import * as vscode from 'vscode';
import { registerFormatter, FormatterStrategy, FormatContext } from '../format/base';
import { iterateBracketTags, loadTags } from '../tagRegistry';

// EQU 文件格式化策略：
// 1. 基于 tagRegistry 中带 closing=true 的标签做层级缩进。
// 2. 非 closable 标签后紧随的“值行”(不以 [ 开头) 额外缩进一级（与 ACT 逻辑一致）。
// 3. 连续空行压缩为 1 行，且可闭合块内部移除全部空行（首尾除外）。
// 4. 不改变行内内容与大小写，仅调整前导缩进与多余空行。
class EquFormatter implements FormatterStrategy {
  constructor(private extCtx: vscode.ExtensionContext) {}

  async provideEdits(ctx: FormatContext): Promise<vscode.TextEdit[]> {
    const { document: doc } = ctx;
    const tags = await loadTags(this.extCtx, 'equ');
    const closable = new Set(tags.filter(t => t.closing).map(t => t.name.toLowerCase()));
    const indentUnit = '\t';
    const maxEmptyLines = 1;
    const edits: vscode.TextEdit[] = [];
    let depth = 0;
    let emptyRun = 0;
    let valueParentDepth: number | null = null;

    // 第一遍：规范缩进与压缩顶层多余空行
    for (let i = 0; i < doc.lineCount; i++) {
      const line = doc.lineAt(i);
      const raw = line.text;
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        emptyRun++;
        if (emptyRun > maxEmptyLines) {
          edits.push(vscode.TextEdit.delete(line.rangeIncludingLineBreak));
        }
        continue;
      } else {
        emptyRun = 0;
      }

      const isValueLine = valueParentDepth !== null && !trimmed.startsWith('[');

      // 预判本行是否是闭合标签行（行首）以先行降低层级
      let decrease = false;
      for (const t of iterateBracketTags(trimmed)) {
        if (t.isClose) {
          const lower = t.rawName.toLowerCase();
          if (closable.has(lower) && t.matchStart === 0) decrease = true;
        }
        break; // 仅看第一个
      }
      if (decrease) depth = Math.max(0, depth - 1);

      const effectiveDepth = isValueLine && valueParentDepth !== null ? valueParentDepth + 1 : depth;
      const desiredIndent = indentUnit.repeat(effectiveDepth);
      const currentLeading = raw.length - raw.trimStart().length;
      const currentIndent = raw.slice(0, currentLeading);
      if (currentIndent !== desiredIndent) {
        edits.push(vscode.TextEdit.replace(new vscode.Range(i, 0, i, currentLeading), desiredIndent));
      }

      // 解析标签影响层级/值区域
      for (const t of iterateBracketTags(trimmed)) {
        if (!t.isClose) {
          const lower = t.rawName.toLowerCase();
          const isClosable = closable.has(lower);
            if (isClosable && t.matchStart === 0) {
              depth++; // 可闭合块增加层级
              valueParentDepth = null; // 进入新块终止旧值区域
            } else if (!isClosable && t.matchStart === 0) {
              // 非 closable 起始行，下一行若是值行则需要额外缩进
              valueParentDepth = depth;
            }
        } else {
          // 关闭标签行已在前面 decrease 处理，退出值区域
          valueParentDepth = null;
        }
        break;
      }
    }

    // 第二遍：删除 closable 块内部空行
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
              stack.splice(s, 1); break;
            }
          }
        }
      }
    }
    const blankLinesToDelete = new Set<number>();
    for (const b of blocks) {
      for (let ln = b.start + 1; ln < b.end; ln++) {
        if (doc.lineAt(ln).text.trim().length === 0) blankLinesToDelete.add(ln);
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

export function registerEquFormatter(context: vscode.ExtensionContext) {
  registerFormatter(context, 'pvf-equ', new EquFormatter(context));
}
