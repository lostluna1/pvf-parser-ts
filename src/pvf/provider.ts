import * as vscode from 'vscode';
import { PvfModel, PvfFileEntry } from './model';

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
