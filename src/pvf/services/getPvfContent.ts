import { getPvfModel } from '../runtimeModel';

/**
 * 读取 PVF 中指定文件的内容，统一转换为 UTF-8 文本（若可识别为文本），并返回原始字节。
 * 已有的 PvfModel.readFileBytes 会：
 *  - 对脚本 / 已知文本 / .nut / stringtable / 反编译 .ani 输出 UTF-8(BOM) 文本字节
 *  - 其他保持原始二进制
 * 这里基于其结果做一次 BOM 去除与文本性判断。
 */
export interface PvfContentResult {
	key: string;          // 标准化 key (lower-case, '/')
	exists: boolean;      // 是否存在
	isText: boolean;      // 是否识别为文本
	text?: string;        // 文本内容（UTF-8，无 BOM）
	bytes: Uint8Array;    // 原始读取结果（可能是文本 UTF-8+BOM，也可能是二进制）
}

/** 判断字节是否主要是可打印 ASCII / 常见换行与制表符，用作回退文本判定 */
function looksLikeText(buf: Uint8Array): boolean {
	if (buf.length === 0) return true;
	// 如果包含 0x00 认为是二进制
	for (let i = 0; i < Math.min(buf.length, 2048); i++) { if (buf[i] === 0) return false; }
	let printable = 0; let total = 0;
	const max = Math.min(buf.length, 4096);
	for (let i = 0; i < max; i++) {
		const c = buf[i];
		total++;
		if (c === 9 || c === 10 || c === 13) { printable++; continue; }
		if (c >= 32 && c < 127) { printable++; continue; }
	}
	return printable / total > 0.85; // 85% 可打印视为文本
}

export async function getPvfContent(filePath: string): Promise<PvfContentResult> {
	const model = getPvfModel();
	const key = filePath.replace(/\\/g, '/').toLowerCase();
	if (!model) {
		return { key, exists: false, isText: false, bytes: new Uint8Array() };
	}
	const f = model.getFileByKey(key);
	if (!f) {
		return { key, exists: false, isText: false, bytes: new Uint8Array() };
	}
	const bytes = await model.readFileBytes(key);
	let slice = bytes;
	// 去除 UTF-8 BOM（如果存在）
	if (slice.length >= 3 && slice[0] === 0xEF && slice[1] === 0xBB && slice[2] === 0xBF) {
		slice = slice.subarray(3);
	}
	// readFileBytes 对已知文本会转成 UTF-8+BOM；其余保持原样，我们再做一次启发式判断
	const isText = (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) || looksLikeText(slice);
	let text: string | undefined;
	if (isText) {
		try { text = new TextDecoder('utf-8', { fatal: false }).decode(slice); } catch { text = Buffer.from(slice).toString('utf8'); }
	}
	return { key, exists: true, isText, text, bytes };
}

export default getPvfContent;

/**
 * 将 PVF 脚本（act/ani/ai/aic/equ/key/lst/str/skl 等类似的方括号标签脚本）解析成一个简单 JSON 结构。
 * 解析策略（轻量、无语义校验）:
 *  - 将每个形如 [TAG ...] 视为一个节点的开始；若该 TAG 在后续遇到 [/<同名>] 则作为可折叠块，children 写入其中
 *  - 未显式闭合的标签按出现顺序放入父级（适用于单行非块元素）
 *  - 支持反引号包裹的多行字符串：在反引号内忽略方括号
 *  - 行内同一行出现多个标签会被依次处理
 * 输出节点字段：
 *  { tag: string; raw: string; line: number; content?: string; children?: Node[] }
 *    raw: 原始标签内部文本（去掉首尾[]与可选的前导/）
 *    content: 若是非块并且该行标签后还有文本，则记录余下文本（trim 后）
 */
export interface ParsedScriptNode {
	tag: string;          // 小写标签名
	raw: string;          // 原始内部文本（不含方括号）
	line: number;         // 行号（从 0 开始）
	inline?: string;      // 标签后同一行剩余文本（trim）
	valueLines?: string[];// 自闭合标签/叶子标签紧随的文本行（直到遇到下一行的标签）
	children?: ParsedScriptNode[]; // 若有子节点
	tokens?: string[];    // 从 valueLines 拆分出的全部 token（按制表符/空白）
	numbers?: number[];   // 可成功解析为数字的 token 列表
}

