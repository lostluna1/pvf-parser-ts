import * as vscode from 'vscode';

// 轻量解析：提取 name / grade / rarity 及一组主属性
interface EquPreviewMeta {
  name?: string;
  grade?: number;
  rarity?: number;
  stats: Record<string, number>;
  version: number;
  md?: vscode.MarkdownString;
  summary?: string;
}

const STAT_ORDER: [string, string][] = [
  ['physical attack', 'STR'],
  ['magical attack', 'INT'],
  ['equipment physical attack', '物攻'],
  ['equipment magical attack', '魔攻'],
  ['move speed', '移速'],
  ['attack speed', '攻速'],
  ['cast speed', '施放'],
  ['fire attack', '火'],
  ['water attack', '水'],
  ['dark attack', '暗'],
  ['light attack', '光'],
];

const cache = new WeakMap<vscode.TextDocument, EquPreviewMeta>();

function parse(doc: vscode.TextDocument): EquPreviewMeta {
  const prev = cache.get(doc);
  if (prev && prev.version === doc.version) return prev;
  const text = doc.getText();
  const meta: EquPreviewMeta = { stats: {}, version: doc.version };
  const name = /\[name\]\s*`([^`]*)`/i.exec(text); if (name) meta.name = name[1].trim();
  const grade = /\[grade\]\s*(\d+)/i.exec(text); if (grade) meta.grade = Number(grade[1]);
  const rarity = /\[rarity\]\s*(\d+)/i.exec(text); if (rarity) meta.rarity = Number(rarity[1]);
  const lines = text.split(/\r?\n/, 400); // 仅前 400 行
  for (const ln of lines) {
    const m = /^\s*\[([^\]]+)\]\s*([+\-]?[0-9]+(?:\.[0-9]+)?)/i.exec(ln);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (STAT_ORDER.some(([k]) => k === key)) {
      const num = Number(m[2]);
      if (!isNaN(num)) meta.stats[key] = num;
    }
  }
  build(meta);
  cache.set(doc, meta);
  return meta;
}

function build(meta: EquPreviewMeta) {
  // Summary (单行放在 decoration 中): 名称 + G + R + 选取前几条属性
  const attrs: string[] = [];
  for (const [k, label] of STAT_ORDER) {
    if (k in meta.stats) attrs.push(`${label}:${meta.stats[k]}`);
    if (attrs.length >= 4) break; // 最多四个
  }
  const stars = meta.rarity !== undefined ? '★★★★★'.slice(0, Math.min(meta.rarity, 5)) : '';
  const tags: string[] = [];
  if (meta.grade !== undefined) tags.push(`G${meta.grade}`);
  if (meta.rarity !== undefined) tags.push(`R${meta.rarity}`);
  const head = meta.name || '(未命名)';
  meta.summary = `${stars ? stars + ' ' : ''}${head}${tags.length ? '  [' + tags.join('/') + ']' : ''}${attrs.length ? '  ' + attrs.join('  ') : ''}`;
  // Markdown hover: 标题彩色 + 表格
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  const colorPalette = ['#ccc','#3fb950','#4184d9','#a371f7','#f0883e','#db524b'];
  const color = meta.rarity !== undefined && meta.rarity < colorPalette.length ? colorPalette[meta.rarity] : '#ddd';
  md.appendMarkdown(`<span style="color:${color};font-weight:600;font-size:14px;">${head.replace(/</g,'&lt;')}</span>`);
  if (stars || tags.length) md.appendMarkdown(`\n<span style="color:${color};">${stars}</span> ${tags.join(' / ')}`);
  const entries = STAT_ORDER.filter(([k]) => k in meta.stats);
  if (entries.length) {
    md.appendMarkdown('\n\n| 属性 | 数值 |\n|:----|:----:|\n');
    for (const [k,label] of entries) {
      md.appendMarkdown(`| ${label} | ${meta.stats[k]} |\n`);
    }
  }
  meta.md = md;
}

const decorationType = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  after: {
    margin: '0 0 0 8px',
    color: new vscode.ThemeColor('descriptionForeground'),
    fontStyle: 'italic'
  }
});

export function registerEquInlinePreview(context: vscode.ExtensionContext) {
  context.subscriptions.push(decorationType);
  const update = (editor?: vscode.TextEditor) => {
    try {
      if (!editor || editor.document.languageId !== 'pvf-equ') return;
      const meta = parse(editor.document);
      const firstLine = editor.document.lineAt(0);
      const range = new vscode.Range(firstLine.range.start, firstLine.range.start); // anchor at column 0
      editor.setDecorations(decorationType, [
        { range, renderOptions: { after: { contentText: meta.summary || '' } }, hoverMessage: meta.md }
      ]);
    } catch {}
  };
  const debouncedEditors = new Set<string>();
  const schedule = (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'pvf-equ') return;
    const key = doc.uri.toString();
    if (debouncedEditors.has(key)) return;
    debouncedEditors.add(key);
    setTimeout(() => {
      debouncedEditors.delete(key);
      const ed = vscode.window.visibleTextEditors.find(e => e.document === doc);
      update(ed);
    }, 120);
  };
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(e => schedule(e.document)));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(ed => update(ed)));
  for (const ed of vscode.window.visibleTextEditors) update(ed);
}
