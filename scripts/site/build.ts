/** `npm run site:build`: generates the website (landing + guide + assets + 404/sitemap/robots) into dist-site/, next to the game at dist-site/play/ (built by `npm run build:site`).
 * Env: SITE_URL (absolute https URL of the site root, for canonical / og:image / sitemap), SITE_REPO (`owner/repo`, footer links), SITE_CNAME (optional custom domain). */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { logoSvg } from '../../src/ui/logo';
import { allGenerated } from './generated';
import { loadManifest, validateManifest } from './manifest';
import { parseFrontMatter, renderMarkdown, searchEntries, esc, type PageMeta, type ShotInfo } from './md';
import { readIndex, shotInfo, SHOTS_DIR } from './optimize';
import { LANDING_TITLE, footer, gameLd, guideIndex, guidePage, head, header, infoPage, notFoundPage, robotsTxt, scripts, sitemapXml, websiteLd, type SiteEnv } from './templates';
import { writeIcons } from './icons';
import { figureHtml } from './md';
import { ACHIEVEMENTS } from '../../src/config/achievements';
import { LIFT_KIND_IDS } from '../../src/config/lifts';
import { BUILDINGS } from '../../src/config/buildings';
import { guestTypeCount } from '../../src/config/guestTypes';
import { SCENARIOS } from '../../src/config/scenarios';
import { FESTIVALS } from '../../src/config/festivals';
import { STAFF_UPGRADES } from '../../src/config/staffUpgrades';

export const OUT = 'dist-site';
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export function siteEnv(e: NodeJS.ProcessEnv = process.env): SiteEnv {
  const repo = e.SITE_REPO?.trim() || 'maartenba/SlopeTycoon';
    let siteUrl = e.SITE_URL?.trim() ?? '';
  if (!siteUrl) siteUrl = 'https://slopetycoon.com/';
  if (siteUrl && !siteUrl.endsWith('/')) siteUrl += '/';
  return { siteUrl, repo, repoUrl: `https://github.com/${repo}`, version: pkg.version };
}

const imgTag = (s: ShotInfo, o: { sizes?: string; eager?: boolean; cls?: string } = {}): string => {
  const f = [...s.files].sort((a, b) => a.w - b.w);
  return `<img src="assets/shots/${f[0]!.file}" srcset="${f.map((x) => `assets/shots/${x.file} ${x.w}w`).join(', ')}" sizes="${o.sizes ?? '(min-width: 900px) 640px, 100vw'}" width="${s.w}" height="${s.h}" alt="${esc(s.alt)}"${o.eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"${o.cls ? ` class="${o.cls}"` : ''}>`;
};

export function buildLanding(tpl: string, env: SiteEnv, shots: Record<string, ShotInfo>, markSvg: string, fullLogo: string, manifestOrder: string[], guide: readonly PageMeta[] = []): string {
  const need = (id: string): ShotInfo => { const s = shots[id]; if (!s) throw new Error(`landing uses unknown/unshot screenshot '${id}'`); return s; };
  const used = new Set<string>();
  const facts: Array<[string, string]> = [['3', 'map sizes'], [String(LIFT_KIND_IDS.length), 'lift types'], [String(ACHIEVEMENTS.length), 'trophies'], [String(SCENARIOS.length), 'scenarios'], ['1× 3× 10×', 'speeds + Skip to…'], ['12', 'real months, 180-day year'], ['7', 'green energy buildings'], [String(guestTypeCount()), 'guest types'], [String(Object.values(BUILDINGS).filter((b) => b.season === 'summer' || ['viewpoint', 'treehouse', 'tackleHut'].includes(b.id)).length), 'summer attractions'], [String(FESTIVALS.filter((f) => f.kind === 'booked').length), 'bookable festivals'], [String(STAFF_UPGRADES.length), 'staff courses'], ['Touch', 'tablets & phones'], ['I', 'statistics charts']];
  const slides = ['hero-winter', 'season-spring', 'season-summer', 'season-autumn', 'night-village'].map((id, i) => { used.add(id); return imgTag(need(id), { sizes: '100vw', eager: i === 0 }); }).join('');
  let html = tpl
    .replace('{{head}}', head(env, { rel: '', title: LANDING_TITLE, path: '', og: 'landing', ld: [gameLd(env), websiteLd(env)] }))
    .replace('{{header}}', header('', markSvg)).replace('{{footer}}', footer(env, '', guide))
    .replace('{{scripts}}', scripts('')).replace('{{repo}}', env.repoUrl).replace('{{slides}}', slides).replace('{{logo}}', fullLogo)
    .replace('{{facts}}', facts.map(([b, l]) => `<div class="fact"><b>${esc(b)}</b><span>${esc(l)}</span></div>`).join(''))
    .replace(/\{\{pic:([\w-]+)\}\}/g, (_m, id: string) => { used.add(id); return figureHtml(need(id), '').replace('class="shot"', 'class="pic"').replace('sizes="(min-width: 900px) 760px, 100vw"', 'sizes="(min-width: 900px) 640px, 100vw"'); })
    .replace('{{achievements}}', String(ACHIEVEMENTS.length)).replace(/\{\{version\}\}/g, env.version).replace('{{changelog}}', `${env.repoUrl}/blob/main/CHANGELOG.md`);
  const gal = manifestOrder.filter((id) => shots[id]).map((id) => { const s = shots[id]!; const big = [...s.files].sort((a, b) => b.w - a.w)[0]!, small = [...s.files].sort((a, b) => a.w - b.w)[0]!;
    return `<a href="assets/shots/${big.file}" data-lightbox><img src="assets/shots/${small.file}" width="${small.w}" height="${Math.round(small.w * s.h / s.w)}" alt="${esc(s.alt)}" loading="lazy" decoding="async"></a>`; }).join('');
  html = html.replace('{{gallery}}', gal);
  const left = html.match(/\{\{[^}]+\}\}/); if (left) throw new Error(`unreplaced placeholder ${left[0]}`);
  return html;
}

