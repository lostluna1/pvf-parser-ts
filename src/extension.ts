import * as vscode from 'vscode';
import { PvfModel, PvfFileEntry } from './pvf/model';
import { parseMetadataForKeys } from './pvf/metadata';
import { PvfProvider } from './pvf/provider';
import { registerPathLinkProvider } from './pvf/pathLinkProvider';
import { registerPvfDecorations } from './pvf/decorations';
import { registerAllCommands } from './commander/index.js';
import { registerScriptLanguages } from './scriptLang/index';
import * as indexer from './npk/indexer';
import * as fs from 'fs/promises';
import * as path from 'path';
import { registerSearchInPack } from './pvf/searchQuickOpen';
import { setPvfModel } from './pvf/runtimeModel';
import getPvfContent, { getIconBase64ByCode , getNameByCodeAndLst , parsePvfScriptToJson} from './pvf/services/getPvfContent';
import getIconFrameBase64 from './pvf/services/getIconFrame';
import { registerStringTableCodeLens } from './pvf/services/stringTableCodeLens';

export function activate(context: vscode.ExtensionContext) {
    const model = new PvfModel();
    setPvfModel(model);
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
    // 注册快速搜索（模糊/多关键字）
    registerSearchInPack(context, model);

    // 激活时自动构建（若尚未有索引且配置了根目录）
    (async () => {
        const cfg = vscode.workspace.getConfiguration();
        const root = (cfg.get<string>('pvf.npkRoot') || '').trim();
        const m = await indexer.loadIndexFromDisk(context);
        if ((!m || m.size === 0) && root) {
            void vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在构建 NPK 索引…' }, async (p) => {
                let lastReport = 0;
                const map = await indexer.buildIndex(context, [root], (done, total, file) => {
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                    if (pct !== lastReport) {
                        const delta = pct - lastReport;
                        lastReport = pct;
                        p.report({ increment: delta, message: `${done}/${total} ${file ? file.split(/[\\/]/).pop() : ''}` });
                    }
                });
                p.report({ increment: 100, message: `已索引 ${map.size} 项` });
                return map;
            });
        } else if (!root) {
            vscode.window.showInformationMessage('未设置 NPK 根目录 (pvf.npkRoot)，无法自动构建索引。');
        }
    })();

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

    // 插件设置入口：在视图标题“插件设置”按钮调用，聚焦 pvf.* 设置
    context.subscriptions.push(vscode.commands.registerCommand('pvf.openSettings', async () => {
        try {
            // 使用扩展标识过滤自身设置；支持再附加 pvf. 前缀便于集中显示
            await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local.pvf-parser-ts pvf.');
        } catch {
            try { await vscode.commands.executeCommand('workbench.action.openSettings', 'pvf.'); } catch {}
        }
    }));

    // diagnostic command: show index status and storage path
    context.subscriptions.push(vscode.commands.registerCommand('pvf.showNpkIndexStatus', async () => {
        const storagePath = context.globalStorageUri.fsPath;
        const indexFile = path.join(storagePath, 'npk-index.sqlite');
        let exists = false;
        let size = 0;
        try { const st = await fs.stat(indexFile); exists = true; size = st.size; } catch { exists = false; }
        let idx = indexer.getIndex();
        if (!idx) {
            try { idx = await indexer.loadIndexFromDisk(context); } catch { idx = null; }
        }
        const entries = idx ? idx.size : 0;
        const msg = `globalStorage: ${storagePath}\nindex db: ${indexFile}\nfile exists: ${exists}\nfile size: ${size}\nin-memory entries: ${entries}`;
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
                        // 清除元数据扫描缓存，确保重新解析
                        try { (model as any)._metadataScannedFiles?.delete(key); } catch {}
                        // 清除已生成的图标缓存，下次生成使用新内容
                        try { (model as any)._fileIconMeta?.delete(key); } catch {}
                        // 清除旧显示名（若内容改动删除了 [name]）
                        try { (model as any).fileDisplayNameMap?.delete(key); } catch {}
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

    // 注册脚本语言特性 (.act 等)
    registerScriptLanguages(context, model);

    // 注册 stringtable.bin CodeLens （按需构建字符串引用索引）
    registerStringTableCodeLens(context, model);

    // AIC Editor (APC 预览编辑) 命令
    context.subscriptions.push(vscode.commands.registerCommand('pvf.openAicEditor', async () => {
        const editor = vscode.window.activeTextEditor; if (!editor) { vscode.window.showWarningMessage('没有活动的编辑器'); return; }
        const doc = editor.document;
        if (!/\.aic$/i.test(doc.fileName)) { vscode.window.showWarningMessage('请在一个 .aic 文件中使用该命令'); return; }
        // 显示源文档在第一列
        try { await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: true }); } catch {}
        const panel = vscode.window.createWebviewPanel('pvfAicEditor', `APC: ${doc.fileName.split(/[\\/]/).pop()}`, vscode.ViewColumn.Two, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [context.extensionUri]
        });
        try { panel.reveal(vscode.ViewColumn.Two, false); } catch {}
        const nonce = (() => { let t=''; const s='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for(let i=0;i<32;i++){ t+=s.charAt(Math.floor(Math.random()*s.length)); } return t; })();
        const clientJsUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media','webview','apcEditor.js')).toString();
        const init = { path: doc.fileName, text: doc.getText(), version: String(doc.version) };
        const initJson = JSON.stringify(init).replace(/</g,'\\u003C');
        panel.webview.html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8" />\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource} 'unsafe-inline'; img-src ${panel.webview.cspSource} data:; font-src ${panel.webview.cspSource}; script-src ${panel.webview.cspSource} 'nonce-${nonce}';" />\n<title>APC 编辑器</title>\n<style>html,body,#root{height:100%;margin:0;padding:0;}</style></head><body><div id="root"></div>\n<script nonce="${nonce}">window.__INIT=${initJson};</script>\n<script src="${clientJsUri}" nonce="${nonce}"></script></body></html>`;
        // 文档变更同步
        const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === doc.uri.toString()) {
                panel.webview.postMessage({ type: 'docUpdate', text: e.document.getText() });
            }
        });
        panel.onDidDispose(() => changeSub.dispose());
        // === 通用 RPC Handler 映射（只在此处集中定义，与 UI 逻辑解耦） ===
        const rpcHandlers: Record<string, (...a: any[]) => any | Promise<any>> = {
            async getPvfContent(path: string) { return await getPvfContent(path); },
            async getPvfJson(path: string) { return await parsePvfScriptToJson(path); },
            async getIconFrame(path: string, frameIndex: number) { return await getIconFrameBase64(path, frameIndex); },
            // webview 端调用顺序为 (lstPath, code)
            async getNameByCodeAndLst(lstPath: string, code: number) { return await getNameByCodeAndLst(lstPath, code); },
            async getIconBase64ByCode(lstPath: string, code: number) { return await getIconBase64ByCode(lstPath, code); }
            // 后续新增方法仅需在此添加，无需再扩展 switch / case
        };

        panel.webview.onDidReceiveMessage(async msg => {
            if (!msg || typeof msg !== 'object') return;
            // 兼容旧消息 & 通用 RPC
            if (msg.type === 'requestInit') {
                panel.webview.postMessage({ type: 'init', data: init });
                return;
            }
            if (msg.type === 'applyEdit') {
                if (typeof msg.text === 'string') {
                    const edit = new vscode.WorkspaceEdit();
                    const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
                    edit.replace(doc.uri, fullRange, msg.text);
                    vscode.workspace.applyEdit(edit).then(ok => {
                        if (ok) vscode.window.showInformationMessage('已写回文档'); else vscode.window.showWarningMessage('写回失败');
                    });
                }
                return;
            }
            if (msg.type === 'rpc' && msg.id && typeof msg.method === 'string') {
                const { id, method, params = [] } = msg as { id: string; method: string; params: any[] };
                const fn = rpcHandlers[method];
                if (!fn) {
                    panel.webview.postMessage({ type: 'rpcResult', id, ok: false, error: `No such method: ${method}` });
                    return;
                }
                try {
                    const result = await Promise.resolve(fn(...params));
                    panel.webview.postMessage({ type: 'rpcResult', id, ok: true, result });
                } catch (err: any) {
                    panel.webview.postMessage({ type: 'rpcResult', id, ok: false, error: String(err && err.message || err) });
                }
                return;
            }
        });
    }));

    // 启动时可选择自动关闭被 VS Code session 恢复的 pvf: 虚拟编辑器标签
    try {
        const cfg = vscode.workspace.getConfiguration();
        const autoClose = cfg.get<boolean>('pvf.closeVirtualEditorsOnStartup', true);
        if (autoClose) {
            // 延迟一点点等 VS Code 恢复完成
            setTimeout(async () => {
                try {
                    const editors = vscode.window.visibleTextEditors.filter(e => e.document.uri.scheme === 'pvf');
                    for (const ed of editors) {
                        try { await vscode.window.showTextDocument(ed.document, { preview: true, preserveFocus: true }); } catch {}
                        // 使用内置命令关闭活动编辑器
                        try { await vscode.commands.executeCommand('workbench.action.closeActiveEditor'); } catch {}
                    }
                } catch {}
            }, 800);
        }
    } catch {}

    // 首次激活或尚未提示时，提示用户可调整编码设置
    (async () => {
        const shownKey = 'pvf.encodingHintShown';
        const already = context.globalState.get<boolean>(shownKey, false);
        const cfg = vscode.workspace.getConfiguration();
        const autoShow = cfg.get<boolean>('pvf.encoding.showHintOnStartup', true); // 预留未来可扩展（当前未在 package.json 暴露）
        if (!already && autoShow) {
            const actionOpen = '打开设置';
            const actionNever = '不再提示';
            const pick = await vscode.window.showInformationMessage('如果打开 PVF / 脚本文件出现乱码，可在设置中调整PVF编码格式(TW/CN/KR)。', actionOpen, actionNever);
            if (pick === actionOpen) {
                try { await vscode.commands.executeCommand('workbench.action.openSettings', 'pvf.encodingMode'); } catch {}
            } else if (pick === actionNever) {
                try { await context.globalState.update(shownKey, true); } catch {}
            }
        }
    })();


}

export function deactivate() { }



