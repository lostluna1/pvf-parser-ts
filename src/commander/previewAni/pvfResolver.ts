import * as vscode from 'vscode';
import { PvfModel } from '../../pvf/model';

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();

export async function loadAniFromPvf(model: PvfModel, aniLogical: string, out?: vscode.OutputChannel): Promise<string | undefined> {
  const cache = (loadAniFromPvf as any)._cache || ((loadAniFromPvf as any)._cache = new Map<string, string>());
  
  // 清理路径字符串，去除反引号
  let logicalRaw = (aniLogical || '').trim();
  logicalRaw = logicalRaw.replace(/^[`'\"]+/, '').replace(/[`'\"]+$/, '');
  
  let logical = norm(logicalRaw);
  
  if (cache.has(logical)) {
    return cache.get(logical);
  }
  
  const outc = out || vscode.window.createOutputChannel('PVF');
  
  // 使用PVF模型的文件查找逻辑
  const joinAndNormalize = (baseDir: string, rel: string) => {
    const relParts = rel.replace(/^\/+/, '').split('/');
    const baseParts = baseDir ? baseDir.split('/').filter(p => p.length > 0) : [];
    const out: string[] = [...baseParts];
    for (const part of relParts) {
      if (part === '..') {
        if (out.length > 0) out.pop();
      } else if (part === '.' || part === '') {
        // skip
      } else {
        out.push(part);
      }
    }
    return out.join('/');
  };
  
  const resolveKey = (filePath: string, baseDir?: string) => {
    const normalizedPath = norm(filePath);
    
    // 1. 精确匹配
    if (model.getFileByKey(normalizedPath)) {
      return normalizedPath;
    }
    
    // 2. 如果有基础目录，尝试相对路径解析
    if (baseDir) {
      const resolved = filePath.startsWith('.') ? 
        joinAndNormalize(baseDir, filePath) : 
        `${baseDir}/${normalizedPath}`;
      
      if (model.getFileByKey(resolved)) {
        return resolved;
      }
      
      // 也尝试规范化，即使不以点开头
      const normalized = joinAndNormalize(baseDir, filePath);
      if (model.getFileByKey(normalized)) {
        return normalized;
      }
    }
    
    // 3. 搜索所有键，寻找结尾匹配
    const keys = Array.from((model as any).fileList?.keys?.() || []) as string[];
    const found = keys.find((k: string) => {
      const lowerKey = k.toLowerCase();
      return lowerKey === normalizedPath || 
             lowerKey.endsWith('/' + normalizedPath) || 
             lowerKey.endsWith(normalizedPath);
    });
    
    if (found) {
      return found;
    }
    
    // 4. 模糊匹配：查找包含路径的文件
    const fuzzyFound = keys.find((k: string) => {
      const lowerKey = k.toLowerCase();
      return lowerKey.indexOf(normalizedPath) >= 0;
    });
    
    return fuzzyFound || null;
  };
  
  try {
    const resolvedKey = resolveKey(logical);
    
    if (resolvedKey) {
      outc.appendLine(`[PVF] 找到ANI文件: ${logical} -> ${resolvedKey}`);
      
      // 读取文件内容
      const content = await model.getTextViewAsync(resolvedKey as string);
      
      if (content && content.length > 0) {
        cache.set(logical, content);
        outc.appendLine(`[PVF] 成功读取ANI文件内容，长度: ${content.length}`);
        return content;
      } else {
        outc.appendLine(`[PVF] ANI文件内容为空: ${resolvedKey}`);
      }
    } else {
      outc.appendLine(`[PVF] 未找到ANI文件: ${logical}`);
      
      // 尝试列出可能的匹配
      const keys = Array.from((model as any).fileList?.keys?.() || []) as string[];
      const possibleMatches = keys.filter((k: string) => {
        const lowerKey = k.toLowerCase();
        return lowerKey.includes('ani') && lowerKey.includes(logical.split('/').pop()?.split('.')[0] || '');
      }).slice(0, 5);
      
      if (possibleMatches.length > 0) {
        outc.appendLine(`[PVF] 可能的匹配: ${possibleMatches.join(', ')}`);
      }
    }
  } catch (error) {
    outc.appendLine(`[PVF] 读取ANI文件时出错: ${String(error)}`);
  }
  
  return undefined;
}

export async function searchAniFiles(model: PvfModel, searchTerm: string): Promise<string[]> {
  const keys = Array.from((model as any).fileList?.keys?.() || []) as string[];
  const normalizedTerm = norm(searchTerm);
  
  const matches = keys.filter((k: string) => {
    const lowerKey = k.toLowerCase();
    return lowerKey.endsWith('.ani') && lowerKey.includes(normalizedTerm);
  });
  
  return matches.slice(0, 20); // 限制结果数量
}
