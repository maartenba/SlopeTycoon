/** Static checks over a generated site directory (no server, no Chrome): links, images, a11y basics, budgets. Used by check.ts and tests/site. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';

export interface Budgets { shotMaxBytes: number; shotsTotalBytes: number; cssJsMaxBytes: number }
export const BUDGETS: Budgets = { shotMaxBytes: 250 * 1024, shotsTotalBytes: 8 * 1024 * 1024, cssJsMaxBytes: 150 * 1024 };
/** External hosts allowed in href/src (footer links and the game's own About credits live in play/, which is not crawled for these). */
export const EXTERNAL_OK = [/^https:\/\/github\.com\//];

export function walk(dir: string, skip: (rel: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const rec = (d: string): void => { for (const n of readdirSync(d)) { const p = join(d, n), r = relative(dir, p).split(sep).join('/'); if (skip(r)) continue; if (statSync(p).isDirectory()) rec(p); else out.push(r); } };
  rec(dir); return out.sort();
}
export interface Ref { attr: string; url: string }
export function extractRefs(html: string): Ref[] {
  const refs: Ref[] = [];
  for (const m of html.matchAll(/\s(href|src|poster)="([^"]*)"/g)) refs.push({ attr: m[1]!, url: m[2]! });
  for (const m of html.matchAll(/\ssrcset="([^"]*)"/g)) for (const part of m[1]!.split(',')) { const u = part.trim().split(/\s+/)[0]; if (u) refs.push({ attr: 'srcset', url: u }); }
  for (const m of html.matchAll(/<meta[^>]+(?:property="og:image"|name="twitter:image")[^>]+content="([^"]*)"/g)) refs.push({ attr: 'meta-image', url: m[1]! });
  return refs;
}
export const idsOf = (html: string): Set<string> => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));

/** Resolves a relative URL from a page (posix path relative to the site root) to a file path (relative to root) or null when it leaves the root. */
export function resolveRel(page: string, url: string): string | null {
  const clean = url.split('#')[0]!.split('?')[0]!;
  const target = normalize(join(dirname(page), clean || '.')).split(sep).join('/').replace(/\/$/, '');
  if (target.startsWith('..')) return null;
  return target === '.' || target === '' ? '' : target;
}

export interface CheckResult { problems: string[]; pages: number; links: number; images: number; shotBytes: number }
export function checkSite(dir: string, opts: { siteUrl?: string; budgets?: Budgets } = {}): CheckResult {
  const b = opts.budgets ?? BUDGETS, problems: string[] = [];
  const bad = (m: string): void => { problems.push(m); };
  if (!existsSync(join(dir, 'index.html'))) return { problems: [`${dir}/index.html missing`], pages: 0, links: 0, images: 0, shotBytes: 0 };
  const all = new Set(walk(dir));
  const htmlFiles = [...all].filter((f) => f.endsWith('.html') && !f.startsWith('play/') && f !== '404.html');
  const htmlCache = new Map<string, string>(); const html = (f: string): string => { let h = htmlCache.get(f); if (h === undefined) { h = readFileSync(join(dir, f), 'utf8'); htmlCache.set(f, h); } return h; };
  let links = 0, images = 0;
  const fileFor = (r: string): string | null => (all.has(r) ? r : all.has(`${r}/index.html`.replace(/^\//, '')) ? `${r}/index.html`.replace(/^\//, '') : r === '' && all.has('index.html') ? 'index.html' : null);
  for (const f of htmlFiles) {
    const h = html(f);
    if (!/<title>[^<]{3,}<\/title>/.test(h)) bad(`${f}: missing <title>`);
    if (!/<meta name="description" content="[^"]{30,}"/.test(h)) bad(`${f}: missing meta description`);
    if (!/<html lang="/.test(h)) bad(`${f}: missing html lang`);
    if ((h.match(/<h1[ >]/g) ?? []).length !== 1) bad(`${f}: needs exactly one <h1>`);
    let last = 0; for (const m of h.matchAll(/<h([1-6])[ >]/g)) { const l = Number(m[1]); if (last && l > last + 1) bad(`${f}: heading level jumps h${last} -> h${l}`); last = l; }
    for (const m of h.matchAll(/<img\b[^>]*>/g)) { images++; if (!/\salt="[^"]+"/.test(m[0]) && !/\salt=""[^>]*\srole="presentation"/.test(m[0])) bad(`${f}: <img> without alt: ${m[0].slice(0, 80)}`); if (!/\swidth="\d+"/.test(m[0]) || !/\sheight="\d+"/.test(m[0])) bad(`${f}: <img> without width/height`); }
    for (const r of extractRefs(h)) {
      links++; const u = r.url;
      if (u === '' || u.startsWith('data:') || u.startsWith('mailto:')) continue;
      if (/^https?:\/\//.test(u)) {
        if (opts.siteUrl && u.startsWith(opts.siteUrl)) continue;
        if (r.attr === 'meta-image') continue;
        if (!EXTERNAL_OK.some((re) => re.test(u))) bad(`${f}: external URL not allowed: ${u}`);
        continue;
      }
      if (u.startsWith('//')) { bad(`${f}: protocol-relative URL ${u}`); continue; }
      if (u.startsWith('/')) { bad(`${f}: root-absolute URL ${u} (breaks subpath hosting)`); continue; }
      if (u.startsWith('#')) { if (u.length > 1 && !idsOf(h).has(u.slice(1))) bad(`${f}: missing anchor ${u}`); continue; }
      const target = resolveRel(f, u);
      if (target === null) { bad(`${f}: link leaves the site: ${u}`); continue; }
      const file = fileFor(target);
      if (!file) { bad(`${f}: broken link ${u} (-> ${target})`); continue; }
      const hash = u.split('#')[1];
      if (hash && file.endsWith('.html') && !file.startsWith('play/') && !idsOf(html(file)).has(hash)) bad(`${f}: missing anchor #${hash} in ${file}`);
    }
    if (/navigator\.serviceWorker|register\(/.test(h)) bad(`${f}: the website must not register a service worker`);
  }
  if (all.has('sw.js')) bad('sw.js at the website root: only the game (play/) has a service worker');
  // budgets
  let shotBytes = 0;
  for (const f of all) if (f.startsWith('assets/shots/') && f.endsWith('.webp')) { const n = statSync(join(dir, f)).size; shotBytes += n; if (n > b.shotMaxBytes) bad(`${f}: ${(n / 1024).toFixed(0)} kB exceeds the per-image budget`); }
  if (shotBytes > b.shotsTotalBytes) bad(`screenshots total ${(shotBytes / 1048576).toFixed(1)} MB exceeds the budget`);
  const cssjs = ['assets/site.css', 'assets/site.js'].reduce((n, f) => n + (all.has(f) ? statSync(join(dir, f)).size : 0), 0);
  if (cssjs > b.cssJsMaxBytes) bad(`site css+js ${(cssjs / 1024).toFixed(0)} kB exceeds the budget`);
  for (const f of ['404.html', '.nojekyll', 'sitemap.xml', 'robots.txt', 'play/index.html', 'play/sw.js', 'play/manifest.webmanifest', 'assets/og.png', 'assets/search-index.json']) if (!all.has(f)) bad(`missing ${f}`);
  return { problems, pages: htmlFiles.length, links, images, shotBytes };
}
