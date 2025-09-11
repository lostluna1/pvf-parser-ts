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

// 不能直接在 webview 内 import 扩展侧的解析函数（无 model 环境），需要通过消息桥请求


// 通过消息桥向扩展请求 PVF 文件内容（方案B）
interface PvfContentResult { key: string; exists: boolean; isText: boolean; text?: string; bytes: Uint8Array; }
interface PendingRequest { resolve: (v: PvfContentResult) => void; reject: (e: any) => void; }
const pending = new Map<string, PendingRequest>();
interface PvfJsonPending { resolve: (v: any) => void; reject: (e: any) => void; }
const pendingJson = new Map<string, PvfJsonPending>();
interface IconPending { resolve:(v:any)=>void; reject:(e:any)=>void; }
const pendingIcon = new Map<string, IconPending>();

// 缓存当前活动 AIC 文档文本 & 路径（由扩展实时推送）
let currentDocText: string | undefined = (window as any).__INIT?.text;
let currentDocPath: string | undefined = (window as any).__INIT?.path;

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
function requestPvfJsonContent(path: string): Promise<any> {
	const id = 'req_json_' + Math.random().toString(36).slice(2);
	return new Promise((resolve, reject) => {
		pendingJson.set(id, { resolve, reject });
		try {
			if (!vscodeApi) throw new Error('vscodeApi unavailable');
			vscodeApi.postMessage({ type: 'getPvfJsonContent', id, path });
		} catch (e) { pendingJson.delete(id); reject(e); }
		setTimeout(() => {
			if (pendingJson.has(id)) { pendingJson.get(id)!.reject(new Error('pvfJsonContent timeout')); pendingJson.delete(id); }
		}, 10000);
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
		} else if (msg.type === 'pvfJsonContent' && msg.id) {
			const p = pendingJson.get(msg.id);
			if (p) {
				pendingJson.delete(msg.id);
				if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.result);
			}
		} else if (msg.type === 'iconFrame' && msg.id) {
			const p = pendingIcon.get(msg.id);
			if (p) {
				pendingIcon.delete(msg.id);
				if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.result);
			}
			} else if (msg.type === 'docUpdate') {
				if (typeof msg.text === 'string') currentDocText = msg.text;
				if (typeof msg.path === 'string') currentDocPath = msg.path;
			}
	});
}
function requestIconFrame(path:string, frameIndex:number):Promise<any>{
	const id='req_icon_'+Math.random().toString(36).slice(2);
	return new Promise((resolve,reject)=>{
		pendingIcon.set(id,{resolve,reject});
		try{ if(!vscodeApi) throw new Error('vscodeApi unavailable'); vscodeApi.postMessage({type:'getIconFrame', id, path, frameIndex}); }
		catch(e){ pendingIcon.delete(id); reject(e); }
		setTimeout(()=>{ if(pendingIcon.has(id)){ pendingIcon.get(id)!.reject(new Error('iconFrame timeout')); pendingIcon.delete(id);} },8000);
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

	raw: string; // 原文（便于后续二次分析）
	growTypeName?: string; // 从 job 文件中解析出的当前转职名称
	skills?: SkillInfo[]; // quick skill 段解析出的技能列表
	nodes?: any[]; // 解析出的全部脚本节点
}


export async function parseAic(text: string, filePathFromInit?: string): Promise<AicParseResult> { // 增加路径参数

	const result: AicParseResult = {
		nodes: [],
		raw: (currentDocText || text || '')
    };
	// 单行路径规范化：优先 currentDocPath，其次传入路径；去头部斜杠，反斜杠转正斜杠，合并重复，转小写
	const normPath = (currentDocPath ?? filePathFromInit)
		?.trim()
		.replace(/^[\\/]+/, '')      // 去掉前导斜杠
		.replace(/\\+/g, '/')        // 反斜杠 -> /
		.replace(/\/+/g, '/')         // 合并重复正斜杠
		.toLowerCase();
	try {
		if (normPath) {
			const currentJson = await requestPvfJsonContent(normPath);
			console.log('[APC] fetched JSON for', normPath, currentJson);
			result.nodes = currentJson?.nodes || [];
		} else {
			result.nodes = [];
		}
	} catch (e) {
		console.warn('[APC] 获取 JSON 失败 path=', normPath, e);
		result.nodes = [];
	}
	var chrIndex = result?.nodes?.[0]?.numbers?.[0] ?? 0;
	var growType = result?.nodes?.[0]?.numbers?.[1] ?? 0;
	try {
		// 1. 读取 character/character.lst (返回 lstEntries: {key,value})
		const chrListJson = await requestPvfJsonContent('character/character.lst');
		const chrEntry = chrListJson?.lstEntries?.find((e: any) => e.key === chrIndex);

		if (chrEntry?.value) {
			// 2. 读取对应职业 .chr 脚本，解析为节点数组
			const chrPath = chrEntry.value.toLowerCase();
			const jobJson = await requestPvfJsonContent(chrPath);
			// 3. 找到 tag == 'growtype name' 的节点
			const growNode = (jobJson?.nodes || []).find((n: any) => n.tag === 'growtype name');
			if (growNode?.valueLines?.length) {
				// valueLines 里每行形如 `名称`，根据 growType 取对应行（越界则忽略）
				const names = growNode.valueLines.map((l: string) => {
					const m = l.match(/`([^`]+)`/); return m ? m[1] : l.trim();
				});
				result.growTypeName = names[growType] || names[0] || '';
				console.log('[APC] growTypeName resolved:', result.growTypeName, 'growType=', growType, 'all=', names);
			} else {
				console.warn('[APC] growtype name node not found or empty in', chrPath);
			}

			var quickSkills = await getQuickSkills(result.nodes || []);
			result.skills = quickSkills;
			console.log('[APC] quickSkills=', result.skills);
		} else {
			console.warn('[APC] character.lst entry not found for classId', chrIndex);
		}
	} catch (e) {
		console.warn('获取 character/character.lst 失败', e);
	}
	return result;
}

// 从节点数组中提取 quick skill 段，返回技能列表
async function getQuickSkills(nodes: any[]): Promise<SkillInfo[]> {

	var skills = nodes.filter((n: { tag: string }) => n.tag === 'quick skill');
	skills = skills.length > 0 ? skills[0].children || [] : [];
	// 需要对skills两两分组,组成SkillInfo对象
	var skillArr: SkillInfo[] = [];
	for (let i = 0; i < skills.length; i += 2) {
		const skill: SkillInfo = {
			id: skills[i].raw,
			level: skills[i + 1]?.raw || 0
		};
		skillArr.push(skill);
	}
	var sklListPath = 'skill/skilllist.lst';
	var chrIndex = nodes?.[0]?.numbers?.[0] ?? 0;
	// 读取 skilllist.lst，找到对应技能名称
	var sklPaths = '';
	var sklListJson = await requestPvfJsonContent(sklListPath);
	sklPaths = sklListJson.lstEntries[chrIndex].value;
	const sklJson = await requestPvfJsonContent(sklPaths);
	for (let skill of skillArr) {
		const skillId = Number(skill.id);
		const sklPath = sklJson?.lstEntries?.find((e: any) => e.key === skillId)?.value;
		if (!sklPath) continue;
		const sklEntry = await requestPvfJsonContent(sklPath);
		const skillName = sklEntry?.nodes?.find((n: any) => n.tag === 'name')?.tokens?.[0] || '';
		const iconTokens = sklEntry?.nodes?.find((n: any) => n.tag === 'icon')?.tokens;
		const iconPath = iconTokens?.[0] || '';
		const iconIndex = Number(iconTokens?.[1] || 0);
		skill.skillName = skillName;
		if (iconPath) {
			try {
				const iconRes = await requestIconFrame(iconPath, iconIndex);
				if (iconRes?.ok && iconRes.base64) skill.iconBase64 = iconRes.base64;
			} catch (e) { /* 忽略单个图标错误 */ }
		}

	}
	console.log('skillArr', skillArr);
	return skillArr;
}

interface SkillInfo {
	id: number;
	skillName?: string;
	iconBase64?: string;
	level: number;
}
// 未来: 可添加解析技能段、动作映射等；当前仅实现 minimum info。