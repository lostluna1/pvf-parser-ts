import * as vscode from 'vscode';
import { PvfModel } from '../model';
import { searchStringIdReferencesAsync } from './stringRefSearchService';

// 解析一行 stringtable.bin:  "63\tswordman/15kuran/event_15kuran.aic"
function parseLine(line: string): { id: number; text: string } | null {
	const tab = line.indexOf('\t');
	if (tab <= 0) return null;
	const idStr = line.slice(0, tab).trim();
	const id = parseInt(idStr, 10);
	if (isNaN(id)) return null;
	const text = line.slice(tab + 1).trim();
	return { id, text };
}

// 简单缓存：stringId -> { files, timestamp }
const refCache = new Map<number, { files: string[]; t: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const MARGIN = 100; // 上下预取行数
const DEBOUNCE_MS = 120;

export function registerStringTableCodeLens(context: vscode.ExtensionContext, model: PvfModel) {
	const selector: vscode.DocumentSelector = [ { pattern: '**/stringtable.bin' } ];
	const emitter = new vscode.EventEmitter<void>();
	context.subscriptions.push(emitter);

	let lastDoc: vscode.TextDocument | undefined;

	const provider: vscode.CodeLensProvider = {
		onDidChangeCodeLenses: emitter.event,
		async provideCodeLenses(document, token) {
			if (token.isCancellationRequested) return [];
			lastDoc = document;
			const editor = vscode.window.activeTextEditor;
			let ranges: vscode.Range[] = [];
			if (editor && editor.document === document) {
				ranges = editor.visibleRanges.map(r => new vscode.Range(
					Math.max(0, r.start.line - MARGIN), 0,
					Math.min(document.lineCount - 1, r.end.line + MARGIN), 0
				));
			} else {
				ranges = [ new vscode.Range(0,0, Math.min(200, document.lineCount - 1), 0) ];
			}

			// 合并重叠范围（简单线性）
			if (ranges.length > 1) {
				ranges.sort((a,b)=> a.start.line - b.start.line);
				const merged: vscode.Range[] = [];
				let cur = ranges[0];
				for (let i=1;i<ranges.length;i++) {
					const r = ranges[i];
						if (r.start.line <= cur.end.line + 1) {
							if (r.end.line > cur.end.line) cur = new vscode.Range(cur.start, r.end);
						} else { merged.push(cur); cur = r; }
				}
				merged.push(cur); ranges = merged;
			}

			const now = Date.now();
			const needScanIds: number[] = [];
			const lineIdMap = new Map<number, number>();
			for (const r of ranges) {
				for (let ln = r.start.line; ln <= r.end.line && ln < document.lineCount; ln++) {
					const parsed = parseLine(document.lineAt(ln).text); if(!parsed) continue; lineIdMap.set(ln, parsed.id);
					const cached = refCache.get(parsed.id);
					if (!cached || (now - cached.t) > CACHE_TTL) needScanIds.push(parsed.id);
				}
			}
			const unique = Array.from(new Set(needScanIds));
			if (unique.length > 0) {
				try {
					const map = await searchStringIdReferencesAsync(model, unique);
					map.forEach((files,id)=> refCache.set(id, { files, t: Date.now() }));
					for (const id of unique) if(!map.has(id)) refCache.set(id, { files: [], t: Date.now() });
				} catch {}
			}

			const lenses: vscode.CodeLens[] = [];
			for (const [line,id] of lineIdMap.entries()) {
				const files = refCache.get(id)?.files || [];
				lenses.push(new vscode.CodeLens(new vscode.Range(line,0,line,0), { title: `${files.length} 引用`, command: 'pvf.openStringRefList', arguments: [id, files] }));
			}
			return lenses;
		}
	};
	context.subscriptions.push(vscode.languages.registerCodeLensProvider(selector, provider));

	// 滚动事件 -> debounce 刷新（仅当前激活编辑器）
	let timer: NodeJS.Timeout | undefined;
	function schedule() { if (timer) clearTimeout(timer); timer = setTimeout(()=> emitter.fire(), DEBOUNCE_MS); }
	context.subscriptions.push(vscode.window.onDidChangeTextEditorVisibleRanges(e => {
		if (e.textEditor.document === lastDoc && e.textEditor.document.fileName.toLowerCase().endsWith('stringtable.bin')) {
			schedule();
		}
	}));

	// 打开引用列表命令
	context.subscriptions.push(vscode.commands.registerCommand('pvf.openStringRefList', async (id: number, files: string[]) => {
		if (!files || files.length === 0) {
			vscode.window.showInformationMessage(`字符串 #${id} 没有脚本引用`);
			return;
		}
		const pick = await vscode.window.showQuickPick(files.slice(0, 500).map(f => ({ label: f.split('/').pop() || f, description: f })), { placeHolder: `引用 #${id} 的脚本 (${files.length} 条，显示前 500)` });
		if (pick) {
			const uri = vscode.Uri.parse(`pvf:/${pick.description}`);
			try { await vscode.window.showTextDocument(uri, { preview: true }); } catch (e) { vscode.window.showErrorMessage('打开引用脚本失败: ' + (e as any)?.message); }
		}
	}));
}
