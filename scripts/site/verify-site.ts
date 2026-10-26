/** `npm run verify:site [-- --base /slopetycoon/]`: serves dist-site/ like GitHub Pages under a base (default: both `/` and `/slopetycoon/`) and crawls it over HTTP:
 * every internal link/image of the website resolves (200), the game lives at <base>play/ with its manifest + SW scope there, unknown paths give 404.html. */
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { createPagesServer, normalizeBase } from '../lib/static-server';
import { extractRefs } from './crawl';

const dist = join(process.cwd(), 'dist-site');
const bi = process.argv.indexOf('--base');
const bases = bi >= 0 ? [normalizeBase(process.argv[bi + 1]!)] : ['/', '/slopetycoon/'];
const problems: string[] = [];
const check = (ok: boolean, m: string): void => { if (!ok) problems.push(m); };

for (const mount of bases) {
  const server = createPagesServer(dist, mount);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const seen = new Set<string>(), queue = [`${origin}${mount}`, `${origin}${mount}guide/`];
    while (queue.length) {
      const url = queue.pop()!; if (seen.has(url)) continue; seen.add(url);
      const r = await fetch(url); check(r.status === 200, `[${mount}] ${url} -> ${r.status}`);
      const type = r.headers.get('content-type') ?? '';
      if (!type.startsWith('text/html') || url.includes('/play/')) { await r.arrayBuffer(); continue; }
      const html = await r.text();
      for (const ref of extractRefs(html)) {
        if (/^(https?:|mailto:|data:|#)/.test(ref.url) || ref.url === '') continue;
        const next = new URL(ref.url, url); next.hash = '';
        check(next.pathname.startsWith(mount), `[${mount}] ${url}: ${ref.url} escapes the base`);
        if (next.pathname.startsWith(mount)) queue.push(next.toString());
      }
    }
    const get = async (p: string): Promise<Response> => fetch(`${origin}${mount}${p}`);
    const man = await (await get('play/manifest.webmanifest')).json() as { start_url: string; scope: string };
    check(man.start_url === './' && man.scope === './', `[${mount}] play manifest start_url/scope must be './' (resolves to ${mount}play/)`);
    const playHtml = await (await get('play/')).text();
    check(/rel="manifest" href="\.\/manifest\.webmanifest"/.test(playHtml), `[${mount}] play/index.html must link ./manifest.webmanifest`);
    check(!/(?:src|href)="\/(?!\/)/.test(playHtml), `[${mount}] play/index.html has root-absolute URLs`);
    const sw = await get('play/sw.js'); check(sw.status === 200 && /javascript/.test(sw.headers.get('content-type') ?? ''), `[${mount}] play/sw.js not served as JS`);
    const mainJs = [...playHtml.matchAll(/src="(\.\/assets\/[^"]+\.js)"/g)].map((m) => m[1]!)[0];
    if (mainJs) { const code = await (await get(`play/${mainJs.slice(2)}`)).text(); check(/["']\.\/sw\.js["']/.test(code), `[${mount}] game must register ./sw.js (scope = ${mount}play/)`); }
    check((await get('sw.js')).status === 404, `[${mount}] the website root must not serve a service worker`);
    const miss = await get('definitely/missing'); check(miss.status === 404 && (await miss.text()).includes('Slope Tycoon'), `[${mount}] unknown path should return 404.html`);
    console.log(`[verify-site] base ${mount}: ${seen.size} URLs crawled`);
  } finally { server.close(); }
  try { execFileSync('npx', ['vite-node', 'scripts/verify-pwa.ts', '--dist', 'dist-site/play', '--base', `${mount}play/`, '--no-404'], { stdio: 'inherit' }); } catch { problems.push(`[${mount}] verify-pwa failed for dist-site/play`); }
}
if (problems.length) { for (const p of problems) console.error('✗', p); process.exit(1); }
console.log('[verify-site] OK');
