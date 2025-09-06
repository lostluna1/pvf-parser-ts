import * as vscode from 'vscode';
import { provideSharedTagFeatures } from '../tagRegistry';

const LANG_ID = 'pvf-act';
const SHORT = 'act';

export function registerActLanguage(context: vscode.ExtensionContext) {
    provideSharedTagFeatures(context, LANG_ID, SHORT);
}
