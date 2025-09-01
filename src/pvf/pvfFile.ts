import { PvfCrypto } from './crypto';
import * as iconv from 'iconv-lite';

export class PvfFile {
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
