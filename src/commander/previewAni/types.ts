export type Tint = [number, number, number, number];

export interface Vec2 { x: number; y: number; }

export interface Box3D { x: number; y: number; z: number; w: number; h: number; d: number; }

export interface FrameSeqEntry {
  img: string;
  idx: number;
  delay: number;
  pos?: Vec2;
  gfx?: string;
  scale?: { x: number; y: number };
  rotate?: number;
  tint?: Tint;
  atk?: Box3D[];
  dmg?: Box3D[];
}

export interface TimelineFrame {
  rgba: string; // base64 of raw RGBA
  w: number;
  h: number;
  delay: number;
  dx: number; // IMAGE POS x
  dy: number; // IMAGE POS y
  fid: number; // frame id from IMG album
  gfx?: string;
  sx?: number;
  sy?: number;
  rot?: number;
  tint?: Tint;
  atk?: Box3D[];
  dmg?: Box3D[];
}
