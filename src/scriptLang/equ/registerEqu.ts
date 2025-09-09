import * as vscode from 'vscode';
import { provideSharedTagFeatures } from '../tagRegistry';
import { registerEquPreviewCodeLens } from './previewLens.js';

export function registerEquLanguage(context: vscode.ExtensionContext) {
	const langId = 'pvf-equ';
	provideSharedTagFeatures(context, langId, 'equ');
	registerEquPreviewCodeLens(context);
}
