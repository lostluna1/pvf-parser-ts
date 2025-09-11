/* character.lst的内容
#PVF_File
0	`character/Swordman/Swordman.chr`
1	`character/Fighter/Fighter.chr`
2	`character/Gunner/Gunner.chr`
3	`character/Mage/Mage.chr`
4	`character/Priest/Priest.chr`
5	`character/Gunner/ATGunner.chr`
6	`character/Thief/Thief.chr`
7	`character/Fighter/ATFighter.chr`
8	`character/Mage/ATMage.chr`
9	`character/Swordman/DemonicSwordman.chr`
10	`character/Mage/CreatorMage.chr` */

// 通过消息桥向扩展请求 PVF 文件内容（方案B）
interface PvfContentResult { key: string; exists: boolean; isText: boolean; text?: string; bytes: Uint8Array; }
interface PendingRequest { resolve: (v: PvfContentResult) => void; reject: (e: any) => void; }
const pending = new Map<string, PendingRequest>();

// 只调用一次 acquireVsCodeApi，设置全局标志，后续模块仅复用
let vscodeApi: any = (window as any).vscodeApi;
if (!vscodeApi && typeof (window as any).acquireVsCodeApi === 'function' && !(window as any).__vscodeApiAcquired) {
	try {
		vscodeApi = (window as any).acquireVsCodeApi();
		(window as any).__vscodeApiAcquired = true;
		(window as any).vscodeApi = vscodeApi;
	} catch (e) {
		// 忽略（可能在特殊情况下已被其它脚本获取）
	}
}

function requestPvfContent(path: string): Promise<PvfContentResult> {
	const id = 'req_' + Math.random().toString(36).slice(2);
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		try {
			if (!vscodeApi) throw new Error('vscodeApi unavailable');
			vscodeApi.postMessage({ type: 'getPvfContent', id, path });
		} catch (e) { pending.delete(id); reject(e); }
		// 超时回退
		setTimeout(() => {
			if (pending.has(id)) { pending.get(id)!.reject(new Error('pvfContent timeout')); pending.delete(id); }
		}, 8000);
	});
}

// 安装一次全局消息监听
if (!(window as any).__pvfContentBridgeInstalled) {
	(window as any).__pvfContentBridgeInstalled = true;
	window.addEventListener('message', ev => {
		const msg = ev.data;
		if (!msg || typeof msg !== 'object') return;
		if (msg.type === 'pvfContent' && msg.id) {
			const p = pending.get(msg.id);
			if (p) {
				pending.delete(msg.id);
				if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.result as PvfContentResult);
			}
		}
	});
}
/* skilllist.lst的内容
#PVF_File
0	`skill/SwordmanSkill.lst`
1	`skill/FighterSkill.lst`
2	`skill/GunnerSkill.lst`
3	`skill/MageSkill.lst`
4	`skill/PriestSkill.lst`
5	`skill/ATGunnerSkill.lst`
6	`skill/ThiefSkill.lst`
7	`skill/ATFighterSkill.lst`
8	`skill/ATMageSkill.lst`
9	`skill/DemonicSwordman.lst`
10	`skill/CreatorMage.lst` */

/* *.aic 的 [minimum info] 结构示例：
[minimum info]
	<17::afro_name`暴力舞者`>
	0	1	0	0	70	0	0	10	0	0	0
	`no creature`	0	0	0 
或：
[minimum info]
	`暴力舞者`
	0	1	0	0	70	0	0	10	0	0	0
	`no creature`	0	0	0 

解析需求：
1. 找到 [minimum info] 段（首个出现即可）。
2. 第一行：角色名称，可能形如 <ID::标识`名字`> 或 直接 `名字`。
3. 第二行：一串数字属性，列1=职业ID(classId)，列2=转职(growType，从0开始)，列5=等级(level)。
4. 第三行：召唤生物/宠物等信息，形式 `creatureName` 后跟若干数值。
*/

