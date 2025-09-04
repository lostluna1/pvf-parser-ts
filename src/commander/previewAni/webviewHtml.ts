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
          .statusbar .stats span b#lblLayer{color:var(--fg)}
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
              <label style="display:flex;align-items:center;gap:6px">
                <input id="toggleAls" type="checkbox" checked /> ALS图层
              </label>
            </div>
            <span class="grow"></span>
          </div>
          <div class="statusbar">
            <div class="stats">
              <span>帧 <b id="lblFrame">1</b> / ${timeline.length}</span>
              <span>帧ID <b id="lblFrameId">0</b></span>
              <span>延迟 <b id="lblDelay">0</b> ms</span>
              <span>图层 <b id="lblLayer">MAIN</b></span>
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
               const toggleAls = document.getElementById('toggleAls');
               let idx=0;let playing=true;let speed=1.0;let timer=null;
               let bgMode = 'dark';
               // camera pan/zoom
               let camX = 0, camY = 0; // in canvas pixels
               let sceneZoom = 1.0;
               // Layer picking state
               let selectedLayer = null; // { frame: number, layer: any }
               let lastPolys = []; // [{ layer, poly: [{x,y},...] }]
               function applyBg(mode){
                 bgMode = mode || 'dark';
                 canvas.classList.remove('bg-dark','bg-light','bg-checker','bg-transparent');
                 if(bgMode==='light') canvas.classList.add('bg-light');
                 else if(bgMode==='checker') canvas.classList.add('bg-checker');
                 else if(bgMode==='transparent') canvas.classList.add('bg-transparent');
                 else canvas.classList.add('bg-dark');
               }
               function b64ToU8(b64){const s=atob(b64);const arr=new Uint8ClampedArray(s.length);for(let i=0;i<s.length;i++)arr[i]=s.charCodeAt(i);return arr;}
               function pointInPoly(px, py, poly){
                 let inside=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){
                   const xi=poly[i].x, yi=poly[i].y; const xj=poly[j].x, yj=poly[j].y;
                   const intersect = ((yi>py)!=(yj>py)) && (px < (xj-xi)*(py-yi)/(yj-yi+0.00001)+xi);
                   if(intersect) inside=!inside;
                 } return inside;
               }
               function buildLayerPolys(layers, cw, ch, dpr){
                 lastPolys=[];
                 const baseX = (cw>>1) + camX; const baseY = (ch>>1) + camY;
                 for(const L of layers){
                   const rot=(L.rot||0)*Math.PI/180; const cos=Math.cos(rot), sin=Math.sin(rot);
                   const sx=(typeof L.sx==='number'?L.sx:1); const sy=(typeof L.sy==='number'?L.sy:1);
                   const ox=L.ox|0, oy=L.oy|0, w=L.w, h=L.h;
                   const pts=[
                     {x:ox,y:oy},{x:ox+w,y:oy},{x:ox+w,y:oy+h},{x:ox,y:oy+h}
                   ].map(p=>{
                     let x=p.x*sx, y=p.y*sy;
                     const rx=x*cos - y*sin; const ry=x*sin + y*cos;
                     const wx=L.dx + rx; const wy=L.dy + ry;
                     return { x: (baseX + wx*sceneZoom), y: (baseY + wy*sceneZoom) };
                   });
                   lastPolys.push({ layer:L, poly:pts });
                 }
               }
               function drawFrame(){
                 const dpr = window.devicePixelRatio || 1;
                 // logical canvas size in CSS pixels
                 const cw = Math.max(1, Math.floor(canvas.width / dpr));
                 const ch = Math.max(1, Math.floor(canvas.height / dpr));
                 // ensure transform matches DPR (in case monitor scale changes)
                 try { ctx.setTransform(dpr,0,0,dpr,0,0); } catch {}
                     const f=timeline[idx];
                     const allLayers = Array.isArray(f.layers) ? f.layers : [f];
                     let layers = allLayers;
                     if (toggleAls && !toggleAls.checked) {
                       const mainLayer = allLayers.find(l=>l.__main) || allLayers[0];
                       layers = mainLayer ? [mainLayer] : [];
                     }
                     const processLayer = (L) => {
                       const imgData=new ImageData(b64ToU8(L.rgba),L.w,L.h);
                       try {
                         if (L.gfx === 'LINEARDODGE') {
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
                         if (L.tint) {
                           const tr = L.tint[0] / 255, tg = L.tint[1] / 255, tb = L.tint[2] / 255, ta = L.tint[3];
                           const d = imgData.data;
                           for (let i = 0; i < d.length; i += 4) {
                             d[i] = Math.min(255, Math.round(d[i] * tr));
                             d[i+1] = Math.min(255, Math.round(d[i+1] * tg));
                             d[i+2] = Math.min(255, Math.round(d[i+2] * tb));
                             if (!Number.isNaN(ta)) d[i+3] = Math.min(255, Math.round(d[i+3] * (ta / 255)));
                           }
                         }
                       } catch {}
                       if(buf.width!==L.w||buf.height!==L.h){ buf.width=L.w; buf.height=L.h; }
                       bctx.clearRect(0,0,buf.width,buf.height);
                       bctx.putImageData(imgData,0,0);
                       ctx.save();
                       // 先应用 ANI 坐标 (世界坐标相对 pivot)，再加 sprite 内部偏移 (top-left)
                       ctx.translate(L.dx, L.dy);
                       const rot = (L.rot || 0) * Math.PI / 180; if (rot) ctx.rotate(rot);
                       const sx = (typeof L.sx === 'number' ? L.sx : 1); const sy = (typeof L.sy === 'number' ? L.sy : 1); if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
                       ctx.drawImage(buf, L.ox|0, L.oy|0);
                       ctx.restore();
                     };
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
                 ctx.save();
                 const baseX = (cw>>1) + camX; const baseY = (ch>>1) + camY; ctx.translate(Math.floor(baseX), Math.floor(baseY)); if (sceneZoom !== 1) ctx.scale(sceneZoom, sceneZoom);
                 // 按层顺序绘制
                 for (const L of layers) { processLayer(L); }
                 // 生成多边形用于拾取（需在变换下完成，因此在 restore 之前记录世界坐标 -> 之后转换为屏幕坐标，我们采用复制逻辑）
                 buildLayerPolys(layers, cw, ch, dpr);

                 // overlays: axes and boxes (isometric-ish projection)
                 // Requirement: Z/Y axes base should be at the bottom of the image (bottom center).
                 // We've already translated to image center and applied rotate/scale. Now move origin to bottom center.
                 ctx.save();
                 // 轴心即世界 pivot，直接在 (0,0) 位置绘制坐标系与盒子（盒子数值已相对 pivot）
                 ctx.translate(0,0);
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
                 // 高亮选中图层 (在屏幕坐标)
                 if (selectedLayer && selectedLayer.frame === idx){
                   const entry = lastPolys.find(p=>p.layer===selectedLayer.layer);
                   if (entry){
                     ctx.save();
                     ctx.lineWidth=2; ctx.strokeStyle='#ff00ff'; ctx.setLineDash([6,4]);
                     const poly=entry.poly; ctx.beginPath(); ctx.moveTo(poly[0].x, poly[0].y); for(let i=1;i<poly.length;i++) ctx.lineTo(poly[i].x, poly[i].y); ctx.closePath(); ctx.stroke();
                     ctx.setLineDash([]);
                     // label
                     const cx=poly.reduce((a,p)=>a+p.x,0)/poly.length; const cy=Math.min(...poly.map(p=>p.y));
                     const label= entry.layer.__id || 'LAYER';
                     ctx.font='12px Segoe UI'; const tw=ctx.measureText(label).width+10; const th=18;
                     ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(cx-tw/2, cy-th-6, tw, th);
                     ctx.fillStyle='#fff'; ctx.fillText(label, cx-tw/2+5, cy-th-6+13);
                     ctx.restore();
                   }
                 }
                 lblFrame.textContent=String(idx+1);
                 lblFrameId.textContent=String(f.fid??idx);
                 lblDelay.textContent=String(f.delay);
                 if (selectedLayer && selectedLayer.frame === idx){
                   lblLayer.textContent = selectedLayer.layer.__id || 'MAIN';
                 } else {
                   lblLayer.textContent = 'MAIN';
                 }
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
               // toggle overlays should redraw immediately
               if (toggleAxes) toggleAxes.addEventListener('change', ()=> drawFrame());
               if (toggleAtk) toggleAtk.addEventListener('change', ()=> drawFrame());
               if (toggleDmg) toggleDmg.addEventListener('change', ()=> drawFrame());
               if (toggleAls) toggleAls.addEventListener('change', ()=> drawFrame());
               // mouse pan + wheel zoom
               let dragging=false, lastX=0, lastY=0;
               canvas.addEventListener('mousedown',(e)=>{ dragging=true; lastX=e.clientX; lastY=e.clientY; canvas.style.cursor='grabbing'; });
               window.addEventListener('mouseup',()=>{ dragging=false; canvas.style.cursor='default'; });
               window.addEventListener('mousemove',(e)=>{ if(!dragging) return; const dx=e.clientX-lastX; const dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY; camX += dx; camY += dy; drawFrame(); });
               canvas.addEventListener('click',(e)=>{
                 const rect = canvas.getBoundingClientRect();
                 const px = e.clientX - rect.left; const py = e.clientY - rect.top;
                 // 自顶向下寻找(后绘制的在数组后面，但在逻辑里我们按顺序绘制；拾取期望顶层优先 -> 逆序遍历)
                 let picked=null;
                 for (let i=lastPolys.length-1;i>=0;i--){
                   if(pointInPoly(px,py,lastPolys[i].poly)){ picked=lastPolys[i]; break; }
                 }
                 if (picked){
                   selectedLayer={ frame: idx, layer: picked.layer };
                 } else {
                   selectedLayer=null;
                 }
                 drawFrame();
               });
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
