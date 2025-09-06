#!/usr/bin/env node
// Copy scriptTags definitions into dist for runtime (language providers)
const fs = require('fs');
const path = require('path');
const root = __dirname + '/..';
const srcDir = path.join(root, 'src', 'scriptLang', 'scriptTags');
const outDir = path.join(root, 'dist', 'scriptLang', 'scriptTags');
if (!fs.existsSync(srcDir)) process.exit(0);
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(srcDir)) {
  if (f.endsWith('.json')) {
    fs.copyFileSync(path.join(srcDir, f), path.join(outDir, f));
  }
}
console.log('[copy-script-tags] copied tag json files to dist/scriptLang/scriptTags');
