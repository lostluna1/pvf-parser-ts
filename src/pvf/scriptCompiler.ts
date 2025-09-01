import { PvfModel } from './model';

export class ScriptCompiler {
  constructor(private model: PvfModel) { }
  compile(scriptText: string): Buffer | null {
    try {
      scriptText = scriptText.replace(/<(\d+::.+?)`.+?`>/g, '<$1``>');
      const out: number[] = [];
      out.push(0xB0, 0xD0);
      const lines = scriptText.split(/\r?\n/);
      for (const lineRaw of lines) {
        const line = lineRaw.trimEnd();
        const hdr = line.trim();
        if (!hdr || hdr.toLowerCase() === '#pvf_file' || hdr.toLowerCase() === '#pvf_file_add') continue;
        const parts = line.split('\t').filter(s => s.length > 0);
        for (const part of parts) {
          const items = this.compileItem(part);
          for (const [t, v] of items) {
            out.push(t & 0xFF);
            out.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF);
          }
        }
      }
      return Buffer.from(out);
    } catch {
      return null;
    }
  }
  private compileItem(item: string): Array<[number, number]> {
    const res: Array<[number, number]> = [];
    const st = (this.model as any)['strtable'] as any;
    const getIdx = (s: string) => st ? (st.getIndex(s) >= 0 ? st.getIndex(s) : st.add(s)) : 0;
    const trim = (s: string) => s.trim();
    if (!item) return res;
    if (item.startsWith('[') && item.endsWith(']')) {
      const idx = getIdx(item);
      res.push([5, idx >>> 0]);
      return res;
    }
    if (item.startsWith('<') && item.endsWith('>')) {
      const inner = item.slice(1, -1);
      const idxDbl = inner.indexOf('::');
      if (idxDbl > 0) {
        const idStr = inner.slice(0, idxDbl);
        const namePart = inner.slice(idxDbl + 2);
        const name = namePart.split('`')[0];
        const id = parseInt(trim(idStr), 10) >>> 0;
        res.push([9, id]);
        const nameIdx = getIdx(name);
        res.push([10, nameIdx >>> 0]);
        return res;
      }
    }
    if (item.startsWith('`') && item.endsWith('`')) {
      const s = item.slice(1, -1);
      const idx = getIdx(s);
      res.push([7, idx >>> 0]);
      return res;
    }
    if (item.startsWith('{') && item.endsWith('}')) {
      const body = item.slice(1, -1);
      const eq = body.indexOf('=');
      const tStr = eq >= 0 ? body.slice(0, eq) : body;
      const vStr = eq >= 0 ? body.slice(eq + 1) : '';
      const t = Math.max(0, Math.min(255, parseInt(trim(tStr), 10) | 0));
      if (t === 0) return res;
      if (vStr.startsWith('`') && vStr.endsWith('`')) {
        const s = vStr.slice(1, -1);
        const idx = getIdx(s);
        res.push([t, idx >>> 0]);
      } else {
        if (vStr.indexOf('.') >= 0) {
          const f = parseFloat(vStr);
          const buf = Buffer.allocUnsafe(4); buf.writeFloatLE(isFinite(f) ? f : 0, 0);
          const val = buf.readUInt32LE(0);
          res.push([t, val >>> 0]);
        } else {
          const n = parseInt(vStr, 10) | 0;
          res.push([t, n >>> 0]);
        }
      }
      return res;
    }
    if (item.indexOf('.') >= 0) {
      const f = parseFloat(item);
      const buf = Buffer.allocUnsafe(4); buf.writeFloatLE(isFinite(f) ? f : 0, 0);
      res.push([4, buf.readUInt32LE(0) >>> 0]);
      return res;
    }
    {
      const n = parseInt(item, 10);
      if (!isNaN(n)) { res.push([2, (n | 0) >>> 0]); return res; }
    }
    return res;
  }
}
