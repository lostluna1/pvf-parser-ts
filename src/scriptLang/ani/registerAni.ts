import * as vscode from 'vscode';
import { loadTags, provideSharedTagFeatures, iterateBracketTags } from '../tagRegistry.js';

// 动态 FRAME 标签：根据 [FRAME MAX] 的数值 (N) 允许 FRAME000..FRAME{N-1}
function computeFrameMax(doc: vscode.TextDocument): number | null {
  for (let i = 0; i < Math.min(doc.lineCount, 200); i++) {
    const text = doc.lineAt(i).text.trim();
    if (/^\[FRAME MAX\]/i.test(text)) {
      // 下一非空行尝试解析整数
      for (let j = i + 1; j < Math.min(doc.lineCount, i + 10); j++) {
        const v = doc.lineAt(j).text.trim();
        if (!v) continue;
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= 0 && n < 10000) return n;
        return null;
      }
    }
  }
  return null;
}

export function registerAniLanguage(context: vscode.ExtensionContext) {
  provideSharedTagFeatures(context, 'pvf-ani', 'ani');

  // 额外补全：FRAME*** 动态帧
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider('pvf-ani', {
    async provideCompletionItems(doc, pos) {
      const linePrefix = doc.lineAt(pos.line).text.slice(0, pos.character);
      if (!/\[[^\]]*$/.test(linePrefix)) return; // 仍在 tag 里
      const frameMax = computeFrameMax(doc);
      if (frameMax === null) return;
      const items: vscode.CompletionItem[] = [];
      const pad = (i: number) => i.toString().padStart(3, '0');
      const limit = Math.min(frameMax, 5000); // 安全上限
      for (let i = 0; i < limit; i++) {
        const name = `FRAME${pad(i)}`;
        const ci = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
        ci.detail = '动态帧标签';
        ci.insertText = name + ']';
        items.push(ci);
      }
      return items;
    }
  }, '[', '/'));

  // 追加诊断：
  // 1) 检查出现的 FRAME*** 是否 <= FRAME MAX-1
  // 2) 根据 FRAME MAX 诊断是否有缺失帧 / 重复帧
  // 3) 忽略动态 FRAME*** 标签的“未知标签”告警（在 tagRegistry 的未知标签逻辑之前补上集合）
  const diag = vscode.languages.createDiagnosticCollection('pvf-ani-frame');
  context.subscriptions.push(diag);
  async function lint(doc: vscode.TextDocument) {
    if (doc.languageId !== 'pvf-ani') return;
    const frameMax = computeFrameMax(doc);
    const diags: vscode.Diagnostic[] = [];
    const seenFrames: number[] = [];
    if (frameMax !== null) {
      for (let lineNum = 0; lineNum < doc.lineCount; lineNum++) {
        const text = doc.lineAt(lineNum).text;
        for (const t of iterateBracketTags(text)) {
          if (t.isClose) continue;
          const m = /^FRAME(\d{3,})$/i.exec(t.rawName.trim());
          if (m) {
            const idx = parseInt(m[1], 10);
            if (isNaN(idx) || idx >= frameMax) {
              diags.push(new vscode.Diagnostic(
                new vscode.Range(lineNum, t.matchStart, lineNum, t.matchEnd),
                `帧索引 ${idx} 超出范围 (应 < ${frameMax})`,
                vscode.DiagnosticSeverity.Warning
              ));
            } else {
              seenFrames.push(idx);
            }
          }
        }
      }
      // 缺失/重复检测
      const present = new Set(seenFrames);
      for (let i=0;i<frameMax;i++) {
        if (!present.has(i)) {
          diags.push(new vscode.Diagnostic(new vscode.Range(0,0,0,1), `缺少帧 FRAME${String(i).padStart(3,'0')} (FRAME MAX=${frameMax})`, vscode.DiagnosticSeverity.Warning));
        }
      }
      const dupCount = new Map<number, number>();
      for (const f of seenFrames) dupCount.set(f, (dupCount.get(f)||0)+1);
      for (const [f,c] of dupCount.entries()) if (c>1) {
        diags.push(new vscode.Diagnostic(new vscode.Range(0,0,0,1), `帧 FRAME${String(f).padStart(3,'0')} 出现 ${c} 次`, vscode.DiagnosticSeverity.Warning));
      }
    }
    diag.set(doc.uri, diags);
  }
  const debouncers = new Map<string, NodeJS.Timeout>();
  function schedule(doc: vscode.TextDocument) {
    if (doc.languageId !== 'pvf-ani') return;
    const key = doc.uri.toString();
    clearTimeout(debouncers.get(key));
    debouncers.set(key, setTimeout(() => void lint(doc), 250));
  }
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(lint));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => schedule(e.document)));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => diag.delete(doc.uri)));
  for (const d of vscode.workspace.textDocuments) void lint(d);
}
