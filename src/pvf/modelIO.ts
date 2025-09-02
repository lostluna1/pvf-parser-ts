import * as fs from 'fs/promises';
import { PvfCrypto } from './crypto';
import { PvfFile } from './pvfFile';

// Note: typed as any to avoid circular type import
export async function openImpl(this: any, filePath: string, progress?: any) {
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

export async function saveImpl(this: any, filePath: string, progress?: any) {
  await this.ensureStringTableUpToDate();

  const files = [...this.fileList.values()].sort((a: any, b: any) => a.fileNameChecksum - b.fileNameChecksum);
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
  // 保存完成后，标记为已清理（不再显示“已修改”装饰）
  for (const f of files) { f.changed = false; }
  return true;
}

export async function readAndDecryptImpl(this: any, f: PvfFile): Promise<Uint8Array> {
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
