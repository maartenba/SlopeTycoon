/** `npm run verify:pwa [-- --base /slopetycoon/] [--dist dist-site/play --no-404]` (after `npm run build` / `build:site`): serves dist/ with a tiny static server and checks every PWA asset resolves. */
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { pngSize } from './lib/png';
import { createPagesServer, normalizeBase } from './lib/static-server';

const argv = process.argv;
const distArg = argv.indexOf('--dist') >= 0 ? argv[argv.indexOf('--dist') + 1]! : 'dist';
const dist = join(process.cwd(), distArg);
const TYPES: Record<string, RegExp> = {
  '.html': /^text\/html/, '.js': /javascript/, '.css': /^text\/css/, '.webmanifest': /manifest\+json|application\/json/,
  '.png': /^image\/png/, '.svg': /^image\/svg\+xml/, '.json': /json/, '.wasm': /wasm/, '.woff2': /font\/woff2/,
};

const problems: string[] = [];
const check = (ok: boolean, msg: string): void => { if (!ok) problems.push(msg); };

if (!existsSync(join(dist, 'sw.js'))) { console.error(`${distArg}/sw.js missing: run \`npm run build\` (or build:site) first`); process.exit(1); }
const argBase = process.argv.indexOf('--base') >= 0 ? process.argv[process.argv.indexOf('--base') + 1] : undefined;
const mount = argBase ? normalizeBase(argBase) : '/';
const server = createPagesServer(dist, mount);
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${mount}`;
const get = async (rel: string): Promise<{ status: number; type: string; body: Buffer }> => {
  const r = await fetch(new URL(rel, base)); return { status: r.status, type: r.headers.get('content-type') ?? '', body: Buffer.from(await r.arrayBuffer()) };
};

try {
  const idx = await get('./'); check(idx.status === 200 && TYPES['.html']!.test(idx.type), 'index.html not served as text/html');
  const html = idx.body.toString();
  check(/rel="manifest" href="\.\/manifest\.webmanifest"/.test(html), 'index.html must link ./manifest.webmanifest (relative)');
  check(!/(?:src|href)="\/(?!\/)/.test(html), 'index.html contains absolute "/" URLs (breaks subpath hosting)');
  const man = JSON.parse((await get('./manifest.webmanifest')).body.toString()) as { start_url: string; scope: string; icons: Array<{ src: string; sizes: string; purpose?: string }> };
  check(man.start_url === './' && man.scope === './', 'manifest start_url/scope must be "./"');
  for (const i of man.icons) {
    const r = await get(i.src); const sz = pngSize(r.body);
    check(r.status === 200 && !!sz && `${sz.w}x${sz.h}` === i.sizes, `icon ${i.src} missing or wrong size`);
  }
  check(man.icons.some((i) => i.purpose === 'maskable'), 'no maskable icon');
  const sw = (await get('./sw.js')); check(sw.status === 200 && TYPES['.js']!.test(sw.type), 'sw.js not served as JavaScript');
  const code = sw.body.toString();
  const urls = [...code.matchAll(/"?url"?:"(\.\/[^"]+)"/g)].map((m) => m[1]!);
  check(urls.length > 3, `precache list suspiciously small (${urls.length})`);
  check(new Set(urls).size === urls.length, 'duplicate precache entries');
  check(/slope-tycoon|\d+\.\d+\.\d+-[0-9a-f]{10}/.test(code), 'sw.js has no cache version');
  check(!/fonts\.(googleapis|gstatic)\.com/.test(html), 'index.html must not reference Google Fonts (self-hosted, offline)');
  let total = 0, gz = 0;
  for (const u of urls) {
    const r = await get(u); total += r.body.length; gz += gzipSync(r.body).length;
    const ext = extname(u); check(r.status === 200, `${u} -> ${r.status}`);
    if (TYPES[ext]) check(TYPES[ext]!.test(r.type), `${u} content-type "${r.type}"`);
  }
  for (const must of ['./index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/favicon.svg', './fonts/nunito-latin.woff2', './fonts/nunito-latin-ext.woff2', './fonts/lilita-one-latin.woff2', './fonts/lilita-one-latin-ext.woff2', './fonts/OFL.txt']) check(urls.includes(must), `${must} not precached`);
  console.log(`[verify-pwa] ${urls.length} precached files, ${(total / 1024).toFixed(0)} kB raw, ${(gz / 1024).toFixed(0)} kB gzip (excl. sw.js)`);
  if (argBase && !argv.includes('--no-404')) {
    const miss = await fetch(new URL('definitely/missing', base)); const t = await miss.text();
    check(miss.status === 404 && t.includes('Slope Tycoon'), 'unknown path should return 404.html (run post-build)');
  }
} finally { server.close(); }
if (problems.length) { for (const p of problems) console.error('✗', p); process.exit(1); }
if (problems.length) { for (const p of problems) console.error('✗', p); process.exit(1); }
console.log(`[verify-pwa] OK${argBase ? ` (base ${mount})` : ''}${distArg !== 'dist' ? ` [${distArg}]` : ''}`);
