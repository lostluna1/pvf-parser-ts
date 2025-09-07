import * as vscode from 'vscode';
import { PvfModel } from './model';

export function registerPathLinkProvider(context: vscode.ExtensionContext, model: PvfModel) {
  // Cache to avoid re-parsing huge .lst files repeatedly
  interface CacheEntry { version: number; links: vscode.DocumentLink[]; truncated: boolean; }
  const lstCache = new Map<string, CacheEntry>();

  const provider: vscode.DocumentLinkProvider = {
    provideDocumentLinks(document: vscode.TextDocument, _token: vscode.CancellationToken) {
      if (document.uri.scheme !== 'pvf') return [];
      const docPath = document.uri.path.replace(/^\//, '').toLowerCase();
      const links: vscode.DocumentLink[] = [];
      const lines = document.lineCount;

      // Configuration (read each invocation to reflect user changes without reload)
      const cfg = vscode.workspace.getConfiguration();
      const maxLinesThreshold = cfg.get<number>('pvf.lstLinkMaxLines', 30000); // above: apply truncation strategy
      const scanCap = cfg.get<number>('pvf.lstLinkScanCap', 12000); // maximum lines to scan when truncated
      const maxLinks = cfg.get<number>('pvf.lstLinkMaxLinks', 6000); // cap total links for performance
      const allowTwoLine = cfg.get<boolean>('pvf.lstLinkEnableTwoLinePattern', true);

      // helper: normalize relative segments against a base directory
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

      // helper: resolve a possibly relative filePath against the document location and model keys
      const isLikelyPath = (s: string) => {
        const low = s.toLowerCase();
        // path-like if contains a slash or has a file extension like .kor.str, .ani, .skl, etc.
        if (low.indexOf('/') >= 0) return true;
        if (/\.[a-z0-9]{1,10}($|\.)/i.test(low)) return true; // has extension or composite extension
        if (/\.[a-z0-9]{1,5}$/i.test(low)) return true;
        return false;
      };
      const resolveKey = (filePathRaw: string) => {
        const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
        // exact match
        if (model.getFileByKey(filePath)) return filePath;
        // try relative to the document folder, handling ../ and ./
        const docDir = docPath.includes('/') ? docPath.substring(0, docPath.lastIndexOf('/')) : '';
        if (docDir) {
          const cand = filePath.startsWith('.') ? joinAndNormalize(docDir, filePath) : `${docDir}/${filePath}`;
          if (model.getFileByKey(cand)) return cand;
          // also try normalizing even if not starting with dot (covers mixed cases)
          const cand2 = joinAndNormalize(docDir, filePath);
          if (model.getFileByKey(cand2)) return cand2;
        }
        // try scanning all keys for an ending match
        const keys = (model as any).getAllKeys ? (model as any).getAllKeys() : Array.from((model as any).fileList?.keys?.() || []);
        const found = keys.find((k: string) => k.toLowerCase() === filePath || k.toLowerCase().endsWith('/' + filePath) || k.toLowerCase().endsWith(filePath));
        if (found) return found;
        // fallback to original (so opening will show not-found message)
        return filePath;
      };

      // If this is an .lst file, keep the previous special parsing (id + `path` forms)
      if (docPath.endsWith('.lst')) {
        const cacheKey = document.uri.toString();
        const large = lines > maxLinesThreshold;
        const effectiveScanLines = large ? Math.min(lines, scanCap) : lines;
        const cached = lstCache.get(cacheKey);
        if (cached && cached.version === document.version && (!large || cached.truncated)) {
          return cached.links; // reuse
        }
        let linkCount = 0;
        for (let i = 0; i < effectiveScanLines; i++) {
          const line = document.lineAt(i).text;
          // match combined form: number\t`path`
          const m = line.match(/^\s*(\d+)\s*\t\s*`([^`]+)`\s*$/);
          if (m) {
            const filePath = m[2].toLowerCase();
            // if the content inside backticks doesn't look like a path, don't create a link
            if (!isLikelyPath(filePath)) continue;
            // prefer link range that only covers the `path` content (exclude id)
            const startTick = line.indexOf('`');
            let range: vscode.Range;
            if (startTick >= 0) {
              const endTick = line.indexOf('`', startTick + 1);
              if (endTick > startTick) {
                range = new vscode.Range(new vscode.Position(i, startTick + 1), new vscode.Position(i, endTick));
              } else {
                range = new vscode.Range(new vscode.Position(i, startTick), new vscode.Position(i, line.length));
              }
            } else {
              range = new vscode.Range(new vscode.Position(i, line.indexOf(m[1])), new vscode.Position(i, line.length));
            }
            const resolved = resolveKey(filePath);
            const entry = { key: resolved, name: resolved.split('/').pop() || resolved, isFile: true };
            const args = JSON.stringify([entry]);
            const target = vscode.Uri.parse(`command:pvf.openFile?${args}`);
            links.push(new vscode.DocumentLink(range, target));
            linkCount++;
            if (linkCount >= maxLinks) break;
            continue;
          }
          if (allowTwoLine && !large && linkCount < maxLinks) { // degrade: skip two-line pattern for large files
            const mNumber = line.match(/^\s*(\d+)\s*$/);
            if (mNumber && i + 1 < effectiveScanLines) {
              const nextLine = document.lineAt(i + 1).text;
              const mPath = nextLine.match(/^\s*`([^`]+)`\s*$/);
              if (mPath) {
                const filePath = mPath[1].toLowerCase();
                if (!isLikelyPath(filePath)) { i++; continue; }
                const startTick = nextLine.indexOf('`');
                let range: vscode.Range;
                if (startTick >= 0) {
                  const endTick = nextLine.indexOf('`', startTick + 1);
                  if (endTick > startTick) {
                    range = new vscode.Range(new vscode.Position(i + 1, startTick + 1), new vscode.Position(i + 1, endTick));
                  } else {
                    range = new vscode.Range(new vscode.Position(i + 1, startTick), new vscode.Position(i + 1, nextLine.length));
                  }
                } else {
                  range = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i + 1, nextLine.length));
                }
                const resolved = resolveKey(filePath);
                const entry = { key: resolved, name: resolved.split('/').pop() || resolved, isFile: true };
                const args = JSON.stringify([entry]);
                const target = vscode.Uri.parse(`command:pvf.openFile?${args}`);
                links.push(new vscode.DocumentLink(range, target));
                linkCount++;
                if (linkCount >= maxLinks) break;
                i++; // skip next line
              }
            }
          }
          if (linkCount >= maxLinks) break;
        }
        lstCache.set(cacheKey, { version: document.version, links: links, truncated: large });
        return links;
      }

      // For .nut files: scan for quoted string literals that look like file paths and create fuzzy search links
      if (docPath.endsWith('.nut')) {
        const baseDir = docPath.includes('/') ? docPath.substring(0, docPath.lastIndexOf('/')) : '';
        const dq = /"([^"\\]|\\.)*"/g; // double-quoted strings with escapes
        const sq = /'([^'\\]|\\.)*'/g;  // single-quoted strings with escapes
        for (let i = 0; i < lines; i++) {
          const line = document.lineAt(i).text;
          const processMatches = (re: RegExp) => {
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(line)) !== null) {
              const full = m[0];
              const inner = full.substring(1, full.length - 1);
              const low = inner.toLowerCase();
              if (low.endsWith('.img')) continue; // skip images
              if (!isLikelyPath(low)) continue;   // must look like a path
              const args = JSON.stringify([inner, baseDir]);
              const target = vscode.Uri.parse(`command:pvf.openFuzzyPath?${args}`);
              // link range excludes quotes
              const start = m.index + 1;
              const end = start + inner.length;
              links.push(new vscode.DocumentLink(new vscode.Range(new vscode.Position(i, start), new vscode.Position(i, end)), target));
            }
          };
          processMatches(dq);
          processMatches(sq);
        }
        return links;
      }

      // For all other pvf files: scan for backtick-enclosed tokens that look like file paths and create fuzzy search links
      for (let i = 0; i < lines; i++) {
        const line = document.lineAt(i).text;
        const regex = /`([^`]+)`/g;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(line)) !== null) {
          const candidate = m[1];
          const low = candidate.toLowerCase();
          // skip image files explicitly
          if (low.endsWith('.img')) continue;
          // heuristics: must look like a path (contain /) or have an extension
          if (!(low.indexOf('/') >= 0 || /\.[a-z0-9]{1,5}$/i.test(low))) continue;
          // create a link that calls fuzzy open with base directory info
          const baseDir = docPath.includes('/') ? docPath.substring(0, docPath.lastIndexOf('/')) : '';
          const args = JSON.stringify([candidate, baseDir]);
          const target = vscode.Uri.parse(`command:pvf.openFuzzyPath?${args}`);
          const start = m.index + 1; // inside backtick
          const end = start + m[1].length;
          const range = new vscode.Range(new vscode.Position(i, start), new vscode.Position(i, end));
          links.push(new vscode.DocumentLink(range, target));
        }
      }

      return links;
    }
  };
  const sel = vscode.languages.registerDocumentLinkProvider({ scheme: 'pvf' }, provider);
  context.subscriptions.push(sel);
}
