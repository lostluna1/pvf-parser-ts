import { PvfModel } from './model';
import * as vscode from 'vscode';

export interface FileMetaInfo {
	name?: string; // [name] 标签值（去掉反引号）
	name2?: string; // [name2]
	tags?: Record<string, string | string[]>; // 其他标签，可扩展
}

/** 解析支持的脚本文本，抽取 [name] / [name2] 等标签内容 */
export function parseScriptMetadata(text: string): FileMetaInfo {
	const meta: FileMetaInfo = { tags: {} };
	// 标准化换行
	const t = text.replace(/\r\n?/g, '\n');
	// 简单块解析：匹配 [section]\n(若干行，直到空行或下一个[xxx])
	const sectionRegex = /^\[(.+?)\]\n([\s\S]*?)(?=^\[|\Z)/gm;
	let m: RegExpExecArray | null;
	while ((m = sectionRegex.exec(t)) !== null) {
		const key = m[1].trim().toLowerCase();
		let body = m[2];
		// 去除末尾多余空白行
		body = body.replace(/\n+$/,'').trim();
		// 反引号包裹的取内容
		const backtick = /^`([\s\S]*?)`$/;
		if (backtick.test(body)) {
			body = body.replace(backtick, '$1');
		}
		if (key === 'name') meta.name = body;
		else if (key === 'name2') meta.name2 = body;
		else if (key) {
			// 多行拆分为数组（如果有制表或多行）
			if (body.indexOf('\n') >= 0 || body.indexOf('\t') >= 0) {
				meta.tags![key] = body.split(/\n+/).map(s=>s.trim()).filter(s=>s.length>0);
			} else meta.tags![key] = body;
		}
	}
	return meta;
}

/**
 * 为模型构建脚本文件的元数据映射（仅解析含 [name] 的文件）。
 * 与 .lst 解析独立；若 .lst 已提供显示名但 metadata 也有 name，则后者覆盖。
 */
function getExcludeList(): string[] {
	const cfg = vscode.workspace.getConfiguration();
	const excludeDefault = '.nut,.lst,.ani,.ani.als,.als,.ui,.png,.jpg,.jpeg,.dds,.bmp,.tga,.gif,.wav,.ogg,.mp3,.bin';
	const excludeCfg = cfg.get<string>('pvf.metadata.excludeExtensions', excludeDefault);
	const excludeList = excludeCfg.split(/[;,:\n\r\t ]+/).map(s=>s.trim().toLowerCase()).filter(Boolean);
	return excludeList.map(e => e.startsWith('.') ? e : '.'+e);
}

function shouldExclude(key: string, excludes: string[]): boolean {
	const lower = key.toLowerCase();
	for (const ext of excludes) if (lower.endsWith(ext)) return true;
	return false;
}

async function parseOne(model: PvfModel, key: string, excludes: string[], scanned: Set<string>) {
	if (scanned.has(key)) return; // 已扫描
	// 提前标记，避免并发重复 IO
	scanned.add(key);
	if (shouldExclude(key, excludes)) { return; }
	try {
		const bytes = await model.readFileBytes(key);
		if (!bytes || bytes.length === 0) { return; }
		let content = Buffer.from(bytes).toString('utf8');
		if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
		if (content.indexOf('[name]') === -1) { return; }
		const meta = parseScriptMetadata(content);
		if (meta.name) (model as any).setDisplayName?.(key, meta.name);
	} catch { /* ignore */ }
}

export async function parseMetadataForKeys(model: PvfModel, keys: string[], progress?: (pct:number)=>void) {
	const excludes = getExcludeList();
	const scanned: Set<string> = (model as any)._metadataScannedFiles || ((model as any)._metadataScannedFiles = new Set<string>());
	for (let i=0;i<keys.length;i++) {
		await parseOne(model, keys[i], excludes, scanned);
		if (progress) progress(Math.floor(((i+1)/keys.length)*100));
	}
}

// 全量构建（保留原功能，供非懒加载模式或命令触发）
export async function buildMetadataMaps(model: PvfModel, progress?: (pct: number)=>void, startPct=80, endPct=100) {
	const excludes = getExcludeList();
	const allKeys = model.getAllKeys();
	const scanned: Set<string> = (model as any)._metadataScannedFiles || ((model as any)._metadataScannedFiles = new Set<string>());
	const keys = allKeys.filter(k => !shouldExclude(k, excludes));
	const total = keys.length || 1;
	for (let i=0;i<keys.length;i++) {
		await parseOne(model, keys[i], excludes, scanned);
		if (progress) {
			const pct = startPct + ((i+1)/total)*(endPct-startPct);
			progress(Math.min(endPct-1, Math.floor(pct)));
		}
	}
	if (progress) progress(endPct);
}
