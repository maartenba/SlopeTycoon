import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { loadManifest } from '../../scripts/site/manifest';
import { parseFrontMatter, type ShotInfo } from '../../scripts/site/md';
import { siteEnv } from '../../scripts/site/build';
import { devlogPages } from '../../scripts/site/pages';
import { atomFeed, firstSentence, fitDescription, loadIntros, loadReleases, parseChangelog, slugOf } from '../../scripts/site/devlog';
import { lintPage, uniqueLint } from '../../scripts/site/crawl';

const env = siteEnv({}), man = loadManifest();
const fake: Record<string, ShotInfo> = Object.fromEntries(man.shots.map((s) => [s.id, { id: s.id, alt: s.alt, caption: s.caption, w: 1280, h: 800, files: [{ w: 640, file: `${s.id}-640.webp` }, { w: 1280, file: `${s.id}-1280.webp` }] }]));
const metas = readdirSync('site/guide').filter((f) => f.endsWith('.md')).map((f) => { const { data } = parseFrontMatter(readFileSync(`site/guide/${f}`, 'utf8')); return { slug: f.replace(/\.md$/, ''), title: data.title, order: data.order, summary: data.summary }; });
const dev = devlogPages(env, '<svg/>', metas, fake);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ld = (h: string): Array<Record<string, any>> => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));
const released = [...readFileSync('CHANGELOG.md', 'utf8').matchAll(/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d\d-\d\d/gm)].map((m) => m[1]!);

describe('devlog', () => {
  it('parses the CHANGELOG: released versions only, with date, highlights and changes', () => {
    const r = loadReleases(); expect(r.map((x) => x.version)).toEqual(released); expect(r.length).toBeGreaterThanOrEqual(12);
    for (const x of r) { expect(x.date).toMatch(/^\d{4}-\d\d-\d\d$/); expect(x.highlights.length, x.version).toBeGreaterThanOrEqual(3); expect(x.highlights.length, x.version).toBeLessThanOrEqual(6); }
    expect(parseChangelog('## [Unreleased]\n\n- x\n\n## [1.2.3] - 2026-01-02\n\nIntro here.\n\n### Highlights\n\n- One\n- Two\n  continued\n\n### Changes\n\n- **Big** change that is long enough to keep.\n')).toEqual([{ version: '1.2.3', date: '2026-01-02', intro: 'Intro here.', highlights: ['One', 'Two continued'], changes: ['**Big** change that is long enough to keep.'] }]);
  });
  it('FAILS when a released CHANGELOG version has no post (the generator reads the CHANGELOG, so new releases add posts)', () => {
    for (const v of released) { expect(dev.pages.find((p) => p.path === slugOf(v)), `no devlog post for ${v}`).toBeTruthy(); expect(dev.feed).toContain(`${env.siteUrl}${slugOf(v)}/`); }
    expect(dev.posts.length).toBe(released.length); expect(dev.pages.length).toBe(released.length + 1);
  });
  it('every released version has a hand-written intro (tagline + lead)', () => { const i = loadIntros(); for (const v of released) { expect(i[v]?.tagline, v).toBeTruthy(); expect(i[v]?.lead?.length ?? 0, v).toBeGreaterThan(80); } for (const k of Object.keys(i)) expect(released, `intro for unknown version ${k}`).toContain(k); });
  it('each post passes the SEO lint and is unique; has date, version, reading time, BlogPosting, prev/next', () => {
    for (const p of dev.pages) expect(lintPage(`${p.path}/index.html`, p.html, { siteUrl: env.siteUrl }), p.path).toEqual([]);
    expect(uniqueLint(dev.pages.map((p) => ({ file: p.path, html: p.html })))).toEqual([]);
    const post = dev.pages.find((p) => p.path === slugOf('0.2.7'))!;
    expect(post.html).toMatch(/<time datetime="2026-10-30">30 October 2026<\/time> · version 0\.2\.7 · \d+ min read/);
    const a = ld(post.html).find((x) => x['@type'] === 'BlogPosting')!; expect(a.datePublished).toBe('2026-10-30'); expect(a.author.name).toBe('Maarten Balliauw'); expect(a.headline).toContain('0.2.7');
    expect(post.html).toContain('rel="prev"'); expect(post.html).toContain('rel="next"'); expect(post.html).toContain('<h2 id="highlights">'); expect(post.html).toContain('What else changed');
    expect(dev.pages.find((p) => p.path === slugOf('0.1.0'))!.html).not.toContain('rel="prev"'); expect(dev.pages.find((p) => p.path === slugOf(released[0]!))!.html).not.toContain('rel="next"');
  });
  it('index lists every post newest first; the feed is a well-formed Atom document with only own URLs', () => {
    const idx = dev.pages[0]!; expect(idx.path).toBe('devlog');
    const order = [...idx.html.matchAll(/href="\.\.\/devlog\/([\d-]+)\/"/g)].map((m) => m[1]);
    expect(order).toEqual(released.map((v) => v.replace(/\./g, '-')));
    expect(dev.feed.startsWith('<?xml')).toBe(true); expect(dev.feed).toContain('<feed xmlns="http://www.w3.org/2005/Atom">'); expect((dev.feed.match(/<entry>/g) ?? []).length).toBe(released.length);
    expect((dev.feed.match(/<\/?entry>/g) ?? []).length).toBe(released.length * 2);
    for (const u of dev.feed.matchAll(/https?:\/\/[^"<\s]+/g)) expect(u[0], 'feed URL').toMatch(/^(https:\/\/slopetycoon\.com\/|http:\/\/www\.w3\.org\/2005\/Atom)/);
    expect(atomFeed(env, [])).toContain('<updated>');
  });
  it('helpers: first sentence, description fitting', () => {
    expect(firstSentence('**Bold** start of a longer sentence. Second sentence.', 200)).toBe('Bold start of a longer sentence.'); expect(firstSentence('a '.repeat(200), 50).endsWith('…')).toBe(true);
    for (const t of ['x', 'y '.repeat(200)]) { const d = fitDescription(t); expect(d.length).toBeGreaterThanOrEqual(120); expect(d.length).toBeLessThanOrEqual(155); }
  });
});
