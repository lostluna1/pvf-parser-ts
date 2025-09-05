import * as vscode from 'vscode';
import { PvfModel, PvfFileEntry } from './model';
import { getIconForFile } from './fileIcons';
import * as path from 'path';

export class PvfProvider implements vscode.TreeDataProvider<PvfFileEntry> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PvfFileEntry | undefined | void>();
  onDidChangeTreeData = this._onDidChangeTreeData.event;

  // 监听展开事件以进行懒解析
  private disposables: vscode.Disposable[] = [];
  private _metadataRequested = new Set<string>();

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
      // 如果 metadata 生成了专属 icon (IMG 指定帧)，优先使用
      try {
        const store: Map<string, any> | undefined = (this.model as any)._fileIconMeta;
        const rec = store ? store.get(element.key) : undefined;
        if (rec && rec.pngPath) {
          const pngUri = vscode.Uri.file(rec.pngPath);
          item.iconPath = { light: pngUri, dark: pngUri };
        }
      } catch { /* ignore */ }
      // 附加显示：脚本显示名 + <代码>
      const cfg = vscode.workspace.getConfiguration();
      const showName = cfg.get<boolean>('pvf.showScriptDisplayName', true);
      const showCode = cfg.get<boolean>('pvf.showScriptCode', true);
      if (showName || showCode) {
        const code = (this.model as any).getCodeForFile ? (this.model as any).getCodeForFile(element.key) : -1;
        const disp = (this.model as any).getDisplayNameForFile ? (this.model as any).getDisplayNameForFile(element.key) : undefined;
        let parts: string[] = [];
        if (showName && disp) parts.push(disp);
        if (showCode && code !== -1) parts.push(`<${code}>`);
        if (parts.length) item.description = parts.join(' ');
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
    // 懒解析：对本层的文件 keys 执行一次 metadata 解析（异步，不阻塞首次显示）
    if (result.length) {
      const fileKeys = result.filter(r=>r.isFile).map(r=>r.key).filter(k=>!this._metadataRequested.has(k));
      if (fileKeys.length) {
        fileKeys.forEach(k=>this._metadataRequested.add(k));
        this.model.ensureMetadataForFiles(fileKeys).then(()=>{
          this._onDidChangeTreeData.fire();
        }).catch(()=>{});
      }
    }
    return Promise.resolve(result);
  }
}
