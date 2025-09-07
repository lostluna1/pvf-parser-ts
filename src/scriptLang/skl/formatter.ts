import * as vscode from 'vscode';
import { registerFormatter, FormatterStrategy, FormatContext } from '../format/base';

class SklFormatter implements FormatterStrategy {
    async provideEdits(ctx: FormatContext, token: vscode.CancellationToken) {
        // Minimal: no-op formatter, keep document as-is
        return [] as vscode.TextEdit[];
    }
}

export function registerSklFormatter(context: vscode.ExtensionContext) {
    registerFormatter(context, 'pvf-skl', new SklFormatter());
}