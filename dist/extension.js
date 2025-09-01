"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const model_1 = require("./pvf/model");
const provider_1 = require("./pvf/provider");
function activate(context) {
    const model = new model_1.PvfModel();
    const output = vscode.window.createOutputChannel('PVF');
    const tree = new provider_1.PvfProvider(model, output);
    vscode.window.registerTreeDataProvider('pvfExplorerView', tree);
    context.subscriptions.push(vscode.commands.registerCommand('pvf.openPack', async () => {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'PVF': ['pvf'] }
        });
        if (!uris || uris.length === 0) {
            return;
        }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '打开 PVF…' }, async (p) => {
            const t0 = Date.now();
            output.appendLine(`[PVF] open start: ${uris[0].fsPath}`);
            await model.open(uris[0].fsPath, (n) => { p.report({ increment: 0, message: `${n}%` }); });
            const ms = Date.now() - t0;
            output.appendLine(`[PVF] open done in ${ms}ms (parsed header+tree only)`);
        });
        tree.refresh();
    }), vscode.commands.registerCommand('pvf.savePack', async () => {
        const dest = await vscode.window.showSaveDialog({ filters: { 'PVF': ['pvf'] } });
        if (!dest) {
            return;
        }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '保存 PVF…' }, async (p) => {
            let last = 0;
            const ok = await model.save(dest.fsPath, (n) => {
                const inc = Math.max(0, Math.min(100, n) - last);
                last = Math.max(last, Math.min(100, n));
                p.report({ increment: inc, message: `${last}%` });
            });
            if (ok) {
                vscode.window.showInformationMessage('另存为成功');
                model.pvfPath = dest.fsPath;
            }
            else {
                vscode.window.showErrorMessage('保存失败');
            }
        });
    }), vscode.commands.registerCommand('pvf.savePackInPlace', async () => {
        if (!model.pvfPath) {
            vscode.window.showWarningMessage('尚未打开任何 PVF 文件');
            return;
        }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '保存 PVF…' }, async (p) => {
            let last = 0;
            const ok = await model.save(model.pvfPath, (n) => {
                const inc = Math.max(0, Math.min(100, n) - last);
                last = Math.max(last, Math.min(100, n));
                p.report({ increment: inc, message: `${last}%` });
            });
            vscode.window.showInformationMessage(ok ? '已保存到当前文件' : '保存失败');
        });
    }), vscode.commands.registerCommand('pvf.exportFile', async (node) => {
        if (!node || !node.isFile)
            return;
        const dest = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(node.name) });
        if (!dest)
            return;
        await model.exportFile(node.key, dest.fsPath);
        vscode.window.showInformationMessage('导出完成');
    }), vscode.commands.registerCommand('pvf.replaceFile', async (node) => {
        if (!node || !node.isFile)
            return;
        const src = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false });
        if (!src || src.length === 0)
            return;
        const res = await model.replaceFile(node.key, src[0].fsPath);
        if (!res.success) {
            vscode.window.showErrorMessage('替换失败');
        }
        tree.refresh();
    }), vscode.commands.registerCommand('pvf.deleteFile', async (node) => {
        if (!node || !node.isFile)
            return;
        model.deleteFile(node.key);
        tree.refresh();
    }), 
    // Provide editable virtual FS for pvf: scheme
    vscode.workspace.registerFileSystemProvider('pvf', new (class {
        constructor() {
            this._emitter = new vscode.EventEmitter();
            this.onDidChangeFile = this._emitter.event;
        }
        watch() { return new vscode.Disposable(() => { }); }
        stat(uri) {
            const key = uri.path.replace(/^\//, '');
            return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: model.getTextSize(key) };
        }
        readDirectory() { return []; }
        createDirectory() { }
        async readFile(uri) {
            const key = uri.path.replace(/^\//, '');
            return await model.readFileBytes(key);
        }
        async writeFile(uri, content, options) {
            const key = uri.path.replace(/^\//, '');
            model.updateFileData(key, content);
            this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
        }
        delete() { }
        rename() { }
    })(), { isCaseSensitive: true, isReadonly: false }), vscode.commands.registerCommand('pvf.openFile', async (node) => {
        if (!node.isFile)
            return;
        const uri = vscode.Uri.parse(`pvf:/${node.key}`);
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });
        }
        catch (e) {
            // Fallback: 强制以文本打开（将内容读到新建untitled文本），极端情况下绕过VSCode的二进制拦截
            try {
                const bytes = await model.readFileBytes(node.key);
                const text = Buffer.from(bytes).toString('utf8');
                const doc = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
                await vscode.window.showTextDocument(doc, { preview: false });
            }
            catch (e2) {
                vscode.window.showErrorMessage('无法打开文件为文本');
            }
        }
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map