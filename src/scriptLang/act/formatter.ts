import * as vscode from 'vscode';
import { registerFormatter, FormatterStrategy, FormatContext } from '../format/base.js';
import { iterateBracketTags, loadTags } from '../tagRegistry.js';

class ActFormatter implements FormatterStrategy {
  constructor(private extCtx: vscode.ExtensionContext) {}

  async provideEdits(ctx: FormatContext): Promise<vscode.TextEdit[]> {
    const { document: doc } = ctx;
    const tags = await loadTags(this.extCtx, 'act');
    const closable = new Set(tags.filter(t => t.closing).map(t => t.name.toLowerCase()));
    const indentUnit = '\t';
    const maxEmptyLines = 1;
    const edits: vscode.TextEdit[] = [];
    let depth = 0;
    let emptyRun = 0;
  // 当前是否处于某个非闭合标签的值区域；记录该标签的层级 depth
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

    // 若处于值区域：对多值行执行拆分
    if (valueParentDepth !== null && !trimmed.startsWith('[')) {
        // 将反引号字符串视为单个 token，其余按空白分隔
        const tokenRegex = /`[^`]*`|[^\s]+/g;
        const tokens = trimmed.match(tokenRegex) || [];
        if (tokens.length > 1) {
      const valueIndent = indentUnit.repeat(valueParentDepth + 1);
          const newText = tokens.map(t => valueIndent + t).join(doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
          edits.push(vscode.TextEdit.replace(line.range, newText));
          // 不再对该行做后续缩进行处理
          continue;
        }
      }
      // 回溯式补救：如果上一条非空行是“非需闭合标签”，而当前行被用户合并成多值行，也尝试拆分
      if (valueParentDepth === null && !trimmed.startsWith('[')) {
        let prevIdx = i - 1;
        while (prevIdx >= 0) {
          const prevText = doc.lineAt(prevIdx).text.trim();
            if (prevText.length === 0) { prevIdx--; continue; }
            // 匹配简单开标签 [NAME ...]
            const m = /^\[([^\]/]+)\]/.exec(prevText);
            if (!m) break; // 上一非空不是开标签
            const tagName = m[1].trim().toLowerCase();
            let dynClosable = closable.has(tagName);
            if (tagName === 'trigger') dynClosable = false; // 回溯下无法精准判断根级，宁可当作非需闭合以触发拆分
            if (!dynClosable) {
              const tokenRegex = /`[^`]*`|[^\s]+/g;
              const tokens = trimmed.match(tokenRegex) || [];
              if (tokens.length > 1) {
                const prevLineDepth = depth; // 近似使用当前 depth（误差仅影响缩进层级一小步）
                const valueIndent = indentUnit.repeat(prevLineDepth + 1);
                const newText = tokens.map(t => valueIndent + t).join(doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
                edits.push(vscode.TextEdit.replace(line.range, newText));
                // 不需继续本行后续处理
                continue;
              }
            }
            break;
        }
      }
    // 判断当前是否为值行（非标签，且 valueParentDepth 生效）
    const isValueLine = valueParentDepth !== null && !trimmed.startsWith('[');

      let decrease = false;
      for (const t of iterateBracketTags(trimmed)) {
        if (t.isClose) {
          const lower = t.rawName.toLowerCase();
          let dynClosable = closable.has(lower);
          if (lower === 'trigger') dynClosable = depth > 0;
          if (dynClosable && t.matchStart === 0) decrease = true;
        }
        break;
      }
      if (decrease) depth = Math.max(0, depth - 1);

      // 根据是否为标签值行决定有效缩进层级
      const effectiveDepth = isValueLine && valueParentDepth !== null
        ? valueParentDepth + 1
        : depth;
      const desiredIndent = indentUnit.repeat(effectiveDepth);
      const currentLeading = raw.length - raw.trimStart().length;
      const currentIndent = raw.slice(0, currentLeading);
      if (currentIndent !== desiredIndent) {
        edits.push(vscode.TextEdit.replace(new vscode.Range(i, 0, i, currentLeading), desiredIndent));
      }

      for (const t of iterateBracketTags(trimmed)) {
        if (!t.isClose) {
          const lower = t.rawName.toLowerCase();
          let dynClosable = closable.has(lower);
          if (lower === 'trigger') dynClosable = depth === 0;
          if (dynClosable && t.matchStart === 0) depth++;
          // 记录非需闭合标签（不增加层级的）以便处理下一行多值拆分
          if (!dynClosable && t.matchStart === 0) {
            valueParentDepth = depth; // 进入值区域
          } else if (t.matchStart === 0) {
            // 任意可闭合标签行开始，终止前一个值区域（即使它会增加 depth）
            valueParentDepth = null;
          }
        }
        break;
      }
      // 若这一行本身是标签行但未通过上面逻辑设定（例如关闭标签），仍需退出值区域
      if (trimmed.startsWith('[') && !/^[^\[]*\[[^\]]+\]/.test(trimmed)) {
        // 简单保险：遇到标签行统一退出值区域（除非在开标签处已重新设定）
        if (!/\[[^\]]+\]$/.test(trimmed)) {
          valueParentDepth = null;
        }
      }
    }

    // 第二遍：移除所有“可闭合标签块”内部的空行（包括只含空白的行）
    // 重新扫描以确定块范围（使用动态 TRIGGER 规则）
    interface Block { start: number; end: number; }
    const blocks: Block[] = [];
    const stack: { tag: string; line: number }[] = [];
    for (let lineNum = 0; lineNum < doc.lineCount; lineNum++) {
      const text = doc.lineAt(lineNum).text;
      for (const t of iterateBracketTags(text)) {
        const lower = t.rawName.toLowerCase();
        if (!t.isClose) {
          let dynClosable = closable.has(lower);
          if (lower === 'trigger') dynClosable = stack.length === 0; // root-level only
          if (dynClosable) stack.push({ tag: lower, line: lineNum });
        } else {
          // 找到最近同名可闭合块
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
    // 去重：合并或并列块内部空行都要删；用集合避免重复删除
    const blankLinesToDelete = new Set<number>();
    for (const b of blocks) {
      for (let ln = b.start + 1; ln < b.end; ln++) {
        const txt = doc.lineAt(ln).text;
        if (txt.trim().length === 0) blankLinesToDelete.add(ln);
      }
    }
    for (const ln of blankLinesToDelete) {
      const line = doc.lineAt(ln);
      // 如果是最后一行没有换行符, 删除其内容; 否则删除包含换行
      const range = (ln === doc.lineCount - 1) ? line.range : line.rangeIncludingLineBreak;
      edits.push(vscode.TextEdit.delete(range));
    }
    return edits;
  }
}

export function registerActFormatter(context: vscode.ExtensionContext) {
  registerFormatter(context, 'pvf-act', new ActFormatter(context));
}
