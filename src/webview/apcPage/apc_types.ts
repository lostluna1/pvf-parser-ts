/**
 * apc装备信息
 */
export interface EquipmentInfo {
	id: number;
	name?: string;
	grade?: number; // 品级数字
	gradeName?: string; // 品级名称
	powerUpLevel?: number; // 强化等级
	iconBase64?: string;
}

/**
 * apc技能信息
 */
export interface SkillInfo {
	id: number;
	skillName?: string;
	iconBase64?: string;
	level: number;
}

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
    jobAllSkills?: SkillInfo[]; // 该职业的全部技能列表
    raw: string; // 原文（便于后续二次分析）
    growTypeName?: string; // 从 job 文件中解析出的当前转职名称
    allGrowTypeNames?: string[]; // 从 job 文件中解析出的所有转职名称列表
    skills?: SkillInfo[]; // skill 段解析出的技能列表
    quickSkills?: SkillInfo[]; // quick skill 段解析出的技能列表
    equipments?: EquipmentInfo[]; // equipment 段解析出的装备列表
    nodes?: any[]; // 解析出的全部脚本节点
}

const GradeName: Record<number, string> = {
	0: '最下级',
	1: '下级',
	2: '中级',
	3: '上级',
	4: '最上级'
};

export function getGradeName(grade: number): string {
    return GradeName[grade] || `未知品级(${grade})`;
}