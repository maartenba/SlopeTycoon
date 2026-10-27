/** `npm run site:build`: generates the website (landing + guide + assets + 404/sitemap/robots) into dist-site/, next to the game at dist-site/play/ (built by `npm run build:site`).
 * Env: SITE_URL (absolute https URL of the site root, for canonical / og:image / sitemap), SITE_REPO (`owner/repo`, footer links), SITE_CNAME (optional custom domain). */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logoSvg } from '../../src/ui/logo';
import { NOT_FOUND_HTML } from '../lib/notFound';
import { allGenerated } from './generated';
import { loadManifest, validateManifest } from './manifest';
import { parseFrontMatter, renderMarkdown, searchEntries, esc, type PageMeta, type ShotInfo } from './md';
import { readIndex, shotInfo, SHOTS_DIR } from './optimize';
import { footer, guideIndex, guidePage, head, header, type SiteEnv } from './templates';
import { figureHtml } from './md';
import { ACHIEVEMENTS } from '../../src/config/achievements';
import { LIFT_KIND_IDS } from '../../src/config/lifts';
import { SCENARIOS } from '../../src/config/scenarios';
import { FESTIVALS } from '../../src/config/festivals';
import { STAFF_UPGRADES } from '../../src/config/staffUpgrades';

export const OUT = 'dist-site';
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export function siteEnv(e: NodeJS.ProcessEnv = process.env): SiteEnv {
  const repo = e.SITE_REPO?.trim() || 'maartenba/SlopeTycoon';
  const [owner, name] = repo.split('/');
  let siteUrl = e.SITE_URL?.trim() ?? '';
  if (!siteUrl && owner && name ) siteUrl = `https://${owner}.github.io/${name === `${owner}.github.io` ? '' : name}`;
  if (siteUrl && !siteUrl.endsWith('/')) siteUrl += '/';
  return { siteUrl, repo, repoUrl: `https://github.com/${repo}`, version: pkg.version };
}

const imgTag = (s: ShotInfo, o: { sizes?: string; eager?: boolean; cls?: string } = {}): string => {
  const f = [...s.files].sort((a, b) => a.w - b.w);
  return `<img src="assets/shots/${f[0]!.file}" srcset="${f.map((x) => `assets/shots/${x.file} ${x.w}w`).join(', ')}" sizes="${o.sizes ?? '(min-width: 900px) 640px, 100vw'}" width="${s.w}" height="${s.h}" alt="${esc(s.alt)}"${o.eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"${o.cls ? ` class="${o.cls}"` : ''}>`;
};

export function buildLanding(tpl: string, env: SiteEnv, shots: Record<string, ShotInfo>, markSvg: string, fullLogo: string, manifestOrder: string[]): string {
  const need = (id: string): ShotInfo => { const s = shots[id]; if (!s) throw new Error(`landing uses unknown/unshot screenshot '${id}'`); return s; };
  const used = new Set<string>();
  const facts: Array<[string, string]> = [['3', 'map sizes'], [String(LIFT_KIND_IDS.length), 'lift types'], [String(ACHIEVEMENTS.length), 'trophies'], [String(SCENARIOS.length), 'scenarios'], ['1× 3× 10×', 'speeds + Skip to…'], ['4', 'seasons, 180-day year'], [String(FESTIVALS.filter((f) => f.kind === 'booked').length), 'bookable festivals'], [String(STAFF_UPGRADES.length), 'staff courses'], ['Touch', 'tablets & phones'], ['I', 'statistics charts']];
  const slides = ['hero-winter', 'season-spring', 'season-summer', 'season-autumn', 'night-village'].map((id, i) => { used.add(id); return imgTag(need(id), { sizes: '100vw', eager: i === 0 }); }).join('');
  let html = tpl
    .replace('{{head}}', head(env, { rel: '', title: 'Slope Tycoon: build your own ski resort in the browser', path: '' }))
    .replace('{{header}}', header('', markSvg)).replace('{{footer}}', footer(env, ''))
    .replace('{{slides}}', slides).replace('{{logo}}', fullLogo)
    .replace('{{facts}}', facts.map(([b, l]) => `<div class="fact"><b>${esc(b)}</b><span>${esc(l)}</span></div>`).join(''))
    .replace(/\{\{pic:([\w-]+)\}\}/g, (_m, id: string) => { used.add(id); return figureHtml(need(id), '').replace('class="shot"', 'class="pic"').replace('sizes="(min-width: 900px) 760px, 100vw"', 'sizes="(min-width: 900px) 640px, 100vw"'); })
    .replace('{{achievements}}', String(ACHIEVEMENTS.length)).replace(/\{\{version\}\}/g, env.version).replace('{{changelog}}', `${env.repoUrl}/blob/main/CHANGELOG.md`);
  const gal = manifestOrder.filter((id) => shots[id]).map((id) => { const s = shots[id]!; const big = [...s.files].sort((a, b) => b.w - a.w)[0]!, small = [...s.files].sort((a, b) => a.w - b.w)[0]!;
    return `<a href="assets/shots/${big.file}" data-lightbox><img src="assets/shots/${small.file}" width="${small.w}" height="${Math.round(small.w * s.h / s.w)}" alt="${esc(s.alt)}" loading="lazy" decoding="async"></a>`; }).join('');
  html = html.replace('{{gallery}}', gal);
  const left = html.match(/\{\{[^}]+\}\}/); if (left) throw new Error(`unreplaced placeholder ${left[0]}`);
  return html;
}