// 预留缓存结构（后续可通过扩展消息填充）
const lstCache = new Map<string, Map<number, string>>(); // lst -> (skillId -> sklPath)
const sklNameCache = new Map<string, string>(); // skl -> 中文名
export const apcPropertyFileMap: [string, string][] = [["character/character.lst", "skill/skilllist.lst"]];

export interface AicMinimumInfo {
	variant: 'angle' | 'simple';
	rawNameLine: string;        // 原始第一行
	characterId?: number;       // angle 形式里 <17::...> 的数字
	characterName: string;      // 提取出的中文/文本名称
	classId?: number;           // 属性行第1列
	growType?: number;          // 属性行第2列
	level?: number;             // 属性行第5列（索引4）
	attributes: number[];       // 整行全部数字
	creatureName?: string;      // 第三行反引号中的名字
	creatureStats: number[];    // creature 行后续数字
	startLine: number;          // 段起始行号 (0-based)
}

export interface AicParseResult {
	minimumInfo?: AicMinimumInfo;
	errors: string[];
	warnings: string[];
	raw: string; // 原文（便于后续二次分析）
}

function extractBacktickName(s: string): string | undefined {
	const m = s.match(/`([^`]+)`/); return m ? m[1].trim() : undefined;
}

function parseNumberRow(line: string): number[] {
	return line.split(/\s+/).map(v => v.trim()).filter(v => v.length).map(v => Number(v)).filter(n => Number.isFinite(n));
}

function parseMinimumInfo(text: string): { info?: AicMinimumInfo; errors: string[]; warnings: string[] } {
	const lines = text.split(/\r?\n/);
	const errors: string[] = []; const warnings: string[] = [];
	const idx = lines.findIndex(l => /\[minimum info\]/i.test(l));
	if (idx < 0) return { errors: [], warnings: [] };
	const nameLine = lines[idx + 1] ?? '';
	const attrLine = lines[idx + 2] ?? '';
	const creatureLine = lines[idx + 3] ?? '';
	let variant: 'angle' | 'simple' = 'simple';
	let characterId: number | undefined; let characterName = '';
	if (/^\s*</.test(nameLine)) {
		variant = 'angle';
		const idMatch = nameLine.match(/<\s*(\d+)\s*::/);
		if (idMatch) characterId = Number(idMatch[1]);
		const nm = extractBacktickName(nameLine); if (nm) characterName = nm; else warnings.push('未在 angle 形式第一行提取到名称');
	} else {
		const nm = extractBacktickName(nameLine); if (nm) characterName = nm; else characterName = nameLine.trim();
	}
	const attributes = parseNumberRow(attrLine);
	if (!attributes.length) warnings.push('属性行未解析到数字');
	const classId = attributes[0];
	const growType = attributes[1];
	const level = attributes[4];
	let creatureName: string | undefined; let creatureStats: number[] = [];
	if (creatureLine) {
		creatureName = extractBacktickName(creatureLine) || undefined;
		const rest = creatureLine.replace(/`[^`]*`/, '');
		creatureStats = parseNumberRow(rest);
	}
	const info: AicMinimumInfo = {
		variant, rawNameLine: nameLine, characterId, characterName: characterName || '',
		classId, growType, level, attributes, creatureName, creatureStats, startLine: idx
	};
	return { info, errors, warnings };
}

export async function parseAic(text: string): Promise<AicParseResult> {
	const min = parseMinimumInfo(text);
	const result: AicParseResult = {
		minimumInfo: min.info,
		errors: min.errors,
		warnings: min.warnings,
		raw: text
    };

	try {
		const lst = await requestPvfContent('character/character.lst');
		console.log('character.lst', lst);
	} catch (e) {
		console.warn('获取 character/character.lst 失败', e);
	}
	return result;
}

// 未来: 可添加解析技能段、动作映射等；当前仅实现 minimum info。