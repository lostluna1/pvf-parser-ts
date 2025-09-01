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
import { encodingForKey, isTextByExtension, detectEncoding, isTextEncoding, isPrintableText, formatListText } from './helpers';
import { getFileNameHashCode as utilGetFileNameHashCode, renderStringTableText as utilRenderStringTableText } from './util';
import { decompileScript } from './scriptDecompiler';

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

  async open(filePath: string, progress?: Progress) { return openImpl.call(this, filePath, progress); }

  // helpers for StringView
  public getStringFromTable(index: number): string | undefined { return this.strtable?.get(index); }
  public getFileByKey(key: string): PvfFile | undefined { return this.fileList.get(key); }
  public async loadFileData(f: PvfFile): Promise<Uint8Array> { return await readAndDecryptImpl.call(this, f); }

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
      let text = this.decompileScript(f);
      const lowerKey = key.toLowerCase();
      if (lowerKey.endsWith('.lst')) text = formatListText(text);
      const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    }
    const lower = key.toLowerCase();
    if (lower === 'stringtable.bin') {
      const text = utilRenderStringTableText(this.fileList, this.strtable);
      const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    }
    // .ani：尝试按 pvfUtility 的 BinaryAniCompiler 解码为文本（优先）
    if (lower.endsWith('.ani') && !f.isScriptFile) {
      const txt = decompileBinaryAni(f);
      if (txt !== null) {
        const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(txt, 'utf8')]);
        return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
      }
    }
    if (lower.endsWith('.nut')) {
      const text = iconv.decode(Buffer.from(raw.subarray(0, f.dataLen)), 'cp949');
      const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    }
    // Known text types (TW: cp950) rendered as UTF-8 with BOM for editing
    if (isTextByExtension(lower)) {
      const sliceForDetect = raw.subarray(0, f.dataLen);
      const enc = detectEncoding(key, sliceForDetect);
      const text = iconv.decode(Buffer.from(sliceForDetect), enc);
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
      if (prefix.startsWith('#PVF_File')) {
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
    try {
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

    // .nut：UTF-8 文本 -> cp949
    if (lower.endsWith('.nut')) {
      let text = Buffer.from(content).toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
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
      if (key.toLowerCase().endsWith('.lst')) text = formatListText(text);
      return Buffer.byteLength(text, 'utf8') + 3;
    }
    const lower = key.toLowerCase();
    if (lower === 'stringtable.bin') {
      const text = utilRenderStringTableText(this.fileList, this.strtable);
      return Buffer.byteLength(text, 'utf8') + 3;
    }
    if (lower.endsWith('.nut')) {
      const src = f.data ? f.data.subarray(0, f.dataLen) : new Uint8Array();
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
    const nameBytes = iconv.encode(k, 'cp949');
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
    const nameBytes = iconv.encode(placeholderKey, 'cp949');
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
      this.strtable = new StringTable('cp950');
      this.strtable.load(bytes.subarray(0, st.dataLen));
    }
    const nstr = this.fileList.get('n_string.lst');
    if (nstr) {
      const bytes = await this.readAndDecrypt(nstr);
      this.strview = new StringView();
      await this.strview.init(bytes.subarray(0, nstr.dataLen), this, 'cp950');
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
      const nameBytes = iconv.encode('stringtable.bin', 'cp949');
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
