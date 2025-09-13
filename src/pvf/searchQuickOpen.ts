import * as vscode from 'vscode';
import { PvfModel } from './model';
import { StringTable } from './stringTable'; // 保留用于类型提示（服务内部已使用）
// 拆分后的搜索服务
import { ensureFileIndexAsync, getIndexedFirst, rankFileMatchesAsync, FileIndexEntry } from './services/fileSearchService';
import { searchCodesAsync } from './services/codeSearchService';
import { searchStringReferencesAsync } from './services/stringRefSearchService';
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

    // 懒构建文件索引（异步）
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: '构建文件索引…' }, async () => {
      await ensureFileIndexAsync(model, p => {
        if (p.phase === 'index' && p.total) {
          // 进度条由 VS Code 控制，这里仅可选更新窗口标题（暂省略以减少刷新）
        }
      });
    });

    const qp = vscode.window.createQuickPick<QuickPickItem>();
    qp.placeholder = '搜索: 默认搜索文件路径 | @开头搜索字符串引用 | #开头搜索物品代码(.lst)';
  qp.matchOnDescription = false; // 禁止内置描述过滤
  qp.matchOnDetail = false; // 关闭 detail 过滤，防止用户认为已触发搜索
    qp.canSelectMany = false;

  // 初始：仅显示占位提示，不预填文件，避免用户误解为实时搜索
  qp.items = [ { key: '__placeholder__', label: '输入后按 Enter 执行搜索 (支持 文件 / @字符串 / #代码)', alwaysShow: true } ];
  qp.title = '输入后按回车开始搜索';

    let disposed = false;
    qp.onDidHide(() => { if (!disposed) qp.dispose(); disposed = true; });

    // 状态管理
    let phase: 'idle' | 'results' = 'idle';
    let currentType: 'file' | 'string' | 'code' | null = null;
    let lastQuery: string | null = null;
    let searching = false; // 防止重复触发

    // 用户修改输入后，若已处于结果阶段则回到 idle
    const updatePlaceholder = () => {
      const raw = qp.value.trim();
      let label: string;
      if (raw.startsWith('@')) {
        label = raw.length > 1 ? `按 Enter 搜索字符串: ${raw.slice(1)}` : '输入 @关键字 后按 Enter 搜索字符串';
      } else if (raw.startsWith('#')) {
        label = raw.length > 1 ? `按 Enter 搜索代码: ${raw.slice(1)}` : '输入 #代码(可多条) 后按 Enter 搜索代码';
      } else if (raw.length === 0) {
        label = '输入后按 Enter 执行搜索 (支持 文件 / @字符串 / #代码)';
      } else {
        label = `按 Enter 搜索文件名: ${raw}`;
      }
      qp.items = [ { key: '__placeholder__', label, alwaysShow: true } ];
    };

    qp.onDidChangeValue(() => {
      if (phase === 'results') { // 修改输入后退出结果阶段
        phase = 'idle'; currentType = null; lastQuery = null;
        qp.title = '输入后按回车开始搜索';
      }
      if (!searching) updatePlaceholder();
    });

    qp.onDidAccept(async () => {
      if (searching) return; // 正在搜索，忽略
      const raw = qp.value.trim();
      if (!raw) { return; }

      // 判定类型
      const type: 'file' | 'string' | 'code' = raw.startsWith('@') ? 'string' : raw.startsWith('#') ? 'code' : 'file';

      // 结果阶段：再次回车 = 打开文件
      if (phase === 'results' && type === currentType) {
        const sel = qp.selectedItems[0];
        if (!sel) return;
        qp.hide();
        const uri = vscode.Uri.parse(`pvf:/${sel.key}`);
        try { await vscode.window.showTextDocument(uri, { preview: true }); }
        catch (e) { vscode.window.showErrorMessage('打开文件失败: ' + (e as any)?.message); }
        return;
      }

  // 进入搜索阶段（先设置 busy，再让出事件循环确保进度条显示）
  searching = true; qp.busy = true; qp.title = '搜索中…';
  await new Promise(resolve => setTimeout(resolve, 0));
      try {
        if (type === 'string') {
          const keyword = raw.slice(1).trim();
          if (!keyword) { vscode.window.showInformationMessage('请输入关键字'); return; }
          const res = await searchStringReferencesAsync(model, keyword, p => {
            if (p.phase === 'scan') {
              if (p.total && p.processed) {
                qp.title = `@${keyword} 扫描中… (${p.processed}/${p.total})`;
              } else {
                qp.title = `@${keyword} 扫描中…`;
              }
            }
          });
          if (!res || res.matches.length === 0) { qp.items = []; qp.title = `@${keyword} 无结果`; phase = 'idle'; currentType = null; return; }
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
          qp.items = items; qp.title = `@${keyword} 结果: ${res.matches.length} (耗时 ${res.elapsed}ms)`;
          phase = 'results'; currentType = 'string'; lastQuery = raw; return;
        }
        if (type === 'code') {
          const codesRaw = raw.slice(1).trim();
          if (!codesRaw) { vscode.window.showInformationMessage('请输入代码'); return; }
          const { items: codeItems, matchedKeys } = await searchCodesAsync(codesRaw, model, 800, p => {
            if (p.phase === 'match' && p.total) {
              qp.title = `# 扫描代码… (${p.processed}/${p.total})`;
            }
          });
          const qpItems: QuickPickItem[] = codeItems.map(ci => {
            const fk = ci.fileKey; const base = fk.split('/').pop() || fk;
            const display = (model as any).getDisplayNameForFile ? (model as any).getDisplayNameForFile(fk) : undefined;
            const label = display || base; const desc: string[] = [];
            if (display && display !== base) desc.push(base); desc.push('code=' + ci.code);
            return { key: fk, label, description: desc.join('  '), detail: fk, alwaysShow: true } as QuickPickItem;
          });
          qp.items = qpItems; qp.title = `# 代码结果: ${qpItems.length}`;
          // 异步显示名刷新
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
              if (changed && phase === 'results' && currentType === 'code') qp.items = refreshed;
            } catch { /* ignore */ }
          })();
          phase = 'results'; currentType = 'code'; lastQuery = raw; return;
        }
        // file
        const token = raw.toLowerCase();
        const ranked = await rankFileMatchesAsync(token, 8000, 600, p => {
          if (p.phase === 'match' && p.total) {
            qp.title = `文件匹配中… (${p.processed}/${p.total})`;
          }
        });
        if (ranked.length === 0) { qp.items = []; qp.title = '无匹配文件'; phase = 'idle'; currentType = null; return; }
        qp.items = ranked.map(toItem); qp.title = `文件结果: ${ranked.length}${ranked.length >= 600 ? '+' : ''}`;
        phase = 'results'; currentType = 'file'; lastQuery = raw; return;
      } finally {
        qp.busy = false; searching = false;
      }
    });
    // 不再需要旧的 atResults 逻辑，已统一为 phase 控制

    qp.show();
  }));
}
