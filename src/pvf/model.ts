import * as fs from 'fs/promises';
import * as path from 'path';
import { PvfCrypto } from './crypto';
import * as iconv from 'iconv-lite';
import { PvfFile } from './pvfFile';
import { StringTable } from './stringTable';
import { ScriptCompiler } from './scriptCompiler';
import { StringView } from './stringView';
import { openImpl, saveImpl, readAndDecryptImpl } from './modelIO';
import { decompileBinaryAni } from './binaryAni';
import { compileBinaryAni } from './aniCompiler';
import { encodingForKey, isTextByExtension, detectEncoding, isTextEncoding, isPrintableText } from './helpers';
import { getFileNameHashCode as utilGetFileNameHashCode, renderStringTableText as utilRenderStringTableText } from './util';
import { decompileScript } from './scriptDecompiler';
import { decompileLst } from './lstDecompiler';
import { buildMetadataMaps, parseMetadataForKeys } from './metadata';

export interface Progress { (n: number): void }

export interface PvfFileEntry {
  key: string; // normalized lower-case path with '/'
  name: string;
  isFile: boolean;
  size?: number;
}

export class PvfModel {
  private fileList = new Map<string, PvfFile>();
  private guid: Buffer = Buffer.alloc(0);
  private guidLen = 0;
  fileVersion = 0;
  pvfPath = '';
  private baseOffset = 0; // where encrypted file data starts
  private childrenCache = new Map<string, PvfFileEntry[]>(); // parent -> immediate children (lazy)
  private rootChildren: PvfFileEntry[] | null = null;
  private encodingCache = new Map<string, string>(); // key -> detected encoding used on last read/write
  private strtable?: StringTable;
  private strview?: StringView;
  // 映射：文件完整 key -> 代码 / 脚本显示名
  private fileCodeMap = new Map<string, number>();
  private fileDisplayNameMap = new Map<string, string>();
  // 记录文本文件原始信息（目前用于 .ani.als / .als 原样写回）
  private originalTextMeta = new Map<string, { encoding: string; newline: string; hadBom: boolean; finalNewline: boolean }>();
  private originalAlsBytes = new Map<string, Uint8Array>(); // 保存首次读取到的原始 ALS 字节（解密后原始，不含我们再解码重编码）

