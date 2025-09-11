import * as vscode from 'vscode';
import { registerFormatter, FormatterStrategy, FormatContext } from '../format/base.js';
import { iterateBracketTags, loadTags } from '../tagRegistry.js';

class KeyFormatter implements FormatterStrategy {
  constructor(private extCtx: vscode.ExtensionContext) {}
  async provideEdits(ctx: FormatContext): Promise<vscode.TextEdit[]> {
    const { document: doc } = ctx;
    const tags = await loadTags(this.extCtx, 'key');
    const closable = new Set(tags.filter(t => t.closing).map(t => t.name.toLowerCase()));
    const indentUnit = '\t';
    const edits: vscode.TextEdit[] = [];
    let depth = 0;
    let emptyRun = 0;
    const maxEmptyLines = 1;
    let valueParentDepth: number | null = null;
    for (let i = 0; i < doc.lineCount; i++) {
      const line = doc.lineAt(i);
      const raw = line.text;
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        emptyRun++;
        if (emptyRun > maxEmptyLines) edits.push(vscode.TextEdit.delete(line.rangeIncludingLineBreak));
        continue;
      } else emptyRun = 0;
      const isValueLine = valueParentDepth !== null && !trimmed.startsWith('[');
      let decrease = false;
      for (const t of iterateBracketTags(trimmed)) {
        if (t.isClose) {
          const lower = t.rawName.toLowerCase();
          if (closable.has(lower) && t.matchStart === 0) decrease = true;
        }
        break;
      }
      if (decrease) depth = Math.max(0, depth - 1);
      const effectiveDepth = isValueLine && valueParentDepth !== null ? valueParentDepth + 1 : depth;
      const desiredIndent = indentUnit.repeat(effectiveDepth);
      const currentLeading = raw.length - raw.trimStart().length;
      const currentIndent = raw.slice(0, currentLeading);
      if (currentIndent !== desiredIndent) {
        edits.push(vscode.TextEdit.replace(new vscode.Range(i, 0, i, currentLeading), desiredIndent));
      }
      for (const t of iterateBracketTags(trimmed)) {
        if (!t.isClose) {
          const lower = t.rawName.toLowerCase();
          if (closable.has(lower) && t.matchStart === 0) {
            depth++;
            valueParentDepth = null;
          } else if (t.matchStart === 0) {
            valueParentDepth = depth; // 非闭合标签的值区
          }
        }
        break;
      }
    }
    return edits;
  }
}

export function registerKeyFormatter(context: vscode.ExtensionContext) {
  registerFormatter(context, 'pvf-key', new KeyFormatter(context));
}
