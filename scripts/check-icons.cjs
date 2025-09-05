#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Load TS source by simple regex (avoid transpile requirement)
const iconsTs = fs.readFileSync(path.join(__dirname, '..', 'src', 'pvf', 'fileIcons.ts'), 'utf8');
const mapMatch = iconsTs.match(/export const extensionIconMap:[^{]+{([\s\S]*?)};/);
if(!mapMatch){
  console.error('未找到 extensionIconMap');
  process.exit(1);
}
const entries = mapMatch[1].split(/\n/)
  .map(l=>l.trim())
  .filter(l=>l && !l.startsWith('//') && l.includes(':'))
  .map(l=>l.replace(/['",]/g,'').trim());
const tsExts = entries.map(l=>l.split(':')[0].trim()).filter(Boolean);

// Load icon theme JSON
const themePath = path.join(__dirname, '..', 'media', 'pvf-icon-theme.json');
let theme = { fileExtensions: {} };
if (fs.existsSync(themePath)) theme = JSON.parse(fs.readFileSync(themePath,'utf8'));
const themeExts = Object.keys(theme.fileExtensions||{}).map(e=>'.'+e);

// Compute differences (ignore multi-dot like .ani.als which theme can't support)
const unsupported = tsExts.filter(e=>e.split('.').length>2); // e.g. .ani.als
const missingInTheme = tsExts.filter(e=>!unsupported.includes(e) && !themeExts.includes(e));

if (missingInTheme.length === 0) {
  console.log('图标映射同步正常，无需处理。');
} else {
  console.log('以下扩展在 fileIcons.ts 中存在，但 icon theme 中缺失:');
  missingInTheme.forEach(e=>console.log('  '+e));
  console.log('\n请在 media/pvf-icon-theme.json 的 fileExtensions 中加入(去掉开头点):');
  missingInTheme.forEach(e=>console.log('  "'+e.slice(1)+'": "(自定义id)"'));
}

if (unsupported.length) {
  console.log('\n不支持在 icon theme 中直接映射的多段扩展 (运行期已支持):');
  unsupported.forEach(e=>console.log('  '+e));
}
