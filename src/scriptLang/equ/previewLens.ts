import * as vscode from 'vscode';
import * as path from 'path';
import * as iconv from 'iconv-lite'; // still used elsewhere if needed (kept)
import { PvfModel } from '../../pvf/model';

interface EquInfo {
    name?: string;
    altName?: string; // name2
    grade?: number;   // [grade]
    rarity?: number;  // [rarity]
    rarityDesc?: string; // 映射成中文描述
    minLevel?: number; // [minimum level]
    description?: string; // [basic explain]
    detailDescription?: string; // [detail explain]
    flavor?: string; // [flavor text]
    equipType?: string;   // [equipment type]
    itemGroupName?: string; // [item group name]
    usableJobs?: string[];  // [usable job] 块
    attachType?: string;    // [attach type]
    weight?: number;        // [weight] 原始数值 (g?)
    physicalAttack?: number; // 力量加成 (加 STR)
    magicalAttack?: number;  // 智力加成 (加 INT)
    physicalDefense?: number; // 体力
    magicalDefense?: number;  // 精神
    jumpPower?: number; // 跳跃力

    hitRecovery?: number; // 硬直
    rigidity?: number; // 僵直
    roomListMoveSpeedRate?: number; // 城镇移动速度
    stuckResistance?: number; // 回避率
    HP_MAX?: number; // 生命上限 HP MAX
    MP_MAX?: number; // 魔法上限 MP MAX
    allElementalResistance?: number; // 所有属性抗性 all elemental resistance
    HP_regen_speed?: number; // HP 回复速度 HP regen speed
    MP_regen_speed?: number; // MP 回复速度 MP regen speed
    allElementalAttack?: number; // 所有属性强化 all elemental attack
    equipmentMagicalDefense?: number; // 魔法防御力
    equipmentPhysicalDefense?: number; // 物理防御力

    inventoryLimit?: number; // 负重上限，显示值除以1000
    slowResistance?: number; // 减速抗性 slow resistance
    freezeResistance?: number; // 冰冻抗性 freeze resistance
    poisonResistance?: number; // 中毒抗性 poison resistance
    stunResistance?: number; // 眩晕抗性 stun resistance
    curseResistance?: number; // 诅咒抗性 curse resistance
    blindResistance?: number; // 失明抗性 blind resistance
    lightningResistance?: number; // 感电抗性 lightning resistance
    stoneResistance?: number; // 石化抗性 stone resistance
    sleepResistance?: number; // 睡眠抗性 sleep resistance
    bleedingResistance?: number; // 出血抗性 bleeding resistance
    confuseResistance?: number; // 混乱抗性 confuse resistance
    holdResistance?: number; // 束缚抗性 hold resistance
    burnResistance?: number; // 灼烧抗性 burn resistance
    weaponBreakResistance?: number; // 武器破坏抗性 weapon break resistance
    armorBreakResistance?: number; // 防具破坏抗性 armor break resistance
    deelementResistance?: number; // 元素剥离抗性(未使用) deelement resistance
    deadlystrikeResistance?: number; // 致命打击抗性(未使用) deadlystrike resistance
    allActivestatusResistance?: number; // 全状态异常抗性 all activestatus resistance
    piercingResistance?: number; // 贯通/穿刺抗性 piercing resistance
  /*   {
            "name": "slow resistance",
            "description": "减速抗性"
        },
        {
            "name": "freeze resistance",
            "description": "冰冻抗性"
        },
        {
            "name": "poison resistance",
            "description": "中毒抗性"
        },
        {
            "name": "stun resistance",
            "description": "眩晕抗性"
        },
        {
            "name": "curse resistance",
            "description": "诅咒抗性"
        },
        {
            "name": "blind resistance",
            "description": "失明抗性"
        },
        {
            "name": "lightning resistance",
            "description": "感电抗性"
        },
        {
            "name": "stone resistance",
            "description": "石化抗性"
        },
        {
            "name": "sleep resistance",
            "description": "睡眠抗性"
        },
        {
            "name": "bleeding resistance",
            "description": "出血抗性"
        },
        {
            "name": "confuse resistance",
            "description": "混乱抗性"
        },
        {
            "name": "hold resistance",
            "description": "束缚抗性"
        },
        {
            "name": "burn resistance",
            "description": "灼烧抗性"
        },
        {
            "name": "weapon break resistance",
            "description": "武器破坏抗性"
        },
        {
            "name": "armor break resistance",
            "description": "防具破坏抗性"
        },
        {
            "name": "deelement resistance",
            "description": "元素剥离抗性(未使用)"
        },
        {
            "name": "deadlystrike resistance",
            "description": "致命打击抗性(未使用)"
        },
        {
            "name": "all activestatus resistance",
            "description": "全状态异常抗性"
        },
        {
            "name": "piercing resistance",
            "description": "贯通/穿刺抗性"
        } */