/** Last commit date (YYYY-MM-DD) of a source file, or today when it is not committed yet. */
export function lastmodOf(file: string, today = new Date().toISOString().slice(0, 10)): string {
  try { const d = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); return /^\d{4}-\d\d-\d\d$/.test(d) ? d : today; } catch { return today; }
}

export async function buildSite(env: SiteEnv = siteEnv()): Promise<{ pages: number }> {
  if (!existsSync(join(OUT, 'play', 'index.html'))) throw new Error(`${OUT}/play/index.html missing: run \`npm run build:site\` (builds the game first)`);
  for (const n of readdirSync(OUT)) if (n !== 'play') rmSync(join(OUT, n), { recursive: true, force: true });
  const man = loadManifest(); const errs = validateManifest(man); if (errs.length) throw new Error(errs.join('; '));
  const idx = readIndex(); const shots: Record<string, ShotInfo> = {};
  for (const m of man.shots) { const s = shotInfo(m, idx); if (s) shots[m.id] = s; }
  const markSvg = logoSvg({ variant: 'mark' }), fullLogo = logoSvg({ variant: 'full' }).replace('class="logo logo-full"', 'class="logo logo-full logo"');

  // assets
  mkdirSync(join(OUT, 'assets', 'fonts'), { recursive: true }); mkdirSync(join(OUT, 'assets', 'icons'), { recursive: true });
  cpSync('public/fonts', join(OUT, 'assets', 'fonts'), { recursive: true });
  await writeIcons(OUT);
  cpSync('site/assets/site.css', join(OUT, 'assets', 'site.css')); cpSync('site/assets/site.js', join(OUT, 'assets', 'site.js')); cpSync('site/assets/consent.js', join(OUT, 'assets', 'consent.js'));
  cpSync('site/assets/og', join(OUT, 'assets', 'og'), { recursive: true });
  if (existsSync(SHOTS_DIR)) cpSync(SHOTS_DIR, join(OUT, 'assets', 'shots'), { recursive: true, filter: (s) => !s.endsWith('index.json') });
  writeFileSync(join(OUT, 'assets', 'logo.svg'), logoSvg({ variant: 'full' })); writeFileSync(join(OUT, 'assets', 'logo-mark.svg'), logoSvg({ variant: 'mark' }));

  // guide
  const files = readdirSync('site/guide').filter((f) => f.endsWith('.md')).sort();
  const parsed = files.map((f) => { const { data, body } = parseFrontMatter(readFileSync(join('site/guide', f), 'utf8')); return { slug: f.replace(/\.md$/, ''), data, body }; });
  const metas: PageMeta[] = parsed.map((p) => ({ slug: p.slug, title: p.data.title, order: p.data.order, summary: p.data.summary }));
  const slugs = new Set(metas.map((m) => m.slug)); const gen = allGenerated(); const search: unknown[] = [];
  // landing
  writeFileSync(join(OUT, 'index.html'), buildLanding(readFileSync('site/index.html', 'utf8'), env, shots, markSvg, fullLogo, man.shots.map((s) => s.id), metas));
  for (const p of parsed) {
    const r = renderMarkdown(p.body, { rel: '../../', shots, slugs, gen });
    for (const id of p.data.screenshots ?? []) if (!r.figures.includes(id)) console.warn(`[site] ${p.slug}: front matter lists '${id}' but the page does not use it`);
    mkdirSync(join(OUT, 'guide', p.slug), { recursive: true });
    writeFileSync(join(OUT, 'guide', p.slug, 'index.html'), guidePage(env, { rel: '../../', markSvg, pages: metas, slug: p.slug, title: p.data.title, summary: p.data.summary, description: p.data.description, html: r.html, toc: r.toc }));
    search.push(...searchEntries(p.slug, p.data.title, r.sections));
  }
  writeFileSync(join(OUT, 'guide', 'index.html'), guideIndex(env, { rel: '../', markSvg, pages: metas }));
  // info pages (about, privacy) from site/pages/*.md
  const info = infoPages(env, markSvg, metas, shots, slugs, gen);
  for (const ip of info) { mkdirSync(join(OUT, ip.slug), { recursive: true }); writeFileSync(join(OUT, ip.slug, 'index.html'), ip.html); }
  writeFileSync(join(OUT, 'assets', 'search-index.json'), JSON.stringify(search));

  // housekeeping files
  writeFileSync(join(OUT, '404.html'), notFoundPage(env)); writeFileSync(join(OUT, '.nojekyll'), '');
  const base = env.siteUrl || 'https://slopetycoon.com/', today = new Date().toISOString().slice(0, 10);
  const newest = (...f: string[]): string => f.map((x) => lastmodOf(x, today)).sort().pop()!;
  const urls = [
    { path: '', lastmod: newest('site/index.html', 'site/assets/site.css'), changefreq: 'weekly', priority: '1.0' },
    { path: 'play/', lastmod: today, changefreq: 'weekly', priority: '0.9' },
    { path: 'guide/', lastmod: newest(...files.map((f) => join('site/guide', f))), changefreq: 'weekly', priority: '0.8' },
    ...metas.map((m) => ({ path: `guide/${m.slug}/`, lastmod: lastmodOf(`site/guide/${m.slug}.md`, today), changefreq: 'monthly', priority: '0.7' })),
    { path: 'about/', lastmod: lastmodOf('site/pages/about.md', today), changefreq: 'yearly', priority: '0.6' },
    { path: 'privacy/', lastmod: lastmodOf('site/pages/privacy.md', today), changefreq: 'yearly', priority: '0.3' },
  ];
  writeFileSync(join(OUT, 'sitemap.xml'), sitemapXml(base, urls));
  writeFileSync(join(OUT, 'robots.txt'), robotsTxt(base));
  if (process.env.SITE_CNAME) writeFileSync(join(OUT, 'CNAME'), `${process.env.SITE_CNAME.trim()}\n`);
  console.log(`[site] built ${OUT}/ : landing + guide index + ${parsed.length} guide pages + ${info.length} info pages, ${Object.keys(shots).length}/${man.shots.length} screenshots`);
  return { pages: parsed.length + info.length };
}

/** About + privacy pages: site/pages/<slug>.md (front matter: title = SEO title, heading = h1, description). */
export function infoPages(env: SiteEnv, markSvg: string, pages: readonly PageMeta[], shots: Record<string, ShotInfo>, slugs: ReadonlySet<string>, gen: Record<string, string>): Array<{ slug: 'about' | 'privacy'; html: string }> {
  return (['about', 'privacy'] as const).map((slug) => {
    const { data, body } = parseFrontMatter(readFileSync(`site/pages/${slug}.md`, 'utf8'));
    const r = renderMarkdown(body, { rel: '../', shots, slugs, gen });
    return { slug, html: infoPage(env, { slug, title: data.title, description: data.description ?? '', heading: data.heading ?? data.title, html: r.html, og: slug, markSvg, pages }) };
  });
}
