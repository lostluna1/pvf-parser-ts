import * as vscode from 'vscode';
import { registerActLanguage } from './act/registerAct.js';
import { registerActFormatter } from './act/formatter';
import { registerAniLanguage } from './ani/registerAni.js';
import { registerAniFormatter } from './ani/formatter';

// 未来可扩展：扫描 scriptTags 下的定义动态生成补全与 hover。
export function registerScriptLanguages(context: vscode.ExtensionContext) {
    registerActLanguage(context);
    registerActFormatter(context);
    registerAniLanguage(context);
    registerAniFormatter(context);
}
