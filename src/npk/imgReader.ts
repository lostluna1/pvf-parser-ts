import { Cursor, readPalette } from './streams.js';
import { Album, ColorBits, CompressMode, ImgVersion, Sprite, Texture, TextureInfo } from './types.js';
import { decodeToRgba } from './colors.js';
import * as zlib from 'zlib';

const IMG_FLAG = 'Neople Img File';
const IMAGE_FLAG = 'Neople Image File';

function createEmptyAlbum(): Album {
  return {
    name: '',
    version: ImgVersion.Other,
    offset: 0,
    length: 0,
    indexLength: 0,
    count: 0,
    sprites: [],
    tables: [],
    textures: undefined,
    textureMap: undefined,
  };
}

export function readImgAt(buf: Buffer, offset: number, length: number, path?: string): Album {
  const cur = new Cursor(buf, offset);
  const start = offset;
  const album = createEmptyAlbum();
  album.path = path || '';
  album.name = (path || '').split('/').pop() || (path || '');
  album.offset = offset;
  let flag = cur.readZeroString('utf8');
  if (flag === IMG_FLAG) {
    album.indexLength = cur.readI64();
    album.version = cur.readI32() as ImgVersion;
    album.count = cur.readI32();
    readByVersion(cur, album);
  } else {
    if (flag === IMAGE_FLAG) {
      album.version = ImgVersion.Ver1;
    } else {
      if (length < 0) length = buf.length - offset;
      album.version = ImgVersion.Other;
      cur.seekAbs(start); // reset to beginning for raw data
      if (album.name.toLowerCase().endsWith('.ogg')) {
        album.version = ImgVersion.Other;
        album.indexLength = length - (cur.offset);
      }
    }
    readByVersion(cur, album);
  }
  album.length = (cur.offset - start) + Math.max(0, length - (cur.offset - start));
  return album;
}

function readByVersion(cur: Cursor, album: Album) {
  switch (album.version) {
    case ImgVersion.Ver1:
      readVer1(cur, album);
      break;
    case ImgVersion.Ver2:
    case ImgVersion.Ver6: // uses SecondHandler too
    case ImgVersion.Ver4:
    case ImgVersion.Ver5:
      // Note: Ver4 and Ver5 have headers before SecondHandler structure
      if (album.version === ImgVersion.Ver4) {
        const size = cur.readI32();
        const pal = readPalette(cur, size);
        album.tables = [pal];
        readVer2Struct(cur, album);
      } else if (album.version === ImgVersion.Ver5) {
        readVer5(cur, album);
      } else {
        readVer2Struct(cur, album);
      }
      break;
    default:
      // Treat as unknown/other; no sprites parsed
      album.sprites = [];
      break;
  }
}

function readVer1(cur: Cursor, album: Album) {
  album.indexLength = cur.readI32();
  cur.seekRel(2);
  album.version = cur.readI32() as ImgVersion;
  album.count = cur.readI32();
  const sprites: Sprite[] = [];
  const links: Array<[Sprite, number]> = [];
  for (let i = 0; i < album.count; i++) {
    const s: Sprite = {
      index: i,
      type: cur.readI32() as ColorBits,
      compressMode: CompressMode.UNKNOWN,
      width: 1,
      height: 1,
      length: 0,
      x: 0,
      y: 0,
      frameWidth: 1,
      frameHeight: 1,
      data: undefined,
      targetIndex: undefined,
      target: undefined,
    };
    if (s.type === ColorBits.LINK) {
      const t = cur.readI32();
      s.targetIndex = t;
      links.push([s, t]);
    } else {
      s.compressMode = cur.readI32() as CompressMode;
      s.width = cur.readI32();
      s.height = cur.readI32();
      s.length = cur.readI32();
      s.x = cur.readI32();
      s.y = cur.readI32();
      s.frameWidth = cur.readI32();
      s.frameHeight = cur.readI32();
      if (s.compressMode === CompressMode.NONE) {
        s.length = s.width * s.height * (s.type === ColorBits.ARGB_8888 ? 4 : 2);
      }
      s.data = cur.readBytes(s.length);
    }
    sprites.push(s);
  }
  // resolve links
  for (const [s, t] of links) {
    if (t >= 0 && t < sprites.length && t !== s.index) {
      s.target = sprites[t];
      s.width = s.target.width;
      s.height = s.target.height;
      s.frameWidth = s.target.frameWidth;
      s.frameHeight = s.target.frameHeight;
      s.x = s.target.x;
      s.y = s.target.y;
    } else {
      // invalid -> clear list like C# would
      album.sprites = [];
      return;
    }
  }
  album.sprites = sprites;
}

