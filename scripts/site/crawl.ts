/** Static checks over a generated site directory (no server, no Chrome): links, images, a11y basics, budgets. Used by check.ts and tests/site. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';

export interface Budgets { shotMaxBytes: number; shotsTotalBytes: number; cssJsMaxBytes: number }
export const BUDGETS: Budgets = { shotMaxBytes: 250 * 1024, shotsTotalBytes: 8 * 1024 * 1024, cssJsMaxBytes: 150 * 1024 };
/** External hosts allowed in href/src (footer links and the game's own About credits live in play/, which is not crawled for these). */
export const EXTERNAL_OK = [/^https:\/\/github\.com\//, /^https:\/\/en\.wikipedia\.org\/wiki\/Ski_Resort_Tycoon$/];
/** Hosts the analytics snippet (assets/consent.js) may contact, and only after the visitor allowed it. */
export const ANALYTICS_HOSTS = ['www.googletagmanager.com', 'www.google-analytics.com'];
export const GA_ID = 'G-NX37ERE0S9';
export const SEO_LIMITS = { titleMax: 59, descMin: 120, descMax: 155 } as const;
const unesc = (h: string): string => h.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** PNG width/height from the IHDR chunk (no image library needed). */
export function pngSize(buf: Buffer): { w: number; h: number } | null {
  return buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG' ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null;
}
export const metaContent = (h: string, attr: 'name' | 'property', key: string): string | null => {
  const m = new RegExp(`<meta[^>]*\\s${attr}="${key}"[^>]*\\scontent="([^"]*)"`).exec(h) ?? new RegExp(`<meta[^>]*\\scontent="([^"]*)"[^>]*\\s${attr}="${key}"`).exec(h);
  return m ? unesc(m[1]!) : null;
};
/** SEO / structured-data / privacy lint of one generated page (title + description length, canonical, social cards, JSON-LD, icons, analytics rules). */
export function lintPage(file: string, h: string, o: { siteUrl?: string; fileExists?: (rel: string) => boolean; readFile?: (rel: string) => Buffer | null } = {}): string[] {
  const out: string[] = [], bad = (m: string): void => { out.push(`${file}: ${m}`); };
  const title = unesc(/<title>([^<]*)<\/title>/.exec(h)?.[1] ?? ''), desc = metaContent(h, 'name', 'description') ?? '';
  if (title.length > SEO_LIMITS.titleMax) bad(`title is ${title.length} chars (max ${SEO_LIMITS.titleMax}): ${title}`);
  if (desc.length < SEO_LIMITS.descMin || desc.length > SEO_LIMITS.descMax) bad(`meta description is ${desc.length} chars (want ${SEO_LIMITS.descMin}-${SEO_LIMITS.descMax})`);
  if (!/<meta name="robots" content="[^"]+"/.test(h)) bad('missing robots meta');
  if (!/<meta name="theme-color"/.test(h) || !/<meta name="viewport"/.test(h)) bad('missing theme-color / viewport');
  if (!/<link rel="icon" href="[^"]*favicon\.ico"/.test(h) || !/rel="icon" href="[^"]*icon\.svg"/.test(h) || !/rel="apple-touch-icon"/.test(h) || !/rel="manifest"/.test(h)) bad('missing favicon / apple-touch-icon / manifest links');
  if (!/rel="preload" href="[^"]*lilita-one-latin\.woff2" as="font"/.test(h)) bad('critical font is not preloaded');
  for (const k of ['og:title', 'og:description', 'og:image', 'og:image:alt', 'og:site_name', 'og:locale', 'og:type']) if (!metaContent(h, 'property', k)) bad(`missing ${k}`);
  for (const k of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) if (!metaContent(h, 'name', k)) bad(`missing ${k}`);
  if (metaContent(h, 'property', 'og:image:width') !== '1200' || metaContent(h, 'property', 'og:image:height') !== '630') bad('og:image dimensions must be 1200x630');
  if (o.siteUrl) {
    if (!new RegExp(`<link rel="canonical" href="${o.siteUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*"`).test(h)) bad('missing canonical URL on the site URL');
    const img = metaContent(h, 'property', 'og:image') ?? '';
    if (!img.startsWith(o.siteUrl)) bad(`og:image must be absolute: ${img}`);
    else if (o.readFile) { const buf = o.readFile(img.slice(o.siteUrl.length)); const sz = buf ? pngSize(buf) : null; if (!sz) bad(`og:image file missing or not a PNG: ${img}`); else if (sz.w !== 1200 || sz.h !== 630) bad(`og:image is ${sz.w}x${sz.h}, want 1200x630`); }
  }
  const lds = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!lds.length) bad('no JSON-LD structured data');
  for (const m of lds) { try { const j = JSON.parse(m[1]!) as { '@context'?: string; '@type'?: unknown }; if (j['@context'] !== 'https://schema.org' || !j['@type']) bad('JSON-LD without @context/@type'); } catch (e) { bad(`invalid JSON-LD: ${String(e).slice(0, 80)}`); } }
  if (/<script[^>]+src="https?:/.test(h) || /gtag\(|googletagmanager|google-analytics/.test(h)) bad('analytics / external scripts must only be injected by consent.js after consent');
  if (!/<script src="[^"]*assets\/consent\.js"/.test(h)) bad('missing consent.js');
  if (!/<footer>[\s\S]*data-consent-open[\s\S]*<\/footer>/.test(h)) bad('footer lacks the "Privacy & analytics settings" link');
  return out;
}
/** Titles and descriptions must be unique across the pages. */
export function uniqueLint(pages: Array<{ file: string; html: string }>): string[] {
  const out: string[] = [];
  for (const [k, label] of [['title', 'title'], ['description', 'meta description']] as const) {
    const seen = new Map<string, string>();
    for (const p of pages) { const v = k === 'title' ? unesc(/<title>([^<]*)<\/title>/.exec(p.html)?.[1] ?? '') : metaContent(p.html, 'name', 'description') ?? ''; const prev = seen.get(v); if (prev) out.push(`${p.file}: ${label} duplicates ${prev}`); else seen.set(v, p.file); }
  }
  return out;
}
/** sitemap.xml must list every website page (and the game at play/), and robots.txt must reference it. */
export function sitemapLint(sitemap: string, robots: string, pagePaths: string[], base: string): string[] {
  const out: string[] = [], locs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!));
  for (const p of [...pagePaths, 'play/']) if (!locs.has(`${base}${p}`)) out.push(`sitemap.xml lacks ${base}${p}`);
  for (const l of locs) if (!l.startsWith(base)) out.push(`sitemap.xml has a foreign URL ${l}`);
  if (!/<lastmod>\d{4}-\d\d-\d\d<\/lastmod>/.test(sitemap)) out.push('sitemap.xml entries need <lastmod>');
  if (!/^User-agent: \*$/m.test(robots) || !/^Allow: \/$/m.test(robots) || !robots.includes(`Sitemap: ${base}sitemap.xml`)) out.push('robots.txt must allow all and reference the sitemap');
  return out;
}

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
export function checkSite(dir: string, opts: { siteUrl?: string; budgets?: Budgets; seo?: boolean } = {}): CheckResult {
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
  for (const f of ['404.html', '.nojekyll', 'sitemap.xml', 'robots.txt', 'play/index.html', 'play/sw.js', 'play/manifest.webmanifest', 'assets/og/landing.png', 'assets/search-index.json']) if (!all.has(f)) bad(`missing ${f}`);
  // external hosts inside the site's own scripts / styles: only the analytics endpoints (loaded after consent)
  for (const f of ['assets/site.js', 'assets/consent.js', 'assets/site.css']) if (all.has(f)) for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) if (!ANALYTICS_HOSTS.includes(m[1]!.toLowerCase()) && !/schema\.org|w3\.org/.test(m[1]!)) bad(`${f}: external host not allowed: ${m[1]}`);
  if (opts.seo) {
    const pages = htmlFiles.map((f) => ({ file: f, html: html(f) }));
    for (const p of pages) problems.push(...lintPage(p.file, p.html, { siteUrl: opts.siteUrl, readFile: (r) => (all.has(r) ? readFileSync(join(dir, r)) : null) }));
    problems.push(...uniqueLint(pages));
    if (all.has('sitemap.xml') && all.has('robots.txt')) problems.push(...sitemapLint(readFileSync(join(dir, 'sitemap.xml'), 'utf8'), readFileSync(join(dir, 'robots.txt'), 'utf8'), htmlFiles.map((f) => f.replace(/index\.html$/, '')), opts.siteUrl || 'https://slopetycoon.com/'));
    for (const f of ['favicon.ico', 'site.webmanifest', 'assets/icons/icon.svg', 'assets/icons/apple-touch-icon.png', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'about/index.html', 'privacy/index.html']) if (!all.has(f)) bad(`missing ${f}`);
    for (const k of ['landing', 'guide', 'privacy', 'about']) { const sz = all.has(`assets/og/${k}.png`) ? pngSize(readFileSync(join(dir, `assets/og/${k}.png`))) : null; if (!sz || sz.w !== 1200 || sz.h !== 630) bad(`assets/og/${k}.png must be a 1200x630 PNG`); }
    if (all.has('404.html') && !/<a href="[^"]+">Play the game<\/a>/.test(readFileSync(join(dir, '404.html'), 'utf8'))) bad('404.html needs links back into the site');
  }
  return { problems, pages: htmlFiles.length, links, images, shotBytes };
}
