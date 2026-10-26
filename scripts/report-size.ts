/** `npm run size` (after `npm run build`): raw + gzip size of every dist file, grouped; sw.js excluded from the budget total. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = join(process.cwd(), 'dist');
if (!existsSync(dist)) { console.error('dist/ missing: run `npm run build` first'); process.exit(1); }
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const group = (rel: string): string => (/^assets\/three-.*\.js$/.test(rel) ? 'three chunk' : rel.endsWith('.js') && rel !== 'sw.js' ? 'app js' : rel.endsWith('.css') ? 'css' : /\.(png|svg|ico)$/.test(rel) ? 'icons/images' : rel === 'sw.js' ? 'sw.js (excluded)' : 'html/manifest/other');
const rows = walk(dist).sort().map((f) => { const b = readFileSync(f), rel = relative(dist, f).split('\\').join('/'); return { rel, g: group(rel), raw: b.length, gz: gzipSync(b, { level: 9 }).length }; });
const kb = (n: number): string => (n / 1024).toFixed(1).padStart(9) + ' kB';
for (const r of rows) console.log(`${r.rel.padEnd(36)} ${kb(r.raw)} ${kb(r.gz)}`);
const groups = new Map<string, { raw: number; gz: number }>();
for (const r of rows) { const g = groups.get(r.g) ?? { raw: 0, gz: 0 }; g.raw += r.raw; g.gz += r.gz; groups.set(r.g, g); }
console.log('\nBy group (raw / gzip):');
for (const [g, v] of groups) console.log(`${g.padEnd(36)} ${kb(v.raw)} ${kb(v.gz)}`);
const t = rows.filter((r) => r.rel !== 'sw.js').reduce((a, r) => ({ raw: a.raw + r.raw, gz: a.gz + r.gz }), { raw: 0, gz: 0 });
console.log(`\nTOTAL (excl. sw.js)${' '.repeat(17)} ${kb(t.raw)} ${kb(t.gz)}  (budget < 2048 kB gzip)`);
if (t.gz > 2 * 1024 * 1024) { console.error('over the 2 MB gzip budget'); process.exit(1); }
