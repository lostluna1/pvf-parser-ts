import * as vscode from 'vscode';
import { provideSharedTagFeatures } from '../tagRegistry';

const LANG_ID = 'pvf-aic';
const SHORT = 'aic';

export function registerAicLanguage(context: vscode.ExtensionContext) {
  provideSharedTagFeatures(context, LANG_ID, SHORT);
  // 预留：AIC 专属诊断（如 [key stream] 中索引重复检测、路径存在性等）
}
