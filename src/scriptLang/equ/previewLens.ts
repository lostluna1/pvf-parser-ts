import * as vscode from 'vscode';
import * as path from 'path';

interface EquInfo {
    name?: string;
    altName?: string; // name2
    grade?: number;
    rarity?: number;
    rarityDesc?: string;
    minLevel?: number;
    description?: string; // basic explain
    equipType?: string;
    itemGroupName?: string;
    usableJobs?: string[];
    attachType?: string;
    weight?: number; // raw weight value
    stats: { key: string; label: string; val: number; display: string }[];
    iconRaw?: { img: string; frame: number } | null;
    iconDataUri?: string; // png data uri once loaded
}

interface DisplayLine { text: string; cls?: string }

const STAT_ORDER: [string, string][] = [
    ['hp max', 'HP'],
    ['mp max', 'MP'],
    ['physical attack', '物攻'],
    ['magical attack', '魔攻'],
    ['equipment physical attack', '物攻(装)'],
    ['equipment magical attack', '魔攻(装)'],
    ['magical defense', '魔防'],
    ['equipment magical defense', '魔防(装)'],
    ['move speed', '移速'],
    ['attack speed', '攻速'],
    ['cast speed', '施放'],
    ['fire attack', '火'],
    ['water attack', '水'],
    ['dark attack', '暗'],
    ['light attack', '光'],
    ['physical critical hit', '物暴'],
    ['magical critical hit', '魔暴'],
    ['mp regen speed', 'MP回'],
    ['anti evil', '抗魔'],
    ['repair price', '修理价'],
    ['value', '价值'],
    ['minimum level', '等级'],
    ['weight', '重量'],
    ['grade', '品级']
];

