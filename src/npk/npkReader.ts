import { Cursor } from './streams.js';
import { Album, ImgVersion, NpkEntryMeta } from './types.js';
import { createReadStream, promises as fsp } from 'fs';
import * as zlib from 'zlib';
import { readImgAt } from './imgReader.js';

const NPK_FLAG = 'NeoplePack_Bill';
const IMG_FLAG = 'Neople Img File';
const IMAGE_FLAG = 'Neople Image File';

const KEY_HEADER = 'puchikon@neople dungeon and fighter ';

function buildKey(): Uint8Array {
  const key = new Uint8Array(256);
  const hdr = Buffer.from(KEY_HEADER, 'utf8');
  key.set(hdr.subarray(0, Math.min(256, hdr.length)), 0);
  const ds = Buffer.from('DNF', 'utf8');
  for (let i = hdr.length; i < 255; i++) {
    key[i] = ds[i % 3];
  }
  key[255] = 0;
  return key;
}

const KEY = buildKey();

function readXorPath(cur: Cursor): string {
  // Read up to 256 bytes, xor with KEY[i] until zero terminator, then skip remaining to align
  const bytes = new Uint8Array(256);
  let i = 0;
  while (i < 256) {
    const b = cur.readU8() ^ KEY[i];
    bytes[i] = b;
    if (b === 0) break;
    i++;
  }
  // C# stream.Seek(255 - i) to skip to 256 boundary
  const skip = 255 - i;
  if (skip > 0) cur.seekRel(skip);
  return Buffer.from(bytes.subarray(0, i)).toString('utf8');
}

export function readNpkEntries(buf: Buffer): NpkEntryMeta[] {
  const cur = new Cursor(buf);
  const flag = cur.readZeroString('utf8');
  if (flag !== NPK_FLAG) return [];
  const count = cur.readI32();
  const list: NpkEntryMeta[] = [];
  for (let i = 0; i < count; i++) {
    const offset = cur.readI32();
    const length = cur.readI32();
    const path = readXorPath(cur);
    list.push({ offset, length, path });
  }
  return list;
}

export async function readFileBuffer(filePath: string): Promise<Buffer> {
  const st = await fsp.stat(filePath);
  const fd = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(st.size);
    await fd.read(buf, 0, st.size, 0);
    return buf;
  } finally {
    await fd.close();
  }
}

export async function readNpkFromFile(filePath: string) {
  const buf = await readFileBuffer(filePath);
  return readNpkFromBuffer(buf, filePath);
}


export function readNpkFromBuffer(buf: Buffer, fileNameForSingle?: string) {
  const cur = new Cursor(buf);
  const list: Album[] = [] as any;
  const flag = cur.readZeroString('utf8');
  if (flag === NPK_FLAG) {
    cur.seekAbs(0);
    const entries = readNpkEntries(buf);
    if (entries.length > 0) {
      // skip header+hash (32 bytes) like C# does
      // After ReadInfo, C# seeks to position 32. Their stream likely at end of header; here we just ignore and use entry offsets
    }
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const nextOffset = i < entries.length - 1 ? entries[i + 1].offset : buf.length;
      const album = readImgAt(buf, e.offset, nextOffset - e.offset, e.path);
      list.push(album);
    }
  } else {
    // Not an NPK; treat as single IMG/data chunk
    const name = fileNameForSingle ? fileNameForSingle.split(/[/\\]/).pop() || '' : '';
    const album = readImgAt(buf, 0, buf.length, name);
    list.push(album);
  }
  return list;
}
