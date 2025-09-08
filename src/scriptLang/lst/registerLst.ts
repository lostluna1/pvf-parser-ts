import * as vscode from 'vscode';

export function registerLstLanguage(context: vscode.ExtensionContext) {
  // 诊断集合
  const collection = vscode.languages.createDiagnosticCollection('pvf-lst');
  context.subscriptions.push(collection);

  async function refresh(doc: vscode.TextDocument) {
    if (doc.languageId !== 'pvf-lst') return;
    const diags: vscode.Diagnostic[] = [];
    const text = doc.getText();
    const lines = text.split(/\r?\n/);
    // 行0: 可选 #PVF_File
    if (lines.length && lines[0].trim().length > 0 && lines[0].trim() !== '#PVF_File' && !lines[0].startsWith('#')) {
      diags.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, lines[0].length), '首行建议使用 #PVF_File 作为文件头', vscode.DiagnosticSeverity.Hint));
    }
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw) continue; // 空行允许
      if (raw.startsWith('#')) continue; // 注释
      if (i === 0 && raw.trim() === '#PVF_File') continue;
      const tab = raw.indexOf('\t');
      if (tab === -1) {
        diags.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, raw.length), '缺少制表符分隔的 key\tvalue', vscode.DiagnosticSeverity.Warning));
        continue;
      }
      const key = raw.substring(0, tab).trim();
      const value = raw.substring(tab + 1);
      if (!key) {
        diags.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, tab), '空的 key', vscode.DiagnosticSeverity.Warning));
      } else if (!/^\d+$/.test(key)) {
        diags.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, tab), 'key 期望为数字', vscode.DiagnosticSeverity.Information));
      }
      if (value.length === 0) {
        diags.push(new vscode.Diagnostic(new vscode.Range(i, tab + 1, i, tab + 1), '缺少值内容', vscode.DiagnosticSeverity.Hint));
      }
    }
    collection.set(doc.uri, diags);
  }

  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refresh));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => refresh(e.document)));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => collection.delete(doc.uri)));

  // 初始运行打开的文档
  for (const doc of vscode.workspace.textDocuments) { void refresh(doc); }
}
