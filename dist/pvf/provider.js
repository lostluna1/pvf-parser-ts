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
exports.PvfProvider = void 0;
const vscode = __importStar(require("vscode"));
class PvfProvider {
    constructor(model, output) {
        this.model = model;
        this.output = output;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    reportProgress(n) {
        // optionally hook to VS Code progress
    }
    getTreeItem(element) {
        const item = new vscode.TreeItem(element.name, element.isFile ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = element.isFile ? 'pvf.file' : 'pvf.folder';
        if (element.isFile) {
            const uri = vscode.Uri.parse(`pvf:/${element.key}`);
            item.resourceUri = uri;
            item.command = { command: 'pvf.openFile', title: '打开', arguments: [element] };
        }
        return item;
    }
    getChildren(element) {
        const label = element ? `children:${element.key}` : 'children:<root>';
        const start = Date.now();
        const result = !element ? this.model.getChildren() : (!element.isFile ? this.model.getChildren(element.key) : []);
        const ms = Date.now() - start;
        this.output?.appendLine(`[PVF] get${label} -> ${Array.isArray(result) ? result.length : 0} items in ${ms}ms`);
        return Promise.resolve(result);
    }
}
exports.PvfProvider = PvfProvider;
//# sourceMappingURL=provider.js.map