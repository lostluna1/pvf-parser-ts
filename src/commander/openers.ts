import * as vscode from 'vscode';
import { Deps } from './types';

export function registerOpeners(context: vscode.ExtensionContext, deps: Deps) {
  const { model, deco, output } = deps;
  context.subscriptions.push(
    vscode.commands.registerCommand('pvf.openFile', async (nodeArg: any) => {
      try {
        let node = nodeArg; if (Array.isArray(nodeArg) && nodeArg.length > 0) node = nodeArg[0]; if (typeof node === 'string') { try { node = JSON.parse(node); } catch {} }
        output.appendLine(`[PVF] openFile invoked arg=${JSON.stringify(node)}`);
        if (!node || !node.key) { output.appendLine('[PVF] openFile: missing node or key'); return; }
        const key = String(node.key).replace(/^\/+/, ''); const f = model.getFileByKey(key); output.appendLine(`[PVF] openFile: key=${key} fileExists=${!!f}`);
        if (!f) { vscode.window.showErrorMessage(`文件未在封包中找到: ${key}`); return; }
        const uri = vscode.Uri.parse(`pvf:/${key}`);
        try {
          const doc = await vscode.workspace.openTextDocument(uri); output.appendLine(`[PVF] openFile: opened pvf: doc length=${doc.getText().length}`); await vscode.window.showTextDocument(doc, { preview: false });
          if (!doc.getText() || doc.getText().length === 0) {
            output.appendLine(`[PVF] openFile: pvf: doc empty for ${key}, falling back to model.getTextViewAsync`);
            try { const text = await (model as any).getTextViewAsync(key); if (text && text.length > 0) { const doc2 = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' }); await vscode.window.showTextDocument(doc2, { preview: false }); } else { output.appendLine(`[PVF] openFile: model.getTextViewAsync returned empty for ${key}`); vscode.window.showWarningMessage('打开的文件内容为空'); } } catch (e) { output.appendLine(`[PVF] openFile: getTextViewAsync failed for ${key}: ${String(e)}`); vscode.window.showErrorMessage('打开文件失败'); }
          }
          return;
        } catch (e) { output.appendLine(`[PVF] openFile: opening pvf:/${key} failed: ${String(e)}`); }
        try { const bytes = await (model as any).readFileBytes(key); if (bytes && bytes.length > 0) { const text = Buffer.from(bytes).toString('utf8'); const doc = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' }); await vscode.window.showTextDocument(doc, { preview: false }); return; } else { output.appendLine(`[PVF] openFile: model.readFileBytes returned empty for ${key}`); } } catch (e) { output.appendLine(`[PVF] openFile: readFileBytes failed for ${key}: ${String(e)}`); }
        vscode.window.showWarningMessage('打开的文件内容为空或无法读取');
      } catch (ex) { output.appendLine(`[PVF] openFile exception: ${String(ex)}`); }
    }),
    vscode.commands.registerCommand('pvf.openFuzzyPath', async (arg: any) => {
      try {
        let filePath: string | undefined; let baseDir: string = '';
        if (Array.isArray(arg) && arg.length >= 1) { filePath = arg[0]; if (arg.length >= 2) baseDir = arg[1] || ''; }
        else if (typeof arg === 'string') { try { const p = JSON.parse(arg); if (Array.isArray(p)) { filePath = p[0]; baseDir = p[1] || ''; } else filePath = arg; } catch { filePath = arg; } }
        else if (arg && typeof arg === 'object') { filePath = arg[0] || arg.filePath || arg; }
        if (!filePath) return;
        const joinAndNormalize = (baseDirLocal: string, rel: string) => {
          const relParts = String(rel).replace(/^\/+/, '').split('/'); const baseParts = baseDirLocal ? baseDirLocal.split('/').filter(p => p.length > 0) : []; const out: string[] = [...baseParts];
          for (const part of relParts) { if (part === '..') { if (out.length > 0) out.pop(); } else if (part === '.' || part === '') { } else { out.push(part); } }
          return out.join('/');
        };
        let needle = String(filePath).replace(/^\/+/, '').toLowerCase(); if (needle.startsWith('.') || needle.indexOf('..') >= 0) { const normalized = joinAndNormalize(baseDir || '', filePath); if (normalized && normalized.length > 0) needle = normalized.toLowerCase(); }
        const base = (baseDir || '').toLowerCase(); const keys: string[] = (model as any).getAllKeys ? (model as any).getAllKeys() : Array.from((model as any).fileList?.keys?.() || []);
        let found: string | undefined; const exact = keys.find((k: string) => k.toLowerCase() === needle); if (exact) found = exact; if (!found && base) { const cand = `${base}/${needle}`; const f2 = keys.find((k: string) => k.toLowerCase() === cand); if (f2) found = f2; }
        if (!found) { const f3 = keys.find((k: string) => k.toLowerCase().endsWith('/' + needle) || k.toLowerCase().endsWith(needle)); if (f3) found = f3; }
        if (!found) { const f4 = keys.find((k: string) => k.toLowerCase().indexOf(needle) >= 0); if (f4) found = f4; }
        if (!found) { vscode.window.showWarningMessage(`未在封包中找到: ${filePath}`); return; }
        if (found.toLowerCase().endsWith('.img')) { vscode.window.showWarningMessage('目标为图片文件，跳转被忽略'); return; }
        const entry = { key: found, name: found.split('/').pop() || found, isFile: true }; await vscode.commands.executeCommand('pvf.openFile', entry);
      } catch (e) { output.appendLine(`[PVF] openFuzzyPath error: ${String(e)}`); }
    })
  );
}
