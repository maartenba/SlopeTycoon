// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { parseFrontMatter, renderMarkdown } from '../../scripts/site/md';
import { infoPage, supportLink, SUPPORT_URL } from '../../scripts/site/templates';
import { siteEnv } from '../../scripts/site/build';
import { allGenerated } from '../../scripts/site/generated';
import { landingSlugs } from '../../scripts/site/pages';
import { loadManifest } from '../../scripts/site/manifest';

const KOFI = 'https://ko-fi.com/slopetycoon';
const env = siteEnv({}), pg = readdirSync('site/guide').filter((f) => f.endsWith('.md')).map((f) => ({ slug: f.replace(/\.md$/, ''), title: f, order: 1 }));
const { data, body } = parseFrontMatter(readFileSync('site/pages/support.md', 'utf8'));
const r = renderMarkdown(body, { rel: '../', shots: {}, slugs: landingSlugs(), gen: allGenerated() });
const html = infoPage(env, { slug: 'support', title: data.title, description: data.description ?? '', heading: data.heading ?? data.title, html: r.html, og: 'support', markSvg: '<svg/>', pages: pg });
void loadManifest;

describe('support page (Ko-fi)', () => {
  it('uses the exact Ko-fi URL with target=_blank rel=noopener everywhere (no GitHub Sponsors left)', () => {
    expect(SUPPORT_URL).toBe(KOFI);
    const tag = supportLink();
    expect(tag).toContain(`href="${KOFI}"`); expect(tag).toContain('target="_blank"'); expect(tag).toContain('rel="noopener"');
    const tags = html.match(/<a [^>]*data-support[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThanOrEqual(3);
    for (const t of tags) { expect(t).toContain(`href="${KOFI}"`); expect(t).toContain('rel="noopener"'); expect(t).toContain('target="_blank"'); }
    expect(html).not.toMatch(/sponsors\/maartenba/);
  });
  it('static HTML has no iframe / embed and the only ko-fi URLs are the link and the inert data attribute', () => {
    expect(html).not.toMatch(/<(iframe|embed|object)\b/i);
    expect(html).toContain('id="kofi-load"'); expect(html).toContain('Show the Ko-fi widget'); expect(html).toContain('Loads ko-fi.com');
    expect(html).toContain('/support.js'); expect(html).not.toMatch(/<script[^>]+src="https?:/);
  });
  it('has its own title, description, canonical path and breadcrumb', () => {
    expect(html).toContain('<title>Support Slope Tycoon'); expect(html).toContain('support/'); expect(html).toContain('BreadcrumbList'); expect(html).toContain('assets/og/support.png');
  });
  it('the widget script is only loaded on the support page, and no other page carries it', () => {
    const about = infoPage(env, { slug: 'about', title: 'A', description: 'd', heading: 'About', html: '<p>x</p>', og: 'about', markSvg: '<svg/>', pages: pg });
    expect(about).not.toContain('support.js');
  });
});

describe('support.js (click to load)', () => {
  const src = readFileSync('site/assets/support.js', 'utf8');
  const setup = (): void => { document.body.innerHTML = `<div id="kofi-widget" data-kofi-src="${KOFI}/?hidefeed=true&amp;widget=true&amp;embed=true&amp;preview=true"><p><button id="kofi-load" type="button">Show</button></p></div>`; new Function(src)(); };
  afterEach(() => { document.body.innerHTML = ''; });
  it('creates no iframe on load, only after the click, once, with the safe attributes', () => {
    setup();
    expect(document.querySelector('iframe')).toBeNull();
    (document.getElementById('kofi-load') as HTMLButtonElement).click();
    const f = document.querySelector('iframe') as HTMLIFrameElement;
    expect(f).not.toBeNull();
    expect(f.getAttribute('src')).toBe(`${KOFI}/?hidefeed=true&widget=true&embed=true&preview=true`);
    expect(f.getAttribute('title')).toBeTruthy(); expect(f.getAttribute('height')).toBe('712'); expect(f.getAttribute('loading')).toBe('lazy'); expect(f.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(f.getAttribute('style')).toContain('width:100%'); expect(f.getAttribute('style')).toContain('#f9f9f9');
    expect(document.querySelectorAll('iframe').length).toBe(1);
  });
  it('names no host itself (the URL comes from the page data attribute)', () => { expect(src).not.toMatch(/https?:\/\//); });
});
