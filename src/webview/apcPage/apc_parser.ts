
import { AicParseResult, EquipmentInfo, getGradeName, SkillInfo } from "./apc_types";

// === RPC pending map & current doc state (restored) ===
interface RpcPending { resolve: (v: any) => void; reject: (e: any) => void; }
const pendingRpc = new Map<string, RpcPending>();
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

function rpcCall(method: string, ...params: any[]): Promise<any> {
	const id = 'rpc_' + Math.random().toString(36).slice(2);
	return new Promise((resolve, reject) => {
		pendingRpc.set(id, { resolve, reject });
		try { if (!vscodeApi) throw new Error('vscodeApi unavailable'); vscodeApi.postMessage({ type: 'rpc', id, method, params }); }
		catch (e) { pendingRpc.delete(id); reject(e); }
		setTimeout(() => { if (pendingRpc.has(id)) { pendingRpc.get(id)!.reject(new Error(method + ' timeout')); pendingRpc.delete(id); } }, 10000);
	});
}
const pvfApi = {
	getContent: (p: string) => rpcCall('getPvfContent', p),
	getJson: (p: string) => rpcCall('getPvfJson', p),
	getIconFrame: (p: string, i: number) => rpcCall('getIconFrame', p, i),
	// 注意：扩展侧函数签名是 (lstPath, code)，这里保持一致
	getNameByCodeAndLst: (lst: string, code: number) => rpcCall('getNameByCodeAndLst', lst, code),
	getIconBase64ByCode: (lst: string, code: number) => rpcCall('getIconBase64ByCode', lst, code),
};
// 安装一次全局消息监听
if (!(window as any).__pvfRpcInstalled) {
	(window as any).__pvfRpcInstalled = true;
	window.addEventListener('message', ev => {
		const msg = ev.data;
		if (!msg || typeof msg !== 'object') return;
		if (msg.type === 'rpcResult' && msg.id) {
			const p = pendingRpc.get(msg.id);
			if (p) { pendingRpc.delete(msg.id); msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error)); }
		} else if (msg.type === 'docUpdate') {
			if (typeof msg.text === 'string') currentDocText = msg.text;
			if (typeof msg.path === 'string') currentDocPath = msg.path;
		}
	});
}




export async function parseAic(text: string): Promise<AicParseResult> { // 增加路径参数

	const result: AicParseResult = {
		nodes: [],
		raw: (currentDocText || text || '')
	};

	const rawPath = currentDocPath;
	const normPath = rawPath ? rawPath.trim()
		.replace(/^[\\/]+/, '')
		.replace(/\\+/g, '/')
		.replace(/\/+/g, '/')
		.toLowerCase() : undefined;
	if (normPath) {
		const currentJson = await pvfApi.getJson(normPath);
		// console.log('[APC] fetched JSON for', normPath, currentJson);
		result.nodes = currentJson?.nodes || [];
	}
	var chrIndex = result?.nodes?.find(t => t.tag === 'minimum info')?.numbers?.[0] ?? 0;
	var growType = result?.nodes?.find(t => t.tag === 'minimum info')?.numbers?.[1] ?? 0;
	console.log(result?.nodes,"result?.nodes")
	// 1. 读取 character/character.lst (返回 lstEntries: {key,value})
	const chrListJson = await pvfApi.getJson('character/character.lst');
	const chrEntry = chrListJson?.lstEntries?.find((e: any) => e.key === chrIndex);

	if (chrEntry?.value) {
		// 2. 读取对应职业 .chr 脚本，解析为节点数组
		const chrPath = chrEntry.value.toLowerCase();
		const jobJson = await pvfApi.getJson(chrPath);
		console.log('[APC] jobJson', jobJson);
		// 3. 找到 tag == 'growtype name' 的节点
		const growNode = (jobJson?.nodes || []).find((n: any) => n.tag === 'growtype name');
		if (growNode?.valueLines?.length) {
			// valueLines 里每行形如 `名称`，根据 growType 取对应行（越界则忽略）
			const names = growNode.valueLines.map((l: string) => {
				const m = l.match(/`([^`]+)`/); return m ? m[1] : l.trim();
			});
			result.growTypeName = names[growType];
			// console.log('[APC] growTypeName resolved:', result.growTypeName, 'growType=', growType, 'all=', names);
			result.allGrowTypeNames = names;
		} else {
			console.warn('[APC] growtype name node not found or empty in', chrPath);
		}
		result.jobAllSkills = await getAllSkillsJob(result?.nodes || []);
		result.quickSkills = await getQuickSkills(result.nodes || [], result.jobAllSkills || []);
		result.skills = await getOwnedSkills(result.nodes || [], result.jobAllSkills || []);
		result.equipments = await getEquipmentInfo(result.nodes || []);
	} else {
		console.warn('[APC] character.lst entry not found for classId', chrIndex);
	}
	return result;
}

async function getAllSkillsJob(nodes: any[]): Promise<SkillInfo[]> {
	var sklListPath = 'skill/skilllist.lst';
	var skillInfos: SkillInfo[] = [];
	var chrIndex = nodes?.find(t => t.tag === 'minimum info')?.numbers?.[0] ?? 0;
	// 读取 skilllist.lst，找到对应技能名称
	var sklPaths = '';
	var sklListJson = await pvfApi.getJson(sklListPath);
	sklPaths = sklListJson.lstEntries[chrIndex].value;
	const sklJson = await pvfApi.getJson(sklPaths);
	// console.log('sklPaths', sklPaths);
	// console.log('sklJson', sklJson);
	skillInfos = [];
	for (const entry of sklJson?.lstEntries || []) {
		const sklPath = entry.value;
		const sklEntry = await pvfApi.getJson(sklPath);
		const skillName = sklEntry?.nodes?.find((n: any) => n.tag === 'name')?.tokens?.[0] || '';
		const iconTokens = sklEntry?.nodes?.find((n: any) => n.tag === 'icon')?.tokens;
		const iconPath = iconTokens?.[0] || '';
		const iconIndex = Number(iconTokens?.[1] || 0);
		let iconBase64: any = undefined;
		if (iconPath) {
			try {
				const iconRes = await pvfApi.getIconFrame(iconPath, iconIndex);
				if (iconRes?.ok) iconBase64 = iconRes.base64;
			} catch { }
		}
		skillInfos.push({
			id: entry.key,
			skillName: skillName.replace(/`+/g, '').trim(),
			iconBase64,
			level: 0
		});
	}

	return skillInfos;
}

