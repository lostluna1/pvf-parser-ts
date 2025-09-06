import * as vscode from 'vscode';

export interface FormatContext {
  languageId: string;
  options: vscode.FormattingOptions;
  document: vscode.TextDocument;
}

export interface FormatterStrategy {
  provideEdits(ctx: FormatContext, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> | vscode.TextEdit[];
}

export function registerFormatter(context: vscode.ExtensionContext, languageId: string, strategy: FormatterStrategy) {
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(languageId, {
      provideDocumentFormattingEdits(document, options, token) {
        return strategy.provideEdits({ languageId, options, document }, token);
      }
    })
  );
}