export interface ParseScriptResult {
	ok: boolean;
	error?: string;
	nodes: ParsedScriptNode[];
	text?: string; // 原始文本（若可用）
	lstEntries?: { key: number; value: string }[]; // 若是 .lst 解析出的键值对
}

/**
 * 基础标签提取，与 tagRegistry.iterateBracketTags 类似，但这里独立实现以避免循环依赖。
 */
function* simpleIterateBracketTags(line: string): Generator<{ isClose: boolean; inner: string; start: number; end: number }> {
	const re = /\[(\/)?([^\]]*)\]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(line))) {
		const isClose = !!m[1];
		const inner = (m[2] || '').trim();
		if (!inner) continue;
		yield { isClose, inner, start: m.index, end: m.index + m[0].length };
	}
}

export async function parsePvfScriptToJson(filePath: string): Promise<ParseScriptResult> {
	const content = await getPvfContent(filePath);
	if (!content.exists) return { ok: false, error: 'file_not_found', nodes: [] };
	if (!content.isText || !content.text) return { ok: false, error: 'not_text_script', nodes: [] };
	const text = content.text.replace(/\r\n?/g, '\n');
	// .lst 特殊：格式 '#PVF_File' 开头，后续 行: <number> \t `path`
	if (/\.lst$/i.test(filePath)) {
		const lines = text.split('\n').map(l => l.trim()).filter(l => l.length);
		const entries: { key: number; value: string }[] = [];
		for (const l of lines) {
			if (l.startsWith('#')) continue;
			const m = l.match(/^(\d+)\s+`([^`]+)`/);
			if (m) { entries.push({ key: Number(m[1]), value: m[2] }); }
		}
		return { ok: true, nodes: [], text, lstEntries: entries };
	}
	const lines = text.split('\n');
	// 预扫闭合标签集合（出现过 [/tag] 的认为是可嵌套块）
	const closableNames = new Set<string>();
	for (const line of lines) {
		for (const t of simpleIterateBracketTags(line)) {
			if (t.isClose) closableNames.add(t.inner.toLowerCase());
		}
	}
	interface StackItem { node: ParsedScriptNode; tag: string; }
	const root: ParsedScriptNode[] = [];
	const stack: StackItem[] = [];
	let inBacktick = false;
	let lastSelfClosing: ParsedScriptNode | null = null; // 收集后续值行

	function attach(node: ParsedScriptNode) {
		if (stack.length) (stack[stack.length - 1].node.children ||= []).push(node); else root.push(node);
	}

	function processLine(line: string, lineIdx: number) {
		// backtick 分段（忽略字符串中的标签）
		type Seg = { text: string; offset: number };
		const segs: Seg[] = [];
		if (line.indexOf('`') === -1 && !inBacktick) {
			segs.push({ text: line, offset: 0 });
		} else {
			let last = 0;
			for (let i = 0; i < line.length; i++) {
				if (line[i] === '`') {
					if (!inBacktick) { if (i > last) segs.push({ text: line.slice(last, i), offset: last }); inBacktick = true; last = i + 1; }
					else { inBacktick = false; last = i + 1; }
				}
			}
			if (!inBacktick && last < line.length) segs.push({ text: line.slice(last), offset: last });
		}
		let anyTag = false;
		for (const seg of segs) {
			for (const t of simpleIterateBracketTags(seg.text)) {
				anyTag = true; lastSelfClosing = null; // 新标签出现，终止上一自闭合的值收集
				const lower = t.inner.toLowerCase();
				if (t.isClose) {
					for (let s = stack.length - 1; s >= 0; s--) { if (stack[s].tag === lower) { stack.splice(s); break; } }
					continue;
				}
				const node: ParsedScriptNode = { tag: lower, raw: t.inner, line: lineIdx };
				// 同行余量（在该标签后的文本直到行末）
				const absEnd = t.end + seg.offset; // 绝对结束位置
				const inlineRemainder = line.slice(absEnd).trim();
				if (inlineRemainder) node.inline = inlineRemainder;
				attach(node);
				if (closableNames.has(lower)) {
					stack.push({ node, tag: lower });
				} else {
					lastSelfClosing = node; // 后续纯文本行归属它，直到遇到下一标签
				}
			}
		}
		if (!anyTag) {
			const trimmed = line.trim();
			if (trimmed) {
				if (lastSelfClosing) {
					(lastSelfClosing.valueLines ||= []).push(trimmed);
				} else if (stack.length) {
					// 将纯文本归属到当前最内层可闭合块
					const top = stack[stack.length - 1].node;
					(top.valueLines ||= []).push(trimmed);
				}
			}
		}
	}

	for (let i = 0; i < lines.length; i++) processLine(lines[i], i);
	// 拆分 valueLines -> tokens / numbers，并为含制表符的行生成子节点
	function expandTokens(arr: ParsedScriptNode[]) {
		for (const n of arr) {
			if (n.valueLines && n.valueLines.length) {
				// 按 \t 拆分；若某行不含 \t 但希望也纳入 tokens，可直接整体作为一个 token
				const tokenList: string[] = [];
				for (const line of n.valueLines) {
					if (line.includes('\t')) {
						for (const part of line.split('\t')) {
							const tk = part.trim(); if (tk) tokenList.push(tk);
						}
					} else {
						const single = line.trim(); if (single) tokenList.push(single);
					}
				}
				if (tokenList.length) {
					n.tokens = tokenList.slice();
					const nums: number[] = [];
					for (const tk of tokenList) {
						const num = Number(tk.replace(/^[-+]?\./,'0.')); // 兼容形如 .5 -> 0.5
						if (!Number.isNaN(num)) nums.push(num);
					}
					if (nums.length) n.numbers = nums;
					// 若节点目前没有 children，则用 tokens 生成子节点；否则不干扰已有结构
					if (!n.children) {
						n.children = tokenList.map(tk => ({ tag: 'value', raw: tk, line: n.line }));
					}
				}
			}
			if (n.children) expandTokens(n.children);
		}
	}
	expandTokens(root);
	return { ok: true, nodes: root, text };
}

// ====== Name lookup helpers (code -> script path -> [name]) ======
// 需求: 依据 lst 文件(plain .lst 文本: <code> `path`) + code 获取对应脚本中的 [name] 标签内容。
// 约定: 若脚本存在 tag = 'name' 节点, 优先 tokens[0], 否则从 valueLines / inline 提取第一个反引号包裹或整行文本。

export interface NameLookupResult {
	ok: boolean;
	code?: number;
	lstPath?: string;
	scriptPath?: string;
	name?: string;
	error?: string; // not_found / no_name / parse_error
}

// 简单内存缓存: lstPath -> Map<code, scriptPath>
const _lstCache: Map<string, Map<number, string>> = new Map();
// 已解析的脚本 name 缓存: scriptPath -> name | null(已解析但无 name)
const _nameCache: Map<string, string | null> = new Map();

function normalizeKey(p: string) { return p.replace(/\\/g,'/').replace(/^\/+/, '').toLowerCase(); }

/** 解析脚本节点中的名称 */
function extractNameFromNodes(nodes: ParsedScriptNode[]): string | undefined {
	const nameNode = nodes.find(n => n.tag === 'name');
	if (!nameNode) return undefined;
	// tokens 优先
	if (nameNode.tokens && nameNode.tokens.length) {
		const raw = nameNode.tokens[0];
		return raw.replace(/^`+|`+$/g,'').trim();
	}
	// 尝试 valueLines
	if (nameNode.valueLines && nameNode.valueLines.length) {
		for (const l of nameNode.valueLines) {
			const m = l.match(/`([^`]+)`/); if (m) return m[1].trim();
			if (l.trim()) return l.trim();
		}
	}
	if (nameNode.inline) {
		const m = nameNode.inline.match(/`([^`]+)`/); if (m) return m[1].trim();
		return nameNode.inline.trim();
	}
	return undefined;
}

/**
 * 给定脚本路径直接获取 [name] 内容
 */
export async function getNameByScriptPath(scriptPath: string): Promise<NameLookupResult> {
	const sp = normalizeKey(scriptPath);
	if (_nameCache.has(sp)) {
		const cached = _nameCache.get(sp)!;
		return cached ? { ok: true, scriptPath: sp, name: cached } : { ok: false, scriptPath: sp, error: 'no_name' };
	}
	try {
		const parsed = await parsePvfScriptToJson(sp);
		if (!parsed.ok) return { ok: false, scriptPath: sp, error: parsed.error || 'parse_error' };
		const name = extractNameFromNodes(parsed.nodes);
		_nameCache.set(sp, name ?? null);
		return name ? { ok: true, scriptPath: sp, name } : { ok: false, scriptPath: sp, error: 'no_name' };
	} catch (e:any) {
		return { ok: false, scriptPath: sp, error: 'parse_error' };
	}
}

/**
 * 通过 lst 路径 + code 查询脚本名称。
 * 若传入的 code 不存在，返回 not_found。
 */
export async function getNameByCodeAndLst(lstPath: string, code: number): Promise<NameLookupResult> {
	const lp = normalizeKey(lstPath);
	if (!_lstCache.has(lp)) {
		// 构建缓存
		const parsed = await parsePvfScriptToJson(lp);
		if (!parsed.ok) return { ok: false, lstPath: lp, code, error: parsed.error || 'parse_error' };
		const map = new Map<number, string>();
		for (const e of parsed.lstEntries || []) { map.set(e.key, normalizeKey(e.value)); }
		_lstCache.set(lp, map);
	}
	const m = _lstCache.get(lp)!;
	const scriptPath = m.get(code);
	if (!scriptPath) return { ok: false, lstPath: lp, code, error: 'not_found' };
	const base = await getNameByScriptPath(scriptPath);
	return { ...base, lstPath: lp, code, scriptPath };
}

/**
 * 批量：按 lst + 多个 code 返回名称映射；未找到或无 name 的项不给出。
 */
export async function batchGetNamesByCodes(lstPath: string, codes: number[]): Promise<Record<number,string>> {
	const out: Record<number,string> = {};
	const lp = normalizeKey(lstPath);
	for (const c of codes) {
		const r = await getNameByCodeAndLst(lp, c);
		if (r.ok && r.name) out[c] = r.name;
	}
	return out;
}

// ====== Icon lookup by lst + code ======
export interface IconLookupResult { ok: boolean; code?: number; lstPath?: string; scriptPath?: string; base64?: string; error?: string; }

// 缓存脚本解析出的 icon 元信息: scriptPath -> { path, frame }
interface ScriptIconMeta { path: string; frame: number; }
const _iconMetaCache: Map<string, ScriptIconMeta | null> = new Map();

/** 尝试从脚本节点解析 icon 标签 (icon <imgPath> <frameIndex>) */
function extractIconMeta(nodes: ParsedScriptNode[]): ScriptIconMeta | undefined {
	const iconNode = nodes.find(n => n.tag === 'icon');
	if (!iconNode) return undefined;
	const toks = iconNode.tokens || [];
	if (toks.length >= 1) {
		const img = toks[0].replace(/`/g,'').trim();
		const frame = toks.length >= 2 ? Number(toks[1]) : 0;
		return { path: img, frame: Number.isFinite(frame)?frame:0 };
	}
	return undefined;
}

async function getIconMetaByScript(scriptPath: string): Promise<ScriptIconMeta | null> {
	const sp = normalizeKey(scriptPath);
	if (_iconMetaCache.has(sp)) return _iconMetaCache.get(sp)!;
	try {
		const parsed = await parsePvfScriptToJson(sp);
		if (!parsed.ok) { _iconMetaCache.set(sp, null); return null; }
		const meta = extractIconMeta(parsed.nodes) || null;
		_iconMetaCache.set(sp, meta);
		return meta;
	} catch { _iconMetaCache.set(sp, null); return null; }
}

/** 给定 lst + code 返回脚本 icon 第 frame 帧的 base64 (自动解析 frame) */
export async function getIconBase64ByCode(lstPath: string, code: number): Promise<IconLookupResult> {
	const lp = normalizeKey(lstPath);
	const map = (_lstCache.has(lp)) ? _lstCache.get(lp)! : (await (async()=>{ const p= await parsePvfScriptToJson(lp); if(!p.ok) return null; const m=new Map<number,string>(); for(const e of p.lstEntries||[]) m.set(e.key, normalizeKey(e.value)); _lstCache.set(lp,m); return m; })());
	if (!map) return { ok:false, lstPath: lp, code, error:'lst_parse_error' };
	const scriptPath = map.get(code);
	if (!scriptPath) return { ok:false, lstPath: lp, code, error:'not_found' };
	const meta = await getIconMetaByScript(scriptPath);
	if (!meta) return { ok:false, lstPath: lp, code, scriptPath, error:'no_icon' };
	try {
		const { getIconFrameBase64 } = await import('./getIconFrame.js');
		const res = await getIconFrameBase64(meta.path, meta.frame);
		if (!res.ok) return { ok:false, lstPath: lp, code, scriptPath, error: res.error || 'icon_error' };
		return { ok:true, lstPath: lp, code, scriptPath, base64: res.base64 };
	} catch (e:any) {
		return { ok:false, lstPath: lp, code, scriptPath, error:'exception' };
	}
}



