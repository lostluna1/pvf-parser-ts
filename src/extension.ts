import * as vscode from 'vscode';
import { PvfModel, PvfFileEntry } from './pvf/model';
import { PvfProvider } from './pvf/provider';

export function activate(context: vscode.ExtensionContext) {
    const model = new PvfModel();
    const output = vscode.window.createOutputChannel('PVF');
    const tree = new PvfProvider(model, output);

    vscode.window.registerTreeDataProvider('pvfExplorerView', tree);

    context.subscriptions.push(
        // clipboard/compare storage
        vscode.commands.registerCommand('pvf._setClipboard', (payload: any) => {
            context.workspaceState.update('pvf.clipboard', payload);
        }),
        vscode.commands.registerCommand('pvf._getClipboard', async () => {
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
        }),

        vscode.commands.registerCommand('pvf.deleteFile', async (node: PvfFileEntry) => {
            if (!node || !node.isFile) return;
            model.deleteFile(node.key);
            tree.refresh();
        }),

        vscode.commands.registerCommand('pvf.createFolder', async (node: PvfFileEntry) => {
            // node is folder
            const base = node && !node.isFile ? node.key : '';
            const name = await vscode.window.showInputBox({ prompt: '输入新文件夹名称', placeHolder: '例如: new_folder' });
            if (!name) return;
            model.createFolder(base ? `${base}/${name}` : name);
            tree.refresh();
        }),

        vscode.commands.registerCommand('pvf.deleteFolder', async (node: PvfFileEntry) => {
            if (!node || node.isFile) return;
            const ok = await vscode.window.showWarningMessage(`确定删除文件夹 ${node.name} 及其所有子项吗？`, { modal: true }, '删除');
            if (ok !== '删除') return;
            model.deleteFolder(node.key);
            tree.refresh();
        }),

        vscode.commands.registerCommand('pvf.createFile', async (node: PvfFileEntry) => {
            const base = node && !node.isFile ? node.key : '';
            const name = await vscode.window.showInputBox({ prompt: '输入新文件名（含扩展名）', placeHolder: '例如: readme.txt' });
            if (!name) return;
            const key = base ? `${base}/${name}` : name;
            // create empty file
            model.createEmptyFile(key);
            tree.refresh();
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
        }),

        // Debug: print detectEncoding and head bytes for a file key to PVF output
        vscode.commands.registerCommand('pvf.debugDetectEncoding', async (node: PvfFileEntry) => {
            let key: string | undefined = node && node.key;
            if (!key) {
                key = await vscode.window.showInputBox({ prompt: '输入文件 key（例如: common/emoticon/against.ani）' });
                if (!key) return;
            }
            try {
                const info = (model as any).debugDetectEncoding(key);
                output.appendLine(`[PVF DEBUG] key=${key} encoding=${info.encoding} hasBom=${info.hasBom} head=${info.headHex}`);
                vscode.window.showInformationMessage('PVF: debug 信息已写入输出面板');
            } catch (err) {
                output.appendLine('[PVF DEBUG] error: ' + String(err));
                vscode.window.showErrorMessage('读取 debug 信息失败');
            }
        })

    );
}

export function deactivate() { }