    attackSpeed?: number;    // 攻击速度
    moveSpeed?: number;   // 移动速度
    castSpeed?: number;     // 施放速度
    stuck?: number;          // 命中率修正，负数才是增加命中率
    price?: number;          // 价格
    repairPrice?: number;   // 修理价格
    value?: number;         // 出售价格，显示值要除以 5
    equipmentPhysicalAttack?: number; // 装备物理攻击力
    equipmentMagicalAttack?: number;  // 装备魔法攻击力
    separateAttack?: number; // 独立攻击力加成
    physicalCriticalHit?: number; // 物理暴击
    magicalCriticalHit?: number;  // 魔法暴击
    durability?: number;    // 耐久度
    elementAttack?: number; // 属性强化 (火攻+ 等)
    iconRaw?: { img: string; frame: number } | null;
    iconDataUri?: string; // png data uri once loaded
    skillLevelUps?: { job: string; skillId: number; value: number }[]; // 技能等级加成
    elementalProperty?: string; // 属性攻击 (fire / ice / light / dark)
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

// 缓存：lst 文件 -> (skillId -> sklPath)
const lstCache = new Map<string, Map<number, string>>();
// 缓存：skl 文件 -> 技能中文名 (name 标签)
const sklNameCache = new Map<string, string>();

export function registerEquPreviewCodeLens(context: vscode.ExtensionContext, model?: PvfModel) {
    const provider: vscode.CodeLensProvider = {
        provideCodeLenses(doc) {
            if (!/\[equipment type\]/i.test(doc.getText())) return [];
            return [new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                title: '预览装备',
                command: 'pvf.showEquPreview',
                arguments: [doc]
            })];
        }
    };
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ pattern: '**/*' }, provider));
    context.subscriptions.push(vscode.commands.registerCommand('pvf.showEquPreview', async (doc: vscode.TextDocument) => {
        const info = parseEquContent(doc.getText());
        const panel = vscode.window.createWebviewPanel('equPreview', info.name || '装备预览', vscode.ViewColumn.Beside, { enableScripts: false });
        panel.webview.html = buildEquHtml(info);
        if (model) {
            // 异步解析技能名称后刷新
            try {
                const names = await resolveSkillNames(info, model);
                panel.webview.html = buildEquHtml(info, names);
            } catch { /* ignore */ }
        }
        if (info.iconRaw) {
            const icon = await tryLoadIconDataUri(context, info.iconRaw).catch(() => undefined);
            if (icon) {
                info.iconDataUri = icon;
                if (model) {
                    try {
                        const names = await resolveSkillNames(info, model);
                        panel.webview.html = buildEquHtml(info, names);
                    } catch { panel.webview.html = buildEquHtml(info); }
                } else panel.webview.html = buildEquHtml(info);
            }
        }
    }));
}

