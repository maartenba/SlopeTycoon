import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { loadManifest } from '../../scripts/site/manifest';
import { parseFrontMatter, plainText, type ShotInfo } from '../../scripts/site/md';
import { allGenerated } from '../../scripts/site/generated';
import { siteEnv, sitemapEntries } from '../../scripts/site/build';
import { devlogPages, landingFiles, landingPages, landingSlugs } from '../../scripts/site/pages';
import { lintPage, uniqueLint, extractRefs } from '../../scripts/site/crawl';
import { sitemapXml } from '../../scripts/site/templates';
import { CARDS } from '../../scripts/site/ogCards';

const env = siteEnv({}), man = loadManifest();
const fake: Record<string, ShotInfo> = Object.fromEntries(man.shots.map((s) => [s.id, { id: s.id, alt: s.alt, caption: s.caption, w: 1280, h: 800, files: [{ w: 640, file: `${s.id}-640.webp` }, { w: 1280, file: `${s.id}-1280.webp` }] }]));
const guide = readdirSync('site/guide').filter((f) => f.endsWith('.md')).map((f) => ({ slug: f.replace(/\.md$/, ''), ...parseFrontMatter(readFileSync(`site/guide/${f}`, 'utf8')) }));
const metas = guide.map((p) => ({ slug: p.slug, title: p.data.title, order: p.data.order, summary: p.data.summary }));
const slugs = new Set(metas.map((m) => m.slug));
const pages = landingPages(env, '<svg/>', metas, fake, slugs, allGenerated());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ld = (h: string): Array<Record<string, any>> => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));
const WANTED = ['ski-resort-tycoon', 'games-like-ski-resort-tycoon', 'how-ski-lifts-work', 'browser-tycoon-games', 'summer-mountain-resort-game', 'play-ski-games-online', 'build-a-ski-resort'];

