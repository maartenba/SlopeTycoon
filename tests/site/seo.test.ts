import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadManifest } from '../../scripts/site/manifest';
import { parseFrontMatter, type ShotInfo } from '../../scripts/site/md';
import { buildLanding, infoPages, siteEnv } from '../../scripts/site/build';
import { GUIDE_INDEX_DESC, GUIDE_INDEX_TITLE, RELATED, guideIndex, guidePage, notFoundPage, robotsTxt, sitemapXml } from '../../scripts/site/templates';
import { renderMarkdown } from '../../scripts/site/md';
import { allGenerated } from '../../scripts/site/generated';
import { SEO_LIMITS, extractRefs, lintPage, pngSize, sitemapLint, uniqueLint, EXTERNAL_OK } from '../../scripts/site/crawl';
import { icoFromPngs, siteManifest } from '../../scripts/site/icons';
import { CARDS } from '../../scripts/site/ogCards';

const env = siteEnv({});
const man = loadManifest();
const fake: Record<string, ShotInfo> = Object.fromEntries(man.shots.map((s) => [s.id, { id: s.id, alt: s.alt, caption: s.caption, w: 1280, h: 800, files: [{ w: 640, file: `${s.id}-640.webp` }, { w: 1280, file: `${s.id}-1280.webp` }] }]));
const files = readdirSync('site/guide').filter((f) => f.endsWith('.md'));
const parsed = files.map((f) => ({ slug: f.replace(/\.md$/, ''), ...parseFrontMatter(readFileSync(`site/guide/${f}`, 'utf8')) }));
const metas = parsed.map((p) => ({ slug: p.slug, title: p.data.title, order: p.data.order, summary: p.data.summary }));
const slugs = new Set(metas.map((m) => m.slug));
const gen = allGenerated();
const pages: Array<{ file: string; html: string }> = [
  { file: 'index.html', html: buildLanding(readFileSync('site/index.html', 'utf8'), env, fake, '<svg/>', '<svg/>', man.shots.map((s) => s.id), metas) },
  { file: 'guide/index.html', html: guideIndex(env, { rel: '../', markSvg: '<svg/>', pages: metas }) },
  ...parsed.map((p) => { const r = renderMarkdown(p.body, { rel: '../../', shots: fake, slugs, gen }); return { file: `guide/${p.slug}/index.html`, html: guidePage(env, { rel: '../../', markSvg: '<svg/>', pages: metas, slug: p.slug, title: p.data.title, summary: p.data.summary, description: p.data.description, html: r.html, toc: r.toc }) }; }),
  ...infoPages(env, '<svg/>', metas, fake, slugs, gen).map((p) => ({ file: `${p.slug}/index.html`, html: p.html })),
];
const siteUrl = env.siteUrl;

