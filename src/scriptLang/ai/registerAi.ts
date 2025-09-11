import * as vscode from 'vscode';
import { provideSharedTagFeatures } from '../tagRegistry';

const LANG_ID = 'pvf-ai';
const SHORT = 'ai';

export function registerAiLanguage(context: vscode.ExtensionContext) {
  // 复用通用标签补全/hover/折叠/语义着色能力
  provideSharedTagFeatures(context, LANG_ID, SHORT);
  // 预留：未来可在此添加 AI 专属诊断（例如 return 索引范围、冷却写法等）
}
