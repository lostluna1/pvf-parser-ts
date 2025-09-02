import * as vscode from 'vscode';
import { Deps } from './types';

// Very first version of a visual ANI editor using webview and VS Code UI Toolkit
export function registerAniEditor(context: vscode.ExtensionContext, _deps: Deps) {
  const d = vscode.commands.registerCommand('pvf.openAniEditor', async () => {
    const editor = vscode.window.activeTextEditor; if (!editor) { vscode.window.showWarningMessage('没有活动的编辑器'); return; }
    const doc = editor.document;
    if (!/\.ani$/i.test(doc.fileName)) { vscode.window.showWarningMessage('请在一个 .ani 文件中使用 ANI 编辑器'); return; }
    const text = doc.getText();

    const panel = vscode.window.createWebviewPanel('pvfAniEditor', `ANI 编辑器: ${doc.fileName.split(/[\\/]/).pop()}`, vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist'),
        context.extensionUri
      ]
    });

    const nonce = (() => { let t=''; const s='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for(let i=0;i<32;i++){ t += s.charAt(Math.floor(Math.random()*s.length)); } return t; })();
    const toolkitUri = vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.js');
    const toolkitSrc = panel.webview.asWebviewUri(toolkitUri).toString();
    // Precompute frame header positions for cursor sync
    let framePos = new Map<number, vscode.Position>();
    function computeFramePositions() {
      framePos = new Map();
      const t = doc.getText();
      const re = /^\s*\[FRAME(\d{3})\]/gmi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(t)) !== null) {
        const lineStart = m.index;
        const bracketAt = t.indexOf('[', lineStart);
        const offset = bracketAt >= 0 ? bracketAt : lineStart;
        const idx = parseInt(m[1], 10);
        if (!Number.isNaN(idx)) framePos.set(idx, doc.positionAt(offset));
      }
    }
    computeFramePositions();

    // Parse frames & their inner tags/values
  const frameBlockRegex = /^\s*\[FRAME(\d{3})\]([\s\S]*?)(?=^\s*\[FRAME\d{3}\]|(?![\s\S]))/gim;
    type FrameEntry = { tag: string; value: string };
    const framesDetailed: { idx: number; entries: FrameEntry[] }[] = [];
    let fm: RegExpExecArray | null;
    while ((fm = frameBlockRegex.exec(text)) !== null) {
      const parsedIdx = parseInt(fm[1], 10);
      const idx = Number.isNaN(parsedIdx) ? framesDetailed.length : parsedIdx;
      const body = fm[2] || '';
      const entries: FrameEntry[] = [];
      // match [TAG] then capture subsequent lines until next [TAG] or end of frame
  const tagRegex = /\s*\[([A-Z ]+)\]\s*\r?\n([\s\S]*?)(?=(?:\r?\n\s*\[[A-Z ]+\])|\s*$)/g;
      let tm: RegExpExecArray | null;
      while ((tm = tagRegex.exec(body)) !== null) {
        const tag = (tm[1] || '').trim();
        let val = (tm[2] || '').replace(/^\s+/gm, '').replace(/\s+$/g, '');
        // Normalize backticks-only lines like: `XXX`\n0 -> keep as-is in text area
        entries.push({ tag, value: val });
      }
      framesDetailed.push({ idx, entries });
    }

    const availableTags = [
      'IMAGE','IMAGE POS','DELAY','ATTACK BOX','DAMAGE BOX','LOOP','SHADOW','COORD','IMAGE RATE','IMAGE ROTATE','RGBA','INTERPOLATION','GRAPHIC EFFECT','DAMAGE TYPE','PLAY SOUND','PRELOAD','SPECTRUM','SET FLAG','FLIP TYPE','LOOP START','LOOP END','CLIP','OPERATION'
    ];

  const clientJsUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'aniEditor.js')).toString();
  const safeData = JSON.stringify({ frames: framesDetailed, availableTags }).replace(/</g, '\\u003C');
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource} 'unsafe-inline'; font-src ${panel.webview.cspSource}; script-src ${panel.webview.cspSource} 'nonce-${nonce}';" />
<style>
  body{margin:0;padding:10px;font-family:Segoe UI,Arial,\"Microsoft YaHei\",sans-serif;color:var(--vscode-foreground);background:var(--vscode-editor-background)}
  .toolbar{display:flex;gap:8px;align-items:center;margin-bottom:8px}
  .frame{border:1px solid var(--vscode-panel-border);border-radius:8px;margin-bottom:8px;overflow:hidden}
  .frame summary{cursor:pointer;list-style:none;padding:8px 12px;background:var(--vscode-editorWidget-background);}
  .frame summary::-webkit-details-marker{display:none}
  .frame .body{padding:10px 12px;display:flex;flex-direction:column;gap:10px}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .tag-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  input.search{height:26px;padding:3px 6px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editorWidget-background);color:var(--vscode-foreground);border-radius:6px;min-width:200px}
  select.combo{height:26px;padding:3px 6px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editorWidget-background);color:var(--vscode-foreground);border-radius:6px;min-width:220px}
  textarea.value{width:100%;min-height:42px;resize:vertical;padding:6px 8px;border-radius:6px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editorWidget-background);color:var(--vscode-foreground)}
  .entry{border:1px dashed var(--vscode-panel-border);border-radius:6px;padding:8px}
  .entry .head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
