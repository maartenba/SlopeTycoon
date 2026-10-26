/** `npm run deploy:check`: what would be deployed (files, sizes, SW cache version). */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = join(process.cwd(), 'dist');
if (!existsSync(join(dist, 'sw.js'))) { console.error('dist/ missing: run `npm run build` first'); process.exit(1); }
const walk = (d: string): string[] => readdirSync(d).sort().flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
let total = 0;
for (const f of walk(dist)) { const s = statSync(f).size; total += s; console.log(`${relative(dist, f).split('\\').join('/').padEnd(40)} ${(s / 1024).toFixed(1).padStart(9)} kB`); }
console.log(`\n${' '.repeat(40)} ${(total / 1024).toFixed(1).padStart(9)} kB total`);
const v = /Slope Tycoon service worker (\S+)/.exec(readFileSync(join(dist, 'sw.js'), 'utf8'))?.[1];
console.log(`SW cache version: ${v ?? 'UNKNOWN'}  (cache name slope-tycoon-${v ?? '?'})`);
console.log(`404.html: ${existsSync(join(dist, '404.html')) ? 'yes' : 'MISSING'}, .nojekyll: ${existsSync(join(dist, '.nojekyll')) ? 'yes' : 'MISSING'}, CNAME: ${existsSync(join(dist, 'CNAME')) ? 'yes' : 'no (optional)'}`);
