import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();

export type IndexRecord = { npk: string; entryPath: string };
let indexMap: Map<string, IndexRecord> | null = null;

export async function loadIndexFromDisk(context: vscode.ExtensionContext): Promise<Map<string, IndexRecord> | null> {
  try {
    const storage = context.globalStorageUri.fsPath;
    const file = path.join(storage, 'npk-index.json');
    const txt = await fs.readFile(file, 'utf8');
    const obj = JSON.parse(txt);
    const m = new Map<string, IndexRecord>();
    for (const k of Object.keys(obj)) {
      m.set(k, obj[k]);
    }
    indexMap = m;
    return m;
  } catch (e) {
    return null;
  }
}

export async function saveIndexToDisk(context: vscode.ExtensionContext, m: Map<string, IndexRecord>) {
  try {
    await fs.mkdir(context.globalStorageUri.fsPath, { recursive: true });
    const file = path.join(context.globalStorageUri.fsPath, 'npk-index.json');
    const obj: Record<string, IndexRecord> = {};
    for (const [k, v] of m) obj[k] = v;
    await fs.writeFile(file, JSON.stringify(obj), 'utf8');
  } catch (e) {
    // ignore
  }
}

export function getIndex(): Map<string, IndexRecord> | null {
  return indexMap;
}

/**
 * 从索引中查找 NPK 文件
 * @param logical 逻辑路径
 * @returns
 */
export async function findNpkFor(logical: string): Promise<IndexRecord | undefined> {
  if (!logical) return undefined;
  // normalize and strip surrounding quotes/backticks and stray backticks
  let s = String(logical).trim();
  if (/^["'`].*["'`]$/.test(s)) s = s.slice(1, -1);
  s = s.replace(/`/g, '');
  const key = norm(s);
  if (indexMap && indexMap.has(key)) return indexMap.get(key);

  if (!indexMap) return undefined;

  // try variant without leading 'sprite/'
  if (key.startsWith('sprite/')) {
    const noSprite = key.slice('sprite/'.length);
    if (indexMap.has(noSprite)) return indexMap.get(noSprite);
  }

  // fallback: try match by tail segment (last 1 or 2 segments)
  const parts = key.split('/').filter(Boolean);
  const tail1 = parts.slice(-1).join('/');
  const tail2 = parts.slice(-2).join('/');
  for (const [k, v] of indexMap) {
    if (!k) continue;
    if (k.endsWith('/' + tail2) || k.endsWith('/' + tail1) || k === tail1) return v;
  }

  return undefined;
}

export type ProgressCallback = (done: number, total: number, file?: string) => void;

export async function buildIndex(context: vscode.ExtensionContext, roots: string[], progressCallback?: ProgressCallback): Promise<Map<string, IndexRecord>> {
  const { readNpkEntries, readFileBuffer } = await import('../npk/npkReader.js');
  const m = new Map<string, IndexRecord>();
  const scanDirs = new Set<string>();
  for (const r of roots) {
    if (!r) continue;
    scanDirs.add(r);
    scanDirs.add(path.join(r, 'ImagePacks2'));
  }

  // First, collect all npk files to know total
  const npkFiles: string[] = [];
  for (const dir of Array.from(scanDirs)) {
    try {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const it of items) {
        if (!it.isFile()) continue;
        const lower = it.name.toLowerCase();
        if (!lower.endsWith('.npk')) continue;
        npkFiles.push(path.join(dir, it.name));
      }
    } catch { }
  }

  let done = 0;
  const total = npkFiles.length;
  for (const full of npkFiles) {
    try {
      const buf = await readFileBuffer(full);
      const entries = readNpkEntries(buf);
      for (const e of entries) {
        try {
          const k = norm(e.path || '');
          if (!k) continue;
          if (!m.has(k)) m.set(k, { npk: full, entryPath: e.path });
        } catch { }
      }
    } catch { }
    done++;
    try { if (progressCallback) progressCallback(done, total, full); } catch { }
  }

  indexMap = m;
  await saveIndexToDisk(context, m);
  return m;
}
