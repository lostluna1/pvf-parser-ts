import * as vscode from 'vscode';
import { Deps } from './types';
import { getSpriteRgba } from '../npk/imgReader.js';
import * as indexer from '../npk/indexer';

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
    const fs = await import('fs/promises'); const path = await import('path');
    // ensure index is loaded from disk before attempting to use it
    try { await indexer.loadIndexFromDisk(context); } catch { }
    const out = vscode.window.createOutputChannel('PVF');
    const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
    const cache = new Map<string, any>();
    async function loadAlbumFor(imgLogical: string): Promise<any | undefined> {
      let logical = imgLogical.replace(/\\/g, '/').replace(/^\//, '').toLowerCase(); if (!logical.startsWith('sprite/')) logical = 'sprite/' + logical; const normalizedKey = norm(logical);
      if (cache.has(normalizedKey)) return cache.get(normalizedKey);
      // try index first
      try {
        const rec = await indexer.findNpkFor(normalizedKey);
        if (rec) {
          const { readNpkFromBuffer, readFileBuffer } = await import('../npk/npkReader.js');
          try {
            const buf = await readFileBuffer(rec.npk);
            const list = await readNpkFromBuffer(buf, rec.npk);
            const found = list.find(a => norm(a.path || '') === normalizedKey) || list.find(a => norm(a.path || '').endsWith('/' + normalizedKey.split('/').slice(-1).join('/')));
            if (found) { cache.set(normalizedKey, found); try { out.appendLine(`[Index HIT] ${normalizedKey} -> ${rec.npk}`); } catch {} ; return found; }
          } catch (e) { try { out.appendLine(`[Index ERR] ${normalizedKey} -> ${String(e)}`); } catch {} ; }
        }
      } catch (e) { try { out.appendLine(`[Index ERR] ${normalizedKey} -> ${String(e)}`); } catch {} ; }
      const { readNpkEntries, readNpkFromBuffer, readFileBuffer } = await import('../npk/npkReader.js');
      const scanDirs = [root, path.join(root, 'ImagePacks2')]; let foundAnyNpk = false;
      const wantParts = normalizedKey.split('/'); const tail1 = wantParts.slice(-1).join('/'); const tail2 = wantParts.slice(-2).join('/');
      for (const dir of scanDirs) {
        try {
          const items = await fs.readdir(dir, { withFileTypes: true });
          for (const it of items) {
            if (!it.isFile()) continue; const lower = it.name.toLowerCase(); if (!lower.endsWith('.npk')) continue; foundAnyNpk = true; const full = path.join(dir, it.name);
            try {
              const buf = await readFileBuffer(full); const entries = readNpkEntries(buf);
              let hit = entries.find(e => norm(e.path) === normalizedKey);
              if (!hit) hit = entries.find(e => { const ep = norm(e.path); return ep.endsWith('/' + tail2) || ep.endsWith('/' + tail1); });
              if (hit) {
                const list = await readNpkFromBuffer(buf, full);
                let found = list.find(a => norm(a.path || '') === normalizedKey);
                if (!found) found = list.find(a => { const ap = norm(a.path || ''); return ap.endsWith('/' + tail2) || ap.endsWith('/' + tail1); }) || list[0];
                if (found) { cache.set(normalizedKey, found); return found; }
              }
            } catch { }
          }
        } catch { }
      }
      if (!foundAnyNpk) vscode.window.showWarningMessage('在配置目录未发现任何 .npk 文件，请确认 pvf.npkRoot 是否指向 ImagePacks2 或其上一级目录');
      return undefined;
    }

  const groups = new Map<string, { img: string, frames: { idx: number, delay: number, pos?: { x: number, y: number }, gfx?: string, scale?: { x: number, y: number }, rotate?: number, tint?: [number, number, number, number] }[] }>();
    const blockRegex = /\[FRAME(\d{3})\]([\s\S]*?)(?=\n\[FRAME|$)/gi; let bm: RegExpExecArray | null;
    while ((bm = blockRegex.exec(text)) !== null) {
      const block = bm[2] || '';
      const imgPathM = /\[IMAGE\][\s\S]*?(?:`([^`]+)`|"([^"]+)"|'([^']+)'|([^\r\n]+\.img))/i.exec(block);
      if (!imgPathM) continue; const img = (imgPathM[1] || imgPathM[2] || imgPathM[3] || imgPathM[4] || '').trim();
      let idx = 0; const after = block.slice(imgPathM.index + imgPathM[0].length); const idxM = /\s*\r?\n\s*(\d+)/.exec(after); if (idxM) idx = parseInt(idxM[1], 10) || 0;
      const delayM = /\[DELAY\]\s*\r?\n\s*(\d+)/i.exec(block); const delay = delayM ? parseInt(delayM[1], 10) : 50;
      const posM = /\[IMAGE POS\]\s*\r?\n\s*(-?\d+)\s+(-?\d+)/i.exec(block); const pos = posM ? { x: parseInt(posM[1], 10), y: parseInt(posM[2], 10) } : undefined;
  const geM = /\[GRAPHIC\s+EFFECT\]\s*\r?\n\s*([^\r\n]+)/i.exec(block);
  const rateM = /\[IMAGE\s+RATE\]\s*\r?\n\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i.exec(block);
  const rotM = /\[IMAGE\s+ROTATE\]\s*\r?\n\s*(-?\d+(?:\.\d+)?)/i.exec(block);
  const rgbaM = /\[RGBA\]\s*\r?\n\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i.exec(block);
      let gfx: string | undefined = undefined;
      if (geM) {
        gfx = String(geM[1]).trim();
        if (/^["'`].*["'`]$/.test(gfx)) gfx = gfx.slice(1, -1);
        gfx = gfx.toUpperCase();
      }
      let scale: { x: number, y: number } | undefined = undefined;
      if (rateM) { const x = parseFloat(rateM[1]); const y = parseFloat(rateM[2]); if (isFinite(x) && isFinite(y)) scale = { x, y }; }
      const rotate = rotM ? (parseFloat(rotM[1]) || 0) : undefined;
      let tint: [number, number, number, number] | undefined = undefined;
      if (rgbaM) {
        const r = Math.max(0, Math.min(255, parseInt(rgbaM[1], 10) || 0));
        const g = Math.max(0, Math.min(255, parseInt(rgbaM[2], 10) || 0));
        const b = Math.max(0, Math.min(255, parseInt(rgbaM[3], 10) || 0));
        const a = Math.max(0, Math.min(255, parseInt(rgbaM[4], 10) || 0));
        tint = [r, g, b, a];
      }
      if (!groups.has(img)) groups.set(img, { img, frames: [] }); groups.get(img)!.frames.push({ idx, delay, pos, gfx, scale, rotate, tint });
    }
    if (groups.size === 0) { vscode.window.showWarningMessage('未解析到任何帧，请检查 ANI 格式或文件内容'); return; }

    const albumMap = new Map<string, any>();
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '查找并加载 IMG 资源…' }, async (p) => {
      const total = groups.size; let done = 0;
      for (const [img] of groups) { const al = await loadAlbumFor(img); if (al) albumMap.set(img, al); done++; p.report({ increment: (done / total) * 100, message: `${done}/${total}` }); }
    });
    if (albumMap.size === 0) { const missing = Array.from(groups.keys()).slice(0, 5).join(', '); vscode.window.showWarningMessage('未找到任何 IMG 资源。缺失示例: ' + missing); return; }

  const timeline: { rgba: string, w: number, h: number, delay: number, dx: number, dy: number, fid: number, gfx?: string, sx?: number, sy?: number, rot?: number, tint?: [number, number, number, number] }[] = [];
    for (const [img, g] of groups) {
      const al = albumMap.get(img); if (!al) continue;
  for (const f of g.frames) { const rgba = getSpriteRgba(al, f.idx); if (!rgba) continue; const b64 = Buffer.from(rgba).toString('base64'); const sp = al.sprites[f.idx]; timeline.push({ rgba: b64, w: sp.width, h: sp.height, delay: f.delay, dx: f.pos?.x || 0, dy: f.pos?.y || 0, fid: f.idx, gfx: f.gfx ? (typeof f.gfx === 'string' ? f.gfx.replace(/^[\'"`]|[\'"`]$/g, '').toUpperCase() : String(f.gfx).toUpperCase()) : undefined, sx: f.scale?.x, sy: f.scale?.y, rot: f.rotate, tint: f.tint }); }
    }
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
    panel.webview.html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';" />
        <style>
          :root{--bg:var(--vscode-editor-background);--fg:var(--vscode-foreground);--panel:var(--vscode-editorWidget-background);--border:var(--vscode-panel-border);--muted:var(--vscode-descriptionForeground);--accent:var(--vscode-button-background);--accent-fg:var(--vscode-button-foreground);}
          body{margin:0;padding:10px;font-family:Segoe UI,Arial,"Microsoft YaHei",sans-serif;color:var(--fg);background:var(--bg)}
          #c{image-rendering:pixelated;outline:none;border:1px solid var(--border);border-radius:8px;display:block;max-width:100%}
          .toolbar{margin:6px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--border);padding:8px 10px;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
          .toolbar .group{display:flex;align-items:center;gap:8px}
          .toolbar .grow{flex:1 1 auto}
          .pill{padding:2px 8px;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--fg)}
          .statusbar{display:flex;align-items:center;gap:16px;justify-content:space-between;margin:6px 0;background:var(--panel);border:1px solid var(--border);padding:6px 10px;border-radius:8px;color:var(--muted)}
          .statusbar .stats{display:flex;gap:16px}
          /* Canvas background modes */
          .bg-dark{background:#111}
          .bg-light{background:#e6e6e6}
          .bg-transparent{background:transparent}
          .bg-checker{background-color:#ffffff; background-image:linear-gradient(45deg, #cfcfcf 25%, transparent 25%),linear-gradient(-45deg, #cfcfcf 25%, transparent 25%),linear-gradient(45deg, transparent 75%, #cfcfcf 75%),linear-gradient(-45deg, transparent 75%, #cfcfcf 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
          /* Fallback styles when toolkit is unavailable */
          .btn-fallback{padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--panel);color:var(--fg);cursor:pointer}
          .btn-fallback:hover{background:rgba(255,255,255,.05)}
          .select-fallback{background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:4px 8px;height:28px}
          .range-fallback{accent-color:var(--accent);}
        </style>
        </head>
        <body>
          <script type="module" src="${toolkitSrc}" nonce="${nonce}"></script>
          <div class="toolbar">
            <div class="group">
              <vscode-button appearance="primary" id="btnPlay" title="空格">暂停</vscode-button>
              <vscode-button id="btnPrev" title="←">上帧</vscode-button>
              <vscode-button id="btnNext" title="→">下帧</vscode-button>
            </div>
            <div class="group">
              <span>速度</span>
              <input id="speed" class="range-fallback" type="range" min="0.25" max="4" step="0.05" value="1" style="width:180px" />
              <span class="pill" id="lblSpeed">1.00x</span>
            </div>
            <div class="group">
              <span>背景</span>
              <vscode-dropdown id="bgSel">
                <vscode-option value="dark">深色</vscode-option>
                <vscode-option value="light">浅色</vscode-option>
                <vscode-option value="checker">棋盘格</vscode-option>
                <vscode-option value="transparent">透明</vscode-option>
              </vscode-dropdown>
            </div>
            <div class="group">
              <vscode-button id="btnRefresh" title="重新解析 ANI">刷新</vscode-button>
            </div>
            <span class="grow"></span>
          </div>
          <div class="statusbar">
            <div class="stats">
              <span>帧 <b id="lblFrame">1</b> / ${timeline.length}</span>
              <span>帧ID <b id="lblFrameId">0</b></span>
              <span>延迟 <b id="lblDelay">0</b> ms</span>
            </div>
            <div class="tips">快捷键：空格播放/暂停，+/- 调速，←/→ 切帧</div>
          </div>
          <canvas id="c" width="512" height="512" tabindex="0"></canvas>
           <script nonce="${nonce}">
             const timeline=${JSON.stringify(timeline)};
             const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
             function doFallback(){
               const replaceAll = (selector, maker) => { document.querySelectorAll(selector).forEach(el => { const n = maker(el); el.replaceWith(n); }); };
               replaceAll('vscode-button', (old)=>{ const b=document.createElement('button'); b.id=old.id; b.title=old.title||''; b.className='btn-fallback'; b.textContent=old.textContent||''; return b; });
               replaceAll('vscode-slider', (old)=>{ const r=document.createElement('input'); r.type='range'; r.id=old.id; r.min=old.getAttribute('min')||'0'; r.max=old.getAttribute('max')||'4'; r.step=old.getAttribute('step')||'0.05'; r.value=old.getAttribute('value')||'1'; r.style.width=old.style.width||'180px'; r.className='range-fallback'; return r; });
               replaceAll('vscode-dropdown', (old)=>{ const s=document.createElement('select'); s.id=old.id; s.className='select-fallback'; Array.from(old.querySelectorAll('vscode-option')).forEach(opt=>{ const o=document.createElement('option'); o.value=opt.getAttribute('value')||''; o.textContent=opt.textContent||''; s.appendChild(o); }); return s; });
             }
             function initUI(){
              const canvas=document.getElementById('c');
              const ctx=canvas.getContext('2d');
              // offscreen buffer for sprite to allow composite operations
              const buf=document.createElement('canvas');
              const bctx=buf.getContext('2d');
               const btnPlay=document.getElementById('btnPlay');
               const btnPrev=document.getElementById('btnPrev');
               const btnNext=document.getElementById('btnNext');
               const btnRefresh=document.getElementById('btnRefresh');
               const speedEl=document.getElementById('speed');
               const bgSel=document.getElementById('bgSel');
               const lblSpeed=document.getElementById('lblSpeed');
               const lblFrame=document.getElementById('lblFrame');
               const lblFrameId=document.getElementById('lblFrameId');
               const lblDelay=document.getElementById('lblDelay');
               let idx=0;let playing=true;let speed=1.0;let timer=null;
               let bgMode = 'dark';
               function applyBg(mode){
                 bgMode = mode || 'dark';
                 canvas.classList.remove('bg-dark','bg-light','bg-checker','bg-transparent');
                 if(bgMode==='light') canvas.classList.add('bg-light');
                 else if(bgMode==='checker') canvas.classList.add('bg-checker');
                 else if(bgMode==='transparent') canvas.classList.add('bg-transparent');
                 else canvas.classList.add('bg-dark');
               }
               function b64ToU8(b64){const s=atob(b64);const arr=new Uint8ClampedArray(s.length);for(let i=0;i<s.length;i++)arr[i]=s.charCodeAt(i);return arr;}
               function drawFrame(){
                 const f=timeline[idx];
                 const imgData=new ImageData(b64ToU8(f.rgba),f.w,f.h);
                 // apply client-side graphic effects for this frame
                 try {
                   if (f.gfx === 'LINEARDODGE') {
                     const d = imgData.data;
                     for (let i = 0; i < d.length; i += 4) {
                       const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
                       const max = Math.max(r, g, b);
                       const sub = 255 - max;
                       const na = Math.min(a, max);
                       d[i+3] = na;
                       d[i] = Math.min(255, r + sub);
                       d[i+1] = Math.min(255, g + sub);
                       d[i+2] = Math.min(255, b + sub);
                     }
                   }
                   // RGBA tint multiply (per-channel scale) with alpha override
                   if (f.tint) {
                     const tr = f.tint[0] / 255, tg = f.tint[1] / 255, tb = f.tint[2] / 255, ta = f.tint[3];
                     const d = imgData.data;
                     for (let i = 0; i < d.length; i += 4) {
                       d[i] = Math.min(255, Math.round(d[i] * tr));
                       d[i+1] = Math.min(255, Math.round(d[i+1] * tg));
                       d[i+2] = Math.min(255, Math.round(d[i+2] * tb));
                       if (!Number.isNaN(ta)) d[i+3] = Math.min(255, Math.round(d[i+3] * (ta / 255)));
                     }
                   }
                 } catch (e) { /* ignore effect failures */ }
                 // prepare offscreen
                 if(buf.width!==f.w||buf.height!==f.h){ buf.width=f.w; buf.height=f.h; }
                 bctx.clearRect(0,0,buf.width,buf.height);
                 bctx.putImageData(imgData,0,0);
                 // draw canvas background so composite modes take effect against it
                 ctx.globalCompositeOperation = 'source-over';
                 if(bgMode==='transparent'){
                   ctx.clearRect(0,0,canvas.width,canvas.height);
                 } else if(bgMode==='light'){
                   ctx.fillStyle = '#e6e6e6';
                   ctx.fillRect(0,0,canvas.width,canvas.height);
                 } else if(bgMode==='checker'){
                   // simple checker pattern (16px)
                   const size = 16; const c1 = '#ffffff', c2 = '#cfcfcf';
                   for(let y=0;y<canvas.height;y+=size){
                     for(let x=0;x<canvas.width;x+=size){
                       const even = ((x/size)|(y/size)) % 2 === 0;
                       ctx.fillStyle = even ? c1 : c2;
                       ctx.fillRect(x,y,size,size);
                     }
                   }
                 } else { // dark
                   ctx.fillStyle = '#111111';
                   ctx.fillRect(0,0,canvas.width,canvas.height);
                 }
                 const cx=(canvas.width>>1)+f.dx;const cy=(canvas.height>>1)+f.dy;
                 // composite with transform: translate->rotate->scale->draw centered
                 ctx.save();
                 ctx.globalCompositeOperation = 'source-over';
                 ctx.translate(Math.floor(cx), Math.floor(cy));
                 const rot = (f.rot || 0) * Math.PI / 180;
                 if (rot) ctx.rotate(rot);
                 const sx = (typeof f.sx === 'number' ? f.sx : 1);
                 const sy = (typeof f.sy === 'number' ? f.sy : 1);
                 if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
                 ctx.drawImage(buf, Math.floor(-f.w/2), Math.floor(-f.h/2));
                 ctx.restore();
                 lblFrame.textContent=String(idx+1);
                 lblFrameId.textContent=String(f.fid??idx);
                 lblDelay.textContent=String(f.delay);
               }
               function schedule(){
                 if(timer)clearTimeout(timer);
                 if(!playing)return;
                 const f=timeline[idx];
                 timer=setTimeout(()=>{idx=(idx+1)%timeline.length;drawFrame();schedule();},Math.max(16,f.delay/Math.max(0.01,speed)));
               }
               function setPlaying(p){playing=p;btnPlay.textContent=playing?'暂停':'播放';if(playing){drawFrame();schedule();}}
               function setSpeed(v){speed=v; if(speedEl) speedEl.value=String(v); lblSpeed.textContent=v.toFixed(2)+'x';}
               btnPlay.addEventListener('click',()=>setPlaying(!playing));
               btnPrev.addEventListener('click',()=>{idx=(idx-1+timeline.length)%timeline.length;drawFrame();});
               btnNext.addEventListener('click',()=>{idx=(idx+1)%timeline.length;drawFrame();});
               if (btnRefresh) btnRefresh.addEventListener('click',()=>{ if (vscodeApi) vscodeApi.postMessage({ type:'refresh' }); else location.reload(); });
               speedEl.addEventListener('input',()=>setSpeed(parseFloat(speedEl.value)));
               bgSel.addEventListener('change',()=>{ applyBg(bgSel.value); drawFrame(); });
               applyBg('dark');
               setSpeed(1.0);drawFrame();schedule();
               setTimeout(()=>{try{canvas.focus();}catch{}},0);
             }
             (function ensureToolkit(){
               const hasCE = !!(window.customElements);
               const defined = hasCE && customElements.get('vscode-button');
               if (defined) { initUI(); return; }
               setTimeout(()=>{
                 const definedLater = hasCE && customElements.get('vscode-button');
                 if (!definedLater) { doFallback(); }
                 initUI();
               }, 1200);
             })();
          </script>
        </body></html>`;
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
