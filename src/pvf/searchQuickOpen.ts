import * as vscode from 'vscode';
import { PvfModel } from './model';

// 运行时动态加载 fuzzysort，避免未安装时直接崩溃
let fuzzysort: any = null;
try { // 尽量不在顶层 import，减少激活时间 & 允许缺失依赖降级
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  fuzzysort = require('fuzzysort');
} catch { /* 忽略，后续走降级路径 */ }

interface QuickPickItem extends vscode.QuickPickItem { key: string; }
interface Entry { key: string; lower: string; base: string; }

let builtIndex: Entry[] | null = null;
let building = false;

function buildIndex(keys: string[]): Entry[] {
  const t0 = Date.now();
  const res: Entry[] = new Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const base = k.lastIndexOf('/') >= 0 ? k.substring(k.lastIndexOf('/') + 1) : k;
    res[i] = { key: k, lower: k.toLowerCase(), base };
  }
  const took = Date.now() - t0;
  if (took > 800) console.log(`[pvf] search index built ${keys.length} items in ${took}ms`);
  return res;
}

function toItem(e: Entry): QuickPickItem {
  return { key: e.key, label: e.base, detail: e.key };
}

// 基础粗筛：tokens 全包含（子串）
function coarseFilter(tokens: string[], source: Entry[], baseSet?: Entry[], limit = 8000): Entry[] {
  if (!tokens.length) return source.slice(0, 600);
  const arr = baseSet || source;
  const out: Entry[] = [];
  outer: for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    const l = e.lower;
    for (const t of tokens) { if (l.indexOf(t) === -1) continue outer; }
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

function fuzzyRank(query: string, candidates: Entry[], limit = 600): Entry[] {
  if (!query) return candidates.slice(0, limit);
  if (!fuzzysort) { // 降级：简单长度 + index 排序
    const ql = query.length;
    return candidates
      .map(e => ({ e, p: e.lower.indexOf(query) }))
      .filter(o => o.p >= 0)
      .sort((a, b) => a.p - b.p || a.e.key.length - b.e.key.length)
      .slice(0, limit)
      .map(o => o.e);
  }
  // fuzzysort 正常使用：对 lower 字段打分
  const r = fuzzysort.go(query, candidates, { key: 'lower', limit, threshold: -1000 });
  return r.map((x: any) => x.obj as Entry);
}

export function registerSearchInPack(context: vscode.ExtensionContext, model: PvfModel) {
  context.subscriptions.push(vscode.commands.registerCommand('pvf.searchInPack', async () => {
    if (!(model as any).pvfPath || model.getAllKeys().length === 0) {
      vscode.window.showWarningMessage('请先打开一个 PVF 文件');
      return;
    }

    // 懒构建索引
    if (!builtIndex && !building) {
      building = true;
      const raw = model.getAllKeys();
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: '构建搜索索引…' }, async () => {
        builtIndex = buildIndex(raw.sort());
      });
      building = false;
    }
    if (!builtIndex) { vscode.window.showErrorMessage('索引尚未构建'); return; }
    const index = builtIndex;

    const qp = vscode.window.createQuickPick<QuickPickItem>();
    qp.placeholder = '搜索 (支持空格分隔多关键字, 先子串粗筛再模糊)';
    qp.matchOnDescription = false; // 我们自己做过滤
    qp.matchOnDetail = false;
    qp.canSelectMany = false;

    // 初始：展示前 200
    qp.items = index.slice(0, 200).map(toItem);

    let disposed = false;
    qp.onDidHide(() => { if (!disposed) qp.dispose(); disposed = true; });

    let debounceTimer: NodeJS.Timeout | null = null;
    let lastQuery = '';
    let lastCoarse: Entry[] | null = null;

    const run = (value: string) => {
      const rawQ = value.trim();
      if (rawQ === lastQuery) return;
      lastQuery = rawQ;
      if (!rawQ) {
        lastCoarse = null;
        qp.items = index.slice(0, 400).map(toItem);
        qp.title = undefined;
        return;
      }
      const tokens = rawQ.toLowerCase().split(/\s+/).filter(Boolean);
      const prefixNarrow = lastCoarse && tokens.length && rawQ.startsWith(tokens[0]) && value.length > 1;
      const base = prefixNarrow ? lastCoarse || index : index;
      const coarse = coarseFilter(tokens, index, prefixNarrow ? base : undefined);
      lastCoarse = coarse; // 保存用于增量
      // fuzzy 使用整串（去空格）或第一个 token
      const fuzzyPattern = tokens.join(' ');
      const ranked = fuzzyRank(fuzzyPattern, coarse, 600);
      qp.items = ranked.map(toItem);
      qp.title = `候选: ${coarse.length}${coarse.length >= 8000 ? '+' : ''}`;
    };

    const schedule = (val: string) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => run(val), 70); // 60~80ms 手感较好
    };

    qp.onDidChangeValue(v => schedule(v));

    qp.onDidAccept(async () => {
      const sel = qp.selectedItems[0];
      if (!sel) return; qp.hide();
      const uri = vscode.Uri.parse(`pvf:/${sel.key}`);
      try { await vscode.window.showTextDocument(uri, { preview: true }); }
      catch (e) { vscode.window.showErrorMessage('打开文件失败: ' + (e as any)?.message); }
    });

    qp.show();
  }));
}
