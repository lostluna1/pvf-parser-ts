import * as vscode from 'vscode';
import * as indexer from '../../npk/indexer';

export interface AlbumEntry { path: string; width: number; height: number; }
export interface Album { sprites: AlbumEntry[]; /* opaque fields allowed */ }

export async function ensureIndex(context: vscode.ExtensionContext){ try { await indexer.loadIndexFromDisk(context); } catch {} }

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();

export async function loadAlbumForImage(context: vscode.ExtensionContext, root: string, imgLogical: string, out?: vscode.OutputChannel): Promise<any | undefined> {
  const fs = await import('fs/promises'); const path = await import('path');
  const cache = (loadAlbumForImage as any)._cache || ((loadAlbumForImage as any)._cache = new Map<string, any>());
  function nDir(d: string){ return d.replace(/^sprite\//,''); }
  let logicalRaw = (imgLogical || '').trim(); logicalRaw = logicalRaw.replace(/^[`'\"]+/, '').replace(/[`'\"]+$/, '');
  let logical = logicalRaw.replace(/\\/g, '/').replace(/^\//, '').toLowerCase(); if (!logical.startsWith('sprite/')) logical = 'sprite/' + logical; const normalizedKey = norm(logical);
  if (cache.has(normalizedKey)) return cache.get(normalizedKey);
  const outc = out || vscode.window.createOutputChannel('PVF');

  // Helper: detect printf-style numeric placeholder like %d or %04d and build regex
  const placeholderRe = /%0?(\d*)d/gi;
  const hasPlaceholder = placeholderRe.test(normalizedKey);
  placeholderRe.lastIndex = 0; // reset
  let placeholderRegex: RegExp | null = null;
  let firstGroupIndex = -1;
  if (hasPlaceholder) {
    // escape regex special chars
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let pattern = '';
    let lastIndex = 0;
    let groupAdded = false;
    let m: RegExpExecArray | null;
    while ((m = placeholderRe.exec(normalizedKey))) {
      const pre = normalizedKey.slice(lastIndex, m.index);
      pattern += esc(pre);
      const widthStr = m[1] || '';
      const width = widthStr ? parseInt(widthStr, 10) : 0;
      if (!groupAdded) { // capture the first numeric group for ranking
        firstGroupIndex = (pattern.match(/\(/g) || []).length; // index of new group among all groups
        pattern += width > 0 ? `(\\d{${width}})` : `(\\d+)`;
        groupAdded = true;
      } else {
        pattern += width > 0 ? `\\d{${width}}` : `\\d+`;
      }
      lastIndex = placeholderRe.lastIndex;
    }
    pattern += esc(normalizedKey.slice(lastIndex));
    placeholderRegex = new RegExp(`^${pattern}$`, 'i');
  }

  // If placeholder exists, try to resolve using index for the smallest number
  if (hasPlaceholder && placeholderRegex) {
    try { await ensureIndex(context); } catch {}
    const idx = indexer.getIndex();
    let bestKey: string | null = null;
    let bestVal: number = Number.POSITIVE_INFINITY;
    const extractNum = (k: string): number | null => {
      const mm = placeholderRegex!.exec(k);
      if (!mm) return null;
      // first capturing group contains the first placeholder digits
      const g = mm[1];
      const num = g ? parseInt(g, 10) : NaN;
      return Number.isFinite(num) ? num : null;
    };
    if (idx && idx.size > 0) {
      for (const k of idx.keys()) {
        const n = extractNum(k);
        if (n === null) continue;
        if (n < bestVal) { bestVal = n; bestKey = k; }
      }
      if (bestKey) {
        try {
          const rec = idx.get(bestKey)!;
          const { readNpkFromBuffer, readFileBuffer } = await import('../../npk/npkReader.js');
          const buf = await readFileBuffer(rec.npk);
          const list = await readNpkFromBuffer(buf, rec.npk);
          const found = list.find((a: any) => norm(a.path||'') === bestKey);
          if (found) { cache.set(normalizedKey, found); try { outc.appendLine(`[Placeholder HIT] ${normalizedKey} -> ${bestKey} in ${rec.npk}`); } catch {} ; return found; }
        } catch (e) { try { outc.appendLine(`[Placeholder IDX ERR] ${normalizedKey} -> ${String(e)}`); } catch {} }
      }
    }
    // Index not available or no match: slow fallback scanning
    const { readNpkEntries, readNpkFromBuffer, readFileBuffer } = await import('../../npk/npkReader.js');
    const scanDirs = [root, path.join(root, 'ImagePacks2')];
    let bestRec: { npk: string; key: string } | null = null; bestVal = Number.POSITIVE_INFINITY;
    for (const dir of scanDirs) {
      try {
        const items = await fs.readdir(dir, { withFileTypes: true });
        for (const it of items) {
          if (!it.isFile()) continue; const lower = it.name.toLowerCase(); if (!lower.endsWith('.npk')) continue; const full = path.join(dir, it.name);
          try {
            const buf = await readFileBuffer(full); const entries = readNpkEntries(buf);
            for (const e of entries) {
              const p = norm(e.path||'');
              const n = extractNum(p);
              if (n === null) continue;
              if (n < bestVal) { bestVal = n; bestRec = { npk: full, key: p }; }
            }
          } catch {}
        }
      } catch {}
    }
    if (bestRec) {
      try {
        const { readNpkFromBuffer, readFileBuffer } = await import('../../npk/npkReader.js');
        const buf = await readFileBuffer(bestRec.npk);
        const list = await readNpkFromBuffer(buf, bestRec.npk);
        const found = list.find((a: any) => norm(a.path||'') === bestRec!.key);
        if (found) { cache.set(normalizedKey, found); try { outc.appendLine(`[Placeholder SCAN HIT] ${normalizedKey} -> ${bestRec.key} in ${bestRec.npk}`); } catch {} ; return found; }
      } catch {}
    }
    // If placeholder couldn't be resolved, continue to normal path which will likely fail and return undefined.
  }
  // try index
  try {
    const rec = await indexer.findNpkFor(normalizedKey);
    if (rec) {
      const { readNpkFromBuffer, readFileBuffer } = await import('../../npk/npkReader.js');
      try {
        const buf = await readFileBuffer(rec.npk);
        const list = await readNpkFromBuffer(buf, rec.npk);
        const hit = list.find((a: any) => norm(a.path||'') === normalizedKey) || list.find((a: any) => norm(a.path||'').endsWith('/' + normalizedKey.split('/').slice(-1).join('/')));
        if (hit) { cache.set(normalizedKey, hit); try { outc.appendLine(`[Index HIT] ${normalizedKey} -> ${rec.npk}`); } catch {} ; return hit; }
      } catch (e) { try { outc.appendLine(`[Index ERR] ${normalizedKey} -> ${String(e)}`); } catch {} }
    }
  } catch (e) { try { outc.appendLine(`[Index ERR] ${normalizedKey} -> ${String(e)}`); } catch {} }
  // scan
  const { readNpkEntries, readNpkFromBuffer, readFileBuffer } = await import('../../npk/npkReader.js');
  const scanDirs = [root, path.join(root, 'ImagePacks2')]; let foundAny = false;
  const wantParts = normalizedKey.split('/'); const tail1 = wantParts.slice(-1).join('/'); const tail2 = wantParts.slice(-2).join('/');
  for (const dir of scanDirs) {
    try {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const it of items) {
        if (!it.isFile()) continue; const lower = it.name.toLowerCase(); if (!lower.endsWith('.npk')) continue; foundAny = true; const full = path.join(dir, it.name);
        try {
          const buf = await readFileBuffer(full); const entries = readNpkEntries(buf);
          let hit = entries.find((e: any) => norm(e.path) === normalizedKey);
          if (!hit) hit = entries.find((e: any) => { const ep = norm(e.path); return ep.endsWith('/' + tail2) || ep.endsWith('/' + tail1); });
          if (hit) {
            const list = await readNpkFromBuffer(buf, full);
            const found = list.find((a: any) => norm(a.path||'') === normalizedKey) || list.find((a: any) => { const ap=norm(a.path||''); return ap.endsWith('/' + tail2) || ap.endsWith('/' + tail1); });
            if (found) { cache.set(normalizedKey, found); return found; }
          }
        } catch {}
      }
    } catch {}
  }
  if (!foundAny) vscode.window.showWarningMessage('在配置目录未发现任何 .npk 文件，请确认 pvf.npkRoot 是否指向 ImagePacks2 或其上一级目录');
  return undefined;
}
