import * as React from 'react';
import { createRoot } from 'react-dom/client';
import {
    FluentProvider,
    Button,
    Slider,
    Switch,
    MessageBar,
    Select,
    makeStyles,
    shorthands,
    tokens,
    MessageBarBody,
    MessageBarTitle
} from '@fluentui/react-components';
import { Collapse } from '@fluentui/react-motion-components-preview';
import { getAppTheme, resolveModeFromBg } from './theme';

// === 统一管理（除坐标系/攻击/受击框外）UI 颜色 ===
// 说明：按你的要求，坐标系/攻击/受击框原色 (#ff4d4f/#52c41a/#1677ff/#fadb14/#13c2c2) 不改动；
// 其他原先散落的半透明与背景颜色集中在此，便于后期替换或接入主题 tokens。
// 这里尽量使用 Fluent tokens 代表语义；某些需要透明/渐变的仍保留自定义，同时集中到一个对象。
const UI_COLORS = {
    panelGradient: 'linear-gradient(180deg, rgba(30,30,30,0.92), rgba(30,30,30,0.88) 60%, rgba(30,30,30,0.75))',
    sectionBgToken: tokens.colorNeutralBackground1, // 原 rgba(255,255,255,0.02)
    sectionBorder: tokens.colorNeutralStroke1,
    valueBadgeBgToken: tokens.colorNeutralBackground3, // 原 rgba(255,255,255,0.07)
    overlayBarBg: 'rgba(0,0,0,0.35)',
    miniBarGradient: 'linear-gradient(180deg, rgba(0,0,0,0.78), rgba(0,0,0,0))',
    layerActiveBg: 'rgba(0,120,215,0.35)',
    layerInactiveBg: 'rgba(255,255,255,0.04)',
};

// 简化的 TimelineFrame / Layer 类型（与 webviewHtml.ts 中使用的关键字段一致）
interface LayerFrame {
    __main?: boolean;
    __id?: string;
    id?: string;
    dx: number; dy: number; w: number; h: number; ox: number; oy: number;
    rot?: number; sx?: number; sy?: number; rgba: string; tint?: number[]; gfx?: string;
    // 缓存轮廓路径，避免重复计算
    __outlinePath?: Path2D;
}
interface Box3D { x: number; y: number; z: number; w: number; h: number; d: number; }
interface TimelineFrame { layers?: LayerFrame[]; delay?: number; atk?: Box3D[]; dmg?: Box3D[]; }
interface LayerMeta { id: string; relLayer: number; order: number; kind?: string; seq?: number; }
interface UseDecl { id: string; path: string; }
interface PersistState { axes: boolean; atk: boolean; dmg: boolean; als: boolean; sync: boolean; bg: string; speed: number; zoom: number; }

declare global { interface Window { __ANI_INIT?: { timeline: TimelineFrame[]; layers: LayerMeta[]; uses: UseDecl[]; state: PersistState; }; acquireVsCodeApi?: any; } }

const vscode = typeof window !== 'undefined' && typeof window.acquireVsCodeApi === 'function' ? window.acquireVsCodeApi() : null;

