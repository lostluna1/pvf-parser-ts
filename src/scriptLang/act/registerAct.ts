import * as vscode from 'vscode';
import { provideSharedTagFeatures, iterateBracketTags, loadTags } from '../tagRegistry';

const LANG_ID = 'pvf-act';
const SHORT = 'act';

export function registerActLanguage(context: vscode.ExtensionContext) {
    provideSharedTagFeatures(context, LANG_ID, SHORT);
    // 自定义附加诊断：SPEECH / SOUND 必须位于 MOTION 块内部
    const diag = vscode.languages.createDiagnosticCollection('pvf-act-motion-nesting');
    context.subscriptions.push(diag);

    async function lint(doc: vscode.TextDocument) {
        if (doc.languageId !== LANG_ID) return;
        const tags = await loadTags(context, SHORT);
        const closable = new Set(tags.filter(t => t.closing).map(t => t.name.toLowerCase()));
        const diags: vscode.Diagnostic[] = [];
        // 栈跟踪当前可闭合块，特别关心 motion 嵌套层级
        const stack: string[] = [];
        for (let line = 0; line < doc.lineCount; line++) {
            const text = doc.lineAt(line).text;
            for (const t of iterateBracketTags(text)) {
                const lower = t.rawName.toLowerCase();
                if (!t.isClose) {
                    // TRIGGER 只有根级闭合：沿用 shared 逻辑，这里只需要 MOTION
                    if (closable.has(lower) || lower === 'motion') {
                        stack.push(lower);
                    }
                    if (lower === 'speech' || lower === 'sound') {
                        const inMotion = stack.lastIndexOf('motion') !== -1; // 在任意上层 MOTION
                        if (!inMotion) {
                            diags.push(new vscode.Diagnostic(
                                new vscode.Range(line, t.matchStart, line, t.matchEnd),
                                `[${t.rawName}] 必须位于 [MOTION] 块内部`,
                                vscode.DiagnosticSeverity.Warning
                            ));
                        }
                    }
                } else {
                    // 关闭：匹配最近同名
                    for (let i = stack.length - 1; i >= 0; i--) {
                        if (stack[i] === lower) { stack.splice(i, 1); break; }
                    }
                }
            }
        }
        diag.set(doc.uri, diags);
    }

    const debouncers = new Map<string, NodeJS.Timeout>();
    function schedule(doc: vscode.TextDocument) {
        if (doc.languageId !== LANG_ID) return;
        const key = doc.uri.toString();
        clearTimeout(debouncers.get(key));
        debouncers.set(key, setTimeout(() => void lint(doc), 200));
    }
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(lint));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => schedule(e.document)));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => diag.delete(doc.uri)));
    for (const d of vscode.workspace.textDocuments) void lint(d);
}
