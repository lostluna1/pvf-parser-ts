import * as fs from 'fs/promises';
import * as path from 'path';
import { PvfCrypto } from './crypto';
import * as iconv from 'iconv-lite';

// File name checksum compatible with pvfUtility DataHelper.GetFileNameHashCode
function getFileNameHashCode(dataBytes: Uint8Array): number {
  // Equivalent to C#:
  // var num = dataBytes.Aggregate<byte, uint>(0x1505, (current, t) => 0x21 * current + t);
  // return num * 0x21;
  let num = 0x1505 >>> 0;
  for (let i = 0; i < dataBytes.length; i++) {
    num = ((num * 0x21) + dataBytes[i]) >>> 0;
  }
  return (num * 0x21) >>> 0;
}

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

  async open(filePath: string, progress?: Progress) {
    this.pvfPath = filePath;
    const fd = await fs.open(filePath, 'r');
    let pos = 0;
    const readBuf = async (len: number) => {
      const b = Buffer.alloc(len);
      await fd.read({ buffer: b, position: pos });
      pos += len;
      return b;
    };

    // header
    this.guidLen = (await readBuf(4)).readInt32LE(0);
    this.guid = await readBuf(this.guidLen);
    this.fileVersion = (await readBuf(4)).readInt32LE(0);
    const fileTreeLen = (await readBuf(4)).readInt32LE(0);
    const fileTreeChecksum = (await readBuf(4)).readUInt32LE(0);
    const fileCount = (await readBuf(4)).readInt32LE(0);

    const fileTreeEnc = await readBuf(fileTreeLen);
    const fileTree = PvfCrypto.decrypt(fileTreeEnc, fileTreeLen, fileTreeChecksum);

    this.fileList.clear();
    const dv = new DataView(fileTree.buffer, fileTree.byteOffset, fileTree.byteLength);
    let tp = 0;
    for (let i = 0; i < fileCount; i++) {
      const fileNameChecksum = dv.getUint32(tp, true); tp += 4;
      const nameLen = dv.getUint32(tp, true); tp += 4;
      const nameBytes = fileTree.subarray(tp, tp + nameLen); tp += nameLen;
      const dataLen = dv.getInt32(tp, true); tp += 4;
      const checksum = dv.getUint32(tp, true); tp += 4;
      const offset = dv.getInt32(tp, true); tp += 4;
      const pf = new PvfFile(fileNameChecksum, nameBytes, dataLen, checksum, offset);
      this.fileList.set(pf.fileName, pf);
      if (progress && i % 512 === 0) progress(Math.floor((i / fileCount) * 50));
    }
    this.baseOffset = pos; // remember where data section starts
    await fd.close();

    // reset lazy caches
    this.childrenCache.clear();
    this.rootChildren = null;

    // Load stringtable and string view for script decompile (best-effort)
    try {
      await this.loadStringAssets();
    } catch {
      // ignore, decompile will fallback partially
    }
  }

  // helpers for StringView
  public getStringFromTable(index: number): string | undefined { return this.strtable?.get(index); }
  public getFileByKey(key: string): PvfFile | undefined { return this.fileList.get(key); }
  public async loadFileData(f: PvfFile): Promise<Uint8Array> { return await this.readAndDecrypt(f); }

  async save(filePath: string, progress?: Progress) {
    // Ensure stringtable.bin is rebuilt if updated, mirroring pvfUtility
    await this.ensureStringTableUpToDate();

    const files = [...this.fileList.values()].sort((a, b) => a.fileNameChecksum - b.fileNameChecksum);
    const fileCount = files.length;

    // rebuild file tree
    let fileTreeLen = 0;
    for (const f of files) fileTreeLen += f.fileNameLen + 20;
    fileTreeLen = (fileTreeLen + 3) & -4;

    const fileTree = new Uint8Array(fileTreeLen);
    const dv = new DataView(fileTree.buffer);
    let tp = 0;
    let dataOffset = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      dv.setUint32(tp, f.fileNameChecksum, true); tp += 4;
      dv.setUint32(tp, f.fileNameLen, true); tp += 4;
      fileTree.set(f.fileNameBytes, tp); tp += f.fileNameLen;
      dv.setInt32(tp, f.dataLen, true); tp += 4;
      dv.setUint32(tp, f.checksum, true); tp += 4;
      dv.setInt32(tp, dataOffset, true); tp += 4;
      dataOffset += f.blockLength;
      if (progress && i % 1024 === 0) progress(Math.floor((i / (files.length * 2)) * 100));
    }
    const fileTreeChecksum = PvfCrypto.createBuffKey(fileTree, fileTreeLen, this.fileList.size >>> 0);
    const fileTreeEnc = PvfCrypto.encrypt(fileTree, fileTreeLen, fileTreeChecksum);

    // layout sizes
    const ending = Buffer.from([0, ...Buffer.from('This pvf Pack was created by pvfUtility.')]);
    let totalSize = 4 + this.guidLen + 4 + 4 + 4 + 4 + fileTreeEnc.length;
    for (const f of files) totalSize += f.blockLength;
    totalSize += ending.length;

    const out = Buffer.alloc(totalSize);
    let p = 0;
    out.writeInt32LE(this.guidLen, p); p += 4;
    this.guid.copy(out, p); p += this.guidLen;
    out.writeInt32LE(this.fileVersion, p); p += 4;
    out.writeInt32LE(fileTreeLen, p); p += 4;
    out.writeUInt32LE(fileTreeChecksum, p); p += 4;
    out.writeInt32LE(fileCount, p); p += 4;
    Buffer.from(fileTreeEnc).copy(out, p); p += fileTreeEnc.length;

    // open original for raw copies of unchanged
    const srcFd = this.pvfPath ? await fs.open(this.pvfPath, 'r') : undefined;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f.blockLength > 0) {
          if (f.changed && f.data) {
            const enc = PvfCrypto.encrypt(f.data, f.blockLength, f.checksum);
            Buffer.from(enc).copy(out, p); p += enc.length;
          } else if (srcFd) {
            const buf = Buffer.alloc(f.blockLength);
            await srcFd.read({ buffer: buf, position: this.baseOffset + f.offset });
            buf.copy(out, p); p += buf.length;
          } else {
            // fallback: decrypt+encrypt path (shouldn't happen normally)
            const data = await this.readAndDecrypt(f);
            const enc = PvfCrypto.encrypt(data, f.blockLength, f.checksum);
            Buffer.from(enc).copy(out, p); p += enc.length;
          }
        }
        if (progress && i % 512 === 0) progress(Math.floor(((fileCount + i) / (fileCount * 2)) * 100));
      }
    } finally {
      if (srcFd) await srcFd.close();
    }

    ending.copy(out, p); p += ending.length;
    await fs.writeFile(filePath, out);
    return true;
  }

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
    const enc = this.detectEncoding(key, data.subarray(0, f.dataLen));
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
      const text = this.decompileScript(f);
      const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    }
    const lower = key.toLowerCase();
    if (lower === 'stringtable.bin') {
      const text = this.renderStringTableText();
      const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    }
    if (lower.endsWith('.nut')) {
      const text = iconv.decode(Buffer.from(raw.subarray(0, f.dataLen)), 'cp949');
      const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    }
    // Known text types (TW: cp950) rendered as UTF-8 with BOM for editing
    if (this.isTextByExtension(lower)) {
      const enc = this.encodingForKey(lower);
      const text = iconv.decode(Buffer.from(raw.subarray(0, f.dataLen)), enc);
      const out = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    }
    // Heuristic fallback: try decode as text if it looks textual (UTF-16 or cp94x)
    const slice = raw.subarray(0, f.dataLen);
    const enc2 = this.detectEncoding(key, slice);
    if (this.isTextEncoding(enc2)) {
      const text = iconv.decode(Buffer.from(slice), enc2);
      if (this.isPrintableText(text)) {
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
      if (!this.strtable) this.strtable = new StringTable(this.encodingForKey('stringtable.bin'));
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
        if (!this.strtable) this.strtable = new StringTable(this.encodingForKey('stringtable.bin'));
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
        if (!this.strtable) this.strtable = new StringTable(this.encodingForKey('stringtable.bin'));
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
    if (this.isTextByExtension(lower)) {
      let text = Buffer.from(content).toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const enc = this.encodingForKey(lower);
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
      const text = this.decompileScript(f);
      return Buffer.byteLength(text, 'utf8') + 3;
    }
    const lower = key.toLowerCase();
    if (lower === 'stringtable.bin') {
      const text = this.renderStringTableText();
      return Buffer.byteLength(text, 'utf8') + 3;
    }
    if (lower.endsWith('.nut')) {
      const src = f.data ? f.data.subarray(0, f.dataLen) : new Uint8Array();
      const text = iconv.decode(Buffer.from(src), 'cp949');
      return Buffer.byteLength(text, 'utf8') + 3;
    }
    if (this.isTextByExtension(lower)) {
      const src = f.data ? f.data.subarray(0, f.dataLen) : new Uint8Array();
      const enc = this.encodingForKey(lower);
      const text = iconv.decode(Buffer.from(src), enc);
      return Buffer.byteLength(text, 'utf8') + 3;
    }
    // Heuristic fallback for other potential text files
    if (f.data && f.dataLen > 0) {
      const slice = f.data.subarray(0, f.dataLen);
      const enc2 = this.detectEncoding(key, slice);
      if (this.isTextEncoding(enc2)) {
        const text = iconv.decode(Buffer.from(slice), enc2);
        if (this.isPrintableText(text)) return Buffer.byteLength(text, 'utf8') + 3;
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
    const pf = new PvfFile(getFileNameHashCode(nameBytes), nameBytes, 0, 0, 0);
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
    const pf = new PvfFile(getFileNameHashCode(nameBytes), nameBytes, 0, 0, 0);
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

  private decompileScript(f: PvfFile): string {
    const data = f.data!;
    const items: { t: number, v: number }[] = [];
    for (let i = 2; i < f.dataLen - 4; i += 5) {
      const t = data[i];
      const v = (data[i + 1] | (data[i + 2] << 8) | (data[i + 3] << 16) | (data[i + 4] << 24)) >>> 0;
      if (t >= 2 && t <= 10) items.push({ t, v });
    }
    const sb: string[] = [];
    sb.push('#PVF_File');

    const getStr = (idx: number) => this.strtable?.get(idx) ?? `#${idx}`;
    const getStrLink = (id: number, nameIdx: number) => this.strview?.get(id, getStr(nameIdx)) ?? '';

    let i = 0;
    while (i < items.length) {
      const { t, v } = items[i];
      // Section tag (heuristic: type==5 or stringtable returns bracketed tag)
      if (t === 5 || (this.strtable && getStr(v).startsWith('['))) {
        sb.push('');
        sb.push(getStr(v));
        i++;
        // After a section, emit following values in lines until next section
        // We'll print in reasonable groups: numbers in one line, strings as their own lines
        while (i < items.length) {
          const nt = items[i].t;
          const nv = items[i].v;
          if (nt === 5 || (this.strtable && getStr(nv).startsWith('['))) break;
          // StringLinkIndex + StringLink pair
          if (nt === 9 && i + 1 < items.length && items[i + 1].t === 10) {
            const name = getStr(items[i + 1].v);
            const val = getStrLink(nv, items[i + 1].v);
            sb.push(`\t\`${val || ''}\``);
            i += 2;
            continue;
          }
          // Plain string
          if (nt === 7) {
            sb.push(`\t\`${getStr(nv)}\``);
            i++;
            continue;
          }
          // Numbers (int/float heuristic)
          const line: string[] = [];
          while (i < items.length) {
            const kt = items[i].t;
            const kv = items[i].v;
            if (kt === 5 || kt === 7 || kt === 9) break;
            const f32 = new DataView(new Uint32Array([kv]).buffer).getFloat32(0, true);
            const asFloat = Number.isFinite(f32) && (Math.abs(kv) > 1_000_000 || Math.abs(f32 % 1) > 1e-6);
            line.push(asFloat ? this.formatFloat(f32) : String(kv));
            i++;
          }
          if (line.length) sb.push('\t' + line.join('\t'));
        }
        continue;
      }
      // Fallbacks
      if (t === 7) {
        sb.push(`\t\`${getStr(v)}\``);
      } else if (t === 9 && i + 1 < items.length && items[i + 1].t === 10) {
        const name = getStr(items[i + 1].v);
        const val = getStrLink(v, items[i + 1].v);
        sb.push(`\t\`${val || ''}\``);
        i++;
      } else {
        const f32 = new DataView(new Uint32Array([v]).buffer).getFloat32(0, true);
        const asFloat = Number.isFinite(f32) && (Math.abs(v) > 1_000_000 || Math.abs(f32 % 1) > 1e-6);
        sb.push((asFloat ? this.formatFloat(f32) : String(v)));
      }
      i++;
    }
    return sb.join('\n');
  }

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

  private async readAndDecrypt(f: PvfFile): Promise<Uint8Array> {
    if (f.data) return f.data;
    // read raw encrypted bytes from pvf on disk and decrypt
    const fd = await fs.open(this.pvfPath, 'r');
    try {
      const buf = Buffer.alloc(f.blockLength);
      await fd.read({ buffer: buf, position: this.baseOffset + f.offset });
      const dec = PvfCrypto.decrypt(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), f.blockLength, f.checksum);
      // zero padding
      for (let i = 0; i < f.blockLength - f.dataLen; i++) dec[f.dataLen + i] = 0;
      f.data = dec; // cache
      return dec;
    } finally {
      await fd.close();
    }
  }

  private encodingForKey(key: string): string {
    const lower = key.toLowerCase();
    if (lower.endsWith('.nut')) return 'cp949';
    return 'cp950';
  }

  private isTextByExtension(lowerKey: string): boolean {
    // Extendable list; treat these as text files decoded via encodingForKey
    return lowerKey.endsWith('.skl')
      || lowerKey.endsWith('.lst')
      || lowerKey.endsWith('.txt')
      || lowerKey.endsWith('.cfg')
      || lowerKey.endsWith('.def')
      || lowerKey.endsWith('.inc')
      || lowerKey.endsWith('.xml');
  }

  private detectEncoding(key: string, bytes: Uint8Array): string {
    // 1) Explicit rules first
    const preferred = this.encodingForKey(key);
    if (bytes.length >= 2) {
      // BOM checks
      if (bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf16le';
      if (bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf16be';
    }
    // 2) Heuristic: UTF-16LE/BE detection via NUL distribution
    if (bytes.length >= 10) {
      let nulEven = 0, nulOdd = 0;
      const n = Math.min(bytes.length, 4096);
      for (let i = 0; i < n; i++) {
        if (bytes[i] === 0) {
          if ((i & 1) === 0) nulEven++; else nulOdd++;
        }
      }
      const nulRatio = (nulEven + nulOdd) / n;
      if (nulRatio > 0.2) {
        // decide endianness by which side has more zeros
        return nulEven > nulOdd ? 'utf16le' : 'utf16be';
      }
    }
    // 3) Default to preferred (TW for non-.nut)
    return preferred;
  }

  private isTextEncoding(enc: string): boolean {
    return enc === 'utf16le' || enc === 'utf16be' || enc === 'cp949' || enc === 'cp950' || enc === 'utf8';
  }

  private isPrintableText(text: string): boolean {
    if (!text) return false;
    const n = Math.min(text.length, 4096);
    if (n === 0) return false;
    let printable = 0;
    for (let i = 0; i < n; i++) {
      const c = text.charCodeAt(i);
      // allow common whitespace and CJK, punctuation etc.
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) printable++;
    }
    return (printable / n) > 0.85;
  }

  private renderStringTableText(): string {
    if (this.strtable) return this.strtable.dumpText();
    const f = this.fileList.get('stringtable.bin');
    if (!f) return '';
    const bytes = f.data ? f.data.subarray(0, f.dataLen) : new Uint8Array();
    const st = new StringTable('cp950');
    st.load(bytes);
    return st.dumpText();
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
      const pf = new PvfFile(getFileNameHashCode(nameBytes), nameBytes, bin.length, 0, 0);
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
}

class PvfFile {
  fileNameBytes: Uint8Array;
  data?: Uint8Array;
  dataLen: number;
  offset: number;
  checksum: number;
  fileNameChecksum: number;
  changed = false;

  constructor(fileNameChecksum: number, fileNameBytes: Uint8Array, dataLen: number, checksum: number, offset: number) {
    this.fileNameChecksum = fileNameChecksum >>> 0;
    this.fileNameBytes = fileNameBytes;
    this.dataLen = dataLen;
    this.checksum = checksum >>> 0;
    this.offset = offset;
  }

  get fileNameLen() { return this.fileNameBytes.length; }
  get fileName() {
    // pvfUtility uses codepage 0x3b5 (949, Korean) for file names
    return iconv.decode(Buffer.from(this.fileNameBytes), 'cp949').replace(/\0+$/, '').replace(/\\/g, '/').toLowerCase();
  }
  get blockLength() { return (this.dataLen + 3) & -4; }
  get isScriptFile() { return this.data && this.data.length >= 2 && ((this.data[0] | (this.data[1] << 8)) === 0xd0b0); }

  initFile(enc: Uint8Array) {
    this.data = PvfCrypto.decrypt(enc, this.blockLength, this.checksum);
    // zero trailing padding
    for (let i = 0; i < this.blockLength - this.dataLen; i++) this.data[this.dataLen + i] = 0;
  }

  writeFileData(bytes: Uint8Array) {
    this.dataLen = bytes.length;
    if (this.dataLen <= 0) { this.data = new Uint8Array(0); return; }
    const block = (this.dataLen + 3) & -4;
    this.data = new Uint8Array(block);
    this.data.set(bytes.subarray(0, this.dataLen));
    this.checksum = PvfCrypto.createBuffKey(this.data, block, this.fileNameChecksum);
  }
}

// --- Helpers ported from pvfUtility idea ---
class StringTable {
  private list: string[] = [];
  private encoding: string;
  public isUpdated = false;
  constructor(encoding: string) { this.encoding = encoding; }
  load(stBytes: Uint8Array) {
    if (stBytes.length < 8) return;
    const count = new DataView(stBytes.buffer, stBytes.byteOffset, stBytes.byteLength).getInt32(0, true);
    const dv = new DataView(stBytes.buffer, stBytes.byteOffset, stBytes.byteLength);
    this.list = new Array(count);
    for (let i = 0; i < count; i++) {
      const off1 = dv.getInt32(4 + i * 4, true);
      const off2 = dv.getInt32(8 + i * 4, true);
      const len = off2 - off1;
      const start = off1 + 4; // per C# code
      const slice = stBytes.subarray(start, start + len);
      const s = iconv.decode(Buffer.from(slice), this.encoding).replace(/\0+$/, '');
      this.list[i] = s;
    }
    this.isUpdated = false;
  }
  get(idx: number): string { return (idx >= 0 && idx < this.list.length) ? this.list[idx] : `#{${idx}}`; }
  getIndex(str: string): number { return this.list.indexOf(str); }
  add(str: string): number { const i = this.list.indexOf(str); if (i >= 0) return i; this.list.push(str); this.isUpdated = true; return this.list.length - 1; }
  dumpText(): string { return this.list.map((s, i) => `${i}\t${s}`).join('\n'); }
  parseFromText(text: string) {
    // Accept lines in format: "index\tvalue"; if index missing, append sequentially
    const lines = text.split(/\r?\n/);
    const list: string[] = [];
    for (const line of lines) {
      if (!line) continue;
      const tab = line.indexOf('\t');
      if (tab > -1) {
        const idxStr = line.slice(0, tab).trim();
        const val = line.slice(tab + 1);
        const idx = /^\d+$/.test(idxStr) ? parseInt(idxStr, 10) : -1;
        if (idx >= 0) {
          // fill gaps with empty strings if needed
          while (list.length < idx) list.push('');
          list[idx] = val;
          continue;
        }
      }
      // fallback: plain line -> append
      list.push(line);
    }
    this.list = list.map(s => s ?? '');
    this.isUpdated = true;
  }
  createBinary(): Buffer {
    // Follow pvfUtility layout: [count][offsets(count+1)][data...], offsets start counted from after the first 4 bytes
    const enc = (s: string) => iconv.encode(s, this.encoding);
    const dataParts = this.list.map(s => enc(s));
    let count = this.list.length;
    // compute total
    const headerSize = 4 + (count + 1) * 4;
    let dataLen = 0;
    for (const b of dataParts) dataLen += b.length;
    const out = Buffer.allocUnsafe(headerSize + dataLen);
    let p = 0;
    out.writeUInt32LE(count >>> 0, p); p += 4;
    // offsets (relative to start+4)
    let off = headerSize - 4; // first data start index used by C# logic (counted from +4)
    for (let i = 0; i < count; i++) {
      out.writeUInt32LE(off >>> 0, p); p += 4;
      off += dataParts[i].length;
    }
    // last end offset
    out.writeUInt32LE(off >>> 0, p); p += 4;
    // data
    for (const b of dataParts) { b.copy(out, p); p += b.length; }
    return out;
  }
}

// --- Minimal Script Compiler (align with pvfUtility essentials) ---
class ScriptCompiler {
  constructor(private model: PvfModel) { }
  compile(scriptText: string): Buffer | null {
    try {
      // Preprocess: normalize Type10 patterns like <id::name`...`> -> <$1``>
      scriptText = scriptText.replace(/<(\d+::.+?)`.+?`>/g, '<$1``>');
      const out: number[] = [];
      // header 0xB0 0xD0
      out.push(0xB0, 0xD0);
      const lines = scriptText.split(/\r?\n/);
      for (const lineRaw of lines) {
        const line = lineRaw.trimEnd();
        const hdr = line.trim();
        if (!hdr || hdr.toLowerCase() === '#pvf_file' || hdr.toLowerCase() === '#pvf_file_add') continue;
        const parts = line.split('\t').filter(s => s.length > 0);
        for (const part of parts) {
          const items = this.compileItem(part);
          for (const [t, v] of items) {
            out.push(t & 0xFF);
            // int32 LE
            out.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF);
          }
        }
      }
      return Buffer.from(out);
    } catch {
      return null;
    }
  }
  private compileItem(item: string): Array<[number, number]> {
    const res: Array<[number, number]> = [];
    const st = this.model['strtable'] as any as StringTable | undefined;
    const getIdx = (s: string) => st ? (st.getIndex(s) >= 0 ? st.getIndex(s) : st.add(s)) : 0;
    const trim = (s: string) => s.trim();
    if (!item) return res;
    // Section [name]
    if (item.startsWith('[') && item.endsWith(']')) {
      const idx = getIdx(item);
      res.push([5, idx >>> 0]);
      return res;
    }
    // Type10: <id::name``>
    if (item.startsWith('<') && item.endsWith('>')) {
      const inner = item.slice(1, -1);
      const idxDbl = inner.indexOf('::');
      if (idxDbl > 0) {
        const idStr = inner.slice(0, idxDbl);
        const namePart = inner.slice(idxDbl + 2);
        const name = namePart.split('`')[0];
        const id = parseInt(trim(idStr), 10) >>> 0;
        res.push([9, id]);
        const nameIdx = getIdx(name);
        res.push([10, nameIdx >>> 0]);
        return res;
      }
    }
    // Backtick string
    if (item.startsWith('`') && item.endsWith('`')) {
      const s = item.slice(1, -1);
      const idx = getIdx(s);
      res.push([7, idx >>> 0]);
      return res;
    }
    // Special {type=val} or {type=`str`}
    if (item.startsWith('{') && item.endsWith('}')) {
      const body = item.slice(1, -1);
      const eq = body.indexOf('=');
      const tStr = eq >= 0 ? body.slice(0, eq) : body;
      const vStr = eq >= 0 ? body.slice(eq + 1) : '';
      const t = Math.max(0, Math.min(255, parseInt(trim(tStr), 10) | 0));
      if (t === 0) return res; // ignore
      if (vStr.startsWith('`') && vStr.endsWith('`')) {
        const s = vStr.slice(1, -1);
        const idx = getIdx(s);
        res.push([t, idx >>> 0]);
      } else {
        // number
        if (vStr.indexOf('.') >= 0) {
          // float -> store as float bits
          const f = parseFloat(vStr);
          const buf = Buffer.allocUnsafe(4); buf.writeFloatLE(isFinite(f) ? f : 0, 0);
          const val = buf.readUInt32LE(0);
          res.push([t, val >>> 0]);
        } else {
          const n = parseInt(vStr, 10) | 0;
          res.push([t, n >>> 0]);
        }
      }
      return res;
    }
    // Numbers
    if (item.indexOf('.') >= 0) {
      const f = parseFloat(item);
      const buf = Buffer.allocUnsafe(4); buf.writeFloatLE(isFinite(f) ? f : 0, 0);
      res.push([4, buf.readUInt32LE(0) >>> 0]);
      return res;
    }
    {
      const n = parseInt(item, 10);
      if (!isNaN(n)) { res.push([2, (n | 0) >>> 0]); return res; }
    }
    // Fallback: ignore token
    return res;
  }
}

class StringView {
  // list of maps by codeIndex
  private files: Array<Record<string, string> | undefined> = [];
  async init(nStringLstBytes: Uint8Array, model: PvfModel, encoding: string) {
    // n_string.lst structure: from 2, every 10 bytes: [type(1),data(4)] x2 where the second data is stringtable index of str file name
    const len = nStringLstBytes.length;
    const dv = new DataView(nStringLstBytes.buffer, nStringLstBytes.byteOffset, nStringLstBytes.byteLength);
    const count = Math.floor((len - 2) / 10);
    this.files = new Array(count);
    const get4 = (pos: number) => dv.getInt32(pos, true);
    for (let id = 0, i = 2; id < count; id++, i += 10) {
      const nameIdx = get4(i + 6);
      const name = model.getStringFromTable(nameIdx) ?? '';
      const file = name ? model.getFileByKey(name.toLowerCase()) : undefined;
      if (file) {
        const data = await model.loadFileData(file);
        if (data && data.length >= file.dataLen) {
          const text = iconv.decode(Buffer.from(data), encoding).replace(/\0+$/, '');
          const map: Record<string, string> = {};
          for (const line of text.split(/\r?\n/)) {
            if (!line || (line.length > 2 && line[0] == '/' && line[1] == '/')) continue;
            const idx = line.indexOf('>');
            if (idx > 0) {
              const k = line.slice(0, idx).trim();
              const v = line.slice(idx + 1).trim();
              if (k) map[k] = v;
            }
          }
          this.files[id] = map;
        }
      }
    }
  }
  get(id: number, name: string): string {
    const m = this.files[id];
    if (!m) return '';
    return m[name] ?? '';
  }
}