// 解析 EQU 文本为数据对象（单一数据源，不额外构造行数组）
function parseEquContent(text: string): EquInfo {
    const lines = text.split(/\r?\n/);
    const info: EquInfo = {};
    let currentTag: string | null = null;
    // ===== 块解析扩展：忽略所有块(存在闭合 [/tag])内部的属性标签，除白名单 =====
    const closingTags = new Set<string>();
    for (const rawLine of lines) {
        const mm = rawLine.trim().match(/^\[\/(.+?)\]$/);
        if (mm) closingTags.add(mm[1].toLowerCase());
    }
    const blockStack: string[] = [];
    const whitelistInside = new Set<string>(['usable job', 'skill levelup']); // 这些块内仍解析其自身内容
    const collect: Record<string, string[]> = {};
    const push = (tag: string, value: string) => { (collect[tag] ||= []).push(value); };
    for (let raw of lines) {
        raw = raw.trim();
        if (!raw) continue;
        const m = raw.match(/^\[(.+?)\]$/);
        if (m) {
            const tagName = m[1].toLowerCase();
            // 关闭块
            if (tagName.startsWith('/')) {
                const closeName = tagName.slice(1);
                // 弹出对应块
                if (blockStack.length && blockStack[blockStack.length - 1] === closeName) {
                    blockStack.pop();
                } else {
                    // 若栈不匹配，尝试向上寻找
                    const idx = blockStack.lastIndexOf(closeName);
                    if (idx !== -1) blockStack.splice(idx);
                }
                currentTag = null;
                continue;
            }
            // 进入块（存在对应闭合标签且非白名单 -> 仅标记，不解析内部属性）
            if (closingTags.has(tagName) && !whitelistInside.has(tagName)) {
                blockStack.push(tagName);
                currentTag = null;
                continue;
            }
            // 白名单块：自身作为 currentTag 采集其直接文本行
            currentTag = tagName;
            continue;
        }
        if (blockStack.length > 0) {
            // 在非白名单块内部不采集任何标签值
            if (!currentTag || !whitelistInside.has(currentTag)) continue;
        }
        if (currentTag) push(currentTag, raw);
    }
    const takeStr = (tag: string) => {
        const key = tag.toLowerCase();
        return collect[key]?.map(s => s.replace(/`/g, '').trim()).join('\n');
    };
    const takeNum = (tag: string): number | undefined => {
        const key = tag.toLowerCase();
        if (!collect[key]) return undefined;
        let max: number | undefined;
        for (const ln of collect[key]) {
            const nums = ln.match(/[-]?[0-9]+/g);
            if (!nums) continue;
            for (const n of nums) {
                const v = parseInt(n, 10);
                if (max === undefined || v > max) max = v;
            }
        }
        return max;
    };
    info.name = takeStr('name');
    info.altName = takeStr('name2');
    info.description = takeStr('basic explain');
    info.detailDescription = takeStr('detail explain');
    info.flavor = takeStr('flavor text');
    info.grade = takeNum('grade');
    info.rarity = takeNum('rarity');
    info.minLevel = takeNum('minimum level');
    info.weight = takeNum('weight');
    info.physicalAttack = takeNum('physical attack');
    info.magicalAttack = takeNum('magical attack');
    info.attackSpeed = takeNum('attack speed');
    info.castSpeed = takeNum('cast speed');
    info.stuck = takeNum('stuck');
    info.price = takeNum('price');
    info.repairPrice = takeNum('repair price');
    info.value = takeNum('value');
    info.equipmentPhysicalAttack = takeNum('equipment physical attack');
    info.equipmentMagicalAttack = takeNum('equipment magical attack');
    info.separateAttack = takeNum('separate attack');
    info.physicalCriticalHit = takeNum('physical critical hit');
    info.magicalCriticalHit = takeNum('magical critical hit');
    info.durability = takeNum('durability');
    info.physicalDefense = takeNum('physical defense');
    info.magicalDefense = takeNum('magical defense');
    info.moveSpeed = takeNum('move speed');
    info.jumpPower = takeNum('jump power');
    info.hitRecovery = takeNum('hit recovery');
    info.roomListMoveSpeedRate = takeNum('room list move speed rate');
    info.stuckResistance = takeNum('stuck resistance');
    info.HP_MAX = takeNum('HP MAX');
    info.MP_MAX = takeNum('MP MAX');
    info.allElementalResistance = takeNum('all elemental resistance');
    info.HP_regen_speed = takeNum('HP regen speed');
    info.MP_regen_speed = takeNum('MP regen speed');
    info.allElementalAttack = takeNum('all elemental attack');
    info.equipmentMagicalDefense = takeNum('equipment magical defense');
    info.equipmentPhysicalDefense = takeNum('equipment physical defense');
    info.elementAttack = takeNum('fire attack') || takeNum('ice attack') || takeNum('light attack') || takeNum('dark attack');
    info.inventoryLimit = takeNum('inventory limit');
    info.slowResistance = takeNum('slow resistance');
    info.freezeResistance = takeNum('freeze resistance');
    info.poisonResistance = takeNum('poison resistance');
    info.stunResistance = takeNum('stun resistance');
    info.curseResistance = takeNum('curse resistance');
    info.blindResistance = takeNum('blind resistance');
    info.lightningResistance = takeNum('lightning resistance');
    info.stoneResistance = takeNum('stone resistance');
    info.bleedingResistance = takeNum('bleeding resistance');
    info.confuseResistance = takeNum('confuse resistance');
    info.holdResistance = takeNum('hold resistance');
    info.sleepResistance = takeNum('sleep resistance');
    info.burnResistance = takeNum('burn resistance');
    info.weaponBreakResistance = takeNum('weapon break resistance');
    info.armorBreakResistance = takeNum('armor break resistance');
    info.deelementResistance = takeNum('deelement resistance');
    info.deadlystrikeResistance = takeNum('deadlystrike resistance');
    info.allActivestatusResistance = takeNum('all activestatus resistance');
    info.piercingResistance = takeNum('piercing resistance');
    const ep = takeStr('elemental property');
    if (ep) {
        if (/fire/i.test(ep)) info.elementalProperty = '火';
        else if (/ice|water/i.test(ep)) info.elementalProperty = '冰';
        else if (/light/i.test(ep)) info.elementalProperty = '光';
        else if (/dark/i.test(ep)) info.elementalProperty = '暗';
    }
    // 若未提供[elemental property]标签，但存在具体元素攻击数值，根据原始标签推断
    if (!info.elementalProperty) {
        if (collect['fire attack']) info.elementalProperty = '火';
        else if (collect['ice attack']) info.elementalProperty = '冰';
        else if (collect['light attack']) info.elementalProperty = '光';
        else if (collect['dark attack']) info.elementalProperty = '暗';
    }
    // usable job block
    if (collect['usable job']) {
        info.usableJobs = collect['usable job'].map(s => s.replace(/[`\[\]]/g, ''));
    }
    info.attachType = takeStr('attach type');
    info.itemGroupName = takeStr('item group name');
    if (collect['skill levelup']) {
        info.skillLevelUps = collect['skill levelup'].map(l => {
            // 优先用正则匹配 `?[job name with spaces]?` skillId value
            const m = l.match(/`?\[([^\]]+)\]`?\s+(\d+)\s+(\d+)/);
            if (m) {
                const job = m[1].trim();
                const skillId = parseInt(m[2], 10);
                const value = parseInt(m[3], 10);
                return { job, skillId, value };
            }
            // 回退旧拆分逻辑（可能丢失包含空格的职业名）
            const parts = l.split(/\s+/).filter(Boolean);
            const job = parts[0]?.replace(/[`\[\]]/g, '');
            const skillId = parseInt(parts[1] || '0', 10);
            const value = parseInt(parts[2] || '0', 10);
            return { job, skillId, value };
        });
    }
    // icon: `path` frame
    if (collect['icon'] && collect['icon'][0]) {
        const seg = collect['icon'][0].split(/\s+/);
        const img = seg[0].replace(/`/g, '');
        const frame = parseInt(seg[1] || '0', 10) || 0;
        info.iconRaw = { img, frame };
    }
    // rarityDesc & grade text 直接写死为 最上级
    info.rarityDesc = '最上级';
    return info;
}

function esc(s: any): string { return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }

function buildEquHtml(info: EquInfo, resolvedSkillNames?: string[]): string {
    const weightKg = info.weight != null ? (info.weight / 1000).toFixed(1).replace(/\.0$/, '') + 'kg' : '';
    // 技能加成：每行 一个  名称 + 'Lv+' + 数值
    const skillLines = (info.skillLevelUps && info.skillLevelUps.length)
        ? info.skillLevelUps.map((s, idx) => {
            const nm = resolvedSkillNames && resolvedSkillNames[idx];
            const nameShown = nm ? nm : (s.job + ' ' + s.skillId);
            return nameShown + 'Lv+' + s.value;
        }).join('\n') : '';
    // 处理描述/风味中的字面 "\n" -> 实际换行
    const rawDesc = (info.description || info.detailDescription || '');
    const descHtml = esc(rawDesc.replace(/\\n/g, '\n'));
    const rawFlavor = info.flavor || '';
    const flavorHtml = esc(rawFlavor.replace(/\\n/g, '\n'));
    const elemLine = info.elementalProperty && info.elementAttack ? `${info.elementalProperty} +${info.elementAttack}` : '';
    const rarityColor = rarityToColor(info.rarity);
    const rarityDescs = ['普通', '高级', '稀有', '神器', '史诗', '传说'];// 0 普通，1 高级，2 稀有，3 神器，4 史诗，5 传说
    info.rarityDesc = info.rarity != null && info.rarity >= 0 && info.rarity < rarityDescs.length ? rarityDescs[info.rarity] : '未知品质';
    console.log(info.rarityDesc, "rarity");
    // stuckRate为负数则代表增加命中率，正整数则代表减少命中率，转为带操作符的字符串
    let stuckRate = "";
    if (info.stuck != null) {
        if (info.stuck < 0) {
            stuckRate = String(-info.stuck);
        } else {
            stuckRate = '-' + info.stuck;
        }

    }
    // 单一模板，无循环拼接
    return `
<!DOCTYPE html>
<html lang="zh-cn">
<head>
	<meta charset="utf-8" />
    <style>
        body{background:#111;color:#ddd;font:10px/1.4 '宋体',SimSun,serif;padding:8px;}
		.name{font-size:14px;color:${rarityColor};font-weight:600;margin-bottom:4px;}
        .rarity-desc{font-size:10px; text-align:right; margin-top:-2px; margin-bottom:4px; color:${rarityColor};}
		.block{margin-top:6px;}
		.stats span{display:block;}
		.icon{float:left;width:28px;height:28px;border:1px solid #555;margin-right:8px;image-rendering:pixelated;background:#222;}
		hr{border:none;border-top:1px solid #333;margin:6px 0;}
		.desc{white-space:pre-wrap;color:#99c;}
		.flavor{white-space:pre-wrap;color:#888;margin-top:4px;}
        .meta{display:flex;justify-content:space-between;align-items:center;gap:12px;}
        .meta .price{text-align:right;min-width:60px;}
	</style>
</head>
<body>
    <div class="icon">${info.iconDataUri ? `<img src="${info.iconDataUri}" style="width:28px;height:28px" />` : ''}</div>
    <div class="name">${esc(info.name) || '未知装备'}</div>
	<hr />
    <div class="rarity-desc">${esc(info.rarityDesc || '')}</div>
    <div class="meta"><span class="weight">${weightKg}</span><span class="price">${info.value ? (info.value / 5 + '金币') : '价格未知'}</span></div>
    <div>${translateJobNames(info.usableJobs)}可以使用</div>
    <div class="meta"><span class="weight">${info.durability != null ? `<span>耐久度 ${info.durability}/${info.durability}</span>` : ''}</span><span class="price">${info.attachType}</span></div>
    <div class="meta"><span class="weight">Lv.${info.minLevel ?? ''}以上可以使用</span><span class="price">最上级</span></div>


  <div>${info.equipmentPhysicalAttack != null ? `<span>物理攻击力 +${info.equipmentPhysicalAttack}</span>` : ''}</div>
  <div>${info.equipmentMagicalAttack != null ? `<span>魔法攻击力 +${info.equipmentMagicalAttack}</span>` : ''}</div>
  <div>${info.equipmentPhysicalDefense != null ? `<span>物理防御力 +${info.equipmentPhysicalDefense}</span>` : ''}</div>
  <div>${info.equipmentMagicalDefense != null ? `<span>魔法防御力 +${info.equipmentMagicalDefense}</span>` : ''}</div>
  <div>${info.separateAttack != null ? `<span>独立攻击力 +${info.separateAttack}</span>` : ''}</div>
  <div>${info.physicalAttack != null ? `<span>力量 +${info.physicalAttack}</span>` : ''}</div>
  <div>${info.magicalAttack != null ? `<span>智力 +${info.magicalAttack}</span>` : ''}</div>
    <div>${info.physicalDefense != null ? `<span>体力 +${info.physicalDefense}</span>` : ''}</div>
    <div>${info.magicalDefense != null ? `<span>精神 +${info.magicalDefense}</span>` : ''}</div>

	<hr />
<div style="color: #3fa7ff;">
  <div>${info.physicalCriticalHit != null ? `<span>物理暴击 +${info.physicalCriticalHit}%</span>` : ''}</div>
  <div>${info.magicalCriticalHit != null ? `<span>魔法暴击 +${info.magicalCriticalHit}%</span>` : ''}</div>
  <div>${info.attackSpeed != null ? `<span>攻击速度 +${info.attackSpeed/10}%</span>` : ''}</div>
  <div>${info.castSpeed != null ? `<span>施放速度 +${info.castSpeed/10}%</span>` : ''}</div>
  <div>${info.moveSpeed != null ? `<span>移动速度 +${info.moveSpeed / 10}%</span>` : ''}</div>
    <div>${info.jumpPower != null ? `<span>跳跃力 +${info.jumpPower}</span>` : ''}</div>
    <div>${info.roomListMoveSpeedRate != null ? `<span>城镇移动速度 +${info.roomListMoveSpeedRate / 10}%</span>` : ''}</div>
    <div>${info.hitRecovery != null ? `<span>硬直 -${info.hitRecovery}</span>` : ''}</div>
    <div>${info.stuckResistance != null ? `<span>回避率 +${info.stuckResistance/10}%</span>` : ''}</div>
    <div>${info.HP_MAX != null ? `<span>生命上限 +${info.HP_MAX}(实际效果${info.HP_MAX*1.73})</span>` : ''}</div>
    <div>${info.MP_MAX != null ? `<span>魔法上限 +${info.MP_MAX}(实际效果${info.MP_MAX*1.73})</span>` : ''}</div>
    <div>${info.allElementalResistance != null ? `<span>所有属性抗性 +${info.allElementalResistance}</span>` : ''}</div>
    <div>${info.HP_regen_speed != null ? `<span>HP回复速度 +${info.HP_regen_speed*3}(实际效果${info.HP_regen_speed*11})</span>` : ''}</div>
    <div>${info.MP_regen_speed != null ? `<span>MP回复速度 +${info.MP_regen_speed*3}(实际效果${info.MP_regen_speed*11})</span>` : ''}</div>
    <div>${info.elementAttack != null ? `<span>${info.elementalProperty || ''}属性强化 +${info.elementAttack}</span>` : ''}</div>
    <div>${info.allElementalAttack != null ? `<span>所有属性强化 +${info.allElementalAttack}</span>` : ''}</div>
    <div>${info.inventoryLimit != null ? `<span>负重上限 +${(info.inventoryLimit / 1000).toFixed(1).replace(/\.0$/, '')}kg</span>` : ''}</div>
    <div>${info.slowResistance != null ? `<span>减速抗性 +${info.slowResistance}</span>` : ''}</div>
    <div>${info.freezeResistance != null ? `<span>冰冻抗性 +${info.freezeResistance}</span>` : ''}</div>
    <div>${info.poisonResistance != null ? `<span>中毒抗性 +${info.poisonResistance}</span>` : ''}</div>
    <div>${info.stunResistance != null ? `<span>眩晕抗性 +${info.stunResistance}</span>` : ''}</div>
    <div>${info.curseResistance != null ? `<span>诅咒抗性 +${info.curseResistance}</span>` : ''}</div>
    <div>${info.blindResistance != null ? `<span>失明抗性 +${info.blindResistance}</span>` : ''}</div>
    <div>${info.lightningResistance != null ? `<span>感电抗性 +${info.lightningResistance}</span>` : ''}</div>
    <div>${info.stoneResistance != null ? `<span>石化抗性 +${info.stoneResistance}</span>` : ''}</div>
    <div>${info.sleepResistance != null ? `<span>睡眠抗性 +${info.sleepResistance}</span>` : ''}</div>
    <div>${info.bleedingResistance != null ? `<span>出血抗性 +${info.bleedingResistance}</span>` : ''}</div>
    <div>${info.confuseResistance != null ? `<span>混乱抗性 +${info.confuseResistance}</span>` : ''}</div>
    <div>${info.holdResistance != null ? `<span>束缚抗性 +${info.holdResistance}</span>` : ''}</div>
    <div>${info.burnResistance != null ? `<span>灼烧抗性 +${info.burnResistance}</span>` : ''}</div>
    <div>${info.weaponBreakResistance != null ? `<span>武器破坏抗性 +${info.weaponBreakResistance}</span>` : ''}</div>
    <div>${info.armorBreakResistance != null ? `<span>防具破坏抗性 +${info.armorBreakResistance}</span>` : ''}</div>
    <div>${info.deelementResistance != null ? `<span>元素剥离抗性 +${info.deelementResistance}</span>` : ''}</div>
    <div>${info.deadlystrikeResistance != null ? `<span>致命打击抗性 +${info.deadlystrikeResistance}</span>` : ''}</div>
    <div>${info.allActivestatusResistance != null ? `<span>全状态异常抗性 +${info.allActivestatusResistance}</span>` : ''}</div>
    <div>${info.piercingResistance != null ? `<span>贯通/穿刺抗性 +${info.piercingResistance}</span>` : ''}</div>
  <div>${info.stuck != null ? `<span>命中率 ${stuckRate}%</span>` : ''}

</div>

    ${skillLines ? `<div class="block skill-ups" style="white-space:pre-line;color:#C586C0;">${esc(skillLines)}</div>` : ''}

	<hr />
    <div class="desc">${descHtml}</div> ${info.flavor ? `<hr class=\"mid-sep\" style=\"border:none;border-top:1px solid #333;margin:6px 0;\" /><div class=\"flavor\">${flavorHtml}</div>` : ''}

</body>
</html>
    `;
}

function rarityToColor(r?: number): string {
    switch (r) {
        case 0: return '#FFFFFF';
        case 1: return '#68D5ED';
        case 2: return '#B36BFF';
        case 3: return '#FF00F0';
        case 4: return '#FFB100';
        case 5: return '#FF6666';
        default: return '#c186ff';
    }
}

function translateJobNames(n :string[]|undefined) :string{
    if (!n) return '';
    return n.map(job => {
        switch (job) {
            case "swordman": return "鬼剑士";
            case "fighter": return "格斗家(女)";
            case "at fighter": return "格斗家(男)";
            case "demonic swordman": return "黑暗武士";
            case "creator mage": return "缔造者";
            case "gunner": return "神枪手(男)";
            case "at gunner": return "神枪手(女)";
            case "mage": return "魔法师(女)";
            case "at mage": return "魔法师(男)";
            case "priest": return "圣职者";
            case "all": return "所有职业";
            default: return job;
        }
    }).join('、');
}

// 解析skillLevelUps中的字段的思路
// skillLevelUps?: { job: string; skillId: number; value: number }[]; // 技能等级加成
// 先根据job字符串得到job的lst路径，然后根据skillId在对应的lst中查找技能skl文件的路径，然后读取skl文件的name字段作为技能名称


// ==== 新增：技能名称解析逻辑 ====
const jobLstMap: Record<string, string> = {
    'swordman': 'skill/swordmanskill.lst',
    'fighter': 'skill/fighterskill.lst',
    'at fighter': 'skill/atfighterskill.lst',
    'demonic swordman': 'skill/demonicswordman.lst',
    'creator mage': 'skill/creatormage.lst',
    'gunner': 'skill/gunnerskill.lst',
    'at gunner': 'skill/atgunnerskill.lst',
    'mage': 'skill/mageskill.lst',
    'at mage': 'skill/atmageskill.lst',
    'priest': 'skill/priestskill.lst'
};

async function resolveSkillNames(info: EquInfo, model: PvfModel): Promise<string[]> {
    if (!info.skillLevelUps || info.skillLevelUps.length === 0) return [];
    const out: string[] = [];
    for (const up of info.skillLevelUps) {
        const lstKey = jobLstMap[up.job?.toLowerCase() || ''];
        if (!lstKey) { out.push(up.job || ''); continue; }
        const sklPath = await findSklPathInLst(model, lstKey, up.skillId);
        if (!sklPath) { out.push(up.job || ''); continue; }
        const nm = await getSklName(model, sklPath);
        out.push(nm || up.job || '');
    }
    return out;
}

async function findSklPathInLst(model: PvfModel, lstKey: string, skillId: number): Promise<string | undefined> {
    let map = lstCache.get(lstKey);
    if (!map) {
        map = new Map<number, string>();
        try {
            // 通过 readFileBytes 获得已反编译后的 .lst 文本 (model 内部会识别脚本并解码)
            const buf = await model.readFileBytes(lstKey); // 含 BOM 的 UTF8 文本
            let text = Buffer.from(buf).toString('utf8');
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            const lines = text.split(/\r?\n/);
            for (const ln of lines) {
                const m = ln.match(/^(\d+)\s+`([^`]+)`/);
                if (m) {
                    const id = parseInt(m[1], 10);
                    const p = m[2].trim().toLowerCase();
                    if (!map.has(id)) map.set(id, p);
                }
            }
        } catch { /* ignore parse errors */ }
        lstCache.set(lstKey, map);
    }
    return map.get(skillId);
}

