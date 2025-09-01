import { PvfFile } from './pvfFile';
import * as iconv from 'iconv-lite';

// Local helper to format floats similar to pvfUtility/DataHelper.FormatFloat
function formatFloat(n: number): string {
  // Keep exactly two decimal places for ANI output
  return n.toFixed(2);
}

export enum ANIData {
  LOOP = 0,
  SHADOW = 1,
  COORD = 3,
  IMAGE_RATE = 7,
  IMAGE_ROTATE = 8,
  RGBA = 9,
  INTERPOLATION = 10,
  GRAPHIC_EFFECT = 11,
  DELAY = 12,
  DAMAGE_TYPE = 13,
  DAMAGE_BOX = 14,
  ATTACK_BOX = 15,
  PLAY_SOUND = 16,
  PRELOAD = 17,
  SPECTRUM = 18,

  SET_FLAG = 23,
  FLIP_TYPE = 24,
  LOOP_START = 25,
  LOOP_END = 26,
  CLIP = 27,
  OPERATION = 28
}

export enum Effect_Item {
  NONE = 0,
  DODGE = 1,
  LINEARDODGE = 2,
  DARK = 3,
  XOR = 4,
  MONOCHROME = 5,
  SPACEDISTORT = 6
}

export enum DAMAGE_TYPE_Item { NORMAL = 0, SUPERARMOR = 1, UNBREAKABLE = 2 }
export enum FLIP_TYPE_Item { HORIZON = 1, VERTICAL = 2, ALL = 3 }

