// 单一来源方案 (Option A): 以 pvf-icon-theme.json 为唯一数据源。
// - 普通扩展：使用 fileExtensions + iconDefinitions。
// - 多段扩展：放在自定义字段 x-multiExtensions（键写全扩展，如 ".ani.als"）。
// - 运行期构建 extensionIconMap，供 TreeView 使用；编辑器标签图标由 VS Code 静态读取主题。

import iconTheme from '../../media/pvf-icon-theme.json';

// 运行期合成映射：扩展 -> 图标文件名（去掉前缀路径，只保留文件部分，便于与 provider 中拼路径）
const map: Record<string, string> = {};

// 从 fileExtensions 建立映射
if (iconTheme && (iconTheme as any).fileExtensions && (iconTheme as any).iconDefinitions) {
  const defs = (iconTheme as any).iconDefinitions as Record<string, { iconPath: string }>;
  for (const ext in (iconTheme as any).fileExtensions) {
    const defId = (iconTheme as any).fileExtensions[ext];
    const def = defs[defId];
    if (def && def.iconPath) {
      const file = def.iconPath.split(/[\\/]/).pop()!;
      map['.' + ext] = file;
    }
  }
}

// 多段扩展 (x-multiExtensions): {".ani.als":"./icons/xxx.png"}
if ((iconTheme as any)['x-multiExtensions']) {
  const multi = (iconTheme as any)['x-multiExtensions'] as Record<string, string>;
  for (const k in multi) {
    const file = multi[k].split(/[\\/]/).pop()!;
    map[k.toLowerCase()] = file;
  }
}

// 需求更新：除 ani/lst/str/als(.ani.als) 外全部使用统一占位图标
const PLACEHOLDER = 'icons8-placeholder-thumbnail-xml-28.png';
// 记录已有专用扩展，其余在 getIconForFile 中返回占位
const dedicatedExts = new Set(Object.keys(map));

export const extensionIconMap: Record<string, string> = map;

// 根据文件名获取匹配的图标，支持多重扩展（如 .ani.als）
export function getIconForFile(name: string): string | undefined {
  const lower = name.toLowerCase();
  // 多后缀优先匹配（例如 .ani.als）
  const parts = lower.split('.');
  for (let i = 1; i < parts.length; i++) {
    const ext = '.' + parts.slice(i).join('.');
    if (extensionIconMap[ext]) return extensionIconMap[ext];
  }
  // 单一后缀匹配
  const lastDot = lower.lastIndexOf('.');
  if (lastDot !== -1) {
    const ext = lower.substring(lastDot);
    if (extensionIconMap[ext]) return extensionIconMap[ext];
  }
  // 其它一律占位
  return PLACEHOLDER;
}
