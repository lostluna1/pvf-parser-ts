import * as vscode from 'vscode';
import { PvfModel } from './model';

export function registerListLinkProvider(context: vscode.ExtensionContext, model: PvfModel) {
  const provider: vscode.DocumentLinkProvider = {
    provideDocumentLinks(document: vscode.TextDocument, _token: vscode.CancellationToken) {
      if (document.uri.scheme !== 'pvf') return [];
      const path = document.uri.path.replace(/^\//, '').toLowerCase();
      if (!path.endsWith('.lst')) return [];
      const links: vscode.DocumentLink[] = [];
      const lines = document.lineCount;

      // helper: resolve a possibly relative filePath against the .lst location and model keys
      const resolveKey = (filePathRaw: string) => {
        const filePath = filePathRaw.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
        // exact match
        if (model.getFileByKey(filePath)) return filePath;
        // try relative to the .lst folder
        const lstDir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
        if (lstDir) {
          const cand = `${lstDir}/${filePath}`;
          if (model.getFileByKey(cand)) return cand;
        }
        // try scanning all keys for an ending match
        const keys = (model as any).getAllKeys ? (model as any).getAllKeys() : Array.from((model as any).fileList?.keys?.() || []);
        const found = keys.find((k: string) => k.toLowerCase() === filePath || k.toLowerCase().endsWith('/' + filePath) || k.toLowerCase().endsWith(filePath));
        if (found) return found;
        // fallback to original (so opening will show not-found message)
        return filePath;
      };

      for (let i = 0; i < lines; i++) {
        const line = document.lineAt(i).text;
        // match combined form: number\t`path`
        const m = line.match(/^\s*(\d+)\s*\t\s*`([^`]+)`\s*$/);
        if (m) {
          const filePath = m[2].toLowerCase();
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
          continue;
        }
        // match two-line form: number on this line, path on next
        const mNumber = line.match(/^\s*(\d+)\s*$/);
        if (mNumber && i + 1 < lines) {
          const nextLine = document.lineAt(i + 1).text;
          const mPath = nextLine.match(/^\s*`([^`]+)`\s*$/);
          if (mPath) {
            const filePath = mPath[1].toLowerCase();
            // only link the path portion on the next line (inside backticks)
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
            i++; // skip next line
          }
        }
      }
      return links;
    }
  };
  const sel = vscode.languages.registerDocumentLinkProvider({ scheme: 'pvf' }, provider);
  context.subscriptions.push(sel);
}
