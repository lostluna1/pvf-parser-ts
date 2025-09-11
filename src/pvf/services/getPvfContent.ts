import { PvfModel } from '../model';
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

export async function getPvfContent( filePath: string): Promise<PvfContentResult> {
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
