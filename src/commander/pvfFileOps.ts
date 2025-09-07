import * as vscode from 'vscode';
import { Deps } from './types';

export function registerPvfFileOps(context: vscode.ExtensionContext, deps: Deps) {
  const { model, tree, deco, output } = deps;
  context.subscriptions.push(
    vscode.commands.registerCommand('pvf._setClipboard', (payload: any) => { context.workspaceState.update('pvf.clipboard', payload); }),
    vscode.commands.registerCommand('pvf._getClipboard', async () => { deco.refreshAll(); return context.workspaceState.get('pvf.clipboard'); }),
    vscode.commands.registerCommand('pvf.selectForCompare', async (node) => { if (!node) return; await context.workspaceState.update('pvf.compareSelection', node.key); vscode.window.showInformationMessage(`已选择 ${node.name} 用于比较`); }),
    vscode.commands.registerCommand('pvf.compareWithSelection', async (node) => {
      if (!node) return; const sel = context.workspaceState.get<string>('pvf.compareSelection'); if (!sel) { vscode.window.showWarningMessage('请先选择一个文件用于比较'); return; }
      const left = vscode.Uri.parse(`pvf:/${sel}`); const right = vscode.Uri.parse(`pvf:/${node.key}`); vscode.commands.executeCommand('vscode.diff', left, right, `${sel} ↔ ${node.key}`);
    }),
    vscode.commands.registerCommand('pvf.cut', async (node) => { if (!node) return; await context.workspaceState.update('pvf.clipboard', { op: 'cut', key: node.key }); vscode.window.showInformationMessage(`已剪切 ${node.name}`); }),
    vscode.commands.registerCommand('pvf.copy', async (node) => { if (!node) return; await context.workspaceState.update('pvf.clipboard', { op: 'copy', key: node.key }); vscode.window.showInformationMessage(`已复制 ${node.name}`); }),
    vscode.commands.registerCommand('pvf.paste', async (node) => {
      if (!node || node.isFile) { vscode.window.showWarningMessage('请选择目标文件夹粘贴'); return; }
      const clip = context.workspaceState.get<any>('pvf.clipboard'); if (!clip) { vscode.window.showWarningMessage('剪贴板为空'); return; }
      const destBase = node.key; const f = model.getFileByKey(clip.key); if (!f) { vscode.window.showErrorMessage('源文件不存在'); return; }
      const baseName = clip.key.split('/').pop() || clip.key; const idx = baseName.lastIndexOf('.'); const namePart = idx >= 0 ? baseName.substring(0, idx) : baseName; const extPart = idx >= 0 ? baseName.substring(idx) : '';
      let candidate = baseName; let n = 1; while (model.getFileByKey(`${destBase}/${candidate}`)) { candidate = `${namePart} (${n})${extPart}`; n++; }
      const destKey = `${destBase}/${candidate}`; const bytes = await model.loadFileData(f); model.createEmptyFile(destKey); const pf = model.getFileByKey(destKey); if (pf) { pf.writeFileData(bytes); pf.changed = true; }
      if (clip.op === 'cut') { model.deleteFile(clip.key); await context.workspaceState.update('pvf.clipboard', undefined); vscode.window.showInformationMessage('移动完成'); } else { vscode.window.showInformationMessage('粘贴完成'); }
      tree.refresh();
    }),
    vscode.commands.registerCommand('pvf.copyPath', async (node) => { if (!node) return; await vscode.env.clipboard.writeText(node.key); vscode.window.showInformationMessage('已复制路径到剪贴板'); }),
    vscode.commands.registerCommand('pvf.openPack', async () => {
      const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { 'PVF': ['pvf'] } }); if (!uris || uris.length === 0) { return; }
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '打开 PVF…' }, async (p) => {
        const t0 = Date.now(); output.appendLine(`[PVF] open start: ${uris[0].fsPath}`); await model.open(uris[0].fsPath, (n: number) => { p.report({ increment: 0, message: `${n}%` }); }); const ms = Date.now() - t0; output.appendLine(`[PVF] open done in ${ms}ms (parsed header+tree only)`);
      }); tree.refresh(); deco.refreshAll();
      try { await vscode.commands.executeCommand('setContext', 'pvf.hasOpenPack', true); } catch {}
    }),
    vscode.commands.registerCommand('pvf.savePack', async () => {
      if (!model || !(model as any).pvfPath) {
        vscode.window.showWarningMessage('尚未打开任何 PVF 文件'); return;
      }
      const dest = await vscode.window.showSaveDialog({ filters: { 'PVF': ['pvf'] } }); if (!dest) { return; }
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '保存 PVF…' }, async (p) => {
        let last = 0; const ok = await model.save(dest.fsPath, (n: number) => { const inc = Math.max(0, Math.min(100, n) - last); last = Math.max(last, Math.min(100, n)); p.report({ increment: inc, message: `${last}%` }); });
        if (ok) { vscode.window.showInformationMessage('另存为成功'); (model as any).pvfPath = dest.fsPath; try { await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '重新加载 PVF…' }, async (pp) => { await model.open(dest.fsPath, (n: number) => { pp.report({ increment: 0, message: `${n}%` }); }); }); tree.refresh(); deco.refreshAll(); } catch { vscode.window.showWarningMessage('保存成功，但重新加载封包失败'); } }
        else { vscode.window.showErrorMessage('保存失败'); }
      });
    }),
    vscode.commands.registerCommand('pvf.savePackInPlace', async () => {
      if (!model.pvfPath) { vscode.window.showWarningMessage('尚未打开任何 PVF 文件'); return; }
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '保存 PVF…' }, async (p) => {
        let last = 0; const ok = await model.save(model.pvfPath, (n: number) => { const inc = Math.max(0, Math.min(100, n) - last); last = Math.max(last, Math.min(100, n)); p.report({ increment: inc, message: `${last}%` }); });
        if (ok) { vscode.window.showInformationMessage('已保存到当前文件'); try { await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '重新加载 PVF…' }, async (pp) => { await model.open(model.pvfPath, (n: number) => { pp.report({ increment: 0, message: `${n}%` }); }); }); tree.refresh(); deco.refreshAll(); } catch { vscode.window.showWarningMessage('保存成功，但重新加载封包失败'); } }
        else { vscode.window.showErrorMessage('保存失败'); }
      });
    }),
    vscode.commands.registerCommand('pvf.exportFile', async (node) => { if (!node || !node.isFile) return; const dest = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(node.name) }); if (!dest) return; await model.exportFile(node.key, dest.fsPath); vscode.window.showInformationMessage('导出完成'); }),
    vscode.commands.registerCommand('pvf.replaceFile', async (node) => { if (!node || !node.isFile) return; const src = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false }); if (!src || src.length === 0) return; const res = await model.replaceFile(node.key, src[0].fsPath); if (!res.success) { vscode.window.showErrorMessage('替换失败'); } tree.refresh(); deco.refreshUris([vscode.Uri.parse(`pvf:/${node.key}`)]); }),
    vscode.commands.registerCommand('pvf.deleteFile', async (node) => { if (!node || !node.isFile) return; model.deleteFile(node.key); tree.refresh(); deco.refreshAll(); }),
    vscode.commands.registerCommand('pvf.createFolder', async (node) => { const base = node && !node.isFile ? node.key : ''; const name = await vscode.window.showInputBox({ prompt: '输入新文件夹名称', placeHolder: '例如: new_folder' }); if (!name) return; model.createFolder(base ? `${base}/${name}` : name); tree.refresh(); deco.refreshAll(); }),
    vscode.commands.registerCommand('pvf.deleteFolder', async (node) => { if (!node || node.isFile) return; const ok = await vscode.window.showWarningMessage(`确定删除文件夹 ${node.name} 及其所有子项吗？`, { modal: true }, '删除'); if (ok !== '删除') return; model.deleteFolder(node.key); tree.refresh(); deco.refreshAll(); }),
    vscode.commands.registerCommand('pvf.createFile', async (node) => { const base = node && !node.isFile ? node.key : ''; const name = await vscode.window.showInputBox({ prompt: '输入新文件名（含扩展名）', placeHolder: '例如: readme.txt' }); if (!name) return; const key = base ? `${base}/${name}` : name; model.createEmptyFile(key); tree.refresh(); deco.refreshUris([vscode.Uri.parse(`pvf:/${key}`)]); }),
  );
}