describe('site SEO', () => {
  it('has the expected set of pages', () => { expect(pages.map((p) => p.file)).toEqual(expect.arrayContaining(['index.html', 'guide/index.html', 'about/index.html', 'privacy/index.html', 'guide/getting-started/index.html'])); expect(pages.length).toBe(parsed.length + 4); });
  it('every page passes the lint: title < 60, description 120-155, canonical, social cards, JSON-LD, icons, consent', () => {
    for (const p of pages) expect(lintPage(p.file, p.html, { siteUrl }), p.file).toEqual([]);
    expect(SEO_LIMITS).toEqual({ titleMax: 59, descMin: 120, descMax: 155 });
  });
  it('titles and descriptions are unique', () => { expect(uniqueLint(pages)).toEqual([]); });
  it('landing / guide index titles are the planned ones', () => { expect(pages[0]!.html).toContain('<title>Slope Tycoon – Ski &amp; mountain resort tycoon game</title>'); expect(GUIDE_INDEX_TITLE.length).toBeLessThan(60); expect(GUIDE_INDEX_DESC.length).toBeGreaterThanOrEqual(120); });
  it('lint catches bad pages', () => {
    const bad = pages[0]!.html.replace(/<title>[^<]*<\/title>/, `<title>${'x'.repeat(70)}</title>`).replace(/<meta name="description" content="[^"]*"/, '<meta name="description" content="short"');
    const p = lintPage('x', bad, { siteUrl }).join('\n'); expect(p).toContain('title is 70'); expect(p).toContain('meta description is 5');
    expect(lintPage('x', pages[0]!.html.replace('</body>', '<script src="https://www.googletagmanager.com/gtag/js"></script></body>'), { siteUrl }).join()).toContain('only be injected by consent.js');
    expect(uniqueLint([pages[0]!, pages[0]!]).length).toBe(2);
  });
  it('JSON-LD: landing has VideoGame/WebApplication (Game, free, Person author) + WebSite; guide pages and info pages have BreadcrumbList', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ld = (h: string): Array<Record<string, any>> => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));
    const land = ld(pages[0]!.html); const game = land.find((x) => Array.isArray(x['@type']) && x['@type'].includes('VideoGame'))!;
    expect(game['@type']).toEqual(['VideoGame', 'WebApplication']); expect(game.applicationCategory).toBe('Game'); expect(game.operatingSystem).toBe('Any'); expect(game.gamePlatform).toBe('Web browser'); expect(game.genre).toContain('Simulation');
    expect(game.offers.price).toBe('0'); expect(game.author).toMatchObject({ '@type': 'Person', name: 'Maarten Balliauw' }); expect(game.image).toMatch(/og\/landing\.png$/); expect(land.some((x) => x['@type'] === 'WebSite')).toBe(true);
    for (const p of pages.slice(1)) { const b = ld(p.html).find((x) => x['@type'] === 'BreadcrumbList'); expect(b, p.file).toBeTruthy(); expect(b!.itemListElement.length).toBeGreaterThanOrEqual(2); }
    expect(ld(pages.find((p) => p.file === 'about/index.html')!.html).some((x) => x['@type'] === 'AboutPage' && x.mainEntity.name === 'Maarten Balliauw')).toBe(true);
  });
  it('og images exist per major page and are 1200x630', () => {
    for (const k of Object.keys(CARDS)) { const f = `site/assets/og/${k}.png`; expect(existsSync(f), f).toBe(true); expect(pngSize(readFileSync(f))).toEqual({ w: 1200, h: 630 }); expect(readFileSync(f).length).toBeLessThan(400 * 1024); }
  });
  it('sitemap lists every page plus the game entry point /play/; robots allows all and points at it', () => {
    const base = 'https://slopetycoon.com/';
    const xml = sitemapXml(base, pages.map((p) => ({ path: p.file.replace(/index\.html$/, ''), lastmod: '2026-10-27', changefreq: 'monthly', priority: '0.5' })).concat([{ path: 'play/', lastmod: '2026-10-27', changefreq: 'weekly', priority: '0.9' }]));
    expect(sitemapLint(xml, robotsTxt(base), pages.map((p) => p.file.replace(/index\.html$/, '')), base)).toEqual([]);
    expect(sitemapLint(xml.replace(`${base}play/`, `${base}x/`), 'User-agent: *\nAllow: /\n', [''], base).join()).toMatch(/play\/.*|robots/);
  });
  it('no external URLs besides GitHub and the Wikipedia link; Wikipedia link has rel=noopener', () => {
    for (const p of pages) {
      for (const r of extractRefs(p.html)) if (/^https?:\/\//.test(r.url) && r.attr !== 'meta-image' && !r.url.startsWith(siteUrl)) expect(EXTERNAL_OK.some((re) => re.test(r.url)), `${p.file}: ${r.url}`).toBe(true);
      for (const m of p.html.matchAll(/<a [^>]*href="https:\/\/en\.wikipedia\.org[^>]*>/g)) expect(m[0], p.file).toContain('rel="noopener"');
    }
  });
  it('no page claims "no tracking" / "nothing tracked" / "no trackers" any more', () => {
    for (const p of pages) expect(p.html, p.file).not.toMatch(/no tracking|nothing tracked|no trackers|never tracked|nothing is uploaded, ever/i);
    for (const p of parsed) expect(p.body, p.slug).not.toMatch(/\bno trackers\b|\bno tracking\b/i);
  });
  it('about page has the owner text; landing has the story section linking /about/', () => {
    const about = pages.find((p) => p.file === 'about/index.html')!.html;
    expect(about).toContain('I am Maarten.'); expect(about).toContain('Ski Resort Tycoon'); expect(about).toContain('one day, I'); expect(about).toContain('Thanks to AI assistance, here we are!'); expect(about).toContain('github.com/maartenba/SlopeTycoon');
    expect(pages[0]!.html).toContain('id="about"'); expect(pages[0]!.html).toContain('href="./about/"');
  });
  it('privacy page explains the analytics honestly and exposes the settings anchor', () => {
    const h = pages.find((p) => p.file === 'privacy/index.html')!.html;
    for (const t of ['Google Analytics', 'opt-in', 'Page views', 'IndexedDB', 'offline', 'GitHub', 'Settings → Privacy', 'id="settings"', 'data-consent-open']) expect(h, t).toContain(t);
    expect(h).toMatch(/never<\/strong> collected|<strong>never<\/strong>/i);
  });
  it('a11y basics: skip link, main landmark, labelled navs, one h1, no empty links', () => {
    for (const p of pages) { expect(p.html, p.file).toContain('class="skip"'); expect(p.html, p.file).toContain('<main id="main"'); expect((p.html.match(/<h1[ >]/g) ?? []).length, p.file).toBe(1); expect(p.html, p.file).not.toMatch(/<a [^>]*>\s*<\/a>/); for (const m of p.html.matchAll(/<nav\b[^>]*>/g)) expect(m[0], p.file).toContain('aria-label'); }
  });
  it('guide pages cross-link related pages that exist', () => {
    for (const [k, v] of Object.entries(RELATED)) { expect(slugs.has(k), k).toBe(true); for (const r of v) expect(slugs.has(r), `${k} -> ${r}`).toBe(true); }
    for (const p of parsed) expect(pages.find((x) => x.file === `guide/${p.slug}/index.html`)!.html, p.slug).toContain('Related pages');
  });
  it('favicon set: ico packs PNGs, web manifest has the icons', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000100000001008060000001ff3ff61', 'hex'); const ico = icoFromPngs([{ size: 16, data: png }, { size: 32, data: png }]);
    expect(ico.readUInt16LE(2)).toBe(1); expect(ico.readUInt16LE(4)).toBe(2); expect(ico.readUInt32BE(6 + 32)).toBe(0x89504e47);
    expect((siteManifest().icons as Array<{ sizes: string }>).map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });
  it('the 404 page has links and is not indexed', () => { const h = notFoundPage(env); expect(h).toContain('noindex'); expect(h).toContain('Play the game'); expect(h).not.toContain('location.replace'); });
});

describe('game entry point (/play/) SEO', () => {
  const h = readFileSync('index.html', 'utf8');
  it('has a short unique title, a 120-155 char description, canonical and social cards', () => {
    const title = /<title>([^<]*)<\/title>/.exec(h)![1]!.replace(/&amp;/g, '&'), desc = /name="description" content="([^"]*)"/.exec(h)![1]!;
    expect(title.length).toBeLessThan(60); expect(title).not.toBe('Slope Tycoon'); expect(desc.length).toBeGreaterThanOrEqual(120); expect(desc.length).toBeLessThanOrEqual(155);
    expect(h).toContain('<link rel="canonical" href="https://slopetycoon.com/play/"'); expect(h).toContain('property="og:image"'); expect(h).toContain('name="twitter:card"'); expect(h).toContain('<noscript>');
  });
  it('keeps the PWA behaviours (manifest, theme colour, apple meta, module entry)', () => { expect(h).toContain('rel="manifest"'); expect(h).toContain('name="theme-color"'); expect(h).toContain('apple-mobile-web-app-capable'); expect(h).toContain('src="/src/main.ts"'); });
});
