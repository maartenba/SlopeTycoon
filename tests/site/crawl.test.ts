import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkSite, extractRefs, resolveRel } from '../../scripts/site/crawl';

const page = (title: string, body: string): string => `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="A description that is certainly longer than thirty chars."></head><body><h1>${title}</h1>${body}</body></html>`;
let dirs: string[] = [];
function fixture(extra: Record<string, string | Buffer> = {}, overrides: Record<string, string | Buffer> = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'site-')); dirs.push(d);
  const files: Record<string, string | Buffer> = {
    'index.html': page('Home', '<a href="guide/">g</a><a href="./play/">p</a><img src="assets/shots/a-640.webp" width="640" height="400" alt="An alt">'),
    'guide/index.html': page('Guide', '<a href="../">home</a><a href="x/#sec">x</a>'), 'guide/x/index.html': page('Page X', '<h2 id="sec">s</h2><a href="../../guide/">g</a>'),
    '404.html': '<html></html>', '.nojekyll': '', 'sitemap.xml': '<x/>', 'robots.txt': '', 'assets/og/landing.png': 'x', 'assets/search-index.json': '[]', 'assets/site.css': 'a{}', 'assets/site.js': ';',
    'assets/shots/a-640.webp': Buffer.alloc(1000), 'play/index.html': '<html></html>', 'play/sw.js': ';', 'play/manifest.webmanifest': '{}', ...extra, ...overrides,
  };
  for (const [f, c] of Object.entries(files)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), c); }
  return d;
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

describe('site crawler', () => {
  it('resolves relative references', () => {
    expect(resolveRel('guide/x/index.html', '../../assets/a.png')).toBe('assets/a.png'); expect(resolveRel('index.html', './play/#a')).toBe('play');
    expect(resolveRel('index.html', '../out')).toBeNull(); expect(extractRefs('<img src="a.png" srcset="b.webp 640w, c.webp 1280w"><a href="#x">')).toHaveLength(4);
  });
  it('passes on a healthy fixture', () => { const r = checkSite(fixture()); expect(r.problems).toEqual([]); expect(r.pages).toBe(3); });
  it('reports broken links, missing anchors, missing alt, root-absolute and external URLs', () => {
    const d = fixture({}, { 'index.html': page('Home', '<a href="nope/">b</a><a href="guide/x/#zzz">a</a><img src="assets/shots/a-640.webp" width="1" height="1"><a href="/play/">r</a><a href="https://evil.example/">e</a><a href="https://github.com/o/r">ok</a>') });
    const p = checkSite(d).problems.join('\n');
    expect(p).toContain('broken link nope/'); expect(p).toContain('missing anchor #zzz'); expect(p).toContain('without alt'); expect(p).toContain('root-absolute'); expect(p).toContain('external URL not allowed: https://evil.example/'); expect(p).not.toContain('github.com');
  });
  it('checks heading order, single h1, service worker rules and budgets', () => {
    const d = fixture({ 'assets/shots/big-1280.webp': Buffer.alloc(300 * 1024), 'sw.js': ';' }, { 'guide/index.html': page('Guide', '<h3>skip</h3><script>navigator.serviceWorker.register("x")</script>') });
    const p = checkSite(d).problems.join('\n');
    expect(p).toContain('heading level jumps h1 -> h3'); expect(p).toContain('must not register a service worker'); expect(p).toContain('sw.js at the website root'); expect(p).toContain('big-1280.webp'); expect(p).toContain('per-image budget');
  });
  it('flags missing required files', () => { expect(checkSite(fixture({}, { 'play/sw.js': '' }), {}).problems).toEqual([]); const d = fixture(); rmSync(join(d, 'sitemap.xml')); expect(checkSite(d).problems).toContain('missing sitemap.xml'); });
});
