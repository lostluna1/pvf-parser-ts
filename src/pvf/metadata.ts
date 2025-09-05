import { PvfModel } from './model';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

// 轻量 PNG 编码 (RGBA -> PNG)，避免额外依赖
import * as zlib from 'zlib';

function crc32(buf: Uint8Array): number {
	let crc = ~0; // 初始化
	for (let i = 0; i < buf.length; i++) {
		crc ^= buf[i];
		for (let j = 0; j < 8; j++) {
			const m = -(crc & 1);
			crc = (crc >>> 1) ^ (0xEDB88320 & m);
		}
	}
	return ~crc >>> 0;
}

function writeChunk(type: string, data: Uint8Array, out: number[]): void {
	const len = data.length;
	out.push((len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, (len) & 0xff);
	const typeBytes = Buffer.from(type, 'ascii');
	const chunk = new Uint8Array(typeBytes.length + data.length);
	chunk.set(typeBytes, 0); chunk.set(data, typeBytes.length);
	const c = crc32(chunk);
	for (let i = 0; i < chunk.length; i++) out.push(chunk[i]);
	out.push((c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, (c) & 0xff);
}

function encodePng(rgba: Uint8Array, w: number, h: number): Buffer {
	// 每行前置过滤字节 0
	const stride = w * 4;
	const raw = Buffer.alloc((stride + 1) * h);
		for (let y = 0; y < h; y++) {
			raw[y * (stride + 1)] = 0; // filter type 0
			const slice = rgba.subarray(y * stride, y * stride + stride);
			slice.forEach((v, i) => { raw[y * (stride + 1) + 1 + i] = v; });
		}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type RGBA
	ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression, filter, interlace
	const idat = zlib.deflateSync(raw, { level: 9 });
	const out: number[] = [];
	// PNG 签名
	out.push(137,80,78,71,13,10,26,10);
	writeChunk('IHDR', ihdr, out);
	writeChunk('IDAT', idat, out);
	writeChunk('IEND', new Uint8Array(), out);
	return Buffer.from(out);
}

export interface FileMetaInfo {
	name?: string; // [name] 标签值（去掉反引号）
	name2?: string; // [name2]
	tags?: Record<string, string | string[]>; // 其他标签，可扩展
	icon?: { img: string; frame: number };
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
		else if (key === 'icon') {
			// lines: path / frame / path / frame ... 仅取第一组
			const lines = body.split(/\n+/).map(s=>s.trim()).filter(Boolean);
			for (let i=0; i+1<lines.length; i+=2) {
				let p = lines[i];
				if ((p.startsWith('`') && p.endsWith('`')) || (/^['"].+['"]$/.test(p))) p = p.slice(1,-1);
				const frame = parseInt(lines[i+1], 10);
				if (p && Number.isFinite(frame)) { meta.icon = { img: p, frame }; break; }
			}
		}
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
		// 为减少无谓解析：快速判断是否含我们关心的标签之一
		if (!/\[(name|icon)\]/i.test(content)) { return; }
		const meta = parseScriptMetadata(content);
		if (meta.name) (model as any).setDisplayName?.(key, meta.name);
		if (meta.icon) {
			await generateIconFor(model, key, meta.icon.img, meta.icon.frame);
		}
	} catch { /* ignore */ }
}

/** 规范化 img 逻辑路径：输入示例 Character/Common/SkillIcon.img -> sprite/character/common/skillicon.img */
function normalizeImgLogical(p: string): string {
	let s = p.trim().replace(/\\/g,'/');
	s = s.replace(/^`+|`+$/g,'');
	if (!/^sprite\//i.test(s)) s = 'sprite/' + s;
	s = s.toLowerCase();
	return s;
}

async function generateIconFor(model: PvfModel, fileKey: string, rawImg: string, frame: number) {
	try {
		const imgLogical = normalizeImgLogical(rawImg);
		const store: Map<string, any> = (model as any)._fileIconMeta || ((model as any)._fileIconMeta = new Map());
		if (store.has(fileKey) && store.get(fileKey).pngPath) return; // 已生成
		// 记录基础信息
		const rec = store.get(fileKey) || { img: imgLogical, frame };
		rec.img = imgLogical; rec.frame = frame;
		store.set(fileKey, rec);
		const cfg = vscode.workspace.getConfiguration();
		const root = (cfg.get<string>('pvf.npkRoot') || '').trim();
		if (!root) return; // 缺少根目录，延迟
		const extCtx = (model as any)._extCtx as vscode.ExtensionContext | undefined;
		if (!extCtx) return; // 还没有上下文
		// 动态加载解析逻辑
		const { loadAlbumForImage } = await import('../commander/previewAni/npkResolver.js');
		const { getSpriteRgba } = await import('../npk/imgReader.js');
		const album = await loadAlbumForImage(extCtx, root, imgLogical).catch(()=>undefined);
		if (!album || !album.sprites || !album.sprites[frame]) return;
		const rgba = getSpriteRgba(album as any, frame);
		if (!rgba) return;
		const sp = album.sprites[frame];
		const png = encodePng(rgba, sp.width, sp.height);
		const cacheDir = path.join(extCtx.globalStorageUri.fsPath, 'icon-cache');
		try { await fs.mkdir(cacheDir, { recursive: true }); } catch {}
		const hash = quickHash(imgLogical + ':' + frame);
		const file = path.join(cacheDir, hash + '.png');
		try { await fs.writeFile(file, png); } catch {}
		rec.pngPath = file;
		store.set(fileKey, rec);
	} catch {/* ignore single icon */}
}

function quickHash(s: string): string {
	let h = 0; for (let i=0;i<s.length;i++) { h = ((h<<5)-h + s.charCodeAt(i))|0; }
	return (h>>>0).toString(16);
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
