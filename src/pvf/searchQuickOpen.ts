import * as vscode from 'vscode';
import { PvfModel } from './model';
// 已去除 fuzzysort 依赖，改为简单多关键字子串过滤 + 轻量排序

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
  // alwaysShow 以绕过 QuickPick 内部再次过滤（我们自定义过滤），detail 保留完整路径供用户查看/匹配
  return { key: e.key, label: e.base, detail: e.key, alwaysShow: true } as QuickPickItem;
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

// 简单排序：优先匹配位置靠前，其次基名长度，再其次完整路径长度
function simpleRank(tokens: string[], candidates: Entry[], limit = 600): Entry[] {
  if (!tokens.length) return candidates.slice(0, limit);
  const first = tokens[0];
  return candidates
    .map(e => ({ e, p: e.lower.indexOf(first) }))
    .sort((a, b) => a.p - b.p || a.e.base.length - b.e.base.length || a.e.key.length - b.e.key.length)
    .slice(0, limit)
    .map(o => o.e);
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
  qp.placeholder = '搜索 (单关键字 子串过滤)';
  qp.matchOnDescription = false; // 我们自己做过滤
  qp.matchOnDetail = true; // 允许用户输入包含目录的路径直接匹配 detail
    qp.canSelectMany = false;

    // 初始：展示前 200
    qp.items = index.slice(0, 200).map(toItem);

    let disposed = false;
    qp.onDidHide(() => { if (!disposed) qp.dispose(); disposed = true; });

    let debounceTimer: NodeJS.Timeout | null = null;
  let lastQuery = '';

    const run = (value: string) => {
      const rawQ = value.trim();
      if (rawQ === lastQuery) return;
      lastQuery = rawQ;
  if (!rawQ) {
        qp.items = index.slice(0, 400).map(toItem);
        qp.title = undefined;
        return;
      }
      const token = rawQ.toLowerCase();
      const candidates: Entry[] = [];
      for (let i = 0; i < index.length; i++) {
        const e = index[i];
        if (e.lower.indexOf(token) !== -1) {
          candidates.push(e);
          if (candidates.length >= 8000) break; // 上限
        }
      }
      const ranked = token ? candidates
        .map(e => ({ e, p: e.lower.indexOf(token) }))
        .sort((a, b) => a.p - b.p || a.e.base.length - b.e.base.length || a.e.key.length - b.e.key.length)
        .slice(0, 600)
        .map(o => o.e) : candidates.slice(0, 600);
      qp.items = ranked.map(toItem);
      qp.title = `候选: ${candidates.length}${candidates.length >= 8000 ? '+' : ''}`;
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
