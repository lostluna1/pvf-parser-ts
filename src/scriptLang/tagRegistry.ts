import * as vscode from 'vscode';
import * as fs from 'fs/promises';

export interface ScriptTagInfo { name: string; description?: string; closing?: boolean; }
interface TagFile { tags: ScriptTagInfo[] }

const cache = new Map<string, ScriptTagInfo[]>();

export async function loadTags(context: vscode.ExtensionContext, short: string): Promise<ScriptTagInfo[]> {
    if (cache.has(short)) return cache.get(short)!;
    const candidates = [
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'scriptLang', 'scriptTags', `${short}.json`),
        vscode.Uri.joinPath(context.extensionUri, 'src', 'scriptLang', 'scriptTags', `${short}.json`)
    ];
    for (const u of candidates) {
        try {
            const txt = await fs.readFile(u.fsPath, 'utf8');
            const data: TagFile = JSON.parse(txt);
            const arr = data.tags || [];
            cache.set(short, arr);
            return arr;
        } catch { }
    }
    cache.set(short, []);
    return [];
}

export function clearTagCache(short?: string) { if (short) cache.delete(short); else cache.clear(); }

// Internal: iterate all bracketed tags in a single line of text.
export function* iterateBracketTags(lineText: string): Generator<{ isClose: boolean; rawName: string; matchStart: number; matchEnd: number; nameStart: number; nameEnd: number }> {
    const regex = /\[(\/)?([^\]]*)\]/g; // capture full inside (may include spaces or operators)
    let m: RegExpExecArray | null;
    while ((m = regex.exec(lineText))) {
        const isClose = !!m[1];
        const inner = m[2].trim();
        if (!inner) continue;
        const nameStart = m.index + 1 + (isClose ? 1 : 0);
        const nameEnd = m.index + m[0].length - 1; // before ']'
        yield { isClose, rawName: inner, matchStart: m.index, matchEnd: m.index + m[0].length, nameStart, nameEnd };
    }
}

export function registerTagDiagnostics(context: vscode.ExtensionContext, langId: string, short: string) {
    const collection = vscode.languages.createDiagnosticCollection(`${langId}-tags`);
    context.subscriptions.push(collection);

    async function lint(doc: vscode.TextDocument) {
        if (doc.languageId !== langId) return;
        const tags = await loadTags(context, short);
        if (!tags.length) { collection.delete(doc.uri); return; }
    const needCloseBase = new Set(tags.filter(t => t.closing).map(t => t.name.toLowerCase()));
    const knownTags = new Set(tags.map(t => t.name.toLowerCase()));
    const stack: { tag: string; line: number; start: number }[] = [];
        const diags: vscode.Diagnostic[] = [];
        for (let lineNum = 0; lineNum < doc.lineCount; lineNum++) {
            const text = doc.lineAt(lineNum).text;
            for (const t of iterateBracketTags(text)) {
                const lower = t.rawName.toLowerCase();
                const range = new vscode.Range(lineNum, t.matchStart, lineNum, t.matchEnd);
                if (!knownTags.has(lower)) {
                    // ani 特殊：动态 FRAME### 视为合法（不在静态列表）
                    if (short === 'ani' && /^frame\d{3,}$/.test(lower)) {
                        // 跳过未知告警，后续单独帧范围诊断在 ani/registerAni.ts
                        continue;
                    }
                    // 兼容旧拼写：ATTACT BOX -> ATTACK BOX，提示修正建议
                    if (short === 'ani' && lower === 'attact box') {
                        const d = new vscode.Diagnostic(range, '未知标签 [ATTACT BOX]，是否想写 ATTACK BOX ?', vscode.DiagnosticSeverity.Information);
                        diags.push(d);
                        continue;
                    }
                    const msg = t.isClose ? `未知闭合标签 [/${t.rawName}]` : `未知标签 [${t.rawName}]`;
                    diags.push(new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Warning));
                    continue;
                }
                if (!t.isClose) {
                    // dynamic rule for act: TRIGGER only closable at root level
                    let dynamicClosing = needCloseBase.has(lower);
                    if (short === 'act' && lower === 'trigger') {
                        dynamicClosing = stack.length === 0; // only root-level
                    }
                    if (dynamicClosing) {
                        stack.push({ tag: lower, line: lineNum, start: t.nameStart });
                    }
                } else {
                    let foundIndex = -1;
                    for (let i = stack.length - 1; i >= 0; i--) {
                        if (stack[i].tag === lower) { foundIndex = i; break; }
                    }
                    if (foundIndex === -1) {
                        diags.push(new vscode.Diagnostic(range, `多余的闭合标签 [/${t.rawName}]`, vscode.DiagnosticSeverity.Warning));
                    } else {
                        stack.splice(foundIndex, 1);
                    }
                }
            }
        }
        for (const pending of stack) {
            const range = new vscode.Range(pending.line, pending.start, pending.line, pending.start + 1);
            diags.push(new vscode.Diagnostic(range, `缺少闭合标签 [/${pending.tag}]`, vscode.DiagnosticSeverity.Warning));
        }
        collection.set(doc.uri, diags);
    }

    const debouncers = new Map<string, NodeJS.Timeout>();
    function schedule(doc: vscode.TextDocument) {
        if (doc.languageId !== langId) return;
        const key = doc.uri.toString();
        clearTimeout(debouncers.get(key));
        debouncers.set(key, setTimeout(() => void lint(doc), 250));
    }

    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(lint));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => schedule(e.document)));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => collection.delete(doc.uri)));
    for (const d of vscode.workspace.textDocuments) void lint(d);
}

