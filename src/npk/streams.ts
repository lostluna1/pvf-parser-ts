export class Cursor {
  private o = 0;
  constructor(private b: Buffer, offset = 0) { this.o = offset; }
  get offset() { return this.o; }
  set offset(v: number) { this.o = v; }
  get length() { return this.b.length; }
  slice(start: number, end?: number) { return this.b.subarray(start, end); }
  seekRel(delta: number) { this.o += delta; }
  seekAbs(pos: number) { this.o = pos; }
  readU8(): number { const v = this.b.readUInt8(this.o); this.o += 1; return v; }
  readI32(): number { const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  readU32(): number { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  readI64(): number { const lo = this.b.readUInt32LE(this.o); const hi = this.b.readInt32LE(this.o + 4); this.o += 8; return hi * 0x100000000 + lo; }
  readBytes(len: number): Buffer { const s = this.b.subarray(this.o, this.o + len); this.o += len; return s; }
  readZeroString(encoding: BufferEncoding = 'utf8'): string {
    let end = this.o;
    while (end < this.b.length && this.b[end] !== 0) end++;
    const s = this.b.toString(encoding, this.o, end);
    this.o = Math.min(end + 1, this.b.length);
    return s;
  }
}

export function readPalette(cur: Cursor, count: number): Uint32Array {
  // Each color is 4 bytes stored as [R,G,B,A] in C# WritePalette; but Colors.ReadPalette reads RGBA stream and constructs Color.FromArgb(A,R,G,B).
  // Net effect: bytes order in file is [R,G,B,A]. We'll pack into 0xAABBGGRR (little-endian friendly RGBA).
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const r = cur.readU8();
    const g = cur.readU8();
    const b = cur.readU8();
    const a = cur.readU8();
    out[i] = (a << 24) | (b << 16) | (g << 8) | (r);
  }
  return out;
}
