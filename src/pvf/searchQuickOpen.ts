import * as vscode from 'vscode';
import { PvfModel } from './model';
import { StringTable } from './stringTable'; // 保留用于类型提示（服务内部已使用）
// 拆分后的搜索服务
import { ensureFileIndex, takeFirstEntries, rankFileMatches, FileIndexEntry } from './services/fileSearchService';
import { ensureCodeIndex, searchCodes } from './services/codeSearchService';
import { searchStringReferences } from './services/stringRefSearchService';
// 统一搜索入口: 普通文件路径 / @字符串引用(含链接) / #代码 -> 文件（来自 .lst 映射）

interface QuickPickItem extends vscode.QuickPickItem { key: string; }
interface Entry extends FileIndexEntry { }

function toItem(e: FileIndexEntry): QuickPickItem {
  // alwaysShow 以绕过 QuickPick 内部再次过滤（我们自定义过滤），detail 保留完整路径供用户查看/匹配
  return { key: e.key, label: e.base, detail: e.key, alwaysShow: true } as QuickPickItem;
}


export function registerSearchInPack(context: vscode.ExtensionContext, model: PvfModel) {
  context.subscriptions.push(vscode.commands.registerCommand('pvf.searchInPack', async () => {
    if (!(model as any).pvfPath || model.getAllKeys().length === 0) {
      vscode.window.showWarningMessage('请先打开一个 PVF 文件');
      return;
    }

    // 懒构建文件索引（由服务维护）
    let index = ensureFileIndex(model);
    if (!index) {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: '构建搜索索引…' }, async () => {
        index = ensureFileIndex(model);
      });
    }
    if (!index) { vscode.window.showErrorMessage('索引尚未构建'); return; }

    const qp = vscode.window.createQuickPick<QuickPickItem>();
    qp.placeholder = '搜索: 默认搜索文件路径 | @开头搜索字符串引用 | #开头搜索物品代码(.lst)';
    qp.matchOnDescription = false; // 我们自己做过滤
    qp.matchOnDetail = true; // 允许用户输入包含目录的路径直接匹配 detail
    qp.canSelectMany = false;

    // 初始：展示前 200
    qp.items = takeFirstEntries(200).map(toItem);

    let disposed = false;
    qp.onDidHide(() => { if (!disposed) qp.dispose(); disposed = true; });

    let debounceTimer: NodeJS.Timeout | null = null;
    let lastQuery = '';

    let atResults = false; // 当前条目为一次 @ 搜索结果
    let lastAtQuery: string | null = null;
    // # 代码搜索索引保证按需构建（服务内部）

    const run = (value: string) => {
      const rawQ = value.trim();
      if (rawQ === lastQuery) return;
      lastQuery = rawQ;
      if (!rawQ) {
        qp.items = takeFirstEntries(400).map(toItem);
        qp.title = undefined;
        atResults = false;
        // 清空 # 状态无需额外
        return;
      }
      // # 全局代码搜索 (跨全部 lst) 语法: #code1 code2 ... 或多行/逗号/分号分隔
      if (rawQ.startsWith('#')) {
        const codesRaw = rawQ.slice(1).trim();
        if (!codesRaw) { qp.title = '# 输入代码 (空格/换行/逗号分隔)'; qp.items = []; return; }
        const { items: codeItems, matchedKeys } = searchCodes(codesRaw, model, 800);
        const qpItems: QuickPickItem[] = codeItems.map(ci => {
          const fk = ci.fileKey;
          const base = fk.split('/').pop() || fk;
          const display = (model as any).getDisplayNameForFile ? (model as any).getDisplayNameForFile(fk) : undefined;
          const label = display || base;
          const descParts: string[] = [];
          if (display && display !== base) descParts.push(base);
          descParts.push('code=' + ci.code);
          return { key: fk, label, description: descParts.join('  '), detail: fk, alwaysShow: true } as QuickPickItem;
        });
        qp.items = qpItems;
        qp.title = `# 代码结果: ${qpItems.length}`;
        // 与原逻辑一致：异步补全 displayName
        (async () => {
          try {
            await (model as any).ensureMetadataForFiles?.(matchedKeys);
            let changed = false;
            const refreshed = qpItems.map(it => {
              const baseName = it.key.split('/').pop() || it.key;
              const disp = (model as any).getDisplayNameForFile ? (model as any).getDisplayNameForFile(it.key) : undefined;
              if (disp && disp !== it.label) {
                changed = true;
                const codePart = (it.description || '').split(/\s{2,}|\s/).find(p => p.startsWith('code=')) || (it.description || '');
                const descParts: string[] = [];
                if (disp !== baseName) descParts.push(baseName);
                if (codePart) descParts.push(codePart);
                return { ...it, label: disp, description: descParts.join('  ') } as QuickPickItem;
              }
              return it;
            });
            if (changed) qp.items = refreshed;
          } catch { /* ignore */ }
        })();
        return;
      }
      const token = rawQ.toLowerCase();
      const ranked = rankFileMatches(token, 8000, 600);
      qp.items = ranked.map(toItem);
      qp.title = `候选: ${ranked.length}${ranked.length >= 600 ? '+' : ''}`;
    };

    const schedule = (val: string) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => run(val), 70); // 60~80ms 手感较好
    };

    qp.onDidChangeValue(v => schedule(v));

    qp.onDidAccept(async () => {
      const value = qp.value.trim();
      // @ 前缀：脚本字符串引用搜索（委托给服务）
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
          const res = searchStringReferences(model, keywordRaw);
          if (!res || res.matches.length === 0) { vscode.window.showInformationMessage('未找到匹配的字符串 (stringtable)'); return; }
          const items: QuickPickItem[] = res.matches.map(m => {
            const base = m.key.split('/').pop() || m.key;
            const labelPrimary = m.labels[0] || base;
            let description: string | undefined = undefined;
            if (m.labels.length > 1) {
              const rest = m.labels.slice(1).join(' | ');
              description = (rest.length > 80 ? rest.slice(0, 77) + '…' : rest);
            } else if (m.labels.length === 1 && labelPrimary !== base) {
              description = base;
            }
            return { key: m.key, label: labelPrimary, description, detail: m.key, alwaysShow: true } as QuickPickItem;
          });
          qp.items = items;
          qp.title = `@${keywordRaw} 结果: ${res.matches.length} (耗时 ${res.elapsed}ms)`;
          atResults = true; lastAtQuery = keywordRaw;
        } finally { qp.busy = false; }
        return; // 保持 QuickPick 打开
      }
      // # 代码检索：直接结果列表，按 Enter 打开所选（无需阶段切换）
      if (value.startsWith('#')) {
        const selHash = qp.selectedItems[0];
        if (selHash) {
          qp.hide();
          const uri = vscode.Uri.parse(`pvf:/${selHash.key}`);
          try { await vscode.window.showTextDocument(uri, { preview: true }); } catch (e) { vscode.window.showErrorMessage('打开文件失败: ' + (e as any)?.message); }
        }
        return;
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
      if (trimmed.startsWith('@')) {
        if (atResults && lastAtQuery && trimmed !== '@' + lastAtQuery) atResults = false;
        return;
      }
      // # 状态变化
      if (trimmed.startsWith('#')) return; // # 搜索不使用 atResults
      atResults = false;
    });

    qp.show();
  }));
}