</style>
</head><body>
<script type="module" src="${toolkitSrc}" nonce="${nonce}"></script>
<div class="toolbar">
  <vscode-button id="btnSave" appearance="primary">保存到文档</vscode-button>
  <vscode-button id="btnAddFrame">新增帧</vscode-button>
  <span style="margin-left:8px;opacity:.8">共 ${framesDetailed.length} 帧</span>
</div>
<div id="frames"></div>
<script type="application/json" id="ani-data" nonce="${nonce}">${safeData}</script>
<script type="module" src="${clientJsUri}" nonce="${nonce}"></script>
</body></html>`;

    panel.webview.html = html;

    // Helper: rebuild ANI text from frames and original header
    function rebuildAni(originalText: string, frames: { idx: number; entries: { tag: string; value: string }[] }[]): string {
      const firstIdx = originalText.search(/\[FRAME\d{3}\]/);
      let header = firstIdx >= 0 ? originalText.slice(0, firstIdx) : originalText;
      // update [FRAME MAX]
      header = header.replace(/\[FRAME MAX\]\s*\r?\n\s*\d+/, `[FRAME MAX]\r\n\t${frames.length}`);
      const CRLF = '\r\n';
      const sb: string[] = [header];
      for (let i = 0; i < frames.length; i++) {
        const fr = frames[i];
        sb.push(CRLF + `[FRAME${String(i).padStart(3,'0')}]` + CRLF);
        for (const ent of (fr.entries||[])) {
          sb.push(`\t[${ent.tag}]` + CRLF);
          const val = (ent.value ?? '').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
          const lines = val.split('\n');
          for (const line of lines) {
            sb.push(`\t\t${line}` + CRLF);
          }
        }
      }
      return sb.join('');
    }

    panel.webview.onDidReceiveMessage(async (msg: any)=>{
      switch(msg?.type){
        case 'add-tag':
          // handled directly in webview in this iteration
          break;
        case 'add-frame':
          // handled directly in webview in this iteration
          break;
        case 'focus-frame': {
          try {
            const idx = typeof msg.idx === 'number' ? msg.idx : NaN;
            if (!Number.isNaN(idx)) {
              const pos = framePos.get(idx);
              if (pos) {
                const visible = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
                const viewColumn = visible?.viewColumn ?? vscode.ViewColumn.One;
                await vscode.window.showTextDocument(doc, { viewColumn, preserveFocus: true, selection: new vscode.Range(pos, pos) });
              }
            }
          } catch {}
          break;
        }
        case 'save': {
          try {
            const frames = Array.isArray(msg.frames) ? msg.frames : [];
            const content = rebuildAni(text, frames);
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
            edit.replace(doc.uri, fullRange, content);
            const ok = await vscode.workspace.applyEdit(edit);
            if (ok) { vscode.window.showInformationMessage('ANI 已保存'); }
            else { vscode.window.showWarningMessage('保存失败'); }
            // Recompute frame header positions after save
            computeFramePositions();
          } catch (e: any) {
            vscode.window.showErrorMessage('保存出错: ' + String(e?.message||e));
          }
          break;
        }
      }
    });

    // Update positions if the source document changes while editor is open
    const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === doc.uri.toString()) {
        computeFramePositions();
      }
    });
    panel.onDidDispose(() => changeSub.dispose());
  });
  context.subscriptions.push(d);
}
