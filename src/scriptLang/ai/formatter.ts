import * as vscode from 'vscode';
import { registerFormatter, FormatterStrategy, FormatContext } from '../format/base.js';
import { iterateBracketTags, loadTags } from '../tagRegistry.js';

class AiFormatter implements FormatterStrategy {
  constructor(private extCtx: vscode.ExtensionContext) {}

  async provideEdits(ctx: FormatContext): Promise<vscode.TextEdit[]> {
    const { document: doc } = ctx;
    const tags = await loadTags(this.extCtx, 'ai');
    const closable = new Set(tags.filter(t => t.closing).map(t => t.name.toLowerCase()));
    const indentUnit = '\t';
    const maxEmptyLines = 1;
    const edits: vscode.TextEdit[] = [];
    let depth = 0;
    let emptyRun = 0;
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

    // 第二遍：删除闭合块内部多余空行
    interface Block { start: number; end: number; }
    const blocks: Block[] = [];
    const stack: { tag: string; line: number }[] = [];
    for (let lineNum = 0; lineNum < doc.lineCount; lineNum++) {
      const text = doc.lineAt(lineNum).text;
      for (const t of iterateBracketTags(text)) {
        const lower = t.rawName.toLowerCase();
        if (!t.isClose) {
          if (closable.has(lower)) stack.push({ tag: lower, line: lineNum });
        } else {
          for (let s = stack.length - 1; s >= 0; s--) {
            if (stack[s].tag === lower) {
              const start = stack[s].line;
              if (lineNum > start) blocks.push({ start, end: lineNum });
              stack.splice(s, 1);
              break;
            }
          }
        }
      }
    }
    const blankLinesToDelete = new Set<number>();
    for (const b of blocks) {
      for (let ln = b.start + 1; ln < b.end; ln++) {
        const txt = doc.lineAt(ln).text;
        if (txt.trim().length === 0) blankLinesToDelete.add(ln);
      }
    }
    for (const ln of blankLinesToDelete) {
      const line = doc.lineAt(ln);
      const range = (ln === doc.lineCount - 1) ? line.range : line.rangeIncludingLineBreak;
      edits.push(vscode.TextEdit.delete(range));
    }
    return edits;
  }
}

export function registerAiFormatter(context: vscode.ExtensionContext) {
  registerFormatter(context, 'pvf-ai', new AiFormatter(context));
}
