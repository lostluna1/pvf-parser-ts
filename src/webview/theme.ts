import { webLightTheme, webDarkTheme, Theme, BrandVariants, createLightTheme, createDarkTheme } from '@fluentui/react-components';

export type AppThemeMode = 'light' | 'dark';

// 可选品牌色（示例占位，实际需要时填入 BrandVariants）
const brand: BrandVariants | undefined = undefined;

const commonOverrides: Partial<Theme> = {
  fontFamilyBase: '"Microsoft YaHei","微软雅黑",' + webLightTheme.fontFamilyBase,
};

// 简单合并（浅拷贝）替代 mergeThemes
function shallowMerge<T extends object>(base: T, ext: Partial<T>): T {
  return { ...(base as any), ...(ext as any) } as T;
}

function buildBase(mode: AppThemeMode): Theme {
  let base: Theme;
  if (brand) {
    base = mode === 'light' ? createLightTheme(brand) : createDarkTheme(brand);
  } else {
    base = mode === 'light' ? webLightTheme : webDarkTheme;
  }
  return shallowMerge(base, commonOverrides as Theme);
}

const cache = new Map<AppThemeMode, Theme>();
export function getAppTheme(mode: AppThemeMode): Theme {
  if (!cache.has(mode)) cache.set(mode, buildBase(mode));
  return cache.get(mode)!;
}

export function resolveModeFromBg(bg: string): AppThemeMode {
  return bg === 'light' ? 'light' : 'dark';
}

export function getAppThemeWithOverrides(mode: AppThemeMode, overrides: Partial<Theme>): Theme {
  return shallowMerge(getAppTheme(mode), overrides as Theme);
}
