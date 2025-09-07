import * as iconv from 'iconv-lite';
import * as vscode from 'vscode';

// 运行期（AUTO 模式下）依据包内检测出的基础编码覆盖：非 .nut 文件使用该覆盖
let runtimeEncodingOverride: string | null = null;
export function setRuntimeEncodingOverride(enc: string | null) { runtimeEncodingOverride = enc; }
export function getRuntimeEncodingOverride(): string | null { return runtimeEncodingOverride; }

// Return preferred encoding by key (nut -> cp949, otherwise cp950)
export function encodingForKey(key: string): string {
  try {
    const cfg = vscode.workspace.getConfiguration();
    const mode = (cfg.get<string>('pvf.encodingMode', 'AUTO') || 'AUTO').toUpperCase();
    const lower = key.toLowerCase();
    if (mode === 'AUTO') {
  if (lower.endsWith('.nut')) return 'cp949';
  if (runtimeEncodingOverride) return runtimeEncodingOverride;
  return 'cp950';
    }
    switch (mode) {
      case 'KR': return 'cp949';
      case 'TW': return 'cp950';
      case 'CN': return 'gb18030';
      case 'JP': return 'shift_jis';
      case 'UTF8': return 'utf8';
      default: return 'cp950';
    }
  } catch {
    // 回退旧逻辑
    const lower = key.toLowerCase();
    if (lower.endsWith('.nut')) return 'cp949';
    return 'cp950';
  }
}

// Text-like extensions
export function isTextByExtension(lowerKey: string): boolean {
  return lowerKey.endsWith('.skl')
    || lowerKey.endsWith('.lst')
    || lowerKey.endsWith('.txt')
    || lowerKey.endsWith('.cfg')
    || lowerKey.endsWith('.def')
    || lowerKey.endsWith('.inc')
    || lowerKey.endsWith('.xml')
    || lowerKey.endsWith('.ani');
}

// Detect encoding using BOM and NUL distribution heuristic; defaults to encodingForKey
export function detectEncoding(key: string, bytes: Uint8Array): string {
  const preferred = encodingForKey(key);
  if (bytes.length >= 2) {
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf16le';
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf16be';
  }
  if (bytes.length >= 3) {
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf8';
  }
  if (bytes.length >= 4) {
    let nulEven = 0, nulOdd = 0;
    const n = Math.min(bytes.length, 4096);
    for (let i = 0; i < n; i++) {
      if (bytes[i] === 0) {
        if ((i & 1) === 0) nulEven++; else nulOdd++;
      }
    }
    const nulRatio = (nulEven + nulOdd) / n;
    if (nulRatio > 0.2) return nulEven > nulOdd ? 'utf16le' : 'utf16be';
  }
  return preferred;
}

export function isTextEncoding(enc: string): boolean {
  return enc === 'utf16le' || enc === 'utf16be' || enc === 'cp949' || enc === 'cp950' || enc === 'utf8' || enc === 'gb18030' || enc === 'shift_jis';
}

export function isPrintableText(text: string): boolean {
  if (!text) return false;
  const n = Math.min(text.length, 4096);
  if (n === 0) return false;
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) printable++;
  }
  return (printable / n) > 0.85;
}