async function getSklName(model: PvfModel, sklPath: string): Promise<string | undefined> {
    const key = sklPath.toLowerCase();
    if (sklNameCache.has(key)) return sklNameCache.get(key);
    try {
    // 使用 readFileBytes 以触发脚本(.skl)反编译路径，得到 UTF8 文本（含 BOM）
    let buf = await model.readFileBytes(key);
    let txt = Buffer.from(buf).toString('utf8');
    if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
    const lines = txt.split(/\r?\n/);
        let current: string | null = null;
        for (let raw of lines) {
            raw = raw.trim();
            if (!raw) continue;
            const m = raw.match(/^\[(.+?)\]$/);
            if (m) { current = m[1].toLowerCase(); continue; }
            if (current === 'name') {
                const nm = raw.replace(/`/g, '').trim();
                sklNameCache.set(key, nm);
                return nm;
            }
        }
        // 若逐行未取到，尝试正则整体提取 [name] 或 [name2]
        let mName = txt.match(/\[name\][^`]*`([^`]+)`/i);
        if (!mName) mName = txt.match(/\[name2\][^`]*`([^`]+)`/i);
        if (mName) {
            const nm = mName[1].trim();
            sklNameCache.set(key, nm);
            return nm;
        }
    } catch { }
    // 最后回退：使用文件名（去扩展）
    const base = key.split('/').pop() || key;
    const fallback = base.replace(/\.skl$/,'');
    sklNameCache.set(key, fallback);
    return fallback;
}
