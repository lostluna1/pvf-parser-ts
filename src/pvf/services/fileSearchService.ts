import { PvfModel } from '../model';

export interface FileIndexEntry {
  key: string; lower: string; base: string;
}

let builtIndex: FileIndexEntry[] | null = null;
let building = false;

export interface FileSearchProgress { phase: 'index' | 'match' | 'done'; processed?: number; total?: number; }

export async function ensureFileIndexAsync(model: PvfModel, progress?: (p: FileSearchProgress) => void): Promise<FileIndexEntry[] | null> {
  if (builtIndex || building) return builtIndex;
  building = true;
  const raw = model.getAllKeys().sort();
  const out: FileIndexEntry[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const k = raw[i];
    const base = k.lastIndexOf('/') >= 0 ? k.substring(k.lastIndexOf('/') + 1) : k;
    out[i] = { key: k, lower: k.toLowerCase(), base };
    if (i % 1000 === 0) { progress?.({ phase: 'index', processed: i, total: raw.length }); await Promise.resolve(); }
  }
  builtIndex = out;
  building = false;
  progress?.({ phase: 'index', processed: raw.length, total: raw.length });
  return builtIndex;
}

export function getIndexedFirst(count: number): FileIndexEntry[] { return builtIndex ? builtIndex.slice(0, count) : []; }

export async function rankFileMatchesAsync(token: string, limitCandidates = 8000, limitReturn = 600, progress?: (p: FileSearchProgress) => void): Promise<FileIndexEntry[]> {
  if (!builtIndex) return [];
  const candidates: FileIndexEntry[] = [];
  for (let i = 0; i < builtIndex.length; i++) {
    const e = builtIndex[i];
    if (!token || e.lower.indexOf(token) !== -1) {
      candidates.push(e);
      if (candidates.length >= limitCandidates) break;
    }
    if (i % 5000 === 0) { progress?.({ phase: 'match', processed: i, total: builtIndex.length }); await Promise.resolve(); }
  }
  progress?.({ phase: 'match', processed: builtIndex.length, total: builtIndex.length });
  if (!token) return candidates.slice(0, limitReturn);
  return candidates
    .map(e => ({ e, p: e.lower.indexOf(token) }))
    .sort((a, b) => a.p - b.p || a.e.base.length - b.e.base.length || a.e.key.length - b.e.key.length)
    .slice(0, limitReturn)
    .map(o => o.e);
}

export function resetFileIndex() { builtIndex = null; }