// 从节点数组中提取 quick skill 段，返回技能列表（复用已获取的 allSkills）
async function getQuickSkills(nodes: any[], allSkills: SkillInfo[]): Promise<SkillInfo[]> {
	const quickSkillNode = nodes.find((n: any) => n.tag === 'quick skill');
	const children = quickSkillNode ? (quickSkillNode.children || []) : [];
	const result: SkillInfo[] = [];
	for (let i = 0; i < children.length; i += 2) {
		const idNum = Number(children[i]?.raw);
		const lvl = children[i + 1]?.raw || 0;
		const base = allSkills.find(s => s.id === idNum);
		result.push({
			id: idNum,
			level: lvl,
			skillName: base?.skillName,
			iconBase64: base?.iconBase64
		});
	}
	return result;
}

async function getOwnedSkills(nodes: any[], allSkills: SkillInfo[]): Promise<SkillInfo[]> {

	const skillNode = nodes.find((n: any) => n.tag === 'skill');
	const children = skillNode ? (skillNode.children || []) : [];
	const result: SkillInfo[] = [];
	for (let i = 0; i < children.length; i += 2) {
		const idNum = Number(children[i]?.raw);
		const lvl = children[i + 1]?.raw || 0;
		const base = allSkills.find(s => s.id === idNum);
		result.push({
			id: idNum,
			level: lvl,
			skillName: base?.skillName,
			iconBase64: base?.iconBase64
		});
	}
	return result.filter(s => !!s.skillName); // 仅保留能找到名称的
}

async function getEquipmentInfo(nodes: any[]): Promise<EquipmentInfo[]> {
	const equipmentNode = nodes.find((n: any) => n.tag === 'equipment');
	const _t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
	const equListJson = await pvfApi.getJson('equipment/equipment.lst');
	const _t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
	try { console.log('[APC] equipment/equipment.lst 加载耗时', (_t1 - _t0).toFixed(1) + 'ms'); } catch {}
	console.log('[APC] equipment.lst', equListJson);
	if (!equipmentNode) return [];
	try {
		const numbers: number[] = equipmentNode.numbers || [];
		const equipments: EquipmentInfo[] = [];
		for (let i = 0; i < numbers.length; i += 3) {
			const id = numbers[i] ?? 0;
			const grade = numbers[i + 1] ?? 0;
			const powerUpLevel = numbers[i + 2] ?? 0;
			const [nameRes, iconRes] = await Promise.all([
				pvfApi.getNameByCodeAndLst('equipment/equipment.lst', id).catch(() => undefined),
				pvfApi.getIconBase64ByCode('equipment/equipment.lst', id).catch(() => undefined)
			]);
			equipments.push({
				id,
				grade,
				powerUpLevel,
				gradeName: getGradeName(grade),
				name: (nameRes && nameRes.ok) ? (nameRes.name || '') : '',
				iconBase64: (iconRes && iconRes.ok) ? iconRes.base64 : undefined
			});
		}
		return equipments;
	} catch (error) {
		console.error('[APC] getEquipmentInfo error:', error);
		return [];
	}
}