function parseEqu(text: string, docDir: string): EquInfo {
    const info: EquInfo = { stats: [], iconRaw: null } as EquInfo;
    const pick = (re: RegExp) => re.exec(text);
    const name = pick(/\[name\]\s*`([^`]*)`/i); if (name) info.name = name[1].trim();
    const name2 = pick(/\[name2\]\s*`([^`]*)`/i); if (name2) info.altName = name2[1].trim();
    const grade = pick(/\[grade\]\s*(\d+)/i); if (grade) info.grade = Number(grade[1]);
    const rarity = pick(/\[rarity\]\s*(\d+)/i); if (rarity) info.rarity = Number(rarity[1]);
    const minLevel = pick(/\[minimum level\]\s*(\d+)/i); if (minLevel) info.minLevel = Number(minLevel[1]);
    const basicExplain = pick(/\[basic explain\]\s*`([^`]*)`/i); if (basicExplain) info.description = basicExplain[1].trim();
    const equipType = pick(/\[equipment type\]\s*`([^`]*)`/i); if (equipType) info.equipType = equipType[1].replace(/^[\[]|[\]]$/g,'').trim();
    const itemGroup = pick(/\[item group name\]\s*`([^`]*)`/i); if (itemGroup) info.itemGroupName = itemGroup[1].trim();
    const attachType = pick(/\[attach type\]\s*`([^`]*)`/i); if (attachType) info.attachType = attachType[1].replace(/^[\[]|[\]]$/g,'');
    // usable job block
    const jobBlock = /\[usable job\]([\s\S]*?)\[\/usable job\]/i.exec(text);
    if (jobBlock) {
        const jobs: string[] = [];
        for (const line of jobBlock[1].split(/\r?\n/)) {
            const jm = /`([^`]+)`/.exec(line);
            if (jm) jobs.push(jm[1].replace(/^[\[]|[\]]$/g,'').trim().toLowerCase());
        }
        if (jobs.length) info.usableJobs = jobs;
    }
    const iconMatch = pick(/\[icon\]\s*`([^`]+)`\s*(\d+)?/i);
    // 稀有度描述
    const rarityDescMap = ['普通', '高级', '稀有', '神器', '史诗', '传说'];
    info.rarityDesc = typeof info.rarity === 'number' && info.rarity >= 0 && info.rarity < rarityDescMap.length
        ? rarityDescMap[info.rarity] : undefined;
    if (iconMatch) {
        const frame = iconMatch[2] ? parseInt(iconMatch[2], 10) : 0;
        info.iconRaw = { img: iconMatch[1], frame: Number.isFinite(frame) ? frame : 0 };
    }
    const lines = text.split(/\r?\n/);
    for (const ln of lines) {
        const tag = /^\s*\[([^\]]+)\]\s*(.*)$/i.exec(ln);
        if (!tag) continue;
        const kRaw = tag[1];
        const k = kRaw.toLowerCase();
        const def = STAT_ORDER.find(([kk]) => kk === k);
        if (!def) continue;
        // 抽取所有数字（多值取最大）
        const rawRest = tag[2].trim();
        if (!rawRest) continue;
        const allNums = rawRest.match(/[+\-]?\d+(?:\.\d+)?/g);
        if (!allNums || !allNums.length) continue;
        let maxIdx = 0;
        let maxVal = Number(allNums[0]);
        for (let i=1;i<allNums.length;i++) {
            const v = Number(allNums[i]);
            if (!Number.isNaN(v) && v > maxVal) { maxVal = v; maxIdx = i; }
        }
        if (Number.isNaN(maxVal)) continue;
        const valNum = maxVal;
        const displayNum = allNums[maxIdx];
    if (k === 'weight') info.weight = valNum;
        info.stats.push({ key: k, label: def[1], val: valNum, display: displayNum });
    }
    return info;
}
function renderHtml(doc: vscode.TextDocument, info: EquInfo): string {
    const colorPalette = ['#dadada', '#3fb950', '#4184d9', '#a371f7', '#f0883e', '#db524b'];
    const r = info.rarity ?? -1;
    const color = r >= 0 && r < colorPalette.length ? colorPalette[r] : '#ccc';
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let iconHtml = '';
    if (info.iconDataUri) {
        iconHtml = `<div class="icon"><img src="${info.iconDataUri}" width="28" height="28"/></div>`;
    } else if (info.iconRaw) {
        iconHtml = `<div class="icon"><div class="box">${esc(path.basename(info.iconRaw.img))}</div></div>`;
    }
    // Build text lines similar to tooltip (structured to avoid embedding html in data)
    const lines: DisplayLine[] = [];
    const add = (text: string, cls?: string) => { if (text) lines.push({ text, cls }); };
    const weight = typeof info.weight === 'number' ? (info.weight/1000).toFixed(1)+ 'kg' : '';
    if (weight) add(weight, 'weight');
    if (info.usableJobs) {
        const jobTxt = info.usableJobs.includes('all') ? '通用' : info.usableJobs.join(',');
        add('可用职业：  ' + jobTxt, 'jobs');
    }
    if (typeof info.minLevel === 'number') add(`Lv ${info.minLevel}以上可以使用`, 'need');
    if (info.attachType) {
        const tradeTxt = /trade/i.test(info.attachType) ? '不可交易' : info.attachType;
        add(tradeTxt, 'trade');
    }
    // Basic numeric stats
    const statPreferredOrder = ['equipment magical defense','magical defense','intelligence','spirit','strength','power','physical attack','magical attack','equipment physical attack','equipment magical attack','anti evil','physical critical hit','magical critical hit','mp regen speed'];
    // Map some alias (e.g. label translations) already set
    for (const orderKey of statPreferredOrder) {
        for (const s of info.stats) {
            if (s.key === orderKey) {
                const plus = s.display.match(/^[-+]?\d/) ? (s.display.startsWith('-')? s.display: '+'+s.display) : s.display;
                add(`${s.label} ${plus}`, 'stat');
            }
        }
    }
    // Remaining stats not already added
    const addedKeys = new Set(lines.map(l=>{
        const m=/^([^ +]+) /.exec(l.text); return m? m[1]:''; }));
    for (const s of info.stats) {
        if (statPreferredOrder.includes(s.key)) continue; // already considered
        const plus = s.display.match(/^[-+]?\d/) ? (s.display.startsWith('-')? s.display: '+'+s.display) : s.display;
        const keyId = s.label;
        if (!addedKeys.has(keyId)) add(`${s.label} ${plus}`, 'stat');
    }
    // Add value / repair price if present
    const valueStat = info.stats.find(s=> s.key === 'value');
    if (valueStat) add(`${valueStat.label} ${valueStat.display}`, 'value');
    const repairStat = info.stats.find(s=> s.key === 'repair price');
    if (repairStat) add(`${repairStat.label} ${repairStat.display}`, 'repair');
    // Description / effects lines
    const effectLines: string[] = [];
    if (info.description) effectLines.push(info.description);
    if (info.itemGroupName) effectLines.push('['+info.itemGroupName+']');
    if (typeof info.grade === 'number' && info.grade >= 70) effectLines.push('最上级');
    // Compose HTML
    const escHtml = (arr: DisplayLine[]) => arr.map(o=> `<div class="ln${o.cls? ' '+o.cls:''}">${esc(o.text)}</div>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
      body{font-family:'SimSun','宋体',var(--vscode-font-family);font-size:10px;max-width:400px;margin:0;background:transparent;color:var(--vscode-foreground);padding:4px 4px 8px 4px;line-height:1.3;}
      .head{display:flex;gap:6px;align-items:flex-start;margin-bottom:4px;}
      .icon,.icon img,.icon .box{width:28px;height:28px;}
      .icon img{image-rendering:pixelated;}
      .icon .box{border:1px solid #888;font-size:8px;display:flex;align-items:center;justify-content:center;background:#222;color:#999;}
      .title{font-size:10px;font-weight:bold;color:${color};}
      .rarity{color:${color};font-size:10px;text-align:right;}
      .alt{margin-top:2px;color:#8aa4b5;font-size:9px;}
      .metaCol{display:flex;flex-direction:column;flex:1 1 auto;}
      .split{height:1px;background:#444;margin:4px 0;}
      .ln{white-space:nowrap;}
      .need{color:#d14f42;}
      .trade{color:#d18642;}
      .stat{color:#cfd8e0;}
      .value{color:#9ec9ff;}
      .repair{color:#9ec9ff;}
      .effects{margin-top:4px;color:#9ec9ff;}
    </style></head><body>
      <div class="head">${iconHtml}<div class="metaCol">
        <div class="title">${esc(info.name || '(未命名 EQU)')}</div>
        ${info.altName? `<div class="alt">${esc(info.altName)}</div>`:''}
        <div class="rarity">${info.rarityDesc? esc(info.rarityDesc):''}</div>
      </div></div>
      ${escHtml(lines)}
      ${effectLines.length? '<div class="split"></div><div class="effects">'+ effectLines.map(e=> esc(e)).join('<br/>') +'</div>':''}
    </body></html>`;
}

async function tryLoadIconDataUri(extCtx: vscode.ExtensionContext, raw: { img: string; frame: number }): Promise<string | undefined> {
    try {
        // 归一化路径 与 metadata.ts 类似
        let s = raw.img.trim().replace(/`/g, '').replace(/\\/g, '/');
        if (!/^sprite\//i.test(s)) s = 'sprite/' + s;
        s = s.toLowerCase();
        const cfg = vscode.workspace.getConfiguration();
        const root = (cfg.get<string>('pvf.npkRoot') || '').trim();
        if (!root) return;
        const { loadAlbumForImage } = await import('../../commander/previewAni/npkResolver.js');
        const { getSpriteRgba } = await import('../../npk/imgReader.js');
        const album = await loadAlbumForImage(extCtx, root, s).catch(() => undefined);
        if (!album || !album.sprites || !album.sprites[raw.frame]) return;
        const rgba = getSpriteRgba(album as any, raw.frame);
        if (!rgba) return;
        const sp = album.sprites[raw.frame];
        // 复用 metadata 的 encodePng：动态 import 其内部导出的私有函数不方便，复制最小逻辑
        const pngBuf = await encodeSimplePng(rgba, sp.width, sp.height);
        return 'data:image/png;base64,' + pngBuf.toString('base64');
    } catch { return; }
}

async function encodeSimplePng(rgba: Uint8Array, w: number, h: number): Promise<Buffer> {
    const zlib = await import('zlib');
    const stride = w * 4;
    const raw = Buffer.alloc((stride + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (stride + 1)] = 0;
        const line = rgba.subarray(y * stride, y * stride + stride);
        line.forEach((v, i) => { raw[y * (stride + 1) + 1 + i] = v; });
    }
    function crc32(buf: Uint8Array): number { let crc = ~0; for (let i = 0; i < buf.length; i++) { crc ^= buf[i]; for (let j = 0; j < 8; j++) { const m = -(crc & 1); crc = (crc >>> 1) ^ (0xEDB88320 & m); } } return ~crc >>> 0; }
    function chunk(type: string, data: Uint8Array, out: number[]) { const len = data.length; out.push((len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255); const tb = Buffer.from(type, 'ascii'); const cdata = new Uint8Array(tb.length + data.length); cdata.set(tb, 0); cdata.set(data, tb.length); const c = crc32(cdata); for (const b of cdata) out.push(b); out.push((c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255); }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = ihdr[11] = ihdr[12] = 0; const idat = zlib.deflateSync(raw, { level: 9 });
    const out: number[] = []; out.push(137, 80, 78, 71, 13, 10, 26, 10); chunk('IHDR', ihdr, out); chunk('IDAT', idat, out); chunk('IEND', new Uint8Array(), out); return Buffer.from(out);
}

export function registerEquPreviewCodeLens(context: vscode.ExtensionContext) {
    const CMD = 'pvf.equ.preview';
    context.subscriptions.push(vscode.commands.registerCommand(CMD, async (uri: vscode.Uri) => {
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const info = parseEqu(doc.getText(), path.dirname(uri.fsPath));
            console.log(info)
            const panel = vscode.window.createWebviewPanel('equPreview', (info.name || path.basename(uri.fsPath)), vscode.ViewColumn.Beside, { enableScripts: false, retainContextWhenHidden: true });
            panel.webview.html = renderHtml(doc, info);
            if (info.iconRaw) {
                const data = await tryLoadIconDataUri(context, info.iconRaw);
                if (data) {
                    info.iconDataUri = data;
                    panel.webview.html = renderHtml(doc, info);
                }
            }
        } catch (e: any) {
            vscode.window.showErrorMessage('无法预览 EQU: ' + (e?.message || e));
        }
    }));

    class LensProvider implements vscode.CodeLensProvider {
        private _onDidChange = new vscode.EventEmitter<void>();
        onDidChangeCodeLenses = this._onDidChange.event;
        provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
            if (doc.languageId !== 'pvf-equ') return [];
            const first = doc.lineAt(0);
            // 解析一次获取名称/稀有度用于标签
            const info = parseEqu(doc.getText(), path.dirname(doc.uri.fsPath));
            const labelParts: string[] = [];
            if (info.name) labelParts.push(info.name);
            const title = `预览装备(${labelParts.join(' · ') || '...'} )`;
            return [new vscode.CodeLens(first.range, { title, command: CMD, arguments: [doc.uri] })];
        }
    }
    const provider = new LensProvider();
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'pvf-equ' }, provider));
}