export function provideSharedTagFeatures(context: vscode.ExtensionContext, langId: string, short: string) {
    context.subscriptions.push(vscode.languages.registerHoverProvider(langId, {
        async provideHover(doc, pos) {
            const lineText = doc.lineAt(pos.line).text;
            for (const t of iterateBracketTags(lineText)) {
                if (pos.character >= t.nameStart && pos.character <= t.nameEnd) {
                    const tags = await loadTags(context, short);
                    const tag = tags.find(x => x.name.toLowerCase() === t.rawName.toLowerCase());
                    if (!tag) return;
                    const nameRange = new vscode.Range(pos.line, t.nameStart, pos.line, t.nameEnd);
                    const md = new vscode.MarkdownString();
                    md.appendCodeblock(tag.name, langId);
                    if (tag.description) {
                        const lines = tag.description.split(/\r?\n/).map(l=>l.replace(/\s+$/,''));
                        if (lines.length === 1) {
                            md.appendMarkdown('\n' + lines[0]);
                        } else {
                            // 首行加粗，其余行保持原样；若后续行包含反引号或路径示例，放入代码块更清晰
                            const first = lines[0];
                            const rest = lines.slice(1);
                            const needsCode = rest.some(l => /`.+`/.test(l) || /\.ani\b/i.test(l) || /^\s*\//.test(l));
                            md.appendMarkdown(`\n**${first}**`);
                            if (needsCode) {
                                // 根据示例中的文件扩展名选择语言高亮
                                const sample = rest.join('\n');
                                const extsFound = new Set<string>();
                                for (const m of sample.matchAll(/\.[a-zA-Z0-9_]{1,6}\b/g)) {
                                    extsFound.add(m[0].toLowerCase());
                                }
                                // 默认使用当前语言语法而不是 text，保证数字/字符串等能高亮
                                let lang = langId; // fallback to current language id
                                const map: Record<string,string> = { '.ani':'pvf-ani', '.act':'pvf-act' };
                                for (const ext of extsFound) {
                                    if (map[ext]) { lang = map[ext]; break; }
                                }
                                md.appendCodeblock(sample, lang);
                            } else {
                                // 普通多行，用两个空格 + 换行维持换行
                                const body = rest.map(l => l + '  ').join('\n');
                                md.appendMarkdown('\n' + body);
                            }
                        }
                    }
                    return new vscode.Hover(md, nameRange);
                }
            }
            return;
        }
    }));

    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(langId, {
        async provideCompletionItems(doc, pos) {
            const line = doc.lineAt(pos).text.slice(0, pos.character);
            if (!/\[[^\]]*$/.test(line)) return;
            const tags = await loadTags(context, short);
                const fullLine = doc.lineAt(pos.line).text;
                const nextChar = pos.character < fullLine.length ? fullLine[pos.character] : '';
                const replaceClosing = nextChar === ']';
            // compute current stack up to position for dynamic closing evaluation
            function computeDepth(): number {
                let depth = 0;
                for (let ln = 0; ln <= pos.line; ln++) {
                    const text = doc.lineAt(ln).text;
                    for (const t of iterateBracketTags(text)) {
                        if (ln === pos.line && t.matchStart >= line.length) break; // don't process after cursor
                        const lower = t.rawName.toLowerCase();
                        const isCloseCandidate = false; // we only need depth (root-level) for trigger; treat any open closable as depth++ and its close as depth--
                        // Determine dynamic closing for trigger same as diagnostics
                        if (short === 'act' && lower === 'trigger') {
                            // root-level closable; nested not closable => only increase depth if depth==0
                            if (depth === 0) depth++;
                        } else {
                            const base = tags.find(tag => tag.name.toLowerCase() === lower);
                            if (base?.closing) depth++;
                        }
                        // We don't attempt to simulate close tokens here since position before potential close.
                    }
                }
                return depth;
            }
            const depth = computeDepth();
            return tags.map(t => {
                const lower = t.name.toLowerCase();
                let dynamicClosing = t.closing;
                if (short === 'act' && lower === 'trigger') dynamicClosing = depth === 0; // root-level only
                const ci = new vscode.CompletionItem(t.name, vscode.CompletionItemKind.Keyword);
                ci.detail = dynamicClosing ? '标签 (需闭合)' : '标签';
                ci.documentation = t.description || '';
                if (dynamicClosing) {
                    ci.insertText = new vscode.SnippetString(`${t.name}]$0[/${t.name}]`);
                } else {
                    ci.insertText = t.name + ']';
                }
                if (replaceClosing) {
                    ci.range = new vscode.Range(pos.line, pos.character, pos.line, pos.character + 1);
                }
                return ci;
            });
        }
    }, '[', '/'));

    context.subscriptions.push(vscode.languages.registerFoldingRangeProvider(langId, {
        async provideFoldingRanges(doc) {
            const tags = await loadTags(context, short);
            if (!tags.length) return [];
            const closers = new Set(tags.filter(t => t.closing).map(t => t.name.toLowerCase()));
            const out: vscode.FoldingRange[] = [];
            const stack: { tag: string; line: number }[] = [];
            for (let i = 0; i < doc.lineCount; i++) {
                const text = doc.lineAt(i).text;
                for (const t of iterateBracketTags(text)) {
                    const lower = t.rawName.toLowerCase();
                    if (!t.isClose) {
                        let dynamicClosing = closers.has(lower);
                        if (short === 'act' && lower === 'trigger') dynamicClosing = stack.length === 0; // only root-level
                        if (dynamicClosing) stack.push({ tag: lower, line: i });
                    } else {
                        for (let s = stack.length - 1; s >= 0; s--) {
                            if (stack[s].tag === lower) {
                                const start = stack[s].line;
                                if (i > start) out.push(new vscode.FoldingRange(start, i));
                                stack.splice(s, 1);
                                break;
                            }
                        }
                    }
                }
            }
            return out;
        }
    }));

    registerTagDiagnostics(context, langId, short);

    // Semantic Tokens：区分需闭合与无需闭合标签
    const tokenTypes = ['keyword', 'type']; // keyword: non-closing, type: closing
    const legend = new vscode.SemanticTokensLegend(tokenTypes, []);
    context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: langId }, {
        async provideDocumentSemanticTokens(doc) {
            const builder = new vscode.SemanticTokensBuilder(legend);
            const tags = await loadTags(context, short);
            if (!tags.length) return builder.build();
            // We'll simulate stack to apply dynamic rule for TRIGGER (act)
            const baseClosing = new Set(tags.filter(t => t.closing).map(t => t.name.toLowerCase()));
            const baseNonClosing = new Set(tags.filter(t => !t.closing).map(t => t.name.toLowerCase()));
            const stack: { tag: string }[] = [];
            for (let lineNum = 0; lineNum < doc.lineCount; lineNum++) {
                const text = doc.lineAt(lineNum).text;
                for (const t of iterateBracketTags(text)) {
                    const lower = t.rawName.toLowerCase();
                    const len = t.nameEnd - t.nameStart;
                    if (len <= 0) continue;
                    let dynamicClosing = baseClosing.has(lower);
                    if (short === 'act' && lower === 'trigger') dynamicClosing = stack.length === 0; // only root-level triggers treated as closing
                    if (!t.isClose) {
                        if (dynamicClosing) stack.push({ tag: lower });
                        builder.push(lineNum, t.nameStart, len, tokenTypes.indexOf(dynamicClosing ? 'type' : 'keyword'), 0);
                    } else {
                        // closing token itself always colored as type if it matches an open closable
                        let matched = false;
                        for (let s = stack.length - 1; s >= 0; s--) {
                            if (stack[s].tag === lower) { stack.splice(s, 1); matched = true; break; }
                        }
                        builder.push(lineNum, t.nameStart, len, tokenTypes.indexOf(matched ? 'type' : 'keyword'), 0);
                    }
                }
            }
            return builder.build();
        }
    }, legend));
}
