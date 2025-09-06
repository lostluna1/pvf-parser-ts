import * as vscode from 'vscode';
import { registerActLanguage } from './act/registerAct.js';

// 未来可扩展：扫描 scriptTags 下的定义动态生成补全与 hover。
export function registerScriptLanguages(context: vscode.ExtensionContext) {
    registerActLanguage(context);
}
