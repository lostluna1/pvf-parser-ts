import * as vscode from 'vscode';
import { PvfModel, PvfFileEntry } from './pvf/model';
import { PvfProvider } from './pvf/provider';

export function activate(context: vscode.ExtensionContext) {
    const model = new PvfModel();
    const output = vscode.window.createOutputChannel('PVF');
    const tree = new PvfProvider(model, output);

    vscode.window.registerTreeDataProvider('pvfExplorerView', tree);

    context.subscriptions.push(
            vscode.commands.registerCommand('pvf.openPack', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'PVF': ['pvf'] }
            });
            if (!uris || uris.length === 0) { return; }
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '打开 PVF…' }, async (p)=>{
                    const t0 = Date.now();
                    output.appendLine(`[PVF] open start: ${uris[0].fsPath}`);
                    await model.open(uris[0].fsPath, (n: number)=> { p.report({ increment: 0, message: `${n}%` }); });
                    const ms = Date.now() - t0;
                    output.appendLine(`[PVF] open done in ${ms}ms (parsed header+tree only)`);
                });
                tree.refresh();
        }),

        vscode.commands.registerCommand('pvf.savePack', async () => {
            const dest = await vscode.window.showSaveDialog({ filters: { 'PVF': ['pvf'] } });
            if (!dest) { return; }
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '保存 PVF…' }, async (p) => {
                let last = 0;
                const ok = await model.save(dest.fsPath, (n: number) => {
                    const inc = Math.max(0, Math.min(100, n) - last);
                    last = Math.max(last, Math.min(100, n));
                    p.report({ increment: inc, message: `${last}%` });
                });
                if (ok) {
                    vscode.window.showInformationMessage('另存为成功');
                    (model as any).pvfPath = dest.fsPath;
                } else {
                    vscode.window.showErrorMessage('保存失败');
                }
            });
        }),

        vscode.commands.registerCommand('pvf.savePackInPlace', async () => {
            if (!model.pvfPath) {
                vscode.window.showWarningMessage('尚未打开任何 PVF 文件');
                return;
            }
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '保存 PVF…' }, async (p) => {
                let last = 0;
                const ok = await model.save(model.pvfPath, (n: number) => {
                    const inc = Math.max(0, Math.min(100, n) - last);
                    last = Math.max(last, Math.min(100, n));
                    p.report({ increment: inc, message: `${last}%` });
                });
                vscode.window.showInformationMessage(ok ? '已保存到当前文件' : '保存失败');
            });
        }),

        vscode.commands.registerCommand('pvf.exportFile', async (node: PvfFileEntry) => {
            if (!node || !node.isFile) return;
            const dest = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(node.name) });
            if (!dest) return;
            await model.exportFile(node.key, dest.fsPath);
            vscode.window.showInformationMessage('导出完成');
        }),

        vscode.commands.registerCommand('pvf.replaceFile', async (node: PvfFileEntry) => {
            if (!node || !node.isFile) return;
            const src = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false });
            if (!src || src.length === 0) return;
            const res = await model.replaceFile(node.key, src[0].fsPath);
            if (!res.success) {
                vscode.window.showErrorMessage('替换失败');
            }
            tree.refresh();
        }),

        vscode.commands.registerCommand('pvf.deleteFile', async (node: PvfFileEntry) => {
            if (!node || !node.isFile) return;
            model.deleteFile(node.key);
            tree.refresh();
        }),

                // Provide editable virtual FS for pvf: scheme
                    vscode.workspace.registerFileSystemProvider('pvf', new (class implements vscode.FileSystemProvider {
                    private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
                    onDidChangeFile = this._emitter.event;
                    watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }
                        stat(uri: vscode.Uri): vscode.FileStat {
                            const key = uri.path.replace(/^\//, '');
                            return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: model.getTextSize(key) };
                        }
                    readDirectory(): [string, vscode.FileType][] { return []; }
                    createDirectory(): void { /* no-op */ }
                    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
                        const key = uri.path.replace(/^\//, '');
                        return await model.readFileBytes(key);
                    }
                    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
                        const key = uri.path.replace(/^\//, '');
                        model.updateFileData(key, content);
                        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
                    }
                    delete(): void { /* implement if needed */ }
                    rename(): void { /* implement if needed */ }
                })(), { isCaseSensitive: true, isReadonly: false }),

        vscode.commands.registerCommand('pvf.openFile', async (node: PvfFileEntry) => {
            if (!node.isFile) return;
            const uri = vscode.Uri.parse(`pvf:/${node.key}`);
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, { preview: false });
            } catch (e) {
                // Fallback: 通过模型的编码检测获取可读文本，避免乱码
                try {
                    const text = await model.getTextViewAsync(node.key);
                    const doc = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
                    await vscode.window.showTextDocument(doc, { preview: false });
                } catch (e2) {
                    vscode.window.showErrorMessage('无法打开文件为文本');
                }
            }
        })
    );
}

export function deactivate() { }
