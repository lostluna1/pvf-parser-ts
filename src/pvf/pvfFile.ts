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
  // C# parity helpers
  get shortName() {
    const fn = this.fileName;
    const idx = fn.lastIndexOf('/');
    return idx >= 0 ? fn.substring(idx + 1) : fn;
  }
  get pathName() {
    const fn = this.fileName;
    const idx = fn.lastIndexOf('/');
    return idx >= 0 ? fn.substring(0, idx) : '';
  }
  get blockLength() { return (this.dataLen + 3) & -4; }
  get isScriptFile() { return this.data && this.data.length >= 2 && ((this.data[0] | (this.data[1] << 8)) === 0xd0b0); }
  get isBinaryAniFile() { return !this.isScriptFile && this.fileName.endsWith('.ani'); }
  get isNutFile() { return !this.isScriptFile && this.fileName.endsWith('.nut'); }
  get isListFile() { return !!this.isScriptFile && this.fileName.endsWith('.lst'); }

  /**
   * 复刻 C# SearchMethods.SearchString (普通模式 / 所有文件) 逻辑。
   * 遍历脚本二进制（已在内存中的解密数据；若未解密则直接跳过，不主动解密以符合用户要求）。
   * 数据结构：从偏移 2 开始，每 5 字节为一条 [flag(1)][value(4)]。
   * 命中条件：flag in {5,7,10} 且 value 在集合；或 (flag==10 且前一条 flag==9) 组合 ((前条 value 高 8 位) <<24) + 当前 value 在集合。
   */
  searchString(nums: Set<number>): boolean {
    if (!this.data || !this.isScriptFile) return false;
    const data = this.data;
    const limit = this.dataLen - 4; // 需要读取 value 的起始上界
    for (let i = 2; i < limit; i += 5) {
      const flag = data[i];
      if (flag === 5 || flag === 7 || flag === 10) {
        const v = (data[i + 1]) | (data[i + 2] << 8) | (data[i + 3] << 16) | (data[i + 4] << 24);
        if (nums.has(v >>> 0)) return true;
      }
      if (i > 4 && flag === 10 && data[i - 5] === 9) {
        // 组合高 8 位与当前 4 字节值
        const hi = data[i - 4];
        const lo = (data[i + 1]) | (data[i + 2] << 8) | (data[i + 3] << 16) | (data[i + 4] << 24);
        const composite = ((hi << 24) >>> 0) + (lo >>> 0);
        if (nums.has(composite >>> 0)) return true;
      }
    }
    return false;
  }

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
