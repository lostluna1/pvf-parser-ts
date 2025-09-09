import * as vscode from 'vscode';
import { provideSharedTagFeatures } from '../tagRegistry';

export function registerEquLanguage(context: vscode.ExtensionContext) {
	const langId = 'pvf-equ';
	provideSharedTagFeatures(context, langId, 'equ');
}
