const { mkdirSync, copyFileSync } = require('fs');
const { resolve } = require('path');

// 简单复制 TSX 编译后的 JS (dist/webview/*) 到 media/webview 下。
// 注意：目前未做打包，仅单文件。如果有依赖 (import react ...) 会失败；仍需 esbuild。
// 暂时提示用户父目录空 package.json 需要填写以让 esbuild 工作。

console.log('[copy-webview] 如果未看到 React Demo，请在工作区根填充 package.json 再运行 npm run build:webview');
