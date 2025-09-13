import * as vscode from 'vscode';
import { PvfModel } from './model';
import { StringTable } from './stringTable';
import { PvfFile } from './pvfFile';
import { StringView } from './stringView';
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

    let atResults = false; // 标记当前列表是否为一次 @ 搜索结果
    let lastAtQuery: string | null = null;

    const run = (value: string) => {
      const rawQ = value.trim();
      if (rawQ === lastQuery) return;
      lastQuery = rawQ;
  if (!rawQ) {
        qp.items = index.slice(0, 400).map(toItem);
        qp.title = undefined;
        atResults = false;
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
      const value = qp.value.trim();
      // @ 前缀：脚本字符串引用搜索（普通模式 / 全部文件）
      if (value.startsWith('@')) {
        // 若已经是结果阶段，再次回车则尝试打开选中条目
        if (atResults) {
          const sel2 = qp.selectedItems[0];
          if (sel2) {
            qp.hide();
            const uri2 = vscode.Uri.parse(`pvf:/${sel2.key}`);
            try { await vscode.window.showTextDocument(uri2, { preview: true }); } catch (e) { vscode.window.showErrorMessage('打开文件失败: ' + (e as any)?.message); }
          }
          return;
        }
        const keywordRaw = value.slice(1).trim();
        if (!keywordRaw) { vscode.window.showInformationMessage('请输入关键字'); return; }
        qp.busy = true;
        const t0 = Date.now();
        try {
          // 构建字符串索引集合（不新建或修改原 stringtable，只读取已加载的）
          // 访问私有 strtable 需通过 (model as any)
          const st: StringTable | undefined = (model as any).strtable;
          if (!st) { vscode.window.showErrorMessage('未加载 stringtable，无法执行字符串搜索'); return; }
          // 访问其内部列表（TypeScript 无法直接，但我们可以调用 dumpText 后再解析，也可利用 createBinary 代价大；直接 (st as any).list）
          const list: string[] = (st as any).list || []; // stringtable entries
          const needle = keywordRaw.toLowerCase();
          const nums = new Set<number>();
          const baseMatches: number[] = [];
          for (let i = 0; i < list.length; i++) {
            const s = list[i];
            if (typeof s === 'string' && s.toLowerCase().indexOf(needle) >= 0) { nums.add(i >>> 0); baseMatches.push(i >>> 0); }
          }
          // ---- 复刻 C# Strview.SearchstrInFiles：对 stringView 内部各 strlist 文件的 value 做包含匹配 ----
          const sv: StringView | undefined = (model as any).strview;
          if (sv && baseMatches.length >= 0) {
            // 访问内部 files 数组
            const filesArr: Array<Record<string,string>|undefined> = (sv as any).files || [];
            const catCount = filesArr.length;
            const kwLower = needle;
            const toTrad = (s: string) => s; // TODO: 繁体转换占位（用户暂未提供映射）
            const kw2 = toTrad(keywordRaw).toLowerCase();
            for (let cat = 0; cat < catCount; cat++) {
              const map = filesArr[cat];
              if (!map) continue;
              const derived: number[] = [];
              for (const k in map) {
                const v = map[k];
                if (!v) continue;
                const vLower = v.toLowerCase();
                if (vLower.indexOf(kwLower) >= 0 || (kw2 !== kwLower && vLower.indexOf(kw2) >= 0)) {
                  // k 是一个 stringtable 中的 key（指向字符串的“名字”），需要转换成其索引
                  const idx = (st as any).list ? (st as any).list.indexOf(k) : -1;
                  if (idx >= 0) derived.push(idx);
                }
              }
              if (derived.length) {
                for (const di of derived) {
                  const composite = ((cat << 24) >>> 0) + (di >>> 0);
                  nums.add(composite >>> 0);
                }
              }
            }
          }
          if (nums.size === 0) {
            vscode.window.showInformationMessage('未找到匹配的字符串 (stringtable)');
            qp.busy = false; return;
          }
          // 遍历全部已在内存中的脚本文件；不触发解密 (即仅使用已有 f.data)
          const matched: Entry[] = [];
            for (const key of model.getAllKeys()) {
              const f: PvfFile | undefined = (model as any).fileList?.get(key);
              if (!f || !f.data || !f.isScriptFile) continue; // 不主动解密
              try { if (f.searchString(nums)) matched.push({ key, lower: key.toLowerCase(), base: key.split('/').pop() || key }); } catch { /* ignore single file */ }
            }
          if (matched.length === 0) {
            vscode.window.showInformationMessage('未命中任何脚本引用');
            qp.busy = false; return;
          }
          // 用匹配结果替换列表；再次按 Enter / 选择打开文件
          qp.items = matched.sort((a,b)=>a.key.localeCompare(b.key)).map(toItem);
          qp.title = `@${keywordRaw} 结果: ${matched.length} (耗时 ${Date.now()-t0}ms)`;
          atResults = true; lastAtQuery = keywordRaw;
        } finally {
          qp.busy = false;
        }
        return; // 保持 QuickPick 打开
      }
      // 默认：打开所选文件
      const sel = qp.selectedItems[0];
      if (!sel) return; qp.hide();
      const uri = vscode.Uri.parse(`pvf:/${sel.key}`);
      try { await vscode.window.showTextDocument(uri, { preview: true }); }
      catch (e) { vscode.window.showErrorMessage('打开文件失败: ' + (e as any)?.message); }
    });

    // 如果用户在结果阶段修改了 @ 查询（而不是仅回车），需要重置 atResults 让下一次回车重新检索
    qp.onDidChangeValue(v => {
      const trimmed = v.trim();
      if (!trimmed.startsWith('@')) { atResults = false; return; }
      if (atResults && lastAtQuery && trimmed !== '@' + lastAtQuery) {
        atResults = false;
      }
    });

    qp.show();
  }));
}
