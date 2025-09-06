import * as vscode from 'vscode';
import { registerFormatter, FormatterStrategy, FormatContext } from '../format/base.js';
import { iterateBracketTags, loadTags } from '../tagRegistry.js';

class AniFormatter implements FormatterStrategy {
  constructor(private extCtx: vscode.ExtensionContext) {}
  async provideEdits(ctx: FormatContext): Promise<vscode.TextEdit[]> {
    const { document: doc } = ctx;
    const tags = await loadTags(this.extCtx, 'ani');
    const closable = new Set(tags.filter(t => t.closing).map(t => t.name.toLowerCase()));
    const indentUnit = '\t';
    const maxEmptyLines = 1; // 与 act 保持一致：块之间最多 1 个空行
    const edits: vscode.TextEdit[] = [];
    let depth = 0;
    let emptyRun = 0;
    let valueParentDepth: number | null = null; // 非 closable 标签后的值区域
  let inFrame = false; // 是否处于一个 FRAME### 合成块
  let currentFrameStart: number | null = null;
  const syntheticFrameBlocks: { start: number; end: number }[] = [];
    for (let i = 0; i < doc.lineCount; i++) {
      const line = doc.lineAt(i);
      const raw = line.text;
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        emptyRun++;
        if (emptyRun > maxEmptyLines) edits.push(vscode.TextEdit.delete(line.rangeIncludingLineBreak));
        continue;
      } else emptyRun = 0;

  // (已禁用 ani 的多值拆分逻辑：保持多值在同一行)
  // 保留缩进处理，下方统一调整缩进。

      const isFrameHeader = /^\[FRAME\d{3,}\]/i.test(trimmed);
      // 新的 FRAME 头到来，先结束上一个 frame 的缩进层级
      if (isFrameHeader) {
        if (inFrame) {
          // 结束旧 frame 块（结束行为前一行）
          if (currentFrameStart !== null && i - 1 >= currentFrameStart) {
            syntheticFrameBlocks.push({ start: currentFrameStart, end: i - 1 });
          }
          depth = Math.max(0, depth - 1);
        }
        inFrame = true;
        currentFrameStart = i;
        valueParentDepth = null; // frame 头不进入值区域
      }

      const isValueLine = valueParentDepth !== null && !trimmed.startsWith('[') && !isFrameHeader;
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

      let openedByTag = false;
      for (const t of iterateBracketTags(trimmed)) {
        if (!t.isClose) {
          const lower = t.rawName.toLowerCase();
          const dynClosable = closable.has(lower);
          if (dynClosable && t.matchStart === 0) { depth++; openedByTag = true; }
          if (!dynClosable && t.matchStart === 0 && !isFrameHeader) {
            valueParentDepth = depth; // 进入值区域（FRAME 头不算值标签）
          } else if (t.matchStart === 0 && !isFrameHeader) {
            valueParentDepth = null; // 可闭合标签终止之前的值区域
          }
        }
        break;
      }
      // FRAME 头自身在标签后增加一层缩进（模拟可闭合块）
      if (isFrameHeader) {
        depth++;
      }
    }

    // 文件结束，若仍在 frame 中则收尾合成块
    if (inFrame && currentFrameStart !== null) {
      const lastLine = doc.lineCount - 1;
      if (lastLine >= currentFrameStart) syntheticFrameBlocks.push({ start: currentFrameStart, end: lastLine });
    }

    // 第二遍：删除所有 closable 块内部空行
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
  // 合并合成 frame 块
  for (const fb of syntheticFrameBlocks) blocks.push(fb);
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

export function registerAniFormatter(context: vscode.ExtensionContext) {
  registerFormatter(context, 'pvf-ani', new AniFormatter(context));
}
