export enum ImgVersion {
  Other = 0x00,
  Ver1 = 0x01,
  Ver2 = 0x02,
  Ver4 = 0x04,
  Ver5 = 0x05,
  Ver6 = 0x06,
  Ver7 = 0x07,
  Ver8 = 0x08,
  Ver9 = 0x09,
}

export enum ColorBits {
  ARGB_1555 = 0x0e,
  ARGB_4444 = 0x0f,
  ARGB_8888 = 0x10,
  LINK = 0x11,
  DXT_1 = 0x12,
  DXT_3 = 0x13,
  DXT_5 = 0x14,
  UNKNOWN = 0x00,
}

export enum CompressMode {
  ZLIB = 0x06,
  NONE = 0x05,
  DDS_ZLIB = 0x07,
  UNKNOWN = 0x01,
}

export interface Sprite {
  index: number;
  type: ColorBits;
  compressMode: CompressMode;
  width: number;
  height: number;
  length: number;
  x: number;
  y: number;
  frameWidth: number;
  frameHeight: number;
  data?: Buffer;
  targetIndex?: number;
  target?: Sprite;
}

export interface Texture {
  index: number;
  width: number;
  height: number;
  length: number;
  fullLength: number;
  data?: Buffer;
  version: number;
  type: ColorBits;
}

export interface TextureInfo {
  unknown: number;
  textureIndex: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  topFlag: number;
}

export type Palette = Uint32Array; // RGBA8888 packed as 0xAABBGGRR

export interface Album {
  path?: string;
  name: string;
  version: ImgVersion;
  offset: number;
  length: number;
  indexLength: number;
  count: number;
  sprites: Sprite[];
  tables: Palette[]; // Ver4/Ver5 palettes (may be empty)
  textures?: Texture[]; // Ver5
  textureMap?: Map<number, TextureInfo>; // Ver5: spriteIndex -> info
}

export interface NpkEntryMeta {
  offset: number;
  length: number;
  path: string;
}

export interface NpkPackage {
  entries: NpkEntryMeta[];
}
