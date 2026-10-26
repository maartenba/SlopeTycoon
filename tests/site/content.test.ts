import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { loadManifest, validateManifest } from '../../scripts/site/manifest';
import { parseFrontMatter, renderMarkdown, type ShotInfo } from '../../scripts/site/md';
import { allGenerated } from '../../scripts/site/generated';
import { buildLanding, siteEnv } from '../../scripts/site/build';
import { guidePage } from '../../scripts/site/templates';

const man = loadManifest();
const fake: Record<string, ShotInfo> = Object.fromEntries(man.shots.map((s) => [s.id, { id: s.id, alt: s.alt, caption: s.caption, w: 1280, h: 800, files: [{ w: 640, file: `${s.id}-640.webp` }, { w: 1280, file: `${s.id}-1280.webp` }] }]));
const files = readdirSync('site/guide').filter((f) => f.endsWith('.md'));
const pages = files.map((f) => ({ slug: f.replace(/\.md$/, ''), ...parseFrontMatter(readFileSync(`site/guide/${f}`, 'utf8')) }));
const slugs = new Set(pages.map((p) => p.slug));

describe('site content', () => {
  it('screenshot manifest is valid and its pages exist', () => {
    expect(validateManifest(man)).toEqual([]);
    for (const s of man.shots) for (const p of s.pages) expect(p === 'landing' || slugs.has(p), `${s.id}: unknown page '${p}'`).toBe(true);
  });
  it('guide has the planned pages with unique order and a summary', () => {
    for (const s of ['getting-started', 'interface', 'building', 'lifts-pistes', 'guests-seasons', 'operations', 'money', 'career', 'achievements', 'modes', 'settings', 'saves', 'troubleshooting', 'glossary', 'shortcuts']) expect(slugs.has(s), s).toBe(true);
    expect(new Set(pages.map((p) => p.data.order)).size).toBe(pages.length);
    for (const p of pages) expect(p.data.summary?.length ?? 0, p.slug).toBeGreaterThan(20);
  });
  it('every page renders; 0-4 figures; front-matter screenshots match the figures used', () => {
    const gen = allGenerated();
    for (const p of pages) {
      const r = renderMarkdown(p.body, { rel: '../../', shots: fake, slugs, gen });
      expect(r.figures.length, p.slug).toBeLessThanOrEqual(4 + (p.slug === 'shortcuts' ? 0 : 0));
      expect([...new Set(r.figures)].sort(), `${p.slug}: front matter screenshots`).toEqual([...(p.data.screenshots ?? [])].sort());
      const html = guidePage(siteEnv({}), { rel: '../../', markSvg: '<svg/>', pages: pages.map((q) => ({ slug: q.slug, title: q.data.title, order: q.data.order })), slug: p.slug, title: p.data.title, html: r.html, toc: r.toc });
      expect(html).toContain('<h1>');
    }
  });
  it('guide text avoids dev jargon', () => {
    for (const p of pages) expect(p.body, p.slug).not.toMatch(/\b(sim tick|ECS|shader|vitest|Three\.js|npm run)\b/i);
  });
  it('landing builds from the manifest ids with no leftover placeholders', () => {
    const html = buildLanding(readFileSync('site/index.html', 'utf8'), siteEnv({ SITE_REPO: 'me/slopes' }), fake, '<svg/>', '<svg/>', man.shots.map((s) => s.id));
    expect(html).not.toMatch(/\{\{/); expect(html).toContain('https://github.com/me/slopes'); expect(html).toContain('href="./play/"');
    expect(html).toContain('canonical'); expect(html).toContain('https://me.github.io/slopes/assets/og.png');
  });
});
