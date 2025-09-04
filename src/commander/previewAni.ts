import * as vscode from 'vscode';
import { Deps } from './types';
import * as indexer from '../npk/indexer';
import { parseAniText } from './previewAni/parseAni';
import { buildTimelineFromFrames, buildTimelineFromPvfFrames, buildCompositeTimeline, expandAlsLayers } from './previewAni/buildTimeline';
import { parseAlsText } from './previewAni/parseAls';
import { buildPreviewHtml } from './previewAni/webviewHtml';

export function registerPreviewAni(context: vscode.ExtensionContext, deps: Deps) {
  // 按文件路径复用面板
  const panelsByFile = new Map<string, vscode.WebviewPanel>();

  async function refreshPreview(fileUri: vscode.Uri, panel: vscode.WebviewPanel) {
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const text = doc.getText();
    const cfg = vscode.workspace.getConfiguration();
    let root = (cfg.get<string>('pvf.npkRoot') || '').trim();

    // 检测文档是否来自PVF
    const isPvfDocument = fileUri.scheme === 'pvf';

    if (!isPvfDocument && !root) {
      const pick = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: '请选择NPK根目录' });
      if (!pick || pick.length === 0) { vscode.window.showWarningMessage('未选择 NPK 根目录'); return; }
      root = pick[0].fsPath; await cfg.update('pvf.npkRoot', root, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`已设置 NPK 根目录: ${root}`);
    }

    // ensure index is loaded from disk before attempting to use it
    if (!isPvfDocument) {
      try { await indexer.loadIndexFromDisk(context); } catch { }
    }

    const out = vscode.window.createOutputChannel('PVF');
    // 使用模块化解析与时间轴构建

    const { framesSeq, groups } = parseAniText(text);
    if (groups.size === 0) { vscode.window.showWarningMessage('未解析到任何帧，请检查 ANI 格式或文件内容'); return; }

  let timeline, albumMap;

    const mainResult = isPvfDocument
      ? await buildTimelineFromPvfFrames(context, deps.model, root, framesSeq, out)
      : await buildTimelineFromFrames(context, root, framesSeq, out);
    timeline = mainResult.timeline;
    albumMap = mainResult.albumMap;

    // === 处理同名 .ani.als 附加图层 ===
  let lastAlsMeta: { uses: { id: string; path: string }[]; adds: { id: string; relLayer: number; order: number; kind?: string }[] } | null = null;
  try {
      const baseDirFs = !isPvfDocument ? require('path').dirname(doc.fileName) : '';
      let alsText: string | undefined;
      let pvfBaseDir = '';
      if (isPvfDocument) {
        // pvf: key 直接追加 .als，计算主 ani 目录用于相对路径解析
        const key = fileUri.path.replace(/^\//,'');
        pvfBaseDir = key.includes('/') ? key.substring(0, key.lastIndexOf('/')) : '';
        const alsKey = key + '.als';
        const alsFile = deps.model.getFileByKey(alsKey);
        if (alsFile) {
          out.appendLine(`[ALS] 检测到附加层文件: ${alsKey}`);
          alsText = await deps.model.getTextViewAsync(alsKey);
          // 如果解析后没有出现 "[use animation]" 且包含不可打印字符，再尝试按 cp949/utf8 直接解码原始字节
          if (alsText && !/\[use\s+animation\]/i.test(alsText)) {
            try {
              const rawBytes = await (deps.model as any).readFileBytes(alsKey);
              if (rawBytes && rawBytes.length > 0) {
                const buf = Buffer.from(rawBytes);
                const tryUtf8 = buf.toString('utf8');
                if (/\[use\s+animation\]/i.test(tryUtf8)) {
                  alsText = tryUtf8;
                  out.appendLine('[ALS] 通过 UTF-8 直接解码成功识别标签');
                } else {
                  const iconv = require('iconv-lite');
                  const try949 = iconv.decode(buf, 'cp949');
                  if (/\[use\s+animation\]/i.test(try949)) {
                    alsText = try949;
                    out.appendLine('[ALS] 通过 cp949 解码成功识别标签');
                  }
                }
              }
            } catch {}
          }
        } else {
          out.appendLine('[ALS] 未找到同名 .ani.als');
        }
      } else {
        const fs = await import('fs/promises');
        const alsPath = doc.fileName + '.als';
        try { await fs.access(alsPath); alsText = await fs.readFile(alsPath, 'utf8'); out.appendLine(`[ALS] 发现并加载 ${alsPath}`); } catch { out.appendLine('[ALS] 未找到同名 .ani.als'); }
      }
      if (alsText) {
        const parsedAls = parseAlsText(alsText, out);
        lastAlsMeta = {
          uses: Array.from(parsedAls.uses.values()).map(u => ({ id: u.id, path: u.path })),
          adds: parsedAls.adds.map(a => ({ id: a.id, relLayer: a.relLayer, order: a.order, kind: a.kind }))
        };
        if (parsedAls.adds.length > 0) {
          const layerMap = await expandAlsLayers(isPvfDocument, context, deps.model, root, isPvfDocument ? pvfBaseDir : baseDirFs, parsedAls, out);
          const composite = await buildCompositeTimeline(context, root, framesSeq, parsedAls, layerMap, out);
          timeline = composite.timeline; // 覆盖
          albumMap = composite.albumMap;
          out.appendLine(`[ALS] 合成完成，主帧数=${timeline.length}`);
        } else {
          out.appendLine('[ALS] 没有有效的 add 引用，忽略附加层');
        }
      }
    } catch (e) { out.appendLine(`[ALS] 处理附加层时出错: ${String(e)}`); }

  if (!timeline || timeline.length === 0) { vscode.window.showWarningMessage('未能生成任何帧'); return; }

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
  const addsWithSeq = (lastAlsMeta?.adds||[]).map((a,i)=>({id:a.id, relLayer:a.relLayer, order:a.order, kind:a.kind, seq:i}));
  panel.webview.html = buildPreviewHtml(context, webview, timeline, nonce, toolkitSrc, addsWithSeq, lastAlsMeta?.uses||[], []);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('pvf.previewAni', async () => {
      const editor = vscode.window.activeTextEditor; if (!editor) { vscode.window.showWarningMessage('没有活动的编辑器'); return; }
      const fileUri = editor.document.uri; const key = fileUri.fsPath.toLowerCase();
      // 确保源文档固定在左侧(第一组)
      try { await vscode.window.showTextDocument(editor.document, { viewColumn: vscode.ViewColumn.One, preserveFocus: true }); } catch {}
      const existing = panelsByFile.get(key);
      if (existing) {
        // 始终使用右侧文档组 (第二列)
        try { existing.reveal(vscode.ViewColumn.Two, true); } catch {}
        await refreshPreview(fileUri, existing);
        return;
      }
      // create new panel and wire events
      const panel = vscode.window.createWebviewPanel('pvfAni', '预览 ANI', vscode.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
      panelsByFile.set(key, panel);
      panel.onDidDispose(() => { panelsByFile.delete(key); }, null, context.subscriptions);
      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg && msg.type === 'refresh') { await refreshPreview(fileUri, panel); return; }
  if (msg && msg.type === 'saveAls') {
          try {
            const uses: any[] = Array.isArray(msg.uses) ? msg.uses : [];
            const adds: any[] = Array.isArray(msg.adds) ? msg.adds : [];
            const lines: string[] = ['#PVF_File',''];
            for (const u of uses) {
              lines.push('[use animation]','\t`'+u.path+'`','\t`'+u.id+'`','');
            }
            for (const a of adds) {
              const tag = (a.kind === 'none-effect-add') ? '[none effect add]' : (a.kind === 'draw-only' ? '[create draw only object]' : '[add]');
              const startFrame = (typeof a.start === 'number') ? a.start : a.order; // 兼容旧字段
              const depth = (typeof a.depth === 'number') ? a.depth : a.relLayer;
              // 输出顺序: startFrame depth
              lines.push(tag,'\t'+startFrame+'\t'+depth,'\t`'+a.id+'`','');
            }
            const alsContent = lines.join('\r\n');
            if (fileUri.scheme === 'pvf') {
              // 目标 key = 主 ani key + '.als'；使用编辑器文本方式（可撤销），不立即写入模型
              const key = fileUri.path.replace(/^\//,'');
              const alsKey = key + '.als';
              const model = deps.model;
              if (!model.getFileByKey(alsKey)) {
                model.createEmptyFile(alsKey);
              }
              try {
                const alsUri = vscode.Uri.from({ scheme: 'pvf', path: '/' + alsKey });
                const doc = await vscode.workspace.openTextDocument(alsUri);
                const edit = new vscode.WorkspaceEdit();
                // 全量替换内容，标记为脏，用户可 Ctrl+Z 撤回
                edit.replace(alsUri, new vscode.Range(0,0, doc.lineCount, 0), alsContent);
                const applied = await vscode.workspace.applyEdit(edit);
                if (applied) {
                  // 打开但不聚焦；然后恢复预览面板焦点
                  await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true, viewColumn: vscode.ViewColumn.One });
                  try { panel.reveal(panel.viewColumn ?? vscode.ViewColumn.Two, false); } catch {}
                  try { deps.deco.refreshUris([alsUri]); } catch {}
                } else {
                  vscode.window.showWarningMessage('写入 ALS 文本编辑失败: '+alsKey);
                }
              } catch (e:any) {
                vscode.window.showErrorMessage('打开/编辑 PVF ALS 失败: '+String(e?.message||e));
              }
            } else {
              const fs = await import('fs/promises');
              const alsPath = fileUri.fsPath + '.als';
              await fs.writeFile(alsPath, alsContent, 'utf8');
              vscode.window.showInformationMessage('ALS 已保存: '+alsPath);
            }
          } catch (e:any) {
            vscode.window.showErrorMessage('保存 ALS 失败: '+String(e?.message||e));
          }
  }
      }, undefined, context.subscriptions);
      await refreshPreview(fileUri, panel);
      // 再次确保面板在右侧（防止 VS Code 由于布局状态放错）
      try { panel.reveal(vscode.ViewColumn.Two, false); } catch {}
    })
  );
}
