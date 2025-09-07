import * as vscode from 'vscode';
import { TimelineFrame } from './types';

interface LayerMeta { id: string; relLayer: number; order: number; kind?: string; source?: string; seq?: number; }
interface UseDecl { id: string; path: string; }

export function buildPreviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview, timeline: TimelineFrame[], nonce: string, toolkitSrc: string, layers?: LayerMeta[], uses?: UseDecl[], _mainFrames?: any[], initState?: any): string {
  const csp = webview.cspSource;
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data:; style-src ${csp} 'unsafe-inline'; font-src ${csp}; script-src ${csp} 'nonce-${nonce}';" />
        <style>
          :root{--bg:var(--vscode-editor-background);--fg:var(--vscode-foreground);--panel:var(--vscode-editorWidget-background);--border:var(--vscode-panel-border);--muted:var(--vscode-descriptionForeground);--accent:var(--vscode-button-background);--accent-fg:var(--vscode-button-foreground);}
          html,body{height:100%;}
          body{margin:0;padding:0;font-family:Segoe UI,Arial,"Microsoft YaHei",sans-serif;color:var(--fg);background:var(--bg);display:flex}
          .container{display:flex;flex-direction:row;gap:10px;box-sizing:border-box;padding:10px;width:100%;height:100%;overflow:hidden}
          .left-panel{width:250px;flex:0 0 auto;display:flex;flex-direction:column;gap:8px;transition:width .18s ease}
          .left-panel.collapsed{width:42px}
          .left-panel.collapsed .layer-list, .left-panel.collapsed .designer-toolbar button:not(#btnTogglePanel), .left-panel.collapsed .frame-panel{display:none}
          #btnTogglePanel{min-width:34px;padding:4px 4px;font-size:12px;line-height:1}
          .main-wrapper{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:8px;overflow:hidden}
          .layer-list{flex:1 1 auto;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px;background:var(--panel);display:flex;flex-direction:column;gap:4px}
          .layer-item{padding:6px 8px;border:1px solid transparent;border-radius:6px;cursor:pointer;display:flex;flex-direction:column;gap:2px;background:rgba(255,255,255,0.02);}
          .layer-item:hover{background:rgba(255,255,255,0.07);}
          .layer-item.active{border-color:var(--accent);background:rgba(0,122,204,0.15);}
          .layer-item .meta{font-size:11px;opacity:.8;display:flex;gap:6px;flex-wrap:wrap}
          .layer-item.dragging{opacity:.4}
          .layer-item.drop-target{outline:2px dashed var(--accent)}
          .layer-actions{display:flex;gap:6px}
          .designer-toolbar{display:flex;gap:6px;flex-wrap:wrap}
          /* 主帧编辑区域相关样式已移除 */
          .small-btn{padding:2px 6px;font-size:11px;line-height:1;border-radius:4px;border:1px solid var(--border);background:var(--panel);cursor:pointer}
          .small-btn:hover{background:rgba(255,255,255,0.07)}
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
            <div class="left-panel" id="leftPanel">
              <div class="designer-toolbar">
                <vscode-button id="btnTogglePanel" appearance="secondary" title="折叠/展开">◀</vscode-button>
                <vscode-button id="btnLayerUp" title="上移一层">上移</vscode-button>
                <vscode-button id="btnLayerDown" title="下移一层">下移</vscode-button>
                <vscode-button id="btnBringFront" title="层级+1 (depth+1)">层级+1</vscode-button>
                <vscode-button id="btnSendBack" title="层级-1 (depth-1)">层级-1</vscode-button>
                <vscode-button id="btnRelInc" title="开始帧+1 (startFrame+1)">start+1</vscode-button>
                <vscode-button id="btnRelDec" title="开始帧-1 (startFrame-1)">start-1</vscode-button>
                <vscode-button id="btnSaveAls" title="保存 ALS 变更">保存ALS</vscode-button>
              </div>
              <div class="layer-list" id="layerList"></div>
              <!-- 主帧编辑面板已移除 -->
            </div>
            <div class="main-wrapper">
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
            <div class="group">
              <label style="display:flex;align-items:center;gap:6px">
                <input id="syncToggle" type="checkbox" checked /> 同步光标
              </label>
            </div>
            <span class="grow"></span>
          </div>
          <div class="statusbar">
            <div class="stats">
              <span>帧ID <b id="lblFrameId">0</b></span>
              <span>帧 <b id="lblFrame">1</b> / ${timeline.length}</span>
              <span>延迟 <b id="lblDelay">0</b> ms</span>
              <span>图层 <b id="lblLayer">MAIN</b></span>
            </div>
            <div class="tips">空格播放/暂停，+/- 调速，←/→ 切帧；支持拖拽画布平移，按住 Ctrl + 滚轮 缩放</div>
          </div>
                <div class="canvas-area"><canvas id="c" tabindex="0"></canvas></div>
              </div>
            </div>
          </div>
           <script nonce="${nonce}">
         const timeline=${JSON.stringify(timeline)};
         const layerMeta=${JSON.stringify(layers||[])};
         const useDecls=${JSON.stringify(uses||[])};
         const initState=${JSON.stringify(initState||{})};
         // 主帧编辑数据已移除
           // 预处理：收集每个 ALS 图层的原始帧序列（按出现顺序）以便 start(=relLayer) 动态偏移重构
           const layerFrameStore = (()=>{
              const m = new Map();
              for (let i=0;i<timeline.length;i++){
                const t = timeline[i];
                const arr = Array.isArray(t.layers)? t.layers : [];
                for (const L of arr){
                  if (L.__main) continue;
                  const id = L.__id || L.id; if(!id) continue;
                  let rec = m.get(id);
                  if(!rec){ rec = { frames: [], originalStart: i }; m.set(id, rec); }
                  rec.frames.push(L);
                }
              }
              return m;
           })();
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
               const syncToggle = document.getElementById('syncToggle');
               let syncEnabled = true; if (syncToggle) syncEnabled = !!syncToggle.checked;
               // 应用初始状态
               try {
                 if (initState && typeof initState === 'object') {
                   if (typeof initState.axes === 'boolean' && toggleAxes) toggleAxes.checked = !!initState.axes;
                   if (typeof initState.atk === 'boolean' && toggleAtk) toggleAtk.checked = !!initState.atk;
                   if (typeof initState.dmg === 'boolean' && toggleDmg) toggleDmg.checked = !!initState.dmg;
                   if (typeof initState.als === 'boolean' && toggleAls) toggleAls.checked = !!initState.als;
                   if (typeof initState.sync === 'boolean' && syncToggle) { syncToggle.checked = !!initState.sync; syncEnabled = !!initState.sync; }
                   if (typeof initState.bg === 'string' && bgSel) { const opt = Array.from(bgSel.querySelectorAll('vscode-option,option')).find(o=> o.getAttribute('value')===initState.bg); if(opt) bgSel.value = initState.bg; }
                   if (typeof initState.speed === 'number' && speedEl) { speedEl.value = String(initState.speed); }
                   if (typeof initState.zoom === 'number' && zoomEl) { zoomEl.value = String(initState.zoom); }
                 }
               } catch {}
               // layer panel elements
               const layerListEl = document.getElementById('layerList');
               const btnLayerUp = document.getElementById('btnLayerUp');
               const btnLayerDown = document.getElementById('btnLayerDown');
               const btnSaveAls = document.getElementById('btnSaveAls');
               const btnBringFront = document.getElementById('btnBringFront');
               const btnSendBack = document.getElementById('btnSendBack');
               const btnRelInc = document.getElementById('btnRelInc');
               const btnRelDec = document.getElementById('btnRelDec');
               // 主帧编辑相关元素已移除
               const btnTogglePanel = document.getElementById('btnTogglePanel');
               const leftPanel = document.getElementById('leftPanel');
               let idx=0;let playing=false;let speed=1.0;let timer=null;
               let bgMode = 'dark';
               // camera pan/zoom
               let camX = 0, camY = 0; // in canvas pixels
               let sceneZoom = 1.0;
               // ALS layer ordering working copy (exclude main)
               // 工作副本：保持原文件顺序 (seq)；禁止拖动改变顺序
               let workingLayers = layerMeta.slice().sort((a,b)=> (a.seq||0)-(b.seq||0));
               let selectedLayerId = null; // ALS id (not MAIN)
               // 主帧编辑状态已删除
               // Layer picking state (使用 id 而非对象引用，避免克隆后引用丢失)
               let lastPolys = []; // [{ layer, poly: [...]}]
               let selectedLayerFrame = -1;
               function normalizeOrdersWithinRel(rel){ /* 禁用: 不再重新分配顺序 */ }
               function rebuildAllOrders(){ /* 禁用 */ }
               function renderLayerList(){
                 if(!layerListEl) return;
                 layerListEl.innerHTML='';
                 // 不再自动排序，按当前 workingLayers 顺序显示
                 for (const lay of workingLayers) {
                   const item=document.createElement('div');
                   item.className='layer-item'+(lay.id===selectedLayerId?' active':'');
                   // 拖拽禁用：不设置 draggable
                   item.dataset.id = lay.id;
                   const title=document.createElement('div'); title.textContent=lay.id; title.style.fontWeight='600'; title.style.fontSize='12px';
                   const meta=document.createElement('div'); meta.className='meta'; meta.innerHTML='start='+lay.order+' depth='+lay.relLayer+(lay.kind?(' '+lay.kind):'');
                   item.appendChild(title); item.appendChild(meta);
                   item.addEventListener('click',()=>{ selectedLayerId = lay.id===selectedLayerId ? null : lay.id; // toggle
                     // also select in canvas highlight
                     if (selectedLayerId){ const candidate = lastPolys.find(p=> (p.layer.__id||p.layer.id) === selectedLayerId); if(candidate){ selectedLayer={ frame: idx, layer: candidate.layer }; } else { selectedLayer=null; } }
                     else selectedLayer=null; renderLayerList(); drawFrame(); });
                   // 拖拽事件移除
                   layerListEl.appendChild(item);
                 }
               }
               function shiftLayer(delta){ /* 排序功能禁用 */ }
               function bringToFront(){ if(!selectedLayerId) return; const t=workingLayers.find(l=> l.id===selectedLayerId); if(!t) return; t.relLayer++; renderLayerList(); drawFrame(); }
               function sendToBack(){ if(!selectedLayerId) return; const t=workingLayers.find(l=> l.id===selectedLayerId); if(!t) return; t.relLayer--; renderLayerList(); drawFrame(); }
               // startFrame 调整函数（修改 order）
               function adjustStartFrame(delta){ if(!selectedLayerId) return; const t=workingLayers.find(l=> l.id===selectedLayerId); if(!t) return; t.order+=delta; renderLayerList(); drawFrame(); }
               // 主帧列表与保存逻辑已删除
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
                     const mainLayer = (Array.isArray(f.layers)? f.layers : [f]).find(l=> l.__main) || f; // 主层引用
                     let layers = [];
                     if (toggleAls && !toggleAls.checked){
                       layers = mainLayer ? [mainLayer] : [];
                     } else {
                       // 动态组合：主层 + 每个 workingLayers (基于新 start 取对应帧)
                       if (mainLayer) layers.push(mainLayer);
                       // 保持 seq 顺序 (原文件声明顺序)，仅根据 start(order) 取对应帧
                       for (const meta of workingLayers){
                         const rec = layerFrameStore.get(meta.id);
                         if (!rec) continue;
                         const relIndex = idx - meta.order; // startFrame = order
                         if (relIndex < 0 || relIndex >= rec.frames.length) continue; // 还未开始或已结束
                         const baseFrame = rec.frames[relIndex];
                         // 克隆并覆盖标记: __rel=depth, __start=startFrame
                         layers.push({ ...baseFrame, __rel: meta.relLayer, __start: meta.order, __id: meta.id });
                       }
                     }
                     // 排序：按 depth(__rel) 升序；主层视为 depth=0，可被 depth<0 的层放到其下方，depth>0 的放到其上方
                     layers.sort((a,b)=>{
                       const ra = a.__main ? 0 : (a.__rel||0);
                       const rb = b.__main ? 0 : (b.__rel||0);
                       if (ra !== rb) return ra - rb;
                       return 0; // 保持同 depth 稳定顺序
                     });
                     // inject __id mapping (already provided); adjust based on workingLayers order for drawing? we keep original render order for now
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
                 // 高亮选中图层 (在屏幕坐标) - 通过 id 匹配
                 if (selectedLayerId && selectedLayerFrame === idx){
                   const entry = lastPolys.find(p=> (p.layer.__id||p.layer.id) === selectedLayerId);
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
                 lblLayer.textContent = (selectedLayerId && selectedLayerFrame===idx) ? selectedLayerId : 'MAIN';
                  // 通知扩展当前帧（节流）
                  if (vscodeApi && syncEnabled) {
                    const now = Date.now();
                    if (!window.__lastFrameNotify || now - window.__lastFrameNotify > 80 || idx === 0) {
                      window.__lastFrameNotify = now;
                      vscodeApi.postMessage({ type:'frameChange', idx });
                    }
                  }
               }
               function schedule(){
                 if(timer)clearTimeout(timer);
                 if(!playing)return;
                 const f=timeline[idx];
                 timer=setTimeout(()=>{idx=(idx+1)%timeline.length;drawFrame();schedule();},Math.max(16,f.delay/Math.max(0.01,speed)));
               }
               function setPlaying(p){playing=p;btnPlay.textContent=playing?'暂停':'播放';if(playing){drawFrame();schedule();}}
               function persist(){ if (vscodeApi) vscodeApi.postMessage({ type:'persistState', state: { axes: !!(toggleAxes&&toggleAxes.checked), atk: !!(toggleAtk&&toggleAtk.checked), dmg: !!(toggleDmg&&toggleDmg.checked), als: !!(toggleAls&&toggleAls.checked), sync: syncEnabled, bg: bgSel?bgSel.value:'dark', speed, zoom: sceneZoom } }); }
               function setSpeed(v){speed=v; if(speedEl) speedEl.value=String(v); lblSpeed.textContent=v.toFixed(2)+'x'; persist();}
               function setZoom(v){sceneZoom=v; if(zoomEl) zoomEl.value=String(v); lblZoom.textContent=Math.round(v*100)+'%'; drawFrame(); persist();}
               btnPlay.textContent = '播放';
               btnPlay.addEventListener('click',()=>setPlaying(!playing));
               btnPrev.addEventListener('click',()=>{idx=(idx-1+timeline.length)%timeline.length;drawFrame();});
               btnNext.addEventListener('click',()=>{idx=(idx+1)%timeline.length;drawFrame();});
               if (btnRefresh) btnRefresh.addEventListener('click',()=>{ if (vscodeApi) vscodeApi.postMessage({ type:'refresh' }); else location.reload(); });
               speedEl.addEventListener('input',()=>setSpeed(parseFloat(speedEl.value)));
               zoomEl.addEventListener('input',()=>setZoom(parseFloat(zoomEl.value)));
               bgSel.addEventListener('change',()=>{ applyBg(bgSel.value); drawFrame(); persist(); });
               // toggle overlays should redraw immediately
               if (toggleAxes) toggleAxes.addEventListener('change', ()=> { drawFrame(); persist(); });
               if (toggleAtk) toggleAtk.addEventListener('change', ()=> { drawFrame(); persist(); });
               if (toggleDmg) toggleDmg.addEventListener('change', ()=> { drawFrame(); persist(); });
               if (toggleAls) toggleAls.addEventListener('change', ()=> { drawFrame(); persist(); });
               if (syncToggle) syncToggle.addEventListener('change', ()=> { syncEnabled = !!syncToggle.checked; if (vscodeApi) vscodeApi.postMessage({ type:'syncToggle', enabled: syncEnabled }); persist(); });
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
                   const id = picked.layer.__id || picked.layer.id || null;
                   if (id) { selectedLayerId = id; selectedLayerFrame = idx; }
                   else { selectedLayerId = null; selectedLayerFrame = -1; }
                 } else { selectedLayerId=null; selectedLayerFrame=-1; }
                 renderLayerList();
                 drawFrame();
               });
               if(btnLayerUp) btnLayerUp.addEventListener('click',()=> shiftLayer(1));
               if(btnLayerDown) btnLayerDown.addEventListener('click',()=> shiftLayer(-1));
               if(btnBringFront) btnBringFront.addEventListener('click',()=> bringToFront());
               if(btnSendBack) btnSendBack.addEventListener('click',()=> sendToBack());
               if(btnRelInc) btnRelInc.addEventListener('click',()=> adjustStartFrame(1));
               if(btnRelDec) btnRelDec.addEventListener('click',()=> adjustStartFrame(-1));
               if(btnSaveAls) btnSaveAls.addEventListener('click',()=>{
                 if(!vscodeApi) return;
                 // 不再排序，按当前列表(用户调整后的)顺序保存
                 const seq = workingLayers.slice();
                 // 保存时需要输出: 第一数字 = startFrame(order), 第二数字 = depth(relLayer)
                 vscodeApi.postMessage({ type:'saveAls', adds: seq.map(l=> ({ id:l.id, start:l.order, depth:l.relLayer, relLayer:l.relLayer, order:l.order, kind:l.kind })) , uses: useDecls });
               });
               // 主帧编辑相关监听已移除
               if(btnTogglePanel) btnTogglePanel.addEventListener('click',()=>{ if(!leftPanel) return; const collapsed = leftPanel.classList.toggle('collapsed'); btnTogglePanel.textContent = collapsed ? '▶' : '◀'; setTimeout(()=>{ resizeCanvas(); }, 200); });
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
               renderLayerList();
               // 主帧列表渲染调用已移除
               // default centered display
               setSpeed(initState && typeof initState.speed==='number'? initState.speed : 1.0);
               setZoom(initState && typeof initState.zoom==='number'? initState.zoom : 1.0);
               applyBg(initState && typeof initState.bg==='string'? initState.bg : 'dark');
               // trigger initial size and first draw
               resizeCanvas();
               schedule();
               setTimeout(()=>{try{canvas.focus();}catch{}},0);
               // 接收来自扩展的跳帧指令
      window.addEventListener('message',(ev)=>{
                  try {
                    const msg = ev.data;
        if (msg && msg.type === 'gotoFrame' && syncEnabled) {
                      const n = parseInt(msg.idx, 10);
                      if (!Number.isNaN(n) && n >=0 && n < timeline.length) {
                        idx = n; drawFrame();
                      }
                    }
                  } catch {}
               });
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