const useStyles = makeStyles({
    root: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        fontFamily: '"Microsoft YaHei","微软雅黑","Segoe UI",Arial',
        background: 'var(--vscode-editor-background)',
        overflow: 'hidden'
    },
    topPanelShell: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        zIndex: 10,
        pointerEvents: 'none'
    },
    topPanelInner: {
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        rowGap: '10px',
    padding: '12px 16px 18px 16px',
    background: UI_COLORS.panelGradient,
        backdropFilter: 'blur(6px)',
    borderBottom: `1px solid ${UI_COLORS.sectionBorder}`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
    },
    panelGroups: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        rowGap: '12px'
    },
    section: {
        display: 'flex',
        flexDirection: 'column',
        rowGap: '6px',
    background: UI_COLORS.sectionBgToken,
    border: `1px solid ${UI_COLORS.sectionBorder}`,
        borderRadius: '4px',
        padding: '6px 8px'
    },
    sectionHeader: {
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.5px',
        opacity: .85,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
    },
    inlineRow: {
        display: 'flex',
        alignItems: 'center',
        columnGap: '6px',
        flexWrap: 'wrap'
    },
    labelSmall: { fontSize: '11px', opacity: .75 },
    valueBadge: {
        fontSize: '11px',
        padding: '2px 6px',
        borderRadius: '4px',
    background: UI_COLORS.valueBadgeBgToken
    },
    canvasWrap: { position: 'relative', flex: 1, ...shorthands.overflow('hidden'), display: 'flex', marginTop: 0 },
    canvas: { width: '100%', height: '100%', display: 'block', outline: 'none', flex: 1 },
    topOverlayBar: {
        position: 'absolute',
        top: '4px',
        right: '8px',
        display: 'flex',
        columnGap: '8px',
        fontSize: '11px',
        padding: '4px 6px',
    background: UI_COLORS.overlayBarBg,
        borderRadius: '4px',
        backdropFilter: 'blur(3px)'
    },
    collapseToggleBtn: {
        position: 'absolute',
        top: '4px',
        left: '8px',
        zIndex: 11,
        pointerEvents: 'auto'
    },
    miniBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        display: 'flex',
        alignItems: 'flex-start', // 允许多行时顶部对齐
        gap: '8px',
        padding: '4px 10px',
    background: UI_COLORS.miniBarGradient,
        fontSize: '12px',
        zIndex: 5,
        pointerEvents: 'none'
    },
    miniBarContent: { display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'auto', flexWrap: 'wrap', rowGap: '4px', maxWidth: '100%' }
});