function readVer2Struct(cur: Cursor, album: Album) {
  const pos = cur.offset + album.indexLength;
  const sprites: Sprite[] = [];
  const links: Array<[Sprite, number]> = [];
  for (let i = 0; i < album.count; i++) {
    const s: Sprite = {
      index: i,
      type: cur.readI32() as ColorBits,
      compressMode: CompressMode.UNKNOWN,
      width: 1,
      height: 1,
      length: 0,
      x: 0,
      y: 0,
      frameWidth: 1,
      frameHeight: 1,
      data: undefined,
      targetIndex: undefined,
      target: undefined,
    };
    if (s.type === ColorBits.LINK) {
      const t = cur.readI32();
      s.targetIndex = t;
      links.push([s, t]);
    } else {
      s.compressMode = cur.readI32() as CompressMode;
      s.width = cur.readI32();
      s.height = cur.readI32();
      s.length = cur.readI32();
      s.x = cur.readI32();
      s.y = cur.readI32();
      s.frameWidth = cur.readI32();
      s.frameHeight = cur.readI32();
    }
    sprites.push(s);
  }
  if (cur.offset < pos) {
    album.sprites = [];
    return;
  }
  // Read pixel blobs for non-link sprites
  for (const s of sprites) {
    if (s.type === ColorBits.LINK) continue;
    if (s.compressMode === CompressMode.NONE) {
      s.length = s.width * s.height * (s.type === ColorBits.ARGB_8888 ? 4 : 2);
    }
    s.data = cur.readBytes(s.length);
  }
  // resolve links similar to Ver1
  for (const [s, t] of links) {
    if (t >= 0 && t < sprites.length && t !== s.index) {
      s.target = sprites[t];
      s.width = s.target.width;
      s.height = s.target.height;
      s.frameWidth = s.target.frameWidth;
      s.frameHeight = s.target.frameHeight;
      s.x = s.target.x;
      s.y = s.target.y;
    } else {
      album.sprites = [];
      return;
    }
  }
  album.sprites = sprites;
}

function readVer5(cur: Cursor, album: Album) {
  const indexCount = cur.readI32();
  album.length = cur.readI32();
  const palCount = cur.readI32();
  if (palCount > 0) {
    const pal = readPalette(cur, palCount);
    album.tables = [pal];
  }
  const textures: Texture[] = [];
  for (let i = 0; i < indexCount; i++) {
    const tex: Texture = {
      version: cur.readI32(),
      type: cur.readI32() as ColorBits,
      index: cur.readI32(),
      length: cur.readI32(),
      fullLength: cur.readI32(),
      width: cur.readI32(),
      height: cur.readI32(),
      data: undefined,
    };
    textures.push(tex);
  }
  const sprites: Sprite[] = [];
  const links: Array<[Sprite, number]> = [];
  const textureMap = new Map<number, TextureInfo>();
  for (let i = 0; i < album.count; i++) {
    const s: Sprite = {
      index: i,
      type: cur.readI32() as ColorBits,
      compressMode: CompressMode.UNKNOWN,
      width: 1,
      height: 1,
      length: 0,
      x: 0,
      y: 0,
      frameWidth: 1,
      frameHeight: 1,
      data: undefined,
      targetIndex: undefined,
      target: undefined,
    };
    if (s.type === ColorBits.LINK) {
      const t = cur.readI32();
      s.targetIndex = t;
      links.push([s, t]);
    } else {
      s.compressMode = cur.readI32() as CompressMode;
      s.width = cur.readI32();
      s.height = cur.readI32();
      s.length = cur.readI32(); // reserved, usually 0
      s.x = cur.readI32();
      s.y = cur.readI32();
      s.frameWidth = cur.readI32();
      s.frameHeight = cur.readI32();
      if (s.type < ColorBits.LINK && s.length !== 0) {
        // ver2-style sprite; data blob will follow after textures
      } else {
        const info: TextureInfo = {
          unknown: cur.readI32(),
          textureIndex: cur.readI32(),
          left: cur.readI32(),
          top: cur.readI32(),
          right: cur.readI32(),
          bottom: cur.readI32(),
          topFlag: cur.readI32(),
        };
        textureMap.set(s.index, info);
      }
    }
    sprites.push(s);
  }
  // resolve links
  for (const [s, t] of links) {
    if (t >= 0 && t < sprites.length && t !== s.index) {
      s.target = sprites[t];
      s.width = s.target.width;
      s.height = s.target.height;
      s.frameWidth = s.target.frameWidth;
      s.frameHeight = s.target.frameHeight;
      s.x = s.target.x;
      s.y = s.target.y;
    } else {
      album.sprites = [];
      return;
    }
  }
  // Read textures blob data
  for (const tex of textures) {
    tex.data = cur.readBytes(tex.length);
  }
  // Read ver2-style sprite data that had non-zero length
  for (const s of sprites) {
    if (s.type < ColorBits.LINK && s.length !== 0) {
      s.data = cur.readBytes(s.length);
    }
  }
  album.textures = textures;
  album.textureMap = textureMap;
  album.sprites = sprites;
}

