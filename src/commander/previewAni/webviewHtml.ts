import * as vscode from 'vscode';
import { TimelineFrame } from './types';

export function buildPreviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview, timeline: TimelineFrame[], nonce: string, toolkitSrc: string): string {
  const csp = webview.cspSource;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data:; style-src ${csp} 'unsafe-inline'; font-src ${csp}; script-src ${csp} 'nonce-${nonce}';" />
        <style>
          :root{--bg:var(--vscode-editor-background);--fg:var(--vscode-foreground);--panel:var(--vscode-editorWidget-background);--border:var(--vscode-panel-border);--muted:var(--vscode-descriptionForeground);--accent:var(--vscode-button-background);--accent-fg:var(--vscode-button-foreground);}
          html,body{height:100%;}
          body{margin:0;padding:0;font-family:Segoe UI,Arial,"Microsoft YaHei",sans-serif;color:var(--fg);background:var(--bg);display:flex}
          .container{display:flex;flex-direction:column;gap:6px;box-sizing:border-box;padding:10px;width:100%;height:100%}
          .canvas-area{position:relative;flex:1 1 auto;min-height:0}
          #c{image-rendering:pixelated;outline:none;border:1px solid var(--border);border-radius:8px;display:block;width:100%;height:100%}
          .toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--border);padding:8px 10px;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
          .toolbar .group{display:flex;align-items:center;gap:8px}
          .toolbar .grow{flex:1 1 auto}
          .pill{padding:2px 8px;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--fg)}
          .statusbar{display:flex;align-items:center;gap:16px;justify-content:space-between;background:var(--panel);border:1px solid var(--border);padding:6px 10px;border-radius:8px;color:var(--muted)}
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
          <div class="container">
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
              <span>缩放</span>
              <input id="zoom" class="range-fallback" type="range" min="0.25" max="4" step="0.05" value="1" style="width:180px" />
              <span class="pill" id="lblZoom">100%</span>
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
              <vscode-button id="btnCenter" title="显示原始 [IMAGE POS] 偏移">原始坐标</vscode-button>
            </div>
            <div class="group">
              <label style="display:flex;align-items:center;gap:6px">
                <input id="toggleAxes" type="checkbox" checked /> 坐标系
              </label>
              <label style="display:flex;align-items:center;gap:6px">
                <input id="toggleAtk" type="checkbox" checked /> 攻击盒
              </label>
              <label style="display:flex;align-items:center;gap:6px">
                <input id="toggleDmg" type="checkbox" checked /> 受击盒
              </label>
            </div>
            <span class="grow"></span>
          </div>
          <div class="statusbar">
            <div class="stats">
              <span>帧 <b id="lblFrame">1</b> / ${timeline.length}</span>
              <span>帧ID <b id="lblFrameId">0</b></span>
              <span>延迟 <b id="lblDelay">0</b> ms</span>
            </div>
            <div class="tips">快捷键：空格播放/暂停，+/- 调速，←/→ 切帧；支持拖拽画布平移，按住 Ctrl + 滚轮 缩放</div>
          </div>
          <div class="canvas-area"><canvas id="c" tabindex="0"></canvas></div>
          </div>
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
              // handle canvas DPI and size to fill remaining area
              function resizeCanvas(){
                const rect = canvas.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                const w = Math.max(1, Math.floor(rect.width));
                const h = Math.max(1, Math.floor(rect.height));
                const needW = Math.floor(w * dpr), needH = Math.floor(h * dpr);
                if (canvas.width !== needW || canvas.height !== needH) {
                  canvas.width = needW; canvas.height = needH;
                }
                ctx.setTransform(dpr,0,0,dpr,0,0);
                drawFrame();
              }
              const ro = new ResizeObserver(()=> resizeCanvas());
              try { ro.observe(canvas.parentElement || canvas); } catch {}
              window.addEventListener('resize', resizeCanvas);
               const btnPlay=document.getElementById('btnPlay');
               const btnPrev=document.getElementById('btnPrev');
               const btnNext=document.getElementById('btnNext');
               const btnRefresh=document.getElementById('btnRefresh');
               const btnCenter=document.getElementById('btnCenter');
               const speedEl=document.getElementById('speed');
               const zoomEl=document.getElementById('zoom');
               const bgSel=document.getElementById('bgSel');
               const lblSpeed=document.getElementById('lblSpeed');
               const lblZoom=document.getElementById('lblZoom');
               const lblFrame=document.getElementById('lblFrame');
               const lblFrameId=document.getElementById('lblFrameId');
               const lblDelay=document.getElementById('lblDelay');
               const toggleAxes = document.getElementById('toggleAxes');
               const toggleAtk = document.getElementById('toggleAtk');
               const toggleDmg = document.getElementById('toggleDmg');
               let idx=0;let playing=true;let speed=1.0;let timer=null;
               let bgMode = 'dark';
               // camera pan/zoom
               let camX = 0, camY = 0; // in canvas pixels
               let sceneZoom = 1.0;
               // centered mode: when true, ignore per-frame IMAGE POS (dx,dy) so sprite stays centered
               let centered = true;
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
                 const dpr = window.devicePixelRatio || 1;
                 // logical canvas size in CSS pixels
                 const cw = Math.max(1, Math.floor(canvas.width / dpr));
                 const ch = Math.max(1, Math.floor(canvas.height / dpr));
                 // ensure transform matches DPR (in case monitor scale changes)
                 try { ctx.setTransform(dpr,0,0,dpr,0,0); } catch {}
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
                   ctx.clearRect(0,0,cw,ch);
                 } else if(bgMode==='light'){
                   ctx.fillStyle = '#e6e6e6';
                   ctx.fillRect(0,0,cw,ch);
                 } else if(bgMode==='checker'){
                   // simple checker pattern (16px)
                   const size = 16; const c1 = '#ffffff', c2 = '#cfcfcf';
                   for(let y=0;y<ch;y+=size){
                     for(let x=0;x<cw;x+=size){
                       const even = ((x/size)|(y/size)) % 2 === 0;
                       ctx.fillStyle = even ? c1 : c2;
                       ctx.fillRect(x,y,size,size);
                     }
                   }
                 } else { // dark
                   ctx.fillStyle = '#111111';
                   ctx.fillRect(0,0,cw,ch);
                 }
                 // composite with transform: center + camera pan + scene zoom, then frame offset
                 ctx.save();
                 ctx.globalCompositeOperation = 'source-over';
                 const baseX = (cw>>1) + camX;
                 const baseY = (ch>>1) + camY;
                 ctx.translate(Math.floor(baseX), Math.floor(baseY));
                 if (sceneZoom !== 1) ctx.scale(sceneZoom, sceneZoom);
                 // apply per-frame offset only when not centered
                 const offX = centered ? 0 : f.dx;
                 const offY = centered ? 0 : f.dy;
                 ctx.translate(offX, offY);
                 const rot = (f.rot || 0) * Math.PI / 180;
                 if (rot) ctx.rotate(rot);
                 const sx = (typeof f.sx === 'number' ? f.sx : 1);
                 const sy = (typeof f.sy === 'number' ? f.sy : 1);
                 if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
                 ctx.drawImage(buf, Math.floor(-f.w/2), Math.floor(-f.h/2));

                 // overlays: axes and boxes (isometric-ish projection)
                 // Requirement: Z/Y axes base should be at the bottom of the image (bottom center).
                 // We've already translated to image center and applied rotate/scale. Now move origin to bottom center.
                 ctx.save();
                 ctx.translate(0, Math.floor(f.h/2));
                 const showAxes = toggleAxes ? (toggleAxes.checked !== false) : true;
                 const showAtk = toggleAtk ? (toggleAtk.checked !== false) : true;
                 const showDmg = toggleDmg ? (toggleDmg.checked !== false) : true;
                 const drawAxes = () => {
                   ctx.save();
                   // draw X (right), Y (down), Z (up) axes from origin (0,0,0)
                   const axisLen = 200;
                   // Projection: treat Y as depth (receding), Z as vertical up.
                   // screenX = x + k * y; screenY = -z + k * y
                   const proj = (x,y,z)=>{ const k = 0.5; return { x: x + k*y, y: -z + k*y }; };
                   ctx.lineWidth = 1;
                   // X axis (red)
                   ctx.strokeStyle = '#ff4d4f'; ctx.beginPath(); let p0 = proj(0,0,0); let p1 = proj(axisLen,0,0); ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y); ctx.stroke();
                   // Y axis (green, depth receding)
                   ctx.strokeStyle = '#52c41a'; ctx.beginPath(); p0 = proj(0,0,0); p1 = proj(0,axisLen,0); ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y); ctx.stroke();
                   // Z axis (blue, vertical up)
                   ctx.strokeStyle = '#1677ff'; ctx.beginPath(); p0 = proj(0,0,0); p1 = proj(0,0,axisLen); ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y); ctx.stroke();
                   ctx.restore();
                 };
                 const drawBox = (box, color) => {
                   const proj = (x,y,z)=>{ const k=0.5; return { x: x + k*y, y: -z + k*y }; };
                   const {x,y,z,w,h,d} = box;
                   // 8 corners
                   const c = [
                     proj(x,   y,   z),
                     proj(x+w, y,   z),
                     proj(x+w, y+h, z),
                     proj(x,   y+h, z),
                     proj(x,   y,   z+d),
                     proj(x+w, y,   z+d),
                     proj(x+w, y+h, z+d),
                     proj(x,   y+h, z+d),
                   ];
                   ctx.save();
                   ctx.strokeStyle = color; ctx.lineWidth = 1.5;
                   // bottom rectangle (0-1-2-3)
                   ctx.beginPath(); ctx.moveTo(c[0].x,c[0].y); for(const i of [1,2,3,0]) ctx.lineTo(c[i].x,c[i].y); ctx.stroke();
                   // top rectangle (4-5-6-7)
                   ctx.beginPath(); ctx.moveTo(c[4].x,c[4].y); for(const i of [5,6,7,4]) ctx.lineTo(c[i].x,c[i].y); ctx.stroke();
                   // verticals
                   ctx.beginPath(); for(const i of [0,1,2,3]){ ctx.moveTo(c[i].x,c[i].y); ctx.lineTo(c[i+4].x,c[i+4].y); } ctx.stroke();
                   ctx.restore();
                 };
                 if (showAxes) drawAxes();
                 if (showAtk && Array.isArray(f.atk)) for (const b of f.atk) drawBox(b, '#fadb14'); // yellow
                 if (showDmg && Array.isArray(f.dmg)) for (const b of f.dmg) drawBox(b, '#13c2c2'); // cyan
                 ctx.restore();
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
               function setZoom(v){sceneZoom=v; if(zoomEl) zoomEl.value=String(v); lblZoom.textContent=Math.round(v*100)+'%'; drawFrame();}
               btnPlay.addEventListener('click',()=>setPlaying(!playing));
               btnPrev.addEventListener('click',()=>{idx=(idx-1+timeline.length)%timeline.length;drawFrame();});
               btnNext.addEventListener('click',()=>{idx=(idx+1)%timeline.length;drawFrame();});
               if (btnRefresh) btnRefresh.addEventListener('click',()=>{ if (vscodeApi) vscodeApi.postMessage({ type:'refresh' }); else location.reload(); });
               speedEl.addEventListener('input',()=>setSpeed(parseFloat(speedEl.value)));
               zoomEl.addEventListener('input',()=>setZoom(parseFloat(zoomEl.value)));
               bgSel.addEventListener('change',()=>{ applyBg(bgSel.value); drawFrame(); });
               if (btnCenter) btnCenter.addEventListener('click',()=>{ centered = false; camX = 0; camY = 0; drawFrame(); });
               // toggle overlays should redraw immediately
               if (toggleAxes) toggleAxes.addEventListener('change', ()=> drawFrame());
               if (toggleAtk) toggleAtk.addEventListener('change', ()=> drawFrame());
               if (toggleDmg) toggleDmg.addEventListener('change', ()=> drawFrame());
               // mouse pan + wheel zoom
               let dragging=false, lastX=0, lastY=0;
               canvas.addEventListener('mousedown',(e)=>{ dragging=true; lastX=e.clientX; lastY=e.clientY; canvas.style.cursor='grabbing'; });
               window.addEventListener('mouseup',()=>{ dragging=false; canvas.style.cursor='default'; });
               window.addEventListener('mousemove',(e)=>{ if(!dragging) return; const dx=e.clientX-lastX; const dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY; camX += dx; camY += dy; drawFrame(); });
               canvas.addEventListener('wheel',(e)=>{
                 // Only zoom when holding Ctrl inside the canvas
                 if (!e.ctrlKey) return;
                 const delta = 0.1 * (e.deltaY>0? -1: 1);
                 const z = Math.min(4, Math.max(0.25, sceneZoom + delta));
                 setZoom(z);
                 e.preventDefault();
               }, { passive:false });
               // keyboard shortcuts: Space play/pause, +/- speed, arrows frame step
               function isTypingTarget(t){
                 if (!t) return false;
                 const tag = (t.tagName||'').toUpperCase();
                 return tag==='INPUT' || tag==='SELECT' || tag==='TEXTAREA' || (t.isContentEditable===true);
               }
               function clamp(v,min,max){ return v<min?min:v>max?max:v; }
               window.addEventListener('keydown',(e)=>{
                 if (isTypingTarget(e.target)) return;
                 // Space: toggle play/pause
                 if (e.code==='Space' || e.key===' ') {
                   setPlaying(!playing);
                   e.preventDefault();
                   return;
                 }
                 // Left/Right arrows: step frames
                 if (e.key==='ArrowLeft') { idx=(idx-1+timeline.length)%timeline.length; drawFrame(); e.preventDefault(); return; }
                 if (e.key==='ArrowRight'){ idx=(idx+1)%timeline.length; drawFrame(); e.preventDefault(); return; }
                 // +/- speed adjust (ignore when holding Ctrl to avoid conflict with zoom or VSCode shortcuts)
                 if (!e.ctrlKey) {
                   if (e.key==='+' || (e.key==='=' && e.shiftKey)) { setSpeed(clamp(speed + 0.1, 0.25, 4)); e.preventDefault(); return; }
                   if (e.key==='-' || e.key==='_') { setSpeed(clamp(speed - 0.1, 0.25, 4)); e.preventDefault(); return; }
                 }
               });
               applyBg('dark');
               // default centered display
               setSpeed(1.0); setZoom(1.0);
               // trigger initial size and first draw
               resizeCanvas();
               schedule();
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
