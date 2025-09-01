import * as iconv from 'iconv-lite';
import { PvfModel } from './model';
import { PvfFile } from './pvfFile';

export class StringView {
  private files: Array<Record<string, string> | undefined> = [];
  async init(nStringLstBytes: Uint8Array, model: PvfModel, encoding: string) {
    const len = nStringLstBytes.length;
    const dv = new DataView(nStringLstBytes.buffer, nStringLstBytes.byteOffset, nStringLstBytes.byteLength);
    const count = Math.floor((len - 2) / 10);
    this.files = new Array(count);
    const get4 = (pos: number) => dv.getInt32(pos, true);
    for (let id = 0, i = 2; id < count; id++, i += 10) {
      const nameIdx = get4(i + 6);
      const name = model.getStringFromTable(nameIdx) ?? '';
      const file = name ? model.getFileByKey(name.toLowerCase()) : undefined;
      if (file) {
        const data = await model.loadFileData(file as any as PvfFile);
        if (data && data.length >= file.dataLen) {
          const text = iconv.decode(Buffer.from(data), encoding).replace(/\0+$/, '');
          const map: Record<string, string> = {};
          for (const line of text.split(/\r?\n/)) {
            if (!line || (line.length > 2 && line[0] == '/' && line[1] == '/')) continue;
            const idx = line.indexOf('>');
            if (idx > 0) {
              const k = line.slice(0, idx).trim();
              const v = line.slice(idx + 1).trim();
              if (k) map[k] = v;
            }
          }
          this.files[id] = map;
        }
      }
    }
  }
  get(id: number, name: string): string {
    const m = this.files[id];
    if (!m) return '';
    return m[name] ?? '';
  }
}
