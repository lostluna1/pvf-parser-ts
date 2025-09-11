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

import getPvfContent from "../../pvf/services/getPvfContent";
import { PvfModel } from "../../pvf/model";
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

    var a = await getPvfContent("character/character.lst");
    console.log(a);
	return result;
}

// 未来: 可添加解析技能段、动作映射等；当前仅实现 minimum info。