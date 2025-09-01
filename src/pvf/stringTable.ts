import * as iconv from 'iconv-lite';

export class StringTable {
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
          while (list.length < idx) list.push('');
          list[idx] = val;
          continue;
        }
      }
      list.push(line);
    }
    this.list = list.map(s => s ?? '');
    this.isUpdated = true;
  }
  createBinary(): Buffer {
    const enc = (s: string) => iconv.encode(s, this.encoding);
    const dataParts = this.list.map(s => enc(s));
    let count = this.list.length;
    const headerSize = 4 + (count + 1) * 4;
    let dataLen = 0;
    for (const b of dataParts) dataLen += b.length;
    const out = Buffer.allocUnsafe(headerSize + dataLen);
    let p = 0;
    out.writeUInt32LE(count >>> 0, p); p += 4;
    let off = headerSize - 4;
    for (let i = 0; i < count; i++) {
      out.writeUInt32LE(off >>> 0, p); p += 4;
      off += dataParts[i].length;
    }
    out.writeUInt32LE(off >>> 0, p); p += 4;
    for (const b of dataParts) { b.copy(out, p); p += b.length; }
    return out;
  }
}
