import { ColorBits } from './types';

// Convert ARGB1555 / ARGB4444 pixel bytes to RGBA8888 buffer (output in RGBA order for Canvas)
export function decodeToRgba(src: Buffer, bits: ColorBits, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount * 4);
  let si = 0;
  for (let i = 0; i < pixelCount; i++) {
    if (bits === ColorBits.ARGB_1555 || bits === ColorBits.ARGB_4444) {
      const b0 = src[si++];
      const b1 = src[si++];
      if (bits === ColorBits.ARGB_1555) {
        let a = (b1 >> 7) & 0x1;
        let r = (b1 >> 2) & 0x1f;
        let g = ((b0 >> 5) & 0x7) | ((b1 & 0x3) << 3);
        let b = b0 & 0x1f;
        a = a ? 0xff : 0x00;
        r = (r << 3) | (r >> 2);
        g = (g << 3) | (g >> 2);
        b = (b << 3) | (b >> 2);
        const o = i * 4;
        out[o + 0] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = a;
      } else {
        // 4444
        const a = b1 & 0xf0;
        const r = (b1 & 0x0f) << 4;
        const g = b0 & 0xf0;
        const b = (b0 & 0x0f) << 4;
        const o = i * 4;
        out[o + 0] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = a;
      }
    } else {
      // Unsupported formats (DXT, LINK) -> transparent pixel
      const o = i * 4;
      out[o + 0] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = 0;
    }
  }
  return out;
}
