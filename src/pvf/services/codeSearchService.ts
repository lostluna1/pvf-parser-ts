import { PvfModel } from '../model';

export interface CodeSearchItem { fileKey: string; code: number; }
export interface CodeSearchProgress { phase: 'index' | 'match' | 'done'; processed?: number; total?: number; }

let codeIndexBuilt = false;
const codeIndex: Map<number, string[]> = new Map();

export async function ensureCodeIndexAsync(model: PvfModel, progress?: (p: CodeSearchProgress) => void): Promise<void> {
  if (codeIndexBuilt) return;
  const snaps = model.getCodeMapSnapshot();
  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i];
    if (!codeIndex.has(snap.code)) codeIndex.set(snap.code, []);
    codeIndex.get(snap.code)!.push(snap.key);
    if (i % 5000 === 0) { progress?.({ phase: 'index', processed: i, total: snaps.length }); await Promise.resolve(); }
  }
  codeIndexBuilt = true;
  progress?.({ phase: 'index', processed: snaps.length, total: snaps.length });
}

export async function searchCodesAsync(raw: string, model: PvfModel, limit = 800, progress?: (p: CodeSearchProgress) => void) {
  await ensureCodeIndexAsync(model, progress);
  const codeTokens = raw.split(/[\s,;，；]+/).filter(Boolean);
  const codeNums = codeTokens.map(t => parseInt(t, 10)).filter(n => !isNaN(n) && n >= 0);
  const seen = new Set<string>();
  const matchedKeys: string[] = [];
  const items: { fileKey: string; code: number }[] = [];
  let processedCodes = 0;
  for (const c of codeNums) {
    const files = codeIndex.get(c);
    processedCodes++;
    if (files) {
      for (const fk of files) {
        if (seen.has(fk)) continue;
        seen.add(fk); matchedKeys.push(fk);
        items.push({ fileKey: fk, code: c });
        if (items.length >= limit) break;
      }
    }
    if (processedCodes % 20 === 0) { progress?.({ phase: 'match', processed: processedCodes, total: codeNums.length }); await Promise.resolve(); }
    if (items.length >= limit) break;
  }
  progress?.({ phase: 'done', processed: processedCodes, total: codeNums.length });
  return { items, matchedKeys };
}

export function resetCodeIndex() { codeIndexBuilt = false; codeIndex.clear(); }
