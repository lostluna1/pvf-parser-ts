import * as vscode from 'vscode';

export function registerStrLanguage(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection('pvf-str');
  context.subscriptions.push(collection);

  function refresh(doc: vscode.TextDocument) {
    if (doc.languageId !== 'pvf-str') return;
    const diags: vscode.Diagnostic[] = [];
    const lines = doc.getText().split(/\r?\n/);
    const keySet = new Map<string, number>();
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw) continue; // 空行
  if (raw.startsWith('#') || raw.startsWith('//')) continue; // 注释 (# 或 //)
      const gt = raw.indexOf('>');
      if (gt === -1) {
        diags.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, raw.length), '缺少 > 分隔符 (key>value)', vscode.DiagnosticSeverity.Warning));
        continue;
      }
      const key = raw.substring(0, gt).trim();
      const value = raw.substring(gt + 1);
      if (!key) {
        diags.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, gt), '空的 key', vscode.DiagnosticSeverity.Warning));
      }
      if (value.length === 0) {
        diags.push(new vscode.Diagnostic(new vscode.Range(i, gt + 1, i, gt + 1), '缺少值内容', vscode.DiagnosticSeverity.Hint));
      }
      if (keySet.has(key)) {
        diags.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, gt), `重复 key，之前在第 ${keySet.get(key)! + 1} 行`, vscode.DiagnosticSeverity.Information));
      } else if (key) {
        keySet.set(key, i);
      }
    }
    collection.set(doc.uri, diags);
  }

  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refresh));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => refresh(e.document)));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => collection.delete(doc.uri)));
  for (const d of vscode.workspace.textDocuments) refresh(d);
}
