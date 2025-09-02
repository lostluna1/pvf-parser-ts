import * as vscode from 'vscode';
import { PvfModel, PvfFileEntry } from './pvf/model';
import { PvfProvider } from './pvf/provider';
import { registerListLinkProvider } from './pvf/listLinkProvider';
import { registerPvfDecorations } from './pvf/decorations';

export function activate(context: vscode.ExtensionContext) {
    const model = new PvfModel();
    const output = vscode.window.createOutputChannel('PVF');
    const tree = new PvfProvider(model, output);
    const deco = registerPvfDecorations(context, model);

    vscode.window.registerTreeDataProvider('pvfExplorerView', tree);
    // register document link provider for .lst files
    registerListLinkProvider(context, model);

    context.subscriptions.push(
        // clipboard/compare storage
        vscode.commands.registerCommand('pvf._setClipboard', (payload: any) => {
            context.workspaceState.update('pvf.clipboard', payload);
        }),
        vscode.commands.registerCommand('pvf._getClipboard', async () => {
            deco.refreshAll();
            return context.workspaceState.get('pvf.clipboard');
        }),

        // Select file for compare
        vscode.commands.registerCommand('pvf.selectForCompare', async (node: PvfFileEntry) => {
            if (!node) return;
            await context.workspaceState.update('pvf.compareSelection', node.key);
            vscode.window.showInformationMessage(`已选择 ${node.name} 用于比较`);
        }),
        vscode.commands.registerCommand('pvf.compareWithSelection', async (node: PvfFileEntry) => {
            if (!node) return;
            const sel = context.workspaceState.get<string>('pvf.compareSelection');
            if (!sel) { vscode.window.showWarningMessage('请先选择一个文件用于比较'); return; }
            // open both as readonly text and use vscode.diff
            const left = vscode.Uri.parse(`pvf:/${sel}`);
            const right = vscode.Uri.parse(`pvf:/${node.key}`);
            vscode.commands.executeCommand('vscode.diff', left, right, `${sel} ↔ ${node.key}`);
        }),

        // Find references (use model.findReferences if implemented, fallback to simple key search)
        vscode.commands.registerCommand('pvf.findReferences', async (node: PvfFileEntry) => {
            if (!node) return;
            const key = node.key;
            try {
                if ((model as any).findReferences) {
                    const refs: string[] = await (model as any).findReferences(key);
                    if (!refs || refs.length === 0) { vscode.window.showInformationMessage('未找到引用'); return; }
                    const pick = await vscode.window.showQuickPick(refs.map(m => ({ label: m })), { canPickMany: false });
                    if (pick) vscode.commands.executeCommand('pvf.openFile', { key: (pick as any).label, name: (pick as any).label, isFile: true });
                    return;
                }
            } catch (e) {
                // ignore and fallback
            }
            // fallback: search for occurrences of the filename in the pack file keys
            const base = key.split('/').pop() || key;
            const matches: string[] = [];
            for (const k of (model as any).getAllKeys ? (model as any).getAllKeys() : Array.from((model as any).fileList?.keys?.() || [])) {
                if (k.indexOf(base) >= 0) matches.push(k);
            }
            if (!matches || matches.length === 0) { vscode.window.showInformationMessage('未找到引用'); return; }
            const pick = await vscode.window.showQuickPick(matches.map((m: string) => ({ label: m })), { canPickMany: false });
            if (pick) vscode.commands.executeCommand('pvf.openFile', { key: (pick as any).label, name: (pick as any).label, isFile: true });
        }),

        // Cut/Copy/Paste
        vscode.commands.registerCommand('pvf.cut', async (node: PvfFileEntry) => {
            if (!node) return;
            await context.workspaceState.update('pvf.clipboard', { op: 'cut', key: node.key });
            vscode.window.showInformationMessage(`已剪切 ${node.name}`);
        }),
        vscode.commands.registerCommand('pvf.copy', async (node: PvfFileEntry) => {
            if (!node) return;
            await context.workspaceState.update('pvf.clipboard', { op: 'copy', key: node.key });
            vscode.window.showInformationMessage(`已复制 ${node.name}`);
        }),
        vscode.commands.registerCommand('pvf.paste', async (node: PvfFileEntry) => {
            if (!node || node.isFile) { vscode.window.showWarningMessage('请选择目标文件夹粘贴'); return; }
            const clip = context.workspaceState.get<any>('pvf.clipboard');
            if (!clip) { vscode.window.showWarningMessage('剪贴板为空'); return; }
            const destBase = node.key;
            const f = model.getFileByKey(clip.key);
            if (!f) { vscode.window.showErrorMessage('源文件不存在'); return; }

            const baseName = clip.key.split('/').pop() || clip.key;
            // build a unique destKey by appending ' (1)', ' (2)', ... before extension on collision
            const makeUnique = (name: string) => {
                const idx = name.lastIndexOf('.');
                const namePart = idx >= 0 ? name.substring(0, idx) : name;
                const extPart = idx >= 0 ? name.substring(idx) : '';
                let candidate = name;
                let n = 1;
                while (model.getFileByKey(`${destBase}/${candidate}`)) {
                    candidate = `${namePart} (${n})${extPart}`;
                    n++;
                }
                return candidate;
            };

            const uniqueName = makeUnique(baseName);
            const destKey = `${destBase}/${uniqueName}`;

            const bytes = await model.loadFileData(f);
            // create and write
            model.createEmptyFile(destKey);
            const pf = model.getFileByKey(destKey);
            if (pf) { pf.writeFileData(bytes); pf.changed = true; }

            if (clip.op === 'cut') {
                model.deleteFile(clip.key);
                await context.workspaceState.update('pvf.clipboard', undefined);
                vscode.window.showInformationMessage('移动完成');
            } else {
                vscode.window.showInformationMessage('粘贴完成');
            }
            tree.refresh();
        }),

        // Copy path
        vscode.commands.registerCommand('pvf.copyPath', async (node: PvfFileEntry) => {
            if (!node) return;
            await vscode.env.clipboard.writeText(node.key);
            vscode.window.showInformationMessage('已复制路径到剪贴板');
        }),

        vscode.commands.registerCommand('pvf.openPack', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'PVF': ['pvf'] }
            });
            if (!uris || uris.length === 0) { return; }
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '打开 PVF…' }, async (p) => {
                const t0 = Date.now();
                output.appendLine(`[PVF] open start: ${uris[0].fsPath}`);
                await model.open(uris[0].fsPath, (n: number) => { p.report({ increment: 0, message: `${n}%` }); });
                const ms = Date.now() - t0;
                output.appendLine(`[PVF] open done in ${ms}ms (parsed header+tree only)`);
            });
            tree.refresh();
            deco.refreshAll();
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
                    try {
                        // Re-open saved PVF to refresh offsets and baseOffset to match on-disk layout
                        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '重新加载 PVF…' }, async (pp) => {
                            await model.open(dest.fsPath, (n: number) => { pp.report({ increment: 0, message: `${n}%` }); });
                        });
                        tree.refresh();
                        deco.refreshAll();
                    } catch (e) {
                        // ignore reopen failures but notify
                        vscode.window.showWarningMessage('保存成功，但重新加载封包失败');
                    }
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
                if (ok) {
                    vscode.window.showInformationMessage('已保存到当前文件');
                    try {
                        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '重新加载 PVF…' }, async (pp) => {
                            await model.open(model.pvfPath, (n: number) => { pp.report({ increment: 0, message: `${n}%` }); });
                        });
                        tree.refresh();
                        deco.refreshAll();
                    } catch {
                        vscode.window.showWarningMessage('保存成功，但重新加载封包失败');
                    }
                } else {
                    vscode.window.showErrorMessage('保存失败');
                }
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
            deco.refreshUris([vscode.Uri.parse(`pvf:/${node.key}`)]);
        }),

        vscode.commands.registerCommand('pvf.deleteFile', async (node: PvfFileEntry) => {
            if (!node || !node.isFile) return;
            model.deleteFile(node.key);
            tree.refresh();
            deco.refreshAll();
        }),

        vscode.commands.registerCommand('pvf.createFolder', async (node: PvfFileEntry) => {
            // node is folder
            const base = node && !node.isFile ? node.key : '';
            const name = await vscode.window.showInputBox({ prompt: '输入新文件夹名称', placeHolder: '例如: new_folder' });
            if (!name) return;
            model.createFolder(base ? `${base}/${name}` : name);
            tree.refresh();
            deco.refreshAll();
        }),

        vscode.commands.registerCommand('pvf.deleteFolder', async (node: PvfFileEntry) => {
            if (!node || node.isFile) return;
            const ok = await vscode.window.showWarningMessage(`确定删除文件夹 ${node.name} 及其所有子项吗？`, { modal: true }, '删除');
            if (ok !== '删除') return;
            model.deleteFolder(node.key);
            tree.refresh();
            deco.refreshAll();
        }),

        vscode.commands.registerCommand('pvf.createFile', async (node: PvfFileEntry) => {
            const base = node && !node.isFile ? node.key : '';
            const name = await vscode.window.showInputBox({ prompt: '输入新文件名（含扩展名）', placeHolder: '例如: readme.txt' });
            if (!name) return;
            const key = base ? `${base}/${name}` : name;
            // create empty file
            model.createEmptyFile(key);
            tree.refresh();
            deco.refreshUris([vscode.Uri.parse(`pvf:/${key}`)]);
        }),

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

        vscode.commands.registerCommand('pvf.openFile', async (nodeArg: any) => {
            try {
                // normalize argument: may be PvfFileEntry, array-wrapped, or simple object
                let node = nodeArg;
                if (Array.isArray(nodeArg) && nodeArg.length > 0) node = nodeArg[0];
                // if command was invoked with a wrapped JSON string, try parse
                if (typeof node === 'string') {
                    try { node = JSON.parse(node); } catch { /* ignore */ }
                }
                output.appendLine(`[PVF] openFile invoked arg=${JSON.stringify(node)}`);
                if (!node || !node.key) {
                    output.appendLine('[PVF] openFile: missing node or key');
                    return;
                }
                const key = String(node.key).replace(/^\/+/, '');
                const f = model.getFileByKey(key);
                output.appendLine(`[PVF] openFile: key=${key} fileExists=${!!f}`);
                if (!f) {
                    vscode.window.showErrorMessage(`文件未在封包中找到: ${key}`);
                    return;
                }

                // First attempt: open the virtual pvf: URI so DocumentLinkProvider and editor features apply
                const uri = vscode.Uri.parse(`pvf:/${key}`);
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    output.appendLine(`[PVF] openFile: opened pvf: doc length=${doc.getText().length}`);
                    await vscode.window.showTextDocument(doc, { preview: false });
                    // if the document appears empty, fallback to model-provided decoding/decompile
                    if (!doc.getText() || doc.getText().length === 0) {
                        output.appendLine(`[PVF] openFile: pvf: doc empty for ${key}, falling back to model.getTextViewAsync`);
                        try {
                            const text = await model.getTextViewAsync(key);
                            if (text && text.length > 0) {
                                const doc2 = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
                                await vscode.window.showTextDocument(doc2, { preview: false });
                            } else {
                                output.appendLine(`[PVF] openFile: model.getTextViewAsync returned empty for ${key}`);
                                vscode.window.showWarningMessage('打开的文件内容为空');
                            }
                        } catch (e) {
                            output.appendLine(`[PVF] openFile: getTextViewAsync failed for ${key}: ${String(e)}`);
                            vscode.window.showErrorMessage('打开文件失败');
                        }
                    }
                    return;
                } catch (e) {
                    output.appendLine(`[PVF] openFile: opening pvf:/${key} failed: ${String(e)}`);
                }

                // Fallback: use model-provided bytes (handles decompile/encoding) and open as a text document
                try {
                    const bytes = await (model as any).readFileBytes(key);
                    if (bytes && bytes.length > 0) {
                        const text = Buffer.from(bytes).toString('utf8');
                        const doc = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
                        await vscode.window.showTextDocument(doc, { preview: false });
                        return;
                    } else {
                        output.appendLine(`[PVF] openFile: model.readFileBytes returned empty for ${key}`);
                    }
                } catch (e) {
                    output.appendLine(`[PVF] openFile: readFileBytes failed for ${key}: ${String(e)}`);
                }

                // Last resort: notify
                vscode.window.showWarningMessage('打开的文件内容为空或无法读取');
            } catch (ex) {
                output.appendLine(`[PVF] openFile exception: ${String(ex)}`);
            }
        }),

        vscode.commands.registerCommand('pvf.openFuzzyPath', async (arg: any) => {
            try {
                let filePath: string | undefined;
                let baseDir: string = '';
                if (Array.isArray(arg) && arg.length >= 1) {
                    filePath = arg[0];
                    if (arg.length >= 2) baseDir = arg[1] || '';
                } else if (typeof arg === 'string') {
                    // could be JSON-encoded
                    try { const p = JSON.parse(arg); if (Array.isArray(p)) { filePath = p[0]; baseDir = p[1] || ''; } else filePath = arg; } catch { filePath = arg; }
                } else if (arg && typeof arg === 'object') {
                    filePath = arg[0] || arg.filePath || arg;
                }
                if (!filePath) return;
                // helper: normalize relative segments against a base directory (like ../ or ./)
                const joinAndNormalize = (baseDirLocal: string, rel: string) => {
                    const relParts = String(rel).replace(/^\/+/, '').split('/');
                    const baseParts = baseDirLocal ? baseDirLocal.split('/').filter(p => p.length > 0) : [];
                    const out: string[] = [...baseParts];
                    for (const part of relParts) {
                        if (part === '..') {
                            if (out.length > 0) out.pop();
                        } else if (part === '.' || part === '') {
                            // skip
                        } else {
                            out.push(part);
                        }
                    }
                    return out.join('/');
                };

                let needle = String(filePath).replace(/^\/+/, '').toLowerCase();
                // if path contains relative parts, normalize against baseDir
                if (needle.startsWith('.') || needle.indexOf('..') >= 0) {
                    const normalized = joinAndNormalize(baseDir || '', filePath);
                    if (normalized && normalized.length > 0) needle = normalized.toLowerCase();
                }
                const base = (baseDir || '').toLowerCase();
                // search order: exact, baseDir + needle, endsWith('/' + needle), contains
                const keys: string[] = (model as any).getAllKeys ? (model as any).getAllKeys() : Array.from((model as any).fileList?.keys?.() || []);
                let found: string | undefined;
                const exact = keys.find((k: string) => k.toLowerCase() === needle);
                if (exact) found = exact;
                if (!found && base) {
                    const cand = `${base}/${needle}`;
                    const f2 = keys.find((k: string) => k.toLowerCase() === cand);
                    if (f2) found = f2;
                }
                if (!found) {
                    const f3 = keys.find((k: string) => k.toLowerCase().endsWith('/' + needle) || k.toLowerCase().endsWith(needle));
                    if (f3) found = f3;
                }
                if (!found) {
                    const f4 = keys.find((k: string) => k.toLowerCase().indexOf(needle) >= 0);
                    if (f4) found = f4;
                }
                if (!found) {
                    vscode.window.showWarningMessage(`未在封包中找到: ${filePath}`);
                    return;
                }
                // ignore .img
                if (found.toLowerCase().endsWith('.img')) { vscode.window.showWarningMessage('目标为图片文件，跳转被忽略'); return; }
                // reuse pvf.openFile by constructing entry
                const entry = { key: found, name: found.split('/').pop() || found, isFile: true };
                await vscode.commands.executeCommand('pvf.openFile', entry);
            } catch (e) {
                output.appendLine(`[PVF] openFuzzyPath error: ${String(e)}`);
            }
        }),

    );
}

export function deactivate() { }