  async open(filePath: string, progress?: Progress) {
    await openImpl.call(this, filePath, progress);
    // AUTO 模式：尝试基于 stringtable.bin 的可解析度推断区域编码（gb18030 / cp950 / cp949 / shift_jis / utf8）
    try {
      const vscodeMod = await import('vscode');
      const cfg = vscodeMod.workspace.getConfiguration();
      const mode = (cfg.get<string>('pvf.encodingMode', 'AUTO') || 'AUTO').toUpperCase();
      if (mode === 'AUTO') {
        const { setRuntimeEncodingOverride, getRuntimeEncodingOverride } = await import('./helpers.js');
        if (!getRuntimeEncodingOverride()) {
          const stFile = this.getFileByKey('stringtable.bin');
          if (stFile) {
            const raw = await this.readAndDecrypt(stFile);
            const slice = raw.subarray(0, stFile.dataLen);
            const candidates = ['gb18030', 'cp950', 'cp949', 'shift_jis', 'utf8'];
            let bestEnc: string | null = null; let bestScore = -1;
            for (const enc of candidates) {
              try {
                const txt = iconv.decode(Buffer.from(slice), enc);
                // 评分：可打印比例 + 常见汉字/假名出现加权
                const n = Math.min(txt.length, 8000); if (n === 0) continue;
                let printable = 0, cjk = 0;
                for (let i = 0; i < n; i++) {
                  const c = txt.charCodeAt(i);
                  if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) printable++;
                  if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3040 && c <= 0x30ff)) cjk++;
                }
                const score = (printable / n) + cjk * 0.0005; // 假设普通文本含 CJK 则略加分
                if (score > bestScore) { bestScore = score; bestEnc = enc; }
              } catch { /* ignore enc */ }
            }
            if (bestEnc && bestEnc !== 'cp950') {
              setRuntimeEncodingOverride(bestEnc);
              // 重新加载 stringtable 以使用新编码
              try { await this.loadStringAssets(); } catch { }
            }
          }
        }
      }
    } catch { /* ignore auto-detect errors */ }
    // 构建 .lst 解析索引（依赖 stringtable 已在 openImpl 内尝试加载）
    try { if (progress) progress(55); await this.buildListFileIndices(); if (progress) progress(70); } catch { /* ignore parsing errors */ }
    // 取消启动时全量 metadata 解析，改为懒加载（文件夹展开时按需解析）
    if (progress) progress(100);
  }

  // helpers for StringView
  public getStringFromTable(index: number): string | undefined { return this.strtable?.get(index); }
  public getFileByKey(key: string): PvfFile | undefined { return this.fileList.get(key); }
  public getStringView(): StringView | undefined { return this.strview; }
  public async loadFileData(f: PvfFile): Promise<Uint8Array> { return await readAndDecryptImpl.call(this, f); }

  // 对外提供代码/显示名查询
  public getCodeForFile(key: string): number { return this.fileCodeMap.get(key) ?? -1; }
  public getDisplayNameForFile(key: string): string | undefined { return this.fileDisplayNameMap.get(key); }
  // 供 metadata 构建调用，若已存在 lst 提供的名称则 metadata 覆盖
  public setDisplayName(key: string, name: string) { this.fileDisplayNameMap.set(key, name); }

  // 懒解析：提供一个针对一批文件 key 的解析接口（由 provider 调用）
  public async ensureMetadataForFiles(keys: string[]) {
    await parseMetadataForKeys(this, keys);
  }

  async save(filePath: string, progress?: Progress) { return saveImpl.call(this, filePath, progress); }

  getChildren(parent?: string): PvfFileEntry[] {
    if (!parent) {
      if (this.rootChildren) return this.rootChildren;
      const folders = new Map<string, string>(); // folderKey -> name
      const files: PvfFileEntry[] = [];
      for (const key of this.fileList.keys()) {
        const idx = key.indexOf('/');
        if (idx === -1) {
          files.push({ key, name: key, isFile: true });
        } else {
          const folder = key.substring(0, idx);
          if (!folders.has(folder)) folders.set(folder, folder);
        }
      }
      const dirs: PvfFileEntry[] = [...folders.keys()].map(k => ({ key: k, name: k, isFile: false }));
      this.rootChildren = [...files, ...dirs].sort((a, b) => (a.isFile === b.isFile) ? a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) : (a.isFile ? 1 : -1));
      return this.rootChildren;
    }
    if (this.childrenCache.has(parent)) return this.childrenCache.get(parent)!;
    const prefix = parent.endsWith('/') ? parent : parent + '/';
    const seenFolders = new Set<string>();
    const result: PvfFileEntry[] = [];
    for (const key of this.fileList.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.substring(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) {
        // immediate file
        result.push({ key, name: rest, isFile: true });
      } else {
        const childFolder = rest.substring(0, slash);
        const childKey = prefix + childFolder;
        if (!seenFolders.has(childKey)) {
          seenFolders.add(childKey);
          result.push({ key: childKey, name: childFolder, isFile: false });
        }
      }
    }
    result.sort((a, b) => (a.isFile === b.isFile) ? a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) : (a.isFile ? 1 : -1));
    this.childrenCache.set(parent, result);
    return result;
  }

  async getTextViewAsync(key: string): Promise<string> {
    const f = this.fileList.get(key);
    if (!f) return '';
    const data = await this.readAndDecrypt(f);
    const enc = detectEncoding(key, data.subarray(0, f.dataLen));
    this.encodingCache.set(key, enc);
    return iconv.decode(Buffer.from(data.subarray(0, f.dataLen)), enc);
  }

  async readFileBytes(key: string): Promise<Uint8Array> {
    const f = this.fileList.get(key);
    if (!f) return new Uint8Array();
    const raw = await this.readAndDecrypt(f);
    // pvfUtility 行为对齐：
    // - 脚本文件：反编译为文本
    // - .nut：按KR(cp949)文本
    // - stringtable.bin：渲染为可读文本（索引+字符串）
    // - 其他：原样字节
    if (f.isScriptFile) {
      const lowerKey = key.toLowerCase();
      let text: string;
      if (lowerKey.endsWith('.lst')) {
        // Prefer structured LST decompile (two-line per entry). Fallback to generic script.
        text = decompileLst(this, f, lowerKey) || this.decompileScript(f);
      } else {
        text = this.decompileScript(f);
      }
      // .lst 已直接使用专用 decompiler 输出，无需额外格式化
      // 若是脚本形式但扩展是 .ani.als/.als，也记录原始字节（用于 HexDiff）
      if ((lowerKey.endsWith('.ani.als') || lowerKey.endsWith('.als')) && !this.originalAlsBytes.has(lowerKey)) {
        const slice = raw.subarray(0, f.dataLen).slice();
        this.originalAlsBytes.set(lowerKey, slice);
        if (!this.originalTextMeta.has(lowerKey)) {
          // 对脚本我们只需要一个占位 meta，使用当前配置推导编码
          this.originalTextMeta.set(lowerKey, { encoding: encodingForKey(lowerKey), newline: '\n', hadBom: false, finalNewline: text.endsWith('\n') });
        }
      }
      const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    }
    const lower = key.toLowerCase();
    if (lower === 'stringtable.bin') {
      const text = utilRenderStringTableText(this.fileList, this.strtable);
      const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    }
    // 仅 .ani：尝试按 pvfUtility 的 BinaryAniCompiler 解码为文本（优先）
    if ((lower.endsWith('.ani')) && !f.isScriptFile) {
      const txt = decompileBinaryAni(f);
      if (txt !== null) {
        const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(txt, 'utf8')]);
        return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
      }
    }
    if (lower.endsWith('.nut')) {
      // 强制以 KR (cp949) 解码 .nut 文件（忽略全局编码设置）
      const text = iconv.decode(Buffer.from(raw.subarray(0, f.dataLen)), 'cp949');
      const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    }
    // Known text types rendered as UTF-8 with BOM for editing
    if (isTextByExtension(lower) || lower.endsWith('.ani.als') || lower.endsWith('.als')) {
      const sliceForDetect = raw.subarray(0, f.dataLen);
      let enc = detectEncoding(key, sliceForDetect);
      // 强制 ALS 永远使用单字节编码（避免被二进制噪声判成 utf16）
      if (lower.endsWith('.ani.als') || lower.endsWith('.als')) {
        if (enc.startsWith('utf16')) enc = encodingForKey(lower.replace('.ani.als', '.ani'));
      }
      const text = iconv.decode(Buffer.from(sliceForDetect), enc);
      // 仅对 ALS 记录原始换行 / 编码 / BOM，用于原样写回
      if (lower.endsWith('.ani.als') || lower.endsWith('.als')) {
        let newline = '\n';
        if (text.indexOf('\r\n') >= 0) newline = '\r\n';
        else if (text.indexOf('\r') >= 0 && text.indexOf('\n') < 0) newline = '\r';
        const hadBom = sliceForDetect.length >= 3 && sliceForDetect[0] === 0xEF && sliceForDetect[1] === 0xBB && sliceForDetect[2] === 0xBF;
        const finalNewline = /\r?\n$/.test(text);
        if (!this.originalTextMeta.has(lower)) {
          this.originalTextMeta.set(lower, { encoding: enc, newline, hadBom, finalNewline });
        } else {
          // 如果之前误记录为 utf16，纠正为单字节编码
          const meta = this.originalTextMeta.get(lower)!;
          if (meta.encoding.startsWith('utf16')) meta.encoding = enc;
        }
        if (!this.originalAlsBytes.has(lower)) {
          // 复制保留原始字节（不含我们后续 UTF8+BOM 包装）
          this.originalAlsBytes.set(lower, sliceForDetect.slice());
        }
      }
      const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    }
    // Heuristic fallback: try decode as text if it looks textual (UTF-16 or cp94x)
    const slice = raw.subarray(0, f.dataLen);
    const enc2 = detectEncoding(key, slice);
    if (isTextEncoding(enc2)) {
      const text = iconv.decode(Buffer.from(slice), enc2);
      if (isPrintableText(text)) {
        const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
        return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
      }
    }
    return slice;
  }

  updateFileData(key: string, content: Uint8Array): boolean {
    const f = this.fileList.get(key);
    if (!f) return false;
    const lower = key.toLowerCase();

    // 自动 ALS 文本识别：即便原始数据是脚本二进制，只要用户当前写入内容看起来是 ALS（含核心标签），就强制按文本 ALS 保存
    if ((lower.endsWith('.ani.als') || lower.endsWith('.als')) && content.length > 0) {
      let probe = Buffer.from(content).toString('utf8');
      if (probe.charCodeAt(0) === 0xFEFF) probe = probe.slice(1);
      const alsPattern = /\[(use\s+animation|add|none\s+effect\s+add|create\s+draw\s+only\s+object)\]/i;
      if (alsPattern.test(probe)) {
        // 调用覆盖保存（不再走脚本编译）
        if (this.saveAlsTextOverride(lower, probe)) return true;
      }
    }
    // .ani：尝试编译为二进制 (对齐 pvfUtility)；失败则按文本保存
    if (lower.endsWith('.ani')) {
      let text = Buffer.from(content).toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const bin = compileBinaryAni(text, lower);
      if (bin && bin.length > 0) {
        f.writeFileData(bin);
        f.changed = true;
        return true;
      }
      // Fallback: 保持 UTF-8 + BOM（避免回退到单字节导致再打开乱码）
      const utf8 = Buffer.from(text, 'utf8');
      const withBom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), utf8]);
      f.writeFileData(new Uint8Array(withBom.buffer, withBom.byteOffset, withBom.byteLength));
      f.changed = true;
      return true;
    }
    // .ani.als：若原文件不是脚本则按 ALS 文本处理；若是脚本则留给脚本分支
    if (lower.endsWith('.ani.als') && !f.isScriptFile) {
      let text = Buffer.from(content).toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      // 兼容：剥离误混入的 #PVF_File 头（ALS 本不应有）
      if (text.startsWith('#PVF_File')) {
        text = text.replace(/^#PVF_File\s*/, '');
      }
      // 若此前未读取过，补采集原始字节 & 元信息（使用当前 f.data 作为 before）
      if (!this.originalAlsBytes.has(lower) && f.data) {
        const origSlice = f.data.subarray(0, f.dataLen).slice();
        this.originalAlsBytes.set(lower, origSlice);
        if (!this.originalTextMeta.has(lower)) {
          // 粗略猜测编码（按 key 推导），行尾统一检测
          let encGuess = detectEncoding(lower, origSlice);
          if (encGuess.startsWith('utf16')) encGuess = encodingForKey(lower.replace('.ani.als', '.ani'));
          const txtGuess = iconv.decode(Buffer.from(origSlice), encGuess);
          let newline = '\n';
          if (txtGuess.indexOf('\r\n') >= 0) newline = '\r\n'; else if (txtGuess.indexOf('\r') >= 0 && txtGuess.indexOf('\n') < 0) newline = '\r';
          this.originalTextMeta.set(lower, { encoding: encGuess, newline, hadBom: origSlice.length >= 3 && origSlice[0] === 0xEF && origSlice[1] === 0xBB && origSlice[2] === 0xBF, finalNewline: /\r?\n$/.test(txtGuess) });
        }
      }
      const meta = this.originalTextMeta.get(lower);
      if (meta) {
        // 规范化行结束再还原
        const normalized = text.replace(/\r\n|\r|\n/g, '\n');
        let restored = normalized.split('\n').join(meta.newline);
        if (meta.finalNewline && !restored.endsWith(meta.newline)) restored += meta.newline;
        // 强制避免再次写成 utf16
        if (meta.encoding.startsWith('utf16')) meta.encoding = encodingForKey(lower.replace('.ani.als', '.ani'));
        let buf = iconv.encode(restored, meta.encoding);
        if (meta.hadBom && meta.encoding.toLowerCase() === 'utf8') {
          buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), buf]);
        }
        f.writeFileData(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
      } else {
        // 非原始 meta 情况：先尝试当前区域主编码 -> 回退 encodingForKey
        let chosen = encodingForKey(lower.replace('.ani.als', '.ani'));
        try { iconv.encode('test', chosen); } catch { chosen = 'utf8'; }
        const encoded = iconv.encode(text, chosen);
        f.writeFileData(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));
      }
      f.changed = true;
      return true;
    }
    // 独立 .als（非脚本）按文本；脚本留给后面脚本分支
    if (lower.endsWith('.als') && !lower.endsWith('.ani.als') && !f.isScriptFile) {
      let text = Buffer.from(content).toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      if (text.startsWith('#PVF_File')) {
        text = text.replace(/^#PVF_File\s*/, '');
      }
      if (!this.originalAlsBytes.has(lower) && f.data) {
        const origSlice = f.data.subarray(0, f.dataLen).slice();
        this.originalAlsBytes.set(lower, origSlice);
        if (!this.originalTextMeta.has(lower)) {
          let encGuess = detectEncoding(lower, origSlice);
          if (encGuess.startsWith('utf16')) encGuess = encodingForKey(lower);
          const txtGuess = iconv.decode(Buffer.from(origSlice), encGuess);
          let newline = '\n';
          if (txtGuess.indexOf('\r\n') >= 0) newline = '\r\n'; else if (txtGuess.indexOf('\r') >= 0 && txtGuess.indexOf('\n') < 0) newline = '\r';
          this.originalTextMeta.set(lower, { encoding: encGuess, newline, hadBom: origSlice.length >= 3 && origSlice[0] === 0xEF && origSlice[1] === 0xBB && origSlice[2] === 0xBF, finalNewline: /\r?\n$/.test(txtGuess) });
        }
      }
      const meta = this.originalTextMeta.get(lower);
      if (meta) {
        const normalized = text.replace(/\r\n|\r|\n/g, '\n');
        let restored = normalized.split('\n').join(meta.newline);
        if (meta.finalNewline && !restored.endsWith(meta.newline)) restored += meta.newline;
        if (meta.encoding.startsWith('utf16')) meta.encoding = encodingForKey(lower);
        let buf = iconv.encode(restored, meta.encoding);
        if (meta.hadBom && meta.encoding.toLowerCase() === 'utf8') {
          buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), buf]);
        }
        f.writeFileData(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
      } else {
        let chosen = encodingForKey(lower);
        try { iconv.encode('test', chosen); } catch { chosen = 'utf8'; }
        const encoded = iconv.encode(text, chosen);
        f.writeFileData(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));
      }
      f.changed = true;
      return true;
    }
    // stringtable.bin：文本视图（index\tvalue） -> 重新构建二进制
    if (lower === 'stringtable.bin') {
      // parse UTF-8 with BOM optionally
      let text = Buffer.from(content).toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      if (!this.strtable) this.strtable = new StringTable('cp950');
      this.strtable.parseFromText(text);
      const bin = this.strtable.createBinary();
      f.writeFileData(new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength));
      f.changed = true;
      return true;
    }
    // 脚本文件：将文本编译回脚本二进制
    if (f.isScriptFile) {
      let text = Buffer.from(content).toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      if (!this.strtable) this.strtable = new StringTable(encodingForKey('stringtable.bin'));
      const compiler = new ScriptCompiler(this);
      const data = compiler.compile(text);
      if (data) {
        f.writeFileData(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        f.changed = true;
        return true;
      } else {
        // 回退：保持原逻辑（不建议）
        const encoded = Buffer.from(text, 'utf8');
        f.writeFileData(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));
        f.changed = true;
        return true;
      }
    }
    // 如果文本以 #PVF_File 开头，也按脚本编译（应对某些最初未识别为脚本的情况）
    {
      const prefix = Buffer.from(content.subarray(0, Math.min(16, content.length))).toString('utf8');
      if (!lower.endsWith('.nut') && prefix.startsWith('#PVF_File')) {
        let text = Buffer.from(content).toString('utf8');
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        if (!this.strtable) this.strtable = new StringTable(encodingForKey('stringtable.bin'));
        const compiler = new ScriptCompiler(this);
        const data = compiler.compile(text);
        if (data) {
          f.writeFileData(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
          f.changed = true;
          return true;
        }
      }
    }

    // 额外尝试：即便不是已识别脚本，也尝试把文本编译为脚本源（便于新建文件后直接写入脚本）
    // NOTE: .nut 文件应保持为普通文本，不尝试 PVF 二进制脚本编译，否则会被误转成 #PVF_File 结构
    try {
      if (lower.endsWith('.nut')) throw new Error('skip generic compile for .nut');
      // 仅当其不是原生脚本的 ALS 才跳过；脚本型 .ani.als/.als 需保留编译行为
      if ((lower.endsWith('.ani.als') || (lower.endsWith('.als') && !lower.endsWith('.ani.als')))
        && !f.isScriptFile) {
        throw new Error('skip als compile');
      }
      let text = Buffer.from(content).toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      // only attempt compile for plausible text content
      if (text.length > 0) {
        if (!this.strtable) this.strtable = new StringTable(encodingForKey('stringtable.bin'));
        const compiler2 = new ScriptCompiler(this);
        const compiled = compiler2.compile(text);
        if (compiled && compiled.length >= 2 && compiled[0] === 0xB0 && compiled[1] === 0xD0) {
          f.writeFileData(new Uint8Array(compiled.buffer, compiled.byteOffset, compiled.byteLength));
          f.changed = true;
          return true;
        }
      }
    } catch {
      // ignore compile failures and continue fallback
    }

    // .nut：UTF-8 文本 -> 目标编码 (默认 AUTO 下为 cp949)
    if (lower.endsWith('.nut')) {
      let text = Buffer.from(content).toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      // 强制使用 cp949 保存 .nut
      const encoded = iconv.encode(text, 'cp949');
      f.writeFileData(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));
      f.changed = true;
      return true;
    }
    // 其他已知文本类型：UTF-8 -> 封包默认编码（通常 cp950）
    if (isTextByExtension(lower)) {
      let text = Buffer.from(content).toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const enc = encodingForKey(lower);
      const encoded = iconv.encode(text, enc);
      f.writeFileData(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));
      f.changed = true;
      return true;
    }
    // 其他：原样字节
    f.writeFileData(content);
    f.changed = true;
    return true;
  }

  getFileSize(key: string): number {
    const f = this.fileList.get(key);
    return f ? f.dataLen : 0;
  }

  getTextSize(key: string): number {
    const f = this.fileList.get(key);
    if (!f) return 0;
    if (f.isScriptFile) {
      let text = this.decompileScript(f);
      // .lst 已直接使用专用 decompiler 输出
      return Buffer.byteLength(text, 'utf8') + 3;
    }
    const lower = key.toLowerCase();
    if (lower === 'stringtable.bin') {
      const text = utilRenderStringTableText(this.fileList, this.strtable);
      return Buffer.byteLength(text, 'utf8') + 3;
    }
    if (lower.endsWith('.nut')) {
      const src = f.data ? f.data.subarray(0, f.dataLen) : new Uint8Array();
      // 计算大小时同样固定 cp949 -> UTF-8
      const text = iconv.decode(Buffer.from(src), 'cp949');
      return Buffer.byteLength(text, 'utf8') + 3;
    }
    if (isTextByExtension(lower)) {
      const src = f.data ? f.data.subarray(0, f.dataLen) : new Uint8Array();
      const enc = detectEncoding(key, src);
      const text = iconv.decode(Buffer.from(src), enc);
      return Buffer.byteLength(text, 'utf8') + 3;
    }
    // Heuristic fallback for other potential text files
    if (f.data && f.dataLen > 0) {
      const slice = f.data.subarray(0, f.dataLen);
      const enc2 = detectEncoding(key, slice);
      if (isTextEncoding(enc2)) {
        const text = iconv.decode(Buffer.from(slice), enc2);
        if (isPrintableText(text)) return Buffer.byteLength(text, 'utf8') + 3;
      }
    }
    return f.dataLen;
  }

  async exportFile(key: string, dest: string) {
    const f = this.fileList.get(key);
    if (!f) return;
    const data = await this.readAndDecrypt(f);
    await fs.writeFile(dest, Buffer.from(data.subarray(0, f.dataLen)));
  }

  async replaceFile(key: string, srcPath: string) {
    const f = this.fileList.get(key);
    if (!f) return { success: false };
    const buf = await fs.readFile(srcPath);
    f.writeFileData(new Uint8Array(buf));
    f.changed = true;
    return { success: true };
  }

  deleteFile(key: string) {
    this.fileList.delete(key);
    // invalidate caches
    this.childrenCache.clear();
    this.rootChildren = null;
  }

  // Create an empty file with zero bytes. Key should be normalized lower-case with '/'
  createEmptyFile(key: string) {
    const k = key.toLowerCase();
    if (this.fileList.has(k)) return false;
    // default checksum and offsets; zero-length file
    const nameBytes = iconv.encode(k, encodingForKey(k));
    const pf = new PvfFile(utilGetFileNameHashCode(nameBytes), nameBytes, 0, 0, 0);
    pf.writeFileData(new Uint8Array(0));
    pf.changed = true;
    this.fileList.set(k, pf);
    this.childrenCache.clear();
    this.rootChildren = null;
    return true;
  }

  // Create an empty folder represented logically by having files under its key; to create an empty folder, insert a placeholder zero-length entry with a trailing slash marker.
  createFolder(key: string) {
    const k = key.toLowerCase();
    if (this.fileList.has(k)) return false;
    // Represent folder by an entry with zero-length name and no data; keep as non-file by not marking as file in entries (we use presence of trailing entries to show folder)
    // We'll create a hidden placeholder file named `${k}/.folder` so folder exists in listings
    const placeholderKey = `${k}/.folder`;
    const nameBytes = iconv.encode(placeholderKey, encodingForKey(placeholderKey));
    const pf = new PvfFile(utilGetFileNameHashCode(nameBytes), nameBytes, 0, 0, 0);
    pf.writeFileData(new Uint8Array(0));
    pf.changed = true;
    this.fileList.set(placeholderKey, pf);
    this.childrenCache.clear();
    this.rootChildren = null;
    return true;
  }

  deleteFolder(key: string) {
    const prefix = key.endsWith('/') ? key : key + '/';
    const keysToDelete: string[] = [];
    for (const k of this.fileList.keys()) {
      if (k === key || k.startsWith(prefix)) keysToDelete.push(k);
    }
    for (const k of keysToDelete) this.fileList.delete(k);
    this.childrenCache.clear();
    this.rootChildren = null;
    return true;
  }

  private decompileScript(f: PvfFile): string { return decompileScript(this, f); }

  private formatFloat(n: number): string {
    // mimic C# FormatFloat: trim trailing zeros
    const s = n.toFixed(6);
    return s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  }

  private async loadStringAssets(): Promise<void> {
    // filenames are lower-case paths
    const st = this.fileList.get('stringtable.bin');
    if (st) {
      const bytes = await this.readAndDecrypt(st);
      // 使用当前配置的基础编码 (stringtable 不区分扩展，传入一个代表性 key)
      this.strtable = new StringTable(encodingForKey('stringtable.bin'));
      this.strtable.load(bytes.subarray(0, st.dataLen));
    }
    const nstr = this.fileList.get('n_string.lst');
    if (nstr) {
      const bytes = await this.readAndDecrypt(nstr);
      this.strview = new StringView();
      await this.strview.init(bytes.subarray(0, nstr.dataLen), this, encodingForKey('n_string.lst'));
    }
  }

  private async ensureStringTableUpToDate(): Promise<void> {
    if (!this.strtable) return;
    if (!this.strtable.isUpdated) return;
    // Ensure a stringtable.bin entry exists; if missing, create a new PvfFile for it
    const bin = this.strtable.createBinary();
    const existing = this.fileList.get('stringtable.bin');
    if (existing) {
      existing.writeFileData(new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength));
      existing.changed = true;
    } else {
      const nameBytes = iconv.encode('stringtable.bin', encodingForKey('stringtable.bin'));
      const pf = new PvfFile(utilGetFileNameHashCode(nameBytes), nameBytes, bin.length, 0, 0);
      pf.writeFileData(new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength));
      pf.changed = true;
      this.fileList.set('stringtable.bin', pf);
    }
    // Invalidate children cache so new file shows up in tree
    this.childrenCache.clear();
    this.rootChildren = null;
    // After rebuilding, we could refresh StringView if indices changed; skipped for performance
    this.strtable.isUpdated = false;
  }

  // compatibility alias
  private async readAndDecrypt(f: PvfFile): Promise<Uint8Array> { return readAndDecryptImpl.call(this, f); }

  // Return a list of all file keys in the pack
  public getAllKeys(): string[] {
    return Array.from(this.fileList.keys());
  }

  // 获取 ALS 文件当前与原始字节的十六进制比较（截取前后各 N 字节）
  public getAlsByteDiffHex(key: string, span: number = 64): { before?: string; after?: string; lengthBefore: number; lengthAfter: number; isScript: boolean } {
    const lower = key.toLowerCase();
    const orig = this.originalAlsBytes.get(lower);
    const f = this.fileList.get(lower);
    if (!f || !f.data) return { lengthBefore: orig ? orig.length : 0, lengthAfter: 0, isScript: false };
    const cur = f.data.subarray(0, f.dataLen);
    const toHex = (buf: Uint8Array) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const sliceWindow = (buf: Uint8Array) => {
      if (buf.length <= span * 2) return toHex(buf);
      const head = buf.subarray(0, span);
      const tail = buf.subarray(buf.length - span);
      return toHex(head) + ' ... ' + toHex(tail);
    };
    return {
      before: orig ? sliceWindow(orig) : undefined,
      after: sliceWindow(cur),
      lengthBefore: orig ? orig.length : 0,
      lengthAfter: cur.length,
      isScript: !!f.isScriptFile
    };
  }

  // 强制把脚本型 .ani.als / .als 覆盖为纯文本 ALS（忽略脚本编译）
  public saveAlsTextOverride(key: string, text: string): boolean {
    const lower = key.toLowerCase();
    if (!(lower.endsWith('.ani.als') || lower.endsWith('.als'))) return false;
    const f = this.fileList.get(lower);
    if (!f) return false;
    // 去除 BOM 和 #PVF_File 头
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (text.startsWith('#PVF_File')) text = text.replace(/^#PVF_File\s*/, '');
    // 规范化换行 -> 使用当前平台换行策略，这里保持 CRLF? 暂保留原识别：默认 \n
    let newline = '\n';
    if (/\r\n/.test(text)) newline = '\r\n'; else if (/\r(?!\n)/.test(text)) newline = '\r';
    const finalNewline = /\r?\n$/.test(text);
    const normalized = text.replace(/\r\n|\r|\n/g, '\n');
    let restored = normalized.split('\n').join(newline);
    if (finalNewline && !restored.endsWith(newline)) restored += newline;
    const enc = encodingForKey(lower.replace('.ani.als', '.ani'));
    const buf = iconv.encode(restored, enc);
    f.writeFileData(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
    f.changed = true;
    // 更新 meta / 原始缓存为新的文本
    this.originalAlsBytes.set(lower, f.data ? f.data.subarray(0, f.dataLen).slice() : new Uint8Array());
    this.originalTextMeta.set(lower, { encoding: enc, newline, hadBom: false, finalNewline });
    return true;
  }

  /**
   * 解析所有 .lst 文件，将其中 (代码, 名称索引) -> 目标脚本文件 的映射建立到 fileCodeMap/fileDisplayNameMap。
   * 结构参考 pvfUtility：从偏移 2 开始，每 10 字节一项：
   * [0]=flag? [1..4]=code (LE int32) [5]=flag2? [6..9]=nameIndex (LE int32)
   * 名称索引用 stringtable 查出字符串，与 .lst 所在目录拼接成文件 key。
   */
  private async buildListFileIndices(): Promise<void> {
    this.fileCodeMap.clear();
    this.fileDisplayNameMap.clear();
    if (!this.strtable) return; // 需要 stringtable
    for (const [key, f] of this.fileList.entries()) {
      if (!key.endsWith('.lst')) continue;
      try {
        const data = await this.readAndDecrypt(f);
        const len = f.dataLen;
        if (len < 12) continue;
        const basePath = (() => {
          const idx = key.lastIndexOf('/');
          return idx >= 0 ? key.substring(0, idx + 1) : '';
        })();
        // 从偏移 2 开始逐条 10 字节记录
        for (let i = 2; i + 10 <= len; i += 10) {
          const code = (data[i + 1]) | (data[i + 2] << 8) | (data[i + 3] << 16) | (data[i + 4] << 24);
          const nameIdx = (data[i + 6]) | (data[i + 7] << 8) | (data[i + 8] << 16) | (data[i + 9] << 24);
          if (code < 0 || nameIdx < 0) continue;
          const name = this.strtable.get(nameIdx);
          if (!name) continue;
          const fileKey = (basePath + name).replace(/\\/g, '/').toLowerCase();
          // 只在目标文件实际存在且是脚本/ani 之类时记录（不过 pvfUtility 只判断脚本，这里保持宽松）
          if (this.fileList.has(fileKey)) {
            this.fileCodeMap.set(fileKey, code);
            this.fileDisplayNameMap.set(fileKey, name);
          }
        }
      } catch {
        // 单个 .lst 解析失败忽略
      }
    }
  }

  // ===== LST 代码检索辅助访问器 =====
  /** 返回当前已解析的所有带代码映射的脚本文件数量 */
  public getLstCodeEntryCount(): number { return this.fileCodeMap.size; }
  /** 获取所有参与 lst 代码映射的 .lst 文件基路径集合（通过逆向推导：扫描所有 .lst，再判断是否在映射中出现其前缀）。 */
  public getAllLstFilesWithCodes(): string[] {
    const bases = new Set<string>();
    for (const key of this.fileList.keys()) if (key.endsWith('.lst')) bases.add(key);
    return Array.from(bases).sort();
  }
  /** 根据 lst 文件路径与一组代码，返回匹配到的脚本文件 key -> code 列表 (只返回存在的) */
  public getFilesByCodesForLst(lstPath: string, codes: number[]): { key: string; code: number }[] {
    // lstPath 用于限定前缀：lst 所在目录 + displayName == fileKey
    const lower = lstPath.toLowerCase();
    const idx = lower.lastIndexOf('/');
    const baseDir = idx >= 0 ? lower.substring(0, idx + 1) : '';
    const want = new Set<number>(codes);
    const out: { key: string; code: number }[] = [];
    for (const [fileKey, code] of this.fileCodeMap.entries()) {
      if (!fileKey.startsWith(baseDir)) continue;
      if (want.has(code)) out.push({ key: fileKey, code });
    }
    return out;
  }
  /** 直接获取所有 (fileKey -> code) 快照 */
  public getCodeMapSnapshot(): Array<{ key: string; code: number; display?: string }> {
    const arr: Array<{ key: string; code: number; display?: string }> = [];
    for (const [k, c] of this.fileCodeMap.entries()) arr.push({ key: k, code: c, display: this.fileDisplayNameMap.get(k) });
    return arr;
  }

  // Find references to a file key or base filename across script/stringtable/text/.ani files
  public async findReferences(key: string): Promise<string[]> {
    const result: string[] = [];
    const base = key.split('/').pop()!.toLowerCase();
    for (const k of this.fileList.keys()) {
      if (k === key) continue;
      const f = this.fileList.get(k)!;
      try {
        // scripts: decompile and search
        if (f.isScriptFile) {
          const txt = this.decompileScript(f);
          if (txt.toLowerCase().indexOf(base) >= 0 || txt.toLowerCase().indexOf(key.toLowerCase()) >= 0) result.push(k);
          continue;
        }
        const lower = k.toLowerCase();
        // binary ani: try decompile
        if (lower.endsWith('.ani')) {
          const txt = decompileBinaryAni(f as any as PvfFile);
          if (txt && (txt.toLowerCase().indexOf(base) >= 0 || txt.toLowerCase().indexOf(key.toLowerCase()) >= 0)) { result.push(k); continue; }
        }
        // stringtable: render and search
        if (lower === 'stringtable.bin') {
          const txt = utilRenderStringTableText(this.fileList, this.strtable);
          if (txt.toLowerCase().indexOf(base) >= 0 || txt.toLowerCase().indexOf(key.toLowerCase()) >= 0) { result.push(k); continue; }
        }
        // other text-like files: try decode and search
        if (f.data && f.dataLen > 0) {
          const slice = f.data.subarray(0, f.dataLen);
          const enc = detectEncoding(k, slice);
          if (isTextEncoding(enc)) {
            const txt = iconv.decode(Buffer.from(slice), enc).toLowerCase();
            if (txt.indexOf(base) >= 0 || txt.indexOf(key.toLowerCase()) >= 0) { result.push(k); continue; }
          }
        }
      } catch {
        // ignore per-file errors
      }
    }
    return result;
  }
}
