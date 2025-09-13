import { PvfModel } from '../model';

export interface FileIndexEntry {
  key: string;
  lower: string;
  base: string;
}

let builtIndex: FileIndexEntry[] | null = null;
let building = false;

export function ensureFileIndex(model: PvfModel): FileIndexEntry[] | null {
  if (!builtIndex && !building) {
    building = true;
    const raw = model.getAllKeys();
    builtIndex = raw.sort().map(k => {
      const base = k.lastIndexOf('/') >= 0 ? k.substring(k.lastIndexOf('/') + 1) : k;
      return { key: k, lower: k.toLowerCase(), base } as FileIndexEntry;
    });
    building = false;
  }
  return builtIndex;
}

export function takeFirstEntries(count: number): FileIndexEntry[] {
  if (!builtIndex) return [];
  return builtIndex.slice(0, count);
}

export function rankFileMatches(token: string, limitCandidates = 8000, limitReturn = 600): FileIndexEntry[] {
  if (!builtIndex) return [];
  const candidates: FileIndexEntry[] = [];
  for (let i = 0; i < builtIndex.length; i++) {
    const e = builtIndex[i];
    if (e.lower.indexOf(token) !== -1) {
      candidates.push(e);
      if (candidates.length >= limitCandidates) break;
    }
  }
  if (!token) return candidates.slice(0, limitReturn);
  return candidates
    .map(e => ({ e, p: e.lower.indexOf(token) }))
    .sort((a, b) => a.p - b.p || a.e.base.length - b.e.base.length || a.e.key.length - b.e.key.length)
    .slice(0, limitReturn)
    .map(o => o.e);
}

export function resetFileIndex() { builtIndex = null; }
