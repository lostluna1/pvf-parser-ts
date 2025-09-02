import * as vscode from 'vscode';
import { PvfModel, PvfFileEntry } from './pvf/model';
import { PvfProvider } from './pvf/provider';
import { registerPathLinkProvider } from './pvf/pathLinkProvider';
import { registerPvfDecorations } from './pvf/decorations';
import { registerAllCommands } from './commander/index.js';

export function activate(context: vscode.ExtensionContext) {
    const model = new PvfModel();
    const output = vscode.window.createOutputChannel('PVF');
    const tree = new PvfProvider(model, output);
    const deco = registerPvfDecorations(context, model);

    vscode.window.registerTreeDataProvider('pvfExplorerView', tree);
    // register document link provider for .lst/.nut and other path-like tokens
    registerPathLinkProvider(context, model);

    // Register all commands from commander modules
    registerAllCommands(context, { model, tree, deco: deco as any, output });

    context.subscriptions.push(
        // Provide editable virtual FS for pvf: scheme
        vscode.workspace.registerFileSystemProvider('pvf', new (class implements vscode.FileSystemProvider {
            private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
            onDidChangeFile = this._emitter.event;
            watch(): vscode.Disposable { return new vscode.Disposable(() => { }); }
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
                deco.refreshUris([uri]);
            }
            delete(): void { /* implement if needed */ }
            rename(): void { /* implement if needed */ }
        })(), { isCaseSensitive: true, isReadonly: false }),
    );
}

export function deactivate() { }
 