const useAniLogic = () => {
    const init = React.useMemo(() => window.__ANI_INIT!, []);
    const [playing, setPlaying] = React.useState(false);
    const [idx, setIdx] = React.useState(0);
    const [speed, setSpeed] = React.useState(init.state.speed || 1);
    const [zoom, setZoom] = React.useState(init.state.zoom || 1);
    // 画布平移偏移
    const [cam, setCam] = React.useState({ x: 0, y: 0 });
    const [bg, setBg] = React.useState(init.state.bg || 'dark');
    const [axes, setAxes] = React.useState(!!init.state.axes);
    const [atk, setAtk] = React.useState(init.state.atk !== false);
    const [dmg, setDmg] = React.useState(init.state.dmg !== false);
    const [alsOn, setAlsOn] = React.useState(!!init.state.als);
    const [syncEnabled, setSyncEnabled] = React.useState(init.state.sync !== false);
    const syncRef = React.useRef(true); // 先保持总是同步
    const rafRef = React.useRef<number>();
    const lastTick = React.useRef<number>(performance.now());
    const acc = React.useRef(0);
    const lastFrameNotifyRef = React.useRef<number>(0);

    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    // ALS 工作层元数据（按原 seq 排序，不主动重排）
    const [workingLayers, setWorkingLayers] = React.useState<LayerMeta[]>(() => init.layers.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0)));
    const [selectedLayerId, setSelectedLayerId] = React.useState<string | null>(null);
    const layerFrameStore = React.useMemo(() => {
        const m = new Map<string, { frames: LayerFrame[]; originalStart: number }>();
        const tl = init.timeline;
        for (let i = 0; i < tl.length; i++) {
            const arr = Array.isArray(tl[i].layers) ? tl[i].layers! : [];
            for (const lf of arr) {
                const id = lf.id || lf.__id || '';
                if (!id) continue;
                let rec = m.get(id);
                if (!rec) { rec = { frames: [], originalStart: i }; m.set(id, rec); }
                rec.frames.push(lf);
            }
        }
        return m;
    }, [init.timeline]);

    // base64 -> Uint8Array
    const b64ToU8 = React.useCallback((s: string) => {
        const b = atob(s); const len = b.length; const u8 = new Uint8Array(len); for (let i = 0; i < len; i++) u8[i] = b.charCodeAt(i); return u8;
    }, []);

    const offscreenRef = React.useRef<HTMLCanvasElement | null>(null);

    // 基于 alpha 通道生成轮廓（外轮廓 + 内洞边界）。简单边缘扫描：对每个非透明像素，如果相邻方向为空则添加一条边线段。
    const buildOutlinePath = React.useCallback((imgData: ImageData, ox: number, oy: number, threshold = 20): Path2D => {
        const { data, width: W, height: H } = imgData;
        const alphaAt = (x: number, y: number) => {
            if (x < 0 || y < 0 || x >= W || y >= H) return 0;
            return data[(y * W + x) * 4 + 3];
        };
        const path = new Path2D();
        // 扫描生成四类边：上、下、左、右；每类尝试合并连续段减少 moveTo/lineTo 数量
        // 上边
        for (let y = 0; y < H; y++) {
            let run = false; let sx = 0;
            for (let x = 0; x <= W; x++) {
                const inside = x < W && alphaAt(x, y) >= threshold;
                const neighbor = x < W && alphaAt(x, y - 1) >= threshold;
                const edge = inside && !neighbor;
                if (edge && !run) { run = true; sx = x; }
                if ((!edge || x === W) && run) { // 结束一段
                    path.moveTo(ox + sx, oy + y);
                    path.lineTo(ox + x, oy + y);
                    run = false;
                }
            }
        }
        // 下边
        for (let y = 0; y < H; y++) {
            let run = false; let sx = 0;
            for (let x = 0; x <= W; x++) {
                const inside = x < W && alphaAt(x, y) >= threshold;
                const neighbor = x < W && alphaAt(x, y + 1) >= threshold;
                const edge = inside && !neighbor;
                if (edge && !run) { run = true; sx = x; }
                if ((!edge || x === W) && run) {
                    path.moveTo(ox + sx, oy + y + 1);
                    path.lineTo(ox + x, oy + y + 1);
                    run = false;
                }
            }
        }
        // 左边
        for (let x = 0; x < W; x++) {
            let run = false; let sy = 0;
            for (let y = 0; y <= H; y++) {
                const inside = y < H && alphaAt(x, y) >= threshold;
                const neighbor = y < H && alphaAt(x - 1, y) >= threshold;
                const edge = inside && !neighbor;
                if (edge && !run) { run = true; sy = y; }
                if ((!edge || y === H) && run) {
                    path.moveTo(ox + x, oy + sy);
                    path.lineTo(ox + x, oy + y);
                    run = false;
                }
            }
        }
        // 右边
        for (let x = 0; x < W; x++) {
            let run = false; let sy = 0;
            for (let y = 0; y <= H; y++) {
                const inside = y < H && alphaAt(x, y) >= threshold;
                const neighbor = y < H && alphaAt(x + 1, y) >= threshold;
                const edge = inside && !neighbor;
                if (edge && !run) { run = true; sy = y; }
                if ((!edge || y === H) && run) {
                    path.moveTo(ox + x + 1, oy + sy);
                    path.lineTo(ox + x + 1, oy + y);
                    run = false;
                }
            }
        }
        return path;
    }, []);

    const draw = React.useCallback(() => {
        try {
            const canvas = canvasRef.current; if (!canvas) return;
            const ctx = canvas.getContext('2d'); if (!ctx) return;
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.clientWidth, h = canvas.clientHeight;
            if (canvas.width !== w * dpr) canvas.width = w * dpr;
            if (canvas.height !== h * dpr) canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            // background
            ctx.clearRect(0, 0, w, h);
            if (bg === 'checker') {
                const size = 32;
                for (let y = 0; y < h; y += size) {
                    for (let x = 0; x < w; x += size) {
                        ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#555' : '#666';
                        ctx.fillRect(x, y, size, size);
                    }
                }
            } else if (bg === 'light') {
                ctx.fillStyle = '#f5f5f5'; ctx.fillRect(0, 0, w, h);
            } else if (bg === 'transparent') {
                ctx.fillStyle = '#00000000'; ctx.fillRect(0, 0, w, h);
            } else {
                ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, w, h);
            }
            ctx.save();
            ctx.translate(w / 2 + cam.x, h / 2 + cam.y);
            if (zoom !== 1) ctx.scale(zoom, zoom);
            const rawFrame = init.timeline[idx] as any;
            // 组合 ALS: 若 alsOn 开启且存在 workingLayers，则动态组合；否则直接使用当前帧 layers
            let compositeLayers: any[] = [];
            if (rawFrame) {
                if (alsOn) {
                    const mainLayer = rawFrame.layers?.find((l: any) => (l as any).__main) || rawFrame.layers?.[0];
                    if (mainLayer) compositeLayers.push(mainLayer);
                    for (const meta of workingLayers) {
                        const rec = layerFrameStore.get(meta.id); if (!rec) continue;
                        const relIndex = idx - meta.order; // startFrame = order
                        if (relIndex < 0 || relIndex >= rec.frames.length) continue;
                        const baseFrame = rec.frames[relIndex];
                        compositeLayers.push({ ...baseFrame, __rel: meta.relLayer, __start: meta.order, __id: meta.id });
                    }
                    compositeLayers.sort((a, b) => {
                        const ra = (a as any).__main ? 0 : ((a as any).__rel || 0);
                        const rb = (b as any).__main ? 0 : ((b as any).__rel || 0);
                        if (ra !== rb) return ra - rb; return 0;
                    });
                } else {
                    // 仅主层
                    const mainLayer = rawFrame.layers?.find((l: any) => (l as any).__main) || rawFrame.layers?.[0];
                    if (mainLayer) compositeLayers.push(mainLayer);
                }
            }
            let frameLayersToDraw = alsOn ? compositeLayers : (compositeLayers.length ? compositeLayers : (rawFrame?.layers || []));
            // 兼容旧结构：时间轴帧没有 layers 属性时，将根帧视为主层
            if ((!frameLayersToDraw || frameLayersToDraw.length === 0) && rawFrame && !rawFrame.layers && rawFrame.rgba) {
                frameLayersToDraw = [{ ...rawFrame, __main: true }];
            }
            if (frameLayersToDraw.length) {
                const buf = offscreenRef.current || (offscreenRef.current = document.createElement('canvas'));
                const bctx = buf.getContext('2d')!;
                for (const L of frameLayersToDraw) {
                    const raw = b64ToU8(L.rgba);
                    const imgData = new ImageData(new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength), L.w, L.h);
                    // 线性减淡 (Linear Dodge) 合成：旧实现通过最大通道推导透明度后提升 RGB
                    // 原逻辑参考旧版 webviewHtml.ts: gfx === 'LINEARDODGE'
                    if (L.gfx === 'LINEARDODGE') {
                        try {
                            const d = imgData.data;
                            for (let i = 0; i < d.length; i += 4) {
                                const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
                                const max = Math.max(r, g, b);
                                const sub = 255 - max; // 剩余空间
                                const na = Math.min(a, max); // 透明度受亮度限制，避免过亮溢出
                                d[i + 3] = na;
                                d[i] = Math.min(255, r + sub);
                                d[i + 1] = Math.min(255, g + sub);
                                d[i + 2] = Math.min(255, b + sub);
                            }
                        } catch {}
                    }
                    if (L.tint) {
                        const d = imgData.data; const tr = L.tint[0] / 255, tg = L.tint[1] / 255, tb = L.tint[2] / 255, ta = L.tint[3];
                        for (let i = 0; i < d.length; i += 4) {
                            d[i] = Math.min(255, Math.round(d[i] * tr));
                            d[i + 1] = Math.min(255, Math.round(d[i + 1] * tg));
                            d[i + 2] = Math.min(255, Math.round(d[i + 2] * tb));
                            if (!Number.isNaN(ta)) d[i + 3] = Math.min(255, Math.round(d[i + 3] * (ta / 255)));
                        }
                    }
                    if (buf.width !== L.w || buf.height !== L.h) { buf.width = L.w; buf.height = L.h; }
                    bctx.clearRect(0, 0, buf.width, buf.height);
                    bctx.putImageData(imgData, 0, 0);
                    ctx.save();
                    ctx.translate(L.dx, L.dy);
                    if (L.rot) ctx.rotate(L.rot * Math.PI / 180);
                    const sx = typeof L.sx === 'number' ? L.sx : 1; const sy = typeof L.sy === 'number' ? L.sy : 1; if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
                    ctx.drawImage(buf, L.ox | 0, L.oy | 0);
                    // 仅在主层绘制 SUPERARMOR 像素轮廓线
                    if (rawFrame?.superArmor && (L as any).__main) {
                        try {
                            if (!L.__outlinePath) {
                                L.__outlinePath = buildOutlinePath(imgData, (L.ox | 0), (L.oy | 0));
                            }
                            ctx.save();
                            const scaleX = typeof L.sx === 'number' && L.sx ? L.sx : 1;
                            const lw = Math.max(1, 2 / scaleX);
                            ctx.lineWidth = lw;
                            ctx.strokeStyle = '#ff0000';
                            ctx.lineJoin = 'round';
                            ctx.lineCap = 'round';
                            ctx.stroke(L.__outlinePath!);
                            ctx.restore();
                        } catch {}
                    }
                    ctx.restore();
                }
            }
            // overlays
            const proj = (x: number, y: number, z: number) => { const k = 0.5; return { x: x + k * y, y: -z + k * y }; };
            const drawAxes = () => {
                const axisLen = 200;
                ctx.save(); ctx.lineWidth = 1;
                ctx.strokeStyle = '#ff4d4f'; ctx.beginPath(); let p0 = proj(0, 0, 0); let p1 = proj(axisLen, 0, 0); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
                ctx.strokeStyle = '#52c41a'; ctx.beginPath(); p0 = proj(0, 0, 0); p1 = proj(0, axisLen, 0); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
                ctx.strokeStyle = '#1677ff'; ctx.beginPath(); p0 = proj(0, 0, 0); p1 = proj(0, 0, axisLen); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
                ctx.restore();
            };
            const drawBox = (box: Box3D, color: string) => {
                const { x, y, z, w, h, d } = box;
                const c = [
                    proj(x, y, z), proj(x + w, y, z), proj(x + w, y + h, z), proj(x, y + h, z),
                    proj(x, y, z + d), proj(x + w, y, z + d), proj(x + w, y + h, z + d), proj(x, y + h, z + d)
                ];
                ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y); for (const i of [1, 2, 3, 0]) ctx.lineTo(c[i].x, c[i].y); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(c[4].x, c[4].y); for (const i of [5, 6, 7, 4]) ctx.lineTo(c[i].x, c[i].y); ctx.stroke();
                ctx.beginPath(); for (const i of [0, 1, 2, 3]) { ctx.moveTo(c[i].x, c[i].y); ctx.lineTo(c[i + 4].x, c[i + 4].y); } ctx.stroke();
                ctx.restore();
            };
            if (axes) drawAxes();
            if (atk && rawFrame?.atk) for (const b of rawFrame.atk) drawBox(b, '#fadb14');
            if (dmg && rawFrame?.dmg) for (const b of rawFrame.dmg) drawBox(b, '#13c2c2');
            ctx.restore();
        } catch (e) {
            console.error('[aniPreview draw error]', e);
        }
    }, [idx, bg, zoom, axes, atk, dmg, alsOn, init.timeline, cam.x, cam.y, b64ToU8, workingLayers]);

    React.useEffect(() => { draw(); });
    React.useEffect(() => { const r = () => draw(); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, [draw]);

    // （上方已重新注册 draw 与 resize effect）

    React.useEffect(() => {
        if (!playing) { return; }
        const step = (now: number) => {
            const frame = init.timeline[idx];
            const delay = (frame.delay || 40) / speed;
            const dt = now - lastTick.current; lastTick.current = now; acc.current += dt;
            if (acc.current >= delay) { acc.current = 0; setIdx(i => (i + 1) % init.timeline.length); }
            rafRef.current = requestAnimationFrame(step);
        };
        lastTick.current = performance.now();
        rafRef.current = requestAnimationFrame(step);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [playing, speed, idx, init.timeline.length]);

    // 同步来自扩展的消息 (gotoFrame)
    React.useEffect(() => {
        const handler = (e: MessageEvent) => { const m = e.data; if (!m) return; if (!syncEnabled) return; if (m.type === 'gotoFrame' && typeof m.idx === 'number') { setIdx(Math.max(0, Math.min(init.timeline.length - 1, m.idx))); } };
        window.addEventListener('message', handler); return () => window.removeEventListener('message', handler);
    }, [init.timeline.length, syncEnabled]);

    // 持久化状态通知扩展
    React.useEffect(() => { vscode?.postMessage({ type: 'persistState', state: { axes, atk, dmg, als: alsOn, sync: syncEnabled, bg, speed, zoom } }); }, [axes, atk, dmg, alsOn, syncEnabled, bg, speed, zoom]);

    // 帧变更通知扩展 (节流)
    React.useEffect(() => {
        if (!syncEnabled) return;
        const now = Date.now();
        if (now - lastFrameNotifyRef.current > 80 || idx === 0) {
            lastFrameNotifyRef.current = now;
            vscode?.postMessage({ type: 'frameChange', idx });
        }
    }, [idx, syncEnabled]);

    const gotoPrev = () => setIdx(i => (i - 1 + init.timeline.length) % init.timeline.length);
    const gotoNext = () => setIdx(i => (i + 1) % init.timeline.length);

    // 画布交互：拖动平移与 Ctrl+滚轮缩放
    React.useEffect(() => {
        const canvas = canvasRef.current; if (!canvas) return;
        let dragging = false; let lastX = 0, lastY = 0;
        const onDown = (e: MouseEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.style.cursor = 'grabbing'; };
        const onMove = (e: MouseEvent) => { if (!dragging) return; const dx = e.clientX - lastX; const dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; setCam(c => ({ x: c.x + dx, y: c.y + dy })); };
        const onUp = () => { dragging = false; canvas.style.cursor = 'default'; };
        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return; // 仅 Ctrl+滚轮触发缩放
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            setZoom(z => { const nz = Math.min(4, Math.max(0.25, parseFloat((z + delta).toFixed(4)))); return nz; });
        };
        canvas.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            canvas.removeEventListener('mousedown', onDown);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            canvas.removeEventListener('wheel', onWheel);
        };
    }, []);

    const styles = useStyles();
    const fluentTheme = React.useMemo(() => getAppTheme(resolveModeFromBg(bg)), [bg]);
    const [panelOpen, setPanelOpen] = React.useState(false);
    const resetView = () => { setCam({ x: 0, y: 0 }); setZoom(1); };
    const frameInfo = `${idx + 1}/${init.timeline.length}`;
    // === ALS 编辑操作 ===
    const mutateLayer = (id: string, mut: (m: LayerMeta) => void) => {
        // 之前实现里 mut({ ...l }) 后又返回 { ...l }，导致修改未写回；这里改为真正返回被修改的副本
        setWorkingLayers(ws => ws.map(l => {
            if (l.id !== id) return l;
            const clone = { ...l };
            mut(clone);
            return clone;
        }));
    };
    const incDepth = () => { if (!selectedLayerId) return; mutateLayer(selectedLayerId, m => { m.relLayer += 1; }); };
    const decDepth = () => { if (!selectedLayerId) return; mutateLayer(selectedLayerId, m => { m.relLayer -= 1; }); };
    const incStart = () => { if (!selectedLayerId) return; mutateLayer(selectedLayerId, m => { m.order += 1; }); };
    const decStart = () => { if (!selectedLayerId) return; mutateLayer(selectedLayerId, m => { m.order -= 1; }); };
    const saveAls = () => {
        if (!vscode) return;
        const seq = workingLayers; // 保持当前顺序
        vscode.postMessage({ type: 'saveAls', adds: seq.map(l => ({ id: l.id, start: l.order, depth: l.relLayer, relLayer: l.relLayer, order: l.order, kind: l.kind })), uses: init.uses });
    };
    const [alsPanelOpen, setAlsPanelOpen] = React.useState(false);
    const ui = (
    <FluentProvider theme={fluentTheme} className={styles.root}>
            <div className={styles.topPanelShell}>
                <Collapse orientation='vertical' animateOpacity={true} visible={panelOpen}>
                    <div className={styles.topPanelInner} style={{ transformOrigin: 'top' }}>
                        <div className={styles.panelGroups}>
                            <MessageBar shape="rounded">
                                <MessageBarBody>
                                    <MessageBarTitle>提示</MessageBarTitle>
                                    拖动: 左键 | 缩放: Ctrl+滚轮 | 重置: 按钮/双击画布
                                </MessageBarBody>
                            </MessageBar>

                            <div className={styles.section} style={{ width: '100%' }}>
                                <Button size='small' appearance='primary' onClick={() => setPanelOpen(false)}>收起</Button>
                            </div>
                            <div className={styles.section} style={{ width: '100%' }}>
                                <div className={styles.sectionHeader}>速度</div>
                                <div className={styles.inlineRow}><span className={styles.labelSmall}>{speed.toFixed(2)}x</span><Slider min={0.25} max={4} step={0.05} value={speed} onChange={(_, d) => setSpeed(d.value)} style={{ flex: 1, minWidth: 160 }} /></div>
                            </div>
                            <div className={styles.section} style={{ width: '100%' }}>
                                <div className={styles.sectionHeader}>视图</div>
                                <div className={styles.inlineRow}><span className={styles.labelSmall}>{Math.round(zoom * 100)}%</span><Slider min={0.25} max={4} step={0.05} value={zoom} onChange={(_, d) => setZoom(d.value)} style={{ flex: 1, minWidth: 160 }} /></div>
                                <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }} title='拖动: 左键 | 缩放: Ctrl+滚轮 | 重置: 按钮/双击画布'>
                                    <Select size='small' value={bg} onChange={(e, data) => { if (data.value) setBg(data.value); }} style={{ minWidth: 140 }}>
                                        <option value='dark'>深色背景</option>
                                        <option value='light'>浅色背景</option>
                                        <option value='checker'>棋盘格</option>
                                        <option value='transparent'>透明</option>
                                    </Select>
                                    <Button size='small' appearance='secondary' onClick={resetView}>重置视图</Button>
                                </div>
                            </div>
                            <div className={styles.section} style={{ width: '100%' }}>
                                <div className={styles.sectionHeader}>视图</div>
                                <div className={styles.inlineRow} style={{ rowGap: 4 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}><Switch checked={axes} onChange={(_, d) => setAxes(!!d.checked)} />坐标系</label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}><Switch checked={atk} onChange={(_, d) => setAtk(!!d.checked)} />攻击框</label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}><Switch checked={dmg} onChange={(_, d) => setDmg(!!d.checked)} />受击框</label>
                                </div>
                            </div>
                            <div className={styles.section} style={{ width: '100%' }}>
                                <div className={styles.sectionHeader}>同步</div>
                                <div className={styles.inlineRow}><label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }} title='与文本编辑器中ani的帧/光标同步'><Switch checked={syncEnabled} onChange={(_, d) => { const v = !!d.checked; setSyncEnabled(v); vscode?.postMessage({ type: 'syncToggle', enabled: v }); }} />与文档编辑器光标同步</label></div>
                            </div>
                        </div>
                    </div>
                </Collapse>
                {/* ALS 独立面板 */}
                <Collapse orientation='vertical' animateOpacity={true} visible={alsPanelOpen}>
                    <div className={styles.topPanelInner} style={{ transformOrigin: 'top', marginTop: panelOpen ? 6 : 0 }}>
                        <div className={styles.panelGroups}>
                            <div className={styles.section} style={{ width: '100%' }}>
                                <div className={styles.sectionHeader}>ALS 图层 <div style={{ display: 'flex', gap: 6 }}><Switch checked={alsOn} onChange={(_, d) => setAlsOn(!!d.checked)} /> <Button size='small' appearance='primary' onClick={() => setAlsPanelOpen(false)}>收起</Button></div></div>
                                {!alsOn && <div style={{ fontSize: 12, opacity: .6 }}>开启 ALS 开关后可编辑附加图层。</div>}
                                {alsOn && (
                                    <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6, gap: 6 }}>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                            <Button size='small' onClick={incStart}>起始帧+1</Button>
                                            <Button size='small' onClick={decStart}>起始帧-1</Button>
                                            <Button size='small' onClick={incDepth}>图层+1</Button>
                                            <Button size='small' onClick={decDepth}>图层-1</Button>
                                            <Button size='small' appearance='primary' onClick={saveAls}>保存ALS</Button>
                                        </div>
                                        <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--vscode-panel-border)', padding: 4, borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            {workingLayers.map(l => {
                                                const active = l.id === selectedLayerId;
                                                return <div key={l.id} onClick={() => setSelectedLayerId(p => p === l.id ? null : l.id)} style={{ cursor: 'pointer', padding: '4px 6px', borderRadius: 4, background: active ? UI_COLORS.layerActiveBg : UI_COLORS.layerInactiveBg, display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                                                    <span style={{ fontWeight: 600, marginRight: 8 }}>{l.id}</span>
                                                    <span style={{ opacity: .8 }}>start={l.order} depth={l.relLayer}{l.kind ? (' ' + l.kind) : ''}</span>
                                                </div>;
                                            })}
                                            {!workingLayers.length && <div style={{ fontSize: 12, opacity: .6 }}>无 ALS 图层</div>}
                                        </div>
                                        <div style={{ fontSize: 11, opacity: .6, lineHeight: 1.4 }}>
                                            提示: 选择图层后使用按钮进行变更图层以及该图层相对于主ani的起始帧。保存会写回 .ani.als，你需要手动保存。
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </Collapse>
            </div>
            {/* 主视图 */}
            {!panelOpen && <div className={styles.miniBar}>
                <div className={styles.miniBarContent}>
                    <Button appearance='primary' onClick={() => setPanelOpen(true)}>展开控制</Button>
                    <Button appearance={playing ? 'primary' : 'secondary'} onClick={() => setPlaying(p => !p)}>{playing ? '暂停' : '播放'}</Button>
                    <Button onClick={gotoPrev}>上帧</Button>
                    <Button onClick={gotoNext}>下帧</Button>
                    {!alsPanelOpen && <Button onClick={() => setAlsPanelOpen(true)}>ALS</Button>}

                    <span>帧 {frameInfo}</span>
                </div>
            </div>}
            {/* {!alsPanelOpen && <div style={{ position: 'absolute', top: 4, right: 8, zIndex: 20 }}><Button size='small' onClick={() => setAlsPanelOpen(true)}>展开 ALS</Button></div>} */}
            <div className={styles.canvasWrap}>
                <canvas ref={canvasRef} className={styles.canvas} onDoubleClick={resetView} />
            </div>
        </FluentProvider>
    );
    return { ui };
};

const App: React.FC = () => {
    const { ui } = useAniLogic();
    return ui;
};

function main() {
    const rootEl = document.getElementById('root'); if (!rootEl) { return; }
    // 全局错误捕获，避免静默白屏
    window.addEventListener('error', (e) => { console.error('GlobalError', e.error || e.message); });
    window.addEventListener('unhandledrejection', (e: any) => { console.error('UnhandledRejection', e.reason); });
    createRoot(rootEl).render(<App />);
}

main();
