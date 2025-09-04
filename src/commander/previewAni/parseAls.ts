import * as vscode from 'vscode';

export interface AlsUseDecl { id: string; path: string; }
export interface AlsAddRef { relLayer: number; order: number; id: string; }
export interface ParsedAls { uses: Map<string, AlsUseDecl>; adds: AlsAddRef[]; }

/** 解析 .ani.als 文件内容（容错：空行 / 额外缩进 / 不规则大小写） */
export function parseAlsText(text: string, out?: vscode.OutputChannel): ParsedAls {
  const uses = new Map<string, AlsUseDecl>();
  const adds: AlsAddRef[] = [];
  const norm = (s: string) => s.trim();

  // 先用正则快速抓取；如果失败再走行解析回退
  // 允许 path 与 id 之间存在额外空行或注释 (# 开头) 行
  const useRe = /\[use\s+animation\]\s*\r?\n+([\s#]*\r?\n+)*\s*`([^`]+)`\s*\r?\n+([\s#]*\r?\n+)*\s*`([^`]+)`/gi;
  let m: RegExpExecArray | null;
  while ((m = useRe.exec(text)) !== null) {
    const p = norm(m[2]);
    const id = norm(m[4]);
    if (!uses.has(id)) uses.set(id, { id, path: p });
  }
  const addRe = /\[add\]\s*\r?\n+([\s#]*\r?\n+)*\s*(-?\d+)\s+(-?\d+)\s*\r?\n+([\s#]*\r?\n+)*\s*`([^`]+)`/gi;
  while ((m = addRe.exec(text)) !== null) {
    adds.push({ relLayer: parseInt(m[2],10)||0, order: parseInt(m[3],10)||0, id: norm(m[5]) });
  }

  if (uses.size === 0 && adds.length === 0) {
  // 诊断：统计原始标记出现次数
  const rawUseCount = (text.match(/\[use\s+animation\]/ig)||[]).length;
  const rawAddCount = (text.match(/\[add\]/ig)||[]).length;
  out?.appendLine(`[ALS][调试] 正则匹配失败，原始标签计数 use=${rawUseCount} add=${rawAddCount}，进入行级回退`);
    // 行级回退解析
    const lines = text.split(/\r?\n/);
    for (let i=0;i<lines.length;i++) {
      const line = lines[i].trim().toLowerCase();
      if (line === '[use animation]') {
        let pLine = ''; let idLine = '';
        // 跳过空行
        let j = i+1; while (j < lines.length && lines[j].trim()==='') j++;
        if (j < lines.length) { pLine = lines[j].trim(); }
        j++; while (j < lines.length && lines[j].trim()==='') j++;
        if (j < lines.length) { idLine = lines[j].trim(); }
        const pathMatch = pLine.match(/^`([^`]+)`$/); const idMatch = idLine.match(/^`([^`]+)`$/);
        if (pathMatch && idMatch) {
          const p = norm(pathMatch[1]); const id = norm(idMatch[1]);
          if (!uses.has(id)) uses.set(id, { id, path: p });
        }
      } else if (line === '[add]') {
        let rel=0, order=0, id='';
        let j=i+1; while (j<lines.length && lines[j].trim()==='') j++;
        if (j<lines.length) {
          const nums = lines[j].trim().split(/\s+/);
            if (nums.length>=2) { rel = parseInt(nums[0],10)||0; order = parseInt(nums[1],10)||0; }
        }
        j++; while (j<lines.length && lines[j].trim()==='') j++;
        if (j<lines.length) {
          const idMatch = lines[j].trim().match(/^`([^`]+)`$/); if (idMatch) id = norm(idMatch[1]);
        }
        if (id) adds.push({ relLayer: rel, order, id });
      }
    }
  }

  adds.sort((a,b)=> a.relLayer === b.relLayer ? a.order - b.order : a.relLayer - b.relLayer);
  out?.appendLine(`[ALS] use animation 声明数: ${uses.size}`);
  out?.appendLine(`[ALS] add 引用数: ${adds.length}`);
  if (uses.size === 0) {
    const sample = text.split(/\r?\n/).slice(0,40).join('\n');
    out?.appendLine('[ALS][调试] 前40行采样:');
    out?.appendLine(sample);
  }
  return { uses, adds };
}