describe('keyword landing pages', () => {
  it('has the planned pages', () => { expect(pages.map((p) => p.path)).toEqual(expect.arrayContaining(WANTED)); expect(landingFiles().length).toBe(pages.length); });
  it('every page passes the SEO lint (title < 60, description 120-155, canonical, cards, JSON-LD) and is unique', () => {
    for (const p of pages) expect(lintPage(`${p.path}/index.html`, p.html, { siteUrl: env.siteUrl }), p.path).toEqual([]);
    expect(uniqueLint(pages.map((p) => ({ file: p.path, html: p.html })))).toEqual([]);
  });
  it('each page has real content: >= 300 words of body text, >= 2 screenshots, a play CTA and exactly one h1', () => {
    for (const p of pages) {
      const { body } = parseFrontMatter(readFileSync(`site/landing/${p.path}.md`, 'utf8'));
      expect(body.replace(/\{\{[^}]+\}\}/g, '').split(/\s+/).length, p.path).toBeGreaterThanOrEqual(300);
      expect((p.html.match(/<figure class="shot">/g) ?? []).length, p.path).toBeGreaterThanOrEqual(2);
      expect(p.html, p.path).toContain('href="../play/"'); expect((p.html.match(/<h1[ >]/g) ?? []).length).toBe(1);
      expect(p.html).toContain('href="../guide/'); // links into the guide
    }
  });
  it('JSON-LD parses: WebPage or Article, BreadcrumbList, FAQPage whose answers match the visible text', () => {
    for (const p of pages) {
      const l = ld(p.html), faq = l.find((x) => x['@type'] === 'FAQPage')!, bc = l.find((x) => x['@type'] === 'BreadcrumbList')!;
      expect(l.some((x) => x['@type'] === 'WebPage' || x['@type'] === 'Article'), p.path).toBe(true);
      expect(bc.itemListElement.length).toBeGreaterThanOrEqual(2); expect(faq.mainEntity.length, p.path).toBeGreaterThanOrEqual(3);
      const visible = plainText(p.html);
      for (const q of faq.mainEntity) { expect(visible).toContain(q.name); expect(visible).toContain(q.acceptedAnswer.text); }
    }
    expect(ld(pages.find((p) => p.path === 'how-ski-lifts-work')!.html).some((x) => x['@type'] === 'Article' && x.datePublished)).toBe(true);
    expect(ld(pages.find((p) => p.path === 'games-like-ski-resort-tycoon')!.html).some((x) => x['@type'] === 'ItemList')).toBe(true);
  });
  it('internal links resolve to a known page; the only external link is Wikipedia, with rel=noopener', () => {
    const known = new Set([...landingSlugs(), ...slugs].map((s) => s)), dirs = new Set(['guide', 'play', 'assets', 'devlog']);
    for (const p of pages) {
      for (const r of extractRefs(p.html)) {
        if (/^(https?:|data:|mailto:|#)/.test(r.url) || r.url.includes('assets/')) { if (/^https?:/.test(r.url) && r.attr === 'href' && !r.url.startsWith(env.siteUrl)) expect(r.url, p.path).toMatch(/^https:\/\/(en\.wikipedia\.org\/wiki\/Ski_Resort_Tycoon|github\.com\/|ko-fi\.com\/slopetycoon$)/); continue; }
        if (/^\.\.\/(favicon\.ico|site\.webmanifest|)$/.test(r.url)) continue; const m = /^\.\.\/([\w-]+)\//.exec(r.url); expect(m, `${p.path}: ${r.url}`).toBeTruthy();
        const seg = m![1]!; expect(known.has(seg) || dirs.has(seg), `${p.path}: ${r.url}`).toBe(true);
        if (seg === 'guide') { const g = /^\.\.\/guide\/([\w-]+)\//.exec(r.url); if (g) expect(slugs.has(g[1]!), `${p.path}: ${r.url}`).toBe(true); }
      }
      for (const a of p.html.match(/<a [^>]*href="https:\/\/en\.wikipedia[^>]*>/g) ?? []) expect(a).toContain('rel="noopener"');
    }
  });
  it('every page and the devlog are in the sitemap and have an og card', () => {
    const base = 'https://slopetycoon.com/', dev = devlogPages(env, '<svg/>', metas, fake);
    const xml = sitemapXml(base, sitemapEntries(metas, [...pages, ...dev.pages], '2026-11-01'));
    for (const p of [...pages, ...dev.pages]) { expect(xml, p.path).toContain(`<loc>${base}${p.path}/</loc>`); expect(xml).toMatch(new RegExp(`<loc>${base}${p.path}/</loc><lastmod>\\d{4}-\\d\\d-\\d\\d</lastmod>`)); }
    for (const p of pages) expect(Object.keys(CARDS), p.path).toContain(/og\/([\w-]+)\.png/.exec(p.html)![1]);
  });
  it('the landing, the footer and the guide link to the new pages', () => {
    const home = readFileSync('scripts/site/templates.ts', 'utf8');
    for (const s of WANTED) expect(home, s).toContain(`${s}/`);
  });
  it('round 2 keyword pages: distinct titles, the sequel question, the builder phrase, no stray competitor names', () => {
    const by = (slug: string): string => pages.find((p) => p.path === slug)!.html;
    const title = (h: string): string => /<title>([^<]*)<\/title>/.exec(h)![1]!;
    expect(title(by('ski-resort-tycoon'))).toBe('Ski Resort Tycoon Online: Play Free');
    expect(title(by('play-ski-games-online'))).toMatch(/^Play Ski Games Online/);
    expect(title(by('build-a-ski-resort'))).toMatch(/Build a Ski Resort/);
    expect(plainText(by('ski-resort-tycoon'))).toContain('Is there a Ski Resort Tycoon 2?');
    expect(plainText(by('ski-resort-tycoon'))).toMatch(/not an official sequel/);
    expect(plainText(by('ski-resort-tycoon'))).toMatch(/ski resort builder/i);
    for (const f of landingFiles()) expect(readFileSync(`site/landing/${f}`, 'utf8'), f).not.toMatch(/powder\s*peaks/i);
    expect(readFileSync('scripts/site/templates.ts', 'utf8')).toContain("LANDING_TITLE = 'Slope Tycoon – Ski Resort Tycoon Game in Your Browser'");
  });
});
