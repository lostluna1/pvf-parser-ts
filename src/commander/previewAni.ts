import * as vscode from 'vscode';
import { Deps } from './types';
import * as indexer from '../npk/indexer';
import { parseAniText } from './previewAni/parseAni';
import { buildTimelineFromFrames } from './previewAni/buildTimeline';
import { buildPreviewHtml } from './previewAni/webviewHtml';

export function registerPreviewAni(context: vscode.ExtensionContext, _deps: Deps) {
  // 按文件路径复用面板
  const panelsByFile = new Map<string, vscode.WebviewPanel>();

  async function refreshPreview(fileUri: vscode.Uri, panel: vscode.WebviewPanel) {
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const text = doc.getText();
    const cfg = vscode.workspace.getConfiguration();
    let root = (cfg.get<string>('pvf.npkRoot') || '').trim();
    if (!root) {
      const pick = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: '请选择NPK根目录' });
      if (!pick || pick.length === 0) { vscode.window.showWarningMessage('未选择 NPK 根目录'); return; }
      root = pick[0].fsPath; await cfg.update('pvf.npkRoot', root, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`已设置 NPK 根目录: ${root}`);
    }
  // ensure index is loaded from disk before attempting to use it
    try { await indexer.loadIndexFromDisk(context); } catch { }
    const out = vscode.window.createOutputChannel('PVF');
  // 使用模块化解析与时间轴构建

  const { framesSeq, groups } = parseAniText(text);
  if (groups.size === 0) { vscode.window.showWarningMessage('未解析到任何帧，请检查 ANI 格式或文件内容'); return; }

  const { timeline, albumMap } = await buildTimelineFromFrames(context, root, framesSeq, out);

    if (timeline.length === 0) { vscode.window.showWarningMessage('未能生成任何帧'); return; }

    panel.title = `预览 ANI: ${doc.fileName.split(/[\\/]/).pop()}`;
    const localRoots = [
      vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist'),
      context.extensionUri
    ];
  panel.webview.options = { enableScripts: true, localResourceRoots: localRoots };
    // CSP nonce helper
    const nonce = (() => { let t = ''; const s = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < 32; i++) { t += s.charAt(Math.floor(Math.random() * s.length)); } return t; })();
    // Load VS Code Webview UI Toolkit locally from node_modules
    const toolkitUri = vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.js');
    const toolkitSrc = panel.webview.asWebviewUri(toolkitUri).toString();
  const webview = panel.webview;
  panel.webview.html = buildPreviewHtml(context, webview, timeline, nonce, toolkitSrc);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('pvf.previewAni', async () => {
      const editor = vscode.window.activeTextEditor; if (!editor) { vscode.window.showWarningMessage('没有活动的编辑器'); return; }
      const fileUri = editor.document.uri; const key = fileUri.fsPath.toLowerCase();
      const existing = panelsByFile.get(key);
      if (existing) {
        try { existing.reveal(vscode.ViewColumn.Beside, true); } catch {}
        await refreshPreview(fileUri, existing);
        return;
      }
      // create new panel and wire events
      const panel = vscode.window.createWebviewPanel('pvfAni', '预览 ANI', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
      panelsByFile.set(key, panel);
      panel.onDidDispose(() => { panelsByFile.delete(key); }, null, context.subscriptions);
      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg && msg.type === 'refresh') { await refreshPreview(fileUri, panel); }
      }, undefined, context.subscriptions);
      await refreshPreview(fileUri, panel);
    })
  );
}
