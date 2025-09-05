import * as vscode from 'vscode';
import { PvfModel, PvfFileEntry } from './pvf/model';
import { parseMetadataForKeys } from './pvf/metadata';
import { PvfProvider } from './pvf/provider';
import { registerPathLinkProvider } from './pvf/pathLinkProvider';
import { registerPvfDecorations } from './pvf/decorations';
import { registerAllCommands } from './commander/index.js';
import * as indexer from './npk/indexer';
import * as fs from 'fs/promises';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const model = new PvfModel();
    // 供 metadata.ts 生成图标时访问上下文 (globalStorage)
    (model as any)._extCtx = context;
    const output = vscode.window.createOutputChannel('PVF');
    const tree = new PvfProvider(model, output);
    const deco = registerPvfDecorations(context, model);
    // 图标逻辑：在 provider 中通过 vscode.extensions.getExtension 查找当前扩展根路径，从 media/icons 读取 png
    // 若需要在运行时修改映射，可暴露命令以动态刷新（后续可扩展）

    vscode.window.registerTreeDataProvider('pvfExplorerView', tree);
    // register document link provider for .lst/.nut and other path-like tokens
    registerPathLinkProvider(context, model);

    // Register all commands from commander modules
    registerAllCommands(context, { model, tree, deco: deco as any, output });

    indexer.loadIndexFromDisk(context).then((m) => {
        // determine whether to build index on activate
        const cfg = vscode.workspace.getConfiguration();
        const root = (cfg.get<string>('pvf.npkRoot') || '').trim();
        // 默认在激活时自动重建索引，若不希望这样可在设置中将 pvf.autoReindexOnActivate 设为 false
        const autoReindex = cfg.get<boolean>('pvf.autoReindexOnActivate', true);
        const needBuild = !!root && (autoReindex || !m || (m instanceof Map && m.size === 0));
        if (needBuild && root) {
            void vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在构建 NPK 索引…' }, async (p) => {
                let lastReport = 0;
                const map = await indexer.buildIndex(context, [root], (done, total, file) => {
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                    // throttle updates
                    if (pct !== lastReport) {
                        const delta = pct - lastReport;
                        lastReport = pct;
                        p.report({ increment: delta, message: `${done}/${total} ${file ? file.split(/[\\/]/).pop() : ''}` });
                    }
                });
                return map;
            });
        }
    });

    // register command to rebuild index explicitly
    context.subscriptions.push(vscode.commands.registerCommand('pvf.rebuildNpkIndex', async () => {
        const cfg = vscode.workspace.getConfiguration();
        const root = (cfg.get<string>('pvf.npkRoot') || '').trim();
        if (!root) {
            vscode.window.showWarningMessage('请先在设置 pvf.npkRoot 指定 ImagePacks 根目录');
            return;
        }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在重建 NPK 索引…' }, async (p) => {
            let lastReport = 0;
            const m = await indexer.buildIndex(context, [root], (done, total, file) => {
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                if (pct !== lastReport) {
                    const delta = pct - lastReport;
                    lastReport = pct;
                    p.report({ increment: delta, message: `${done}/${total} ${file ? file.split(/[\\/]/).pop() : ''}` });
                }
            });
            p.report({ increment: 100, message: `已索引 ${m.size} 项` });
        });
        vscode.window.showInformationMessage('NPK 索引已重建');
    }));

    // diagnostic command: show index status and storage path
    context.subscriptions.push(vscode.commands.registerCommand('pvf.showNpkIndexStatus', async () => {
        const storagePath = context.globalStorageUri.fsPath;
        const indexFile = path.join(storagePath, 'npk-index.json');
        let exists = false;
        try { await fs.stat(indexFile); exists = true; } catch { exists = false; }
        let idx = indexer.getIndex();
        if (!idx) {
            try { idx = await indexer.loadIndexFromDisk(context); } catch { idx = null; }
        }
        const entries = idx ? idx.size : 0;
        const msg = `globalStorage: ${storagePath}\nindex file: ${indexFile}\nfile exists: ${exists}\nin-memory entries: ${entries}`;
        vscode.window.showInformationMessage('已在输出面板写入索引信息');
        const out = vscode.window.createOutputChannel('PVF');
        out.show(true);
        out.appendLine(msg);
    }));


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
                // 异步重新解析 [name]/[icon]，以及 .lst 代码映射
                (async () => {
                    try {
                        await parseMetadataForKeys(model, [key]);
                    } catch {}
                    try {
                        if (key.toLowerCase().endsWith('.lst')) {
                            // 重建 lst 索引（私有方法反射调用）
                            const anyModel: any = model as any;
                            if (typeof anyModel.buildListFileIndices === 'function') {
                                await anyModel.buildListFileIndices();
                            }
                        }
                    } catch {}
                    // 刷新树以更新描述和动态图标
                    try { tree.refresh(); } catch {}
                })();
            }
            delete(): void { /* implement if needed */ }
            rename(): void { /* implement if needed */ }
        })(), { isCaseSensitive: true, isReadonly: false }),
    );
}

export function deactivate() { }

