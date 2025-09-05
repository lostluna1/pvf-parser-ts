import * as vscode from 'vscode';
import { PvfModel, PvfFileEntry } from './model';
import { getIconForFile } from './fileIcons';
import * as path from 'path';

export class PvfProvider implements vscode.TreeDataProvider<PvfFileEntry> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PvfFileEntry | undefined | void>();
  onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private model: PvfModel, private output?: vscode.OutputChannel) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  reportProgress(n: number) {
    // optionally hook to VS Code progress
  }

  getTreeItem(element: PvfFileEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(element.name,
      element.isFile ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed);
    item.contextValue = element.isFile ? 'pvf.file' : 'pvf.folder';
  const uri = vscode.Uri.parse(`pvf:/${element.key}`);
  // 为文件和文件夹都设置 resourceUri，便于文件装饰向父级传播
  item.resourceUri = uri;
    if (element.isFile) {
      const icon = getIconForFile(element.name);
      if (icon) {
        // 运行时通过扩展上下文相对路径定位；这里暂用全路径会在 activate 中补充 context 传入或使用 asExternalUri
        // 由于 TreeDataProvider 无法直接访问 ExtensionContext，这里借助全局存储 VS Code API 提供的全局变量 (vscode.extensions) 获取当前扩展安装路径。
        try {
          const me = vscode.extensions.getExtension('local.pvf-parser-ts');
          const base = me?.extensionPath;
          if (base) {
            const iconFile = path.join(base, 'media', 'icons', icon);
            const light = vscode.Uri.file(iconFile);
            const dark = light; // 暂不区分主题
            item.iconPath = { light, dark };
          }
        } catch { /* ignore */ }
      }
    }
  if (element.isFile) item.command = { command: 'pvf.openFile', title: '打开', arguments: [element] };
    return item;
  }

  getChildren(element?: PvfFileEntry): Thenable<PvfFileEntry[]> {
    const label = element ? `children:${element.key}` : 'children:<root>';
    const start = Date.now();
    const result = !element ? this.model.getChildren() : (!element.isFile ? this.model.getChildren(element.key) : []);
    const ms = Date.now() - start;
    this.output?.appendLine(`[PVF] get${label} -> ${Array.isArray(result) ? result.length : 0} items in ${ms}ms`);
    return Promise.resolve(result);
  }
}
