import * as vscode from 'vscode';
import { Deps } from './types';

export function registerSetNpkRoot(context: vscode.ExtensionContext, _deps: Deps) {
  context.subscriptions.push(
    vscode.commands.registerCommand('pvf.setNpkRoot', async () => {
      const uri = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false });
      if (!uri || uri.length === 0) return;
      const root = uri[0].fsPath;
      await vscode.workspace.getConfiguration().update('pvf.npkRoot', root, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`已设置 NPK 根目录: ${root}`);
    })
  );
}