// Ported DecompileBinaryAni: returns textual representation or null on failure
export function decompileBinaryAni(f: PvfFile): string | null {
  try {
    if (!f || !f.data || f.dataLen <= 0) return '';
    const buf = f.data.subarray(0, f.dataLen);
    let pos = 0;
    const ensure = (n: number) => { if (pos + n > buf.length) throw new Error('unexpected EOF'); };
    const readByte = (): number => { ensure(1); return buf[pos++]; };
    const readUInt16 = (): number => { ensure(2); const v = buf[pos] | (buf[pos+1] << 8); pos += 2; return v & 0xFFFF; };
    const readInt16 = (): number => { ensure(2); const v = (buf[pos] | (buf[pos+1] << 8)); pos += 2; return (v << 16) >> 16; };
    const readInt32 = (): number => { ensure(4); const v = (buf[pos]) | (buf[pos+1] << 8) | (buf[pos+2] << 16) | (buf[pos+3] << 24); pos += 4; return v | 0; };
    const readFloat = (): string => { ensure(4); const dv = new DataView(buf.buffer, buf.byteOffset + pos, 4); const fval = dv.getFloat32(0, true); pos += 4; return formatFloat(fval); };
    const read256 = (): number => { const b = readByte(); return (256.0 + b) % 256.0; };
    const readString = (len: number): string => { ensure(len); const slice = buf.subarray(pos, pos + len); pos += len; return Buffer.from(slice).toString('ascii'); };

    const frameMax = readUInt16();
    const imgCount = readUInt16();
    const imgList: string[] = [];
    for (let i = 0; i < imgCount; i++) {
      const l = readInt32();
      imgList.push(readString(l));
    }

    const sb: string[] = [];
    const append = (s: string) => sb.push(s);
    append('#PVF_File\r\n');

    const aniOverallItem = readUInt16();
    for (let j = 0; j < aniOverallItem; j++) {
      const data = readUInt16();
      switch (data) {
        case ANIData.LOOP:
        case ANIData.SHADOW:
          append(`[${ANIData[data]}]\r\n\t${readByte()}\r\n`);
          break;
        case ANIData.COORD:
        case ANIData.OPERATION:
          append(`[${ANIData[data]}]\r\n\t${readUInt16()}\r\n`);
          break;
        case ANIData.SPECTRUM:
          append('[SPECTRUM]\r\n');
          append(`\t${readByte()}`);
          append('\r\n\t[SPECTRUM TERM]\r\n\t\t' + String(readInt32()));
          append('\r\n\t[SPECTRUM LIFE TIME]\r\n\t\t' + String(readInt32()));
          append('\r\n\t[SPECTRUM COLOR]\r\n\t\t');
          append(`${read256()}\t${read256()}\t${read256()}\t${read256()}\r\n`);
          append('\t[SPECTRUM EFFECT]\r\n\t\t`' + Effect_Item[readUInt16()] + '`\r\n');
          break;
        default:
          return null;
      }
    }

    append(`[FRAME MAX]\r\n\t${frameMax}\r\n`);
    for (let k = 0; k < frameMax; k++) {
      append(`\r\n[FRAME${String(k).padStart(3, '0')}]\r\n`);
      const aniBoxItem = readUInt16();
      let boxItemText = '';
      for (let l = 0; l < aniBoxItem; l++) {
        const data = readUInt16();
        switch (data) {
          case ANIData.ATTACK_BOX:
            boxItemText += '\t[ATTACK BOX]\r\n\t';
            break;
          case ANIData.DAMAGE_BOX:
            boxItemText += '\t[DAMAGE BOX]\r\n\t';
            break;
          default:
            return null;
        }
        boxItemText += `${readInt32()}\t${readInt32()}\t${readInt32()}\t${readInt32()}\t${readInt32()}\t${readInt32()}\r\n`;
      }

      append('\t[IMAGE]\r\n');
      const imgIndex = readInt16();
      if (imgIndex >= 0) {
        if (imgIndex > imgList.length - 1) return null;
        append(`\t\t\`${imgList[imgIndex]}\`\r\n\t\t${readUInt16()}\r\n`);
      } else {
        append('\t\t``\r\n\t\t0\r\n');
      }

      append(`\t[IMAGE POS]\r\n\t\t${readInt32()}\t${readInt32()}\r\n`);
      const frameItem = readUInt16();
      for (let i = 0; i < frameItem; i++) {
        const data = readUInt16();
        switch (data) {
          case ANIData.LOOP:
          case ANIData.SHADOW:
          case ANIData.INTERPOLATION:
            append(`\t[${ANIData[data]}]\r\n\t\t${readByte()}\r\n`);
            break;
          case ANIData.COORD:
            append(`\t[COORD]\r\n\t\t${readUInt16()}\r\n`);
            break;
          case ANIData.PRELOAD:
            append('\t[PRELOAD]\r\n\t\t1\r\n');
            break;
          case ANIData.IMAGE_RATE:
            append(`\t[IMAGE RATE]\r\n\t\t${readFloat()}\t${readFloat()}\r\n`);
            break;
          case ANIData.IMAGE_ROTATE:
            append(`\t[IMAGE ROTATE]\r\n\t\t${readFloat()}\r\n`);
            break;
          case ANIData.RGBA:
            append(`\t[RGBA]\r\n\t\t${read256()}\t${read256()}\t${read256()}\t${read256()}\r\n`);
            break;
          case ANIData.GRAPHIC_EFFECT: {
            append('\t[GRAPHIC EFFECT]\r\n');
            const effectIndex = readUInt16();
            append(`\t\t\`${Effect_Item[effectIndex]}\`\r\n`);
            if (effectIndex === Effect_Item.MONOCHROME) {
              append(`\t\t${read256()}\t${read256()}\t${read256()}\r\n`);
            }
            if (effectIndex === Effect_Item.SPACEDISTORT) {
              append(`\t\t${readInt16()}\t${readInt16()}\r\n`);
            }
            break;
          }
          case ANIData.DELAY:
            append(`\t[DELAY]\r\n\t\t${readInt32()}\r\n`);
            break;
          case ANIData.DAMAGE_TYPE:
            append(`\t[DAMAGE TYPE]\r\n\t\t\`${DAMAGE_TYPE_Item[readUInt16()]}\`\r\n`);
            break;
          case ANIData.PLAY_SOUND:
            append(`\t[PLAY SOUND]\r\n\t\t\`${readString(readInt32())}\`\r\n`);
            break;
          case ANIData.SET_FLAG:
            append(`\t[SET FLAG]\r\n\t\t${readInt32()}\r\n`);
            break;
          case ANIData.FLIP_TYPE:
            append(`\t[FLIP TYPE]\r\n\t\t\`${FLIP_TYPE_Item[readUInt16()]}\`\r\n`);
            break;
          case ANIData.LOOP_START:
            append('\t[LOOP START]\r\n');
            break;
          case ANIData.LOOP_END:
            append(`\t[LOOP END]\r\n\t\t${readInt32()}\r\n`);
            break;
          case ANIData.CLIP:
            append(`\t[CLIP]\r\n\t\t${readInt16()}\t${readInt16()}\t${readInt16()}\t${readInt16()}\r\n`);
            break;
          default:
            return null;
        }
      }

      append(boxItemText);
    }

    return sb.join('');
  } catch (err) {
    return null;
  }
}
