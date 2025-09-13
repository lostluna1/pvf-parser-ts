import { PvfModel } from '../model';

export interface CodeSearchItem {
  fileKey: string;
  code: number;
}

let codeIndexBuilt = false;
const codeIndex: Map<number, string[]> = new Map();

export function ensureCodeIndex(model: PvfModel) {
  if (codeIndexBuilt) return;
  for (const snap of model.getCodeMapSnapshot()) {
    if (!codeIndex.has(snap.code)) codeIndex.set(snap.code, []);
    codeIndex.get(snap.code)!.push(snap.key);
  }
  codeIndexBuilt = true;
}

/**
 * 搜索代码
 * @param raw 用户输入的原始查询字符串
 * @param model PVF 模型
 * @param limit 返回的最大结果数量，默认 800
 * @returns 匹配的代码项和文件键
 */
export function searchCodes(raw: string, model: PvfModel, limit = 800) {
  ensureCodeIndex(model);
  const codeTokens = raw.split(/[\s,;，；]+/).filter(Boolean);
  const codeNums = codeTokens.map(t => parseInt(t, 10)).filter(n => !isNaN(n) && n >= 0);
  const seen = new Set<string>();
  const matchedKeys: string[] = [];
  const items: { fileKey: string; code: number }[] = [];
  for (const c of codeNums) {
    const files = codeIndex.get(c);
    if (!files) continue;
    for (const fk of files) {
      if (seen.has(fk)) continue;
      seen.add(fk); matchedKeys.push(fk);
      items.push({ fileKey: fk, code: c });
      if (items.length >= limit) break;
    }
    if (items.length >= limit) break;
  }
  return { items, matchedKeys };
}

export function resetCodeIndex() { codeIndexBuilt = false; codeIndex.clear(); }
