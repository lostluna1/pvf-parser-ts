import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
// sqlite 运行时按需加载，避免在未安装 native 模块时导致激活报错
let sqlite3: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let sqliteOpen: any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Database = any; // 简化类型（只用到 .all/.exec/.prepare）
try {
  // 使用 require 兼容 CommonJS
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  sqlite3 = require('sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sqlite = require('sqlite');
  sqliteOpen = sqlite.open;
} catch {
  // 如果失败则稍后第一次使用时报错或回退
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();

export type IndexRecord = { npk: string; entryPath: string };
let indexMap: Map<string, IndexRecord> | null = null;
let db: Database | null = null;

async function getDb(context: vscode.ExtensionContext): Promise<Database> {
  if (db) return db;
  const storage = context.globalStorageUri.fsPath;
  await fs.mkdir(storage, { recursive: true });
  const file = path.join(storage, 'npk-index.sqlite');
  if (!sqliteOpen || !sqlite3) throw new Error('sqlite 模块未安装');
  db = await sqliteOpen({ filename: file, driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS entries (
    key TEXT PRIMARY KEY,
    npk TEXT NOT NULL,
    entryPath TEXT NOT NULL
  );`);
  return db;
}

export async function loadIndexFromDisk(context: vscode.ExtensionContext): Promise<Map<string, IndexRecord> | null> {
  try {
    const database = await getDb(context);
  const rows = await database.all(`SELECT key, npk, entryPath FROM entries`);
    const m = new Map<string, IndexRecord>();
    for (const r of rows as any) {
      m.set(r.key, { npk: r.npk, entryPath: r.entryPath });
    }
    indexMap = m;
    return m;
  } catch {
    return null;
  }
}

export async function saveIndexToDisk(context: vscode.ExtensionContext, m: Map<string, IndexRecord>) {
  try {
    const database = await getDb(context);
    // use transaction for bulk insert
    await database.exec('BEGIN');
    await database.exec('DELETE FROM entries');
    const stmt = await database.prepare('INSERT INTO entries (key, npk, entryPath) VALUES (?, ?, ?)');
    for (const [k, v] of m) {
      try { await stmt.run(k, v.npk, v.entryPath); } catch { }
    }
    await stmt.finalize();
    await database.exec('COMMIT');
  } catch {
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

  // fallback: controlled suffix match (collect all, only return when唯一)
  const parts = key.split('/').filter(Boolean);
  const tail1 = parts.slice(-1).join('/');
  const tail2 = parts.slice(-2).join('/');
  const candidates: IndexRecord[] = [];
  for (const [k, v] of indexMap) {
    if (!k) continue;
    if (k === key) return v; // exact (should have hit earlier)
    if (parts.length >= 2 && (k.endsWith('/' + tail2))) candidates.push(v);
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    // 尝试仅文件名匹配，但需确保唯一
    const nameMatches: IndexRecord[] = [];
    for (const [k, v] of indexMap) {
      if (k.endsWith('/' + tail1) || k === tail1) nameMatches.push(v);
    }
    if (nameMatches.length === 1) return nameMatches[0];
  }

  return undefined;
}

// 返回所有可能的候选（尾部 2 段优先，否则尾部 1 段）供上层做 disambiguation
export function findAllCandidates(logical: string): IndexRecord[] {
  if (!indexMap) return [];
  const key = norm(logical);
  if (indexMap.has(key)) return [indexMap.get(key)!];
  const parts = key.split('/').filter(Boolean);
  const tail1 = parts.slice(-1).join('/');
  const tail2 = parts.slice(-2).join('/');
  const twoSeg: IndexRecord[] = [];
  const oneSeg: IndexRecord[] = [];
  for (const [k, v] of indexMap) {
    if (k === key) return [v];
    if (parts.length >= 2 && k.endsWith('/' + tail2)) twoSeg.push(v);
    else if (k.endsWith('/' + tail1) || k === tail1) oneSeg.push(v);
  }
  return twoSeg.length > 0 ? twoSeg : oneSeg;
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
