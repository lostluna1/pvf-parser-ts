import * as vscode from 'vscode';
import { registerActLanguage } from './act/registerAct.js';
import { registerActFormatter } from './act/formatter';
import { registerAniLanguage } from './ani/registerAni.js';
import { registerAniFormatter } from './ani/formatter';
import { registerSklLanguage } from './skl/registerSkl';
import { registerSklFormatter } from './skl/formatter';
import { registerLstLanguage } from './lst/registerLst';
import { registerStrLanguage } from './str/registerStr';
import { registerEquLanguage } from './equ/registerEqu';
import { registerEquFormatter } from './equ/formatter';

// 未来可扩展：扫描 scriptTags 下的定义动态生成补全与 hover。
export function registerScriptLanguages(context: vscode.ExtensionContext, model?: any) {
    registerActLanguage(context);
    registerActFormatter(context);
    registerAniLanguage(context);
    registerAniFormatter(context);
    // register SKL language and formatter
    registerSklLanguage(context);
    registerSklFormatter(context);
    registerLstLanguage(context);
    registerStrLanguage(context);
    registerEquLanguage(context, model);
    registerEquFormatter(context);
}
