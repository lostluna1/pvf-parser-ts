import * as vscode from 'vscode';
import { provideSharedTagFeatures } from '../tagRegistry';

const LANG_ID = 'pvf-skl';
const SHORT = 'skl';

export function registerSklLanguage(context: vscode.ExtensionContext) {
    provideSharedTagFeatures(context, LANG_ID, SHORT);
    registerSklValueDiagnostics(context);
}

// SKL 专用数值结构诊断（初步实现：level info）
function registerSklValueDiagnostics(context: vscode.ExtensionContext) {
    const coll = vscode.languages.createDiagnosticCollection(`${LANG_ID}-values`);
    context.subscriptions.push(coll);

    function lint(doc: vscode.TextDocument) {
        if (doc.languageId !== LANG_ID) return;
        const diags: vscode.Diagnostic[] = [];
        let inLevelInfo = false;
        let expectedCols: number | null = null;
        let seenFirstValueLine = false;
        let packedDone = false; // 单行打包模式

        // 简单的反引号多行字符串跟踪，避免误解析其中的方括号或数据
        let inBacktick = false;

        for (let i = 0; i < doc.lineCount; i++) {
            const raw = doc.lineAt(i).text;
            // 处理反引号进入/退出
            for (let k = 0; k < raw.length; k++) if (raw[k] === '`') inBacktick = !inBacktick;
            if (inBacktick) continue; // 字符串内部不分析

            const line = raw.trim();
            if (!inLevelInfo) {
                if (/^\[level info\]/i.test(line)) {
                    inLevelInfo = true;
                    expectedCols = null;
                    seenFirstValueLine = false;
                    packedDone = false;
                }
                continue;
            } else {
                if (/^\[\/level info\]/i.test(line)) {
                    // 结束
                    inLevelInfo = false;
                    expectedCols = null;
                    continue;
                }
                if (line === '' || line.startsWith('//')) continue;
                if (packedDone) continue; // 打包模式后续行忽略结构检查
                // 第一条有效数据行：期望是一个整数（列数）或“打包模式”列数+所有数据
                if (!seenFirstValueLine) {
                    const tokens = line.split(/\s+/);
                    const numericTokens = tokens.filter(t => /^[+-]?\d+(?:\.\d+)?$/.test(t));
                    if (numericTokens.length === 0) {
                        diags.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, raw.length), '[level info] 第一行必须以正整数列数开头', vscode.DiagnosticSeverity.Warning));
                        seenFirstValueLine = true; // 防止重复报
                        continue;
                    }
                    const col = parseInt(numericTokens[0], 10);
                    if (!isFinite(col) || col <= 0) {
                        diags.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, raw.length), '[level info] 列数必须是正整数', vscode.DiagnosticSeverity.Warning));
                        seenFirstValueLine = true;
                        continue;
                    }
                    expectedCols = col;
                    // 判断是否为打包：同一行后面还跟了数据且数量可以整除列数
                    const packedValues = numericTokens.slice(1);
                    if (packedValues.length > 0) {
                        if (packedValues.length % col !== 0) {
                            diags.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, raw.length), `打包数据列数不整除：列数 ${col}，实际附加数值 ${packedValues.length}` , vscode.DiagnosticSeverity.Warning));
                        } else {
                            // 打包模式认为合法，不再对后续行做列数校验
                            packedDone = true;
                        }
                    }
                    seenFirstValueLine = true;
                    continue;
                }
                // 非打包模式下的后续数据行：应当有 expectedCols 个数值
                if (expectedCols && expectedCols > 0) {
                    const commentIdx = raw.indexOf('//');
                    const dataSlice = (commentIdx >= 0 ? raw.slice(0, commentIdx) : raw).trim();
                    if (dataSlice === '') continue;
                    const tokens = dataSlice.split(/\s+/);
                    const numericTokens = tokens.filter(t => /^[+-]?\d+(?:\.\d+)?$/.test(t));
                    if (numericTokens.length === 0) {
                        diags.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, raw.length), '期望数值行，但未检测到任何数值', vscode.DiagnosticSeverity.Warning));
                        continue;
                    }
                    if (numericTokens.length !== expectedCols) {
                        diags.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, raw.length), `列数不匹配：期望 ${expectedCols} 个，实际 ${numericTokens.length} 个`, vscode.DiagnosticSeverity.Warning));
                    }
                    if (numericTokens.length !== tokens.length) {
                        diags.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, raw.length), '存在非数值 token，将被忽略', vscode.DiagnosticSeverity.Information));
                    }
                }
            }
        }
        coll.set(doc.uri, diags);
    }

    const debounce = new Map<string, NodeJS.Timeout>();
    function schedule(doc: vscode.TextDocument) {
        if (doc.languageId !== LANG_ID) return;
        const key = doc.uri.toString();
        clearTimeout(debounce.get(key));
        debounce.set(key, setTimeout(() => lint(doc), 250));
    }

    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(lint));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => schedule(e.document)));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => coll.delete(doc.uri)));
    for (const d of vscode.workspace.textDocuments) lint(d);
}
