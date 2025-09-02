import * as vscode from 'vscode';
import { Deps } from './types';
import { readNpkFromFile } from '../npk/npkReader.js';
import { getSpriteRgba } from '../npk/imgReader.js';

export function registerOpenNpk(context: vscode.ExtensionContext, _deps: Deps) {
  context.subscriptions.push(
    vscode.commands.registerCommand('pvf.openNpk', async () => {
      const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { 'NPK/IMG': ['npk', 'img'] } });
      if (!uris || uris.length === 0) return;
      const file = uris[0].fsPath;
      try {
        const albums = await readNpkFromFile(file);
        if (!albums || albums.length === 0) {
          vscode.window.showWarningMessage('未解析到任何专辑/帧');
          return;
        }
        const totalSprites = albums.reduce((sum, a) => sum + (a.sprites?.length || 0), 0);
        const verStat = new Map<number, number>();
        for (const a of albums) { const v = a.version || 0; verStat.set(v, (verStat.get(v) || 0) + 1); }
        const verText = Array.from(verStat.entries()).map(([v, c]) => `v${v}:${c}`).join(', ');
        vscode.window.showInformationMessage(`解析完成：专辑 ${albums.length}，总帧 ${totalSprites}（版本分布：${verText}）`);
        const pick = await vscode.window.showInformationMessage('是否预览第一份专辑的帧序列？', '预览');
        if (pick === '预览') { showAlbumPreview(albums[0]); }
      } catch (e: any) {
        vscode.window.showErrorMessage(`解析失败: ${e?.message || String(e)}`);
      }
    })
  );

  function showAlbumPreview(album: any) {
    const panel = vscode.window.createWebviewPanel('pvfPreview', `预览: ${album?.name || 'IMG'}`, vscode.ViewColumn.Active, { enableScripts: true });
    const items: any[] = [];
    for (let i = 0; i < Math.min(album.sprites?.length || 0, 64); i++) {
      const s = album.sprites[i]; if (!s) continue;
      const rgba = getSpriteRgba(album, i); if (!rgba) continue;
      const b64 = Buffer.from(rgba).toString('base64');
      items.push({ index: i, w: s.width, h: s.height, data: b64 });
    }
    const payload = JSON.stringify(items);
    panel.webview.html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" />
      <style>body{font-family:sans-serif;padding:8px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}.item{border:1px solid #ccc;padding:8px;border-radius:6px;background:#fafafa}.cap{font-size:12px;color:#555;margin-top:4px}canvas{background:transparent;image-rendering:pixelated}</style>
      </head><body><div>帧总数：${album?.sprites?.length || 0}；展示前 ${items.length} 帧</div><div class="grid" id="grid"></div>
      <script>const items=${payload};const grid=document.getElementById('grid');function draw(rgba,w,h,cv){cv.width=w;cv.height=h;const ctx=cv.getContext('2d');const d=ctx.createImageData(w,h);d.data.set(rgba);ctx.putImageData(d,0,0);}for(const it of items){const wrap=document.createElement('div');wrap.className='item';const canvas=document.createElement('canvas');const cap=document.createElement('div');cap.className='cap';cap.textContent='#'+it.index+'  '+it.w+'x'+it.h;wrap.appendChild(canvas);wrap.appendChild(cap);grid.appendChild(wrap);const rgba=Uint8ClampedArray.from(atob(it.data),c=>c.charCodeAt(0));draw(rgba,it.w,it.h,canvas);}</script>
      </body></html>`;
  }
}