// Optional: helper to get RGBA pixels for a sprite (Ver1/2/4 basic types only)
export function getSpriteRgba(album: Album, spriteIndex: number): Uint8Array | undefined {
  const s = album.sprites[spriteIndex];
  if (!s) return undefined;
  if (s.type === ColorBits.LINK && s.target) return getSpriteRgba(album, s.target.index);
  const pixelCount = s.width * s.height;
  // Special handling for Ver4 palette-mapped case (ARGB_1555 + ZLIB with palette indices)
  if (album.version === ImgVersion.Ver4 && s.type === ColorBits.ARGB_1555 && s.compressMode === CompressMode.ZLIB) {
    if (!s.data) return undefined;
    try {
      const indices = zlib.inflateSync(s.data);
      const table = album.tables && album.tables[0] ? album.tables[0] : undefined;
      if (!table) return undefined;
      const out = new Uint8Array(pixelCount * 4);
      for (let i = 0; i < pixelCount; i++) {
        const idx = indices[i] ?? 0;
        const rgba = table[idx] || 0;
        const r = rgba & 0xff;
        const g = (rgba >>> 8) & 0xff;
        const b = (rgba >>> 16) & 0xff;
        const a = (rgba >>> 24) & 0xff;
        const o = i * 4;
        out[o + 0] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = a;
      }
      return out;
    } catch {
      return undefined;
    }
  }

  // General cases
  let raw: Buffer | undefined = s.data as any;
  if (!raw) return undefined;
  if (s.compressMode === CompressMode.ZLIB) {
    try { raw = zlib.inflateSync(raw); } catch { return undefined; }
  }
  if (s.type === ColorBits.ARGB_8888) {
    // C# Colors.ReadColor for 8888 copies 4 bytes as B,G,R,A into target buffer.
    // 我们需要 RGBA 顺序供 Canvas 使用，因此将 BGRA -> RGBA。
    if (raw.length < pixelCount * 4) return undefined;
    const out = new Uint8Array(pixelCount * 4);
    let si = 0;
    for (let i = 0; i < pixelCount; i++) {
      const b = raw[si++];
      const g = raw[si++];
      const r = raw[si++];
      const a = raw[si++];
      const o = i * 4;
      out[o + 0] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
    return out;
  }
  if (s.type === ColorBits.ARGB_1555 || s.type === ColorBits.ARGB_4444) {
    // raw should be pixelCount*2
    if (raw.length < pixelCount * 2) return undefined;
    return decodeToRgba(raw.subarray(0, pixelCount * 2), s.type, pixelCount);
  }
  // Other formats (DXT, DDS_ZLIB) not supported yet
  return undefined;
}
