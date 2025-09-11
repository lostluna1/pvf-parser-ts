import * as vscode from 'vscode';
import { provideSharedTagFeatures } from '../tagRegistry';

const LANG_ID = 'pvf-key';
const SHORT = 'key';

export function registerKeyLanguage(context: vscode.ExtensionContext) {
  provideSharedTagFeatures(context, LANG_ID, SHORT);
}
