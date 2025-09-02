import * as vscode from 'vscode';
import { PvfModel } from './model';

/**
 * 注册 PVF 资源的装饰：
 * - 文件被修改时着色（沿用 git 的 modified 颜色），并向父级目录传播。
 * - 通过 refreshAll()/refreshUris() 主动触发刷新。
 */
export function registerPvfDecorations(context: vscode.ExtensionContext, model: PvfModel) {
  class PvfDecorationProvider implements vscode.FileDecorationProvider {
    private readonly _emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    onDidChangeFileDecorations = this._emitter.event;

    /** 主动刷新所有装饰 */
    refreshAll() { this._emitter.fire(undefined); }
    /** 按 URI 刷新 */
    refreshUris(uris: vscode.Uri[]) { this._emitter.fire(uris); }

    provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
      if (uri.scheme !== 'pvf') return;
      // uri.path starts with '/'
      const rawKey = uri.path.replace(/^\/+/, '');
      // 忽略空 key
      if (!rawKey) return;
      const f = model.getFileByKey(rawKey);
      if (f && f.changed) {
        const deco = new vscode.FileDecoration('M', '已修改（尚未保存到 PVF）', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
        deco.propagate = true; // 着色传播到父级文件夹
        return deco;
      }
      return;
    }
  }

  const provider = new PvfDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(provider));

  return {
    provider,
    refreshAll: () => provider.refreshAll(),
    refreshUris: (uris: vscode.Uri[]) => provider.refreshUris(uris),
  };
}
