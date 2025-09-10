import { build } from 'esbuild';
import { rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const entry = resolve('src/webview/reactDemo.tsx');
const outdir = resolve('media/webview');
try { rmSync(outdir, { recursive: true, force: true }); } catch {}
mkdirSync(outdir, { recursive: true });

const isProd = process.argv.includes('--prod');

const pkgStubPlugin = {
  name: 'pkg-stub',
  setup(b) {
    b.onResolve({ filter: /package\.json$/ }, args => {
      // 若路径指向上一层空 package.json（表现为以 ../package.json 结尾），用 stub 替换
      if (args.path.endsWith('../package.json') || args.path === '../package.json') {
        return { path: 'stub-package-json', namespace: 'pkgstub' };
      }
      return null;
    });
    b.onLoad({ filter: /.*/, namespace: 'pkgstub' }, () => ({
      contents: '{"name":"stub-root","version":"0.0.0"}',
      loader: 'json'
    }));
  }
};

await build({
  absWorkingDir: resolve('.'),
  entryPoints: [entry],
  outdir,
  bundle: true,
  minify: isProd,
  sourcemap: !isProd,
  format: 'iife',
  platform: 'browser',
  target: ['es2019'],
  logLevel: 'info',
  external: [],
  mainFields: ['module','main'],
  conditions: ['browser','default'],
  plugins: [pkgStubPlugin],
  define: { 'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development') },
});

console.log('webview build complete');