async function makeOg(out: string): Promise<void> {
  try {
    const sharp = (await import('sharp')).default;
    const src = join(SHOTS_DIR, 'hero-winter-1280.webp');
    const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset=".35" stop-color="#0b1626" stop-opacity="0"/><stop offset="1" stop-color="#0b1626" stop-opacity=".95"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><text x="60" y="470" font-family="Lilita One,Arial Rounded MT Bold,Arial,sans-serif" font-weight="800" font-size="104" fill="#ffb84d">Slope Tycoon</text><text x="62" y="540" font-family="Nunito,Arial,sans-serif" font-size="40" fill="#e8f0fb">Build your own ski resort, in the browser.</text><text x="62" y="590" font-family="Nunito,Arial,sans-serif" font-size="28" fill="#a9bbd3">Free · plays offline · no tracking</text></svg>`);
    const base = existsSync(src) ? sharp(src).resize(1200, 630, { fit: 'cover' }) : sharp({ create: { width: 1200, height: 630, channels: 3, background: '#10213a' } });
    await base.composite([{ input: text }]).png({ compressionLevel: 9, palette: true }).toFile(out);
  } catch (e) { console.warn(`[site] og.png skipped: ${String(e).slice(0, 120)}`); }
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
  for (const f of ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png']) cpSync(join('public/icons', f), join(OUT, 'assets', 'icons', f));
  cpSync('site/assets/site.css', join(OUT, 'assets', 'site.css')); cpSync('site/assets/site.js', join(OUT, 'assets', 'site.js'));
  if (existsSync(SHOTS_DIR)) cpSync(SHOTS_DIR, join(OUT, 'assets', 'shots'), { recursive: true, filter: (s) => !s.endsWith('index.json') });
  writeFileSync(join(OUT, 'assets', 'logo.svg'), logoSvg({ variant: 'full' })); writeFileSync(join(OUT, 'assets', 'logo-mark.svg'), logoSvg({ variant: 'mark' }));
  await makeOg(join(OUT, 'assets', 'og.png'));

  // landing
  writeFileSync(join(OUT, 'index.html'), buildLanding(readFileSync('site/index.html', 'utf8'), env, shots, markSvg, fullLogo, man.shots.map((s) => s.id)));

  // guide
  const files = readdirSync('site/guide').filter((f) => f.endsWith('.md')).sort();
  const parsed = files.map((f) => { const { data, body } = parseFrontMatter(readFileSync(join('site/guide', f), 'utf8')); return { slug: f.replace(/\.md$/, ''), data, body }; });
  const metas: PageMeta[] = parsed.map((p) => ({ slug: p.slug, title: p.data.title, order: p.data.order, summary: p.data.summary }));
  const slugs = new Set(metas.map((m) => m.slug)); const gen = allGenerated(); const search: unknown[] = [];
  for (const p of parsed) {
    const r = renderMarkdown(p.body, { rel: '../../', shots, slugs, gen });
    for (const id of p.data.screenshots ?? []) if (!r.figures.includes(id)) console.warn(`[site] ${p.slug}: front matter lists '${id}' but the page does not use it`);
    mkdirSync(join(OUT, 'guide', p.slug), { recursive: true });
    writeFileSync(join(OUT, 'guide', p.slug, 'index.html'), guidePage(env, { rel: '../../', markSvg, pages: metas, slug: p.slug, title: p.data.title, summary: p.data.summary, html: r.html, toc: r.toc }));
    search.push(...searchEntries(p.slug, p.data.title, r.sections));
  }
  writeFileSync(join(OUT, 'guide', 'index.html'), guideIndex(env, { rel: '../', markSvg, pages: metas }));
  writeFileSync(join(OUT, 'assets', 'search-index.json'), JSON.stringify(search));

  // housekeeping files
  writeFileSync(join(OUT, '404.html'), NOT_FOUND_HTML); writeFileSync(join(OUT, '.nojekyll'), '');
  const base = env.siteUrl || 'https://maartenba.github.io/SlopeTycoon/';
  const urls = ['', 'guide/', ...metas.map((m) => `guide/${m.slug}/`), 'play/'];
  writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${base}sitemap.xml\n`);
  if (process.env.SITE_CNAME) writeFileSync(join(OUT, 'CNAME'), `${process.env.SITE_CNAME.trim()}\n`);
  console.log(`[site] built ${OUT}/ : landing + guide index + ${parsed.length} guide pages, ${Object.keys(shots).length}/${man.shots.length} screenshots`);
  return { pages: parsed.length };
}

