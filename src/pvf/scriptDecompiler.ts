import { PvfFile } from './pvfFile';
import { StringView } from './stringView';
import { StringTable } from './stringTable';

function formatFloat(n: number): string {
  // keep two decimals consistent with ANI policy? Use trim trailing zeros if needed
  const s = n.toFixed(6);
  return s.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

export function decompileScript(model: any, f: PvfFile): string {
  const data = f.data!;
  const items: { t: number, v: number }[] = [];
  for (let i = 2; i < f.dataLen - 4; i += 5) {
    const t = data[i];
    const v = (data[i + 1] | (data[i + 2] << 8) | (data[i + 3] << 16) | (data[i + 4] << 24)) >>> 0;
    if (t >= 2 && t <= 10) items.push({ t, v });
  }
  const sb: string[] = [];
  sb.push('#PVF_File');

  const getStr = (idx: number) => model.getStringFromTable(idx) ?? `#${idx}`;
  const getStrLink = (id: number, nameIdx: number) => model.getStringView()?.get(id, getStr(nameIdx)) ?? '';

  let i = 0;
  while (i < items.length) {
    const { t, v } = items[i];
    // Section tag (heuristic: type==5 or stringtable returns bracketed tag)
    if (t === 5 || (model.getStringFromTable && getStr(v).startsWith('['))) {
      sb.push('');
      sb.push(getStr(v));
      i++;
      while (i < items.length) {
        const nt = items[i].t;
        const nv = items[i].v;
        if (nt === 5 || (model.getStringFromTable && getStr(nv).startsWith('['))) break;
        if (nt === 9 && i + 1 < items.length && items[i + 1].t === 10) {
          const name = getStr(items[i + 1].v);
          const val = getStrLink(nv, items[i + 1].v);
          sb.push(`\t\`${val || ''}\``);
          i += 2;
          continue;
        }
        if (nt === 7) {
          sb.push(`\t\`${getStr(nv)}\``);
          i++;
          continue;
        }
        const line: string[] = [];
        while (i < items.length) {
          const kt = items[i].t;
          const kv = items[i].v;
          if (kt === 5 || kt === 7 || kt === 9) break;
          const f32 = new DataView(new Uint32Array([kv]).buffer).getFloat32(0, true);
          const asFloat = Number.isFinite(f32) && (Math.abs(kv) > 1_000_000 || Math.abs(f32 % 1) > 1e-6);
          line.push(asFloat ? formatFloat(f32) : String(kv));
          i++;
        }
        if (line.length) sb.push('\t' + line.join('\t'));
      }
      continue;
    }
    if (t === 7) {
      sb.push(`\t\`${getStr(v)}\``);
    } else if (t === 9 && i + 1 < items.length && items[i + 1].t === 10) {
      const name = getStr(items[i + 1].v);
      const val = getStrLink(v, items[i + 1].v);
      sb.push(`\t\`${val || ''}\``);
      i++;
    } else {
      const f32 = new DataView(new Uint32Array([v]).buffer).getFloat32(0, true);
      const asFloat = Number.isFinite(f32) && (Math.abs(v) > 1_000_000 || Math.abs(f32 % 1) > 1e-6);
      sb.push((asFloat ? formatFloat(f32) : String(v)));
    }
    i++;
  }
  return sb.join('\n');
}
