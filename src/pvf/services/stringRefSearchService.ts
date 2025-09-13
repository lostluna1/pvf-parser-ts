import { PvfModel } from '../model';
import { StringTable } from '../stringTable';
import { StringView } from '../stringView';
import { PvfFile } from '../pvfFile';

export interface StringRefMatch {
  key: string; // file key
  labels: string[]; // up to 4 labels
}

export interface StringRefResult {
  keyword: string;
  matches: StringRefMatch[];
  elapsed: number;
}

export interface StringRefProgress {
  phase: 'prepare' | 'scan' | 'done';
  processed?: number;
  total?: number;
}


/**
 * 搜索脚本里引用到的 stringtable / stringview 文本。
 * @param model PVF 模型
 * @param keywordRaw 原始查询字符串
 * @returns 匹配结果或 null（无 stringtable）
 */
export async function searchStringReferencesAsync(model: PvfModel, keywordRaw: string, progress?: (p: StringRefProgress) => void, yieldEvery = 300): Promise<StringRefResult | null> {
  const t0 = Date.now();
  progress?.({ phase: 'prepare' });
  const st: StringTable | undefined = (model as any).strtable;
  if (!st) return null;
  const list: string[] = (st as any).list || [];
  const needle = keywordRaw.toLowerCase();
  const nums = new Set<number>();
  const baseValueMap = new Map<number, string>();
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (typeof s === 'string' && s.toLowerCase().includes(needle)) { nums.add(i >>> 0); baseValueMap.set(i >>> 0, s); }
  }
  const sv: StringView | undefined = (model as any).strview;
  const compositeValueMap = new Map<number, string>();
  if (sv) {
    const filesArr: Array<Record<string, string> | undefined> = (sv as any).files || [];
    for (let cat = 0; cat < filesArr.length; cat++) {
      const map = filesArr[cat]; if (!map) continue;
      for (const k in map) {
        const v = map[k]; if (!v) continue;
        if (v.toLowerCase().includes(needle)) {
          const idx = list.indexOf(k);
          if (idx >= 0) {
            const composite = ((cat << 24) >>> 0) + (idx >>> 0);
            nums.add(composite >>> 0);
            compositeValueMap.set(composite >>> 0, v);
          }
        }
      }
    }
  }
  if (nums.size === 0) return { keyword: keywordRaw, matches: [], elapsed: Date.now() - t0 };

  const fileMap: Map<string, PvfFile> = (model as any).fileList;
  const keys = model.getAllKeys();
  const matches: StringRefMatch[] = [];
  progress?.({ phase: 'scan', processed: 0, total: keys.length });

  const extractLabels = (f: PvfFile): string[] => {
    if (!f.data) return [];
    const out: string[] = [];
    const data = f.data;
    const limit = f.dataLen - 4;
    for (let i = 2; i < limit; i += 5) {
      const flag = data[i];
      const lo = (data[i + 1]) | (data[i + 2] << 8) | (data[i + 3] << 16) | (data[i + 4] << 24);
      if ((flag === 5 || flag === 7 || flag === 10) && nums.has(lo >>> 0)) {
        const v = baseValueMap.get(lo >>> 0);
        if (v && out.indexOf(v) === -1) out.push(v);
      }
      if (flag === 10 && i > 4 && data[i - 5] === 9) {
        const cat = data[i - 4];
        const composite = ((cat << 24) >>> 0) + (lo >>> 0);
        if (nums.has(composite >>> 0)) {
          const cv = compositeValueMap.get(composite >>> 0);
          if (cv && out.indexOf(cv) === -1) out.push(cv);
        }
      }
      if (out.length >= 4) break;
    }
    return out;
  };

  for (let idx = 0; idx < keys.length; idx++) {
    const key = keys[idx];
    const f: PvfFile | undefined = fileMap.get(key);
    if (f && f.data && f.isScriptFile) {
      try {
        if (f.searchString(nums)) {
          const labels = extractLabels(f);
          matches.push({ key, labels });
        }
      } catch { /* ignore */ }
    }
    if (idx % yieldEvery === 0) {
      progress?.({ phase: 'scan', processed: idx + 1, total: keys.length });
      await Promise.resolve(); // 让步
    }
  }
  progress?.({ phase: 'done', processed: keys.length, total: keys.length });
  return { keyword: keywordRaw, matches: matches.sort((a, b) => a.key.localeCompare(b.key)), elapsed: Date.now() - t0 };
}

// New: batch search by explicit string IDs (base only) used by CodeLens
export async function searchStringIdReferencesAsync(model: PvfModel, ids: number[], yieldEvery = 400): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (ids.length === 0) return out;
  const idSet = new Set(ids.map(v => v >>> 0));
  const fileMap: Map<string, PvfFile> = (model as any).fileList;
  const keys = model.getAllKeys();
  // Ensure required scripts are loaded
  for (let kIdx = 0; kIdx < keys.length; kIdx++) {
    const key = keys[kIdx];
    const f = fileMap.get(key);
    if (!f) continue;
    if (!f.data) {
      try { await (model as any).loadFileData?.(f); } catch { continue; }
    }
    if (!f.data || !f.isScriptFile) continue;
    const data = f.data;
    const limit = f.dataLen - 4;
    let hitIds: number[] | null = null;
    for (let i = 2; i < limit; i += 5) {
      const flag = data[i];
      if (flag === 5 || flag === 7 || flag === 10) {
        const v = (data[i + 1]) | (data[i + 2] << 8) | (data[i + 3] << 16) | (data[i + 4] << 24);
        const vv = v >>> 0;
        if (idSet.has(vv)) {
          if (!hitIds) hitIds = [];
            if (hitIds.indexOf(vv) === -1) hitIds.push(vv);
        }
      }
      // composite 暂不扫描（只按 base ID）
    }
    if (hitIds) {
      for (const sid of hitIds) {
        let arr = out.get(sid);
        if (!arr) out.set(sid, arr = []);
        arr.push(key);
      }
    }
    if (kIdx % yieldEvery === 0) await Promise.resolve();
  }
  // sort arrays for deterministic output
  out.forEach((arr, k) => arr.sort());
  return out;
}
