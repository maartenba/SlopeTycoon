import { describe, expect, it } from 'vitest';
import { parseFrontMatter, prevNext, renderMarkdown, searchEntries, slugify, type Ctx, type ShotInfo } from '../../scripts/site/md';

const shot: ShotInfo = { id: 'a-shot', alt: 'Alt text for the shot', caption: 'A <nice> caption', w: 1280, h: 800, files: [{ w: 640, file: 'a-shot-640.webp' }, { w: 1280, file: 'a-shot-1280.webp' }] };
const ctx: Ctx = { rel: '../../', shots: { 'a-shot': shot }, slugs: new Set(['money', 'saves']), gen: { tbl: '| A | B |\n|---|---|\n| 1 | 2 |' } };

describe('md pipeline', () => {
  it('parses front matter and rejects a missing one', () => {
    const r = parseFrontMatter('---\ntitle: Hi\norder: 3\nscreenshots: [a, b]\n---\nBody');
    expect(r.data).toMatchObject({ title: 'Hi', order: 3, screenshots: ['a', 'b'] }); expect(r.body).toBe('Body');
    expect(() => parseFrontMatter('no front matter')).toThrow();
    expect(() => parseFrontMatter('---\ntitle: x\n---\nb')).toThrow(/order/);
  });
  it('renders callouts (tip / warning / note) and leaves plain blockquotes alone', () => {
    const h = renderMarkdown('> [!TIP] Be kind.\n\n> [!WARNING] Careful *now*.\n\n> plain quote', ctx).html;
    expect(h).toContain('<aside class="callout tip"><strong class="callout-title">Tip</strong><p>Be kind.</p>');
    expect(h).toContain('class="callout warning"'); expect(h).toContain('<em>now</em>'); expect(h).toContain('<blockquote>');
  });
  it('builds ids, anchors and a TOC (h2/h3, unique ids)', () => {
    const r = renderMarkdown('## One\n\ntext\n\n### Sub part\n\n## One\n', ctx);
    expect(r.toc).toEqual([{ level: 2, id: 'one', text: 'One' }, { level: 3, id: 'sub-part', text: 'Sub part' }, { level: 2, id: 'one-2', text: 'One' }]);
    expect(r.html).toContain('<h2 id="one">'); expect(slugify('Hello, <b>World</b>!')).toBe('hello-world');
  });
  it('rewrites page: links relative to the page and rejects unknown pages', () => {
    expect(renderMarkdown('[m](page:money) [s](page:saves#x) [g](game:)', ctx).html).toContain('href="../../guide/money/"');
    expect(renderMarkdown('[s](page:saves#x) [g](game:)', ctx).html).toMatch(/href="\.\.\/\.\.\/guide\/saves\/#x".*href="\.\.\/\.\.\/play\/"/);
    expect(() => renderMarkdown('[x](page:nope)', ctx)).toThrow(/unknown guide page/);
  });
  it('adds rel=noopener to external links and wraps tables', () => {
    const h = renderMarkdown('[gh](https://github.com/a/b)\n\n{{gen:tbl}}', ctx).html;
    expect(h).toContain('<a rel="noopener" href="https://github.com/a/b">'); expect(h).toContain('<div class="table-wrap"><table>');
  });
  it('renders figures with srcset, dimensions, escaped caption, and tracks used ids', () => {
    const r = renderMarkdown('{{fig:a-shot}}', ctx);
    expect(r.figures).toEqual(['a-shot']);
    expect(r.html).toContain('srcset="../../assets/shots/a-shot-640.webp 640w, ../../assets/shots/a-shot-1280.webp 1280w"');
    expect(r.html).toContain('width="1280" height="800" alt="Alt text for the shot"'); expect(r.html).toContain('<figcaption>A &lt;nice&gt; caption</figcaption>');
    expect(r.html).toContain('data-lightbox');
    expect(() => renderMarkdown('{{fig:zzz}}', ctx)).toThrow(/unknown screenshot/);
    expect(() => renderMarkdown('{{gen:zzz}}', ctx)).toThrow(/unknown generated/);
  });
  it('builds search entries per h2 section, with prev/next ordering', () => {
    const r = renderMarkdown('Intro text that is long enough to be indexed here.\n\n## Prices\n\nDay passes cost money and you can change them at any time.\n', ctx);
    const e = searchEntries('money', 'Money', r.sections);
    expect(e.map((x) => x.u)).toEqual(['guide/money/', 'guide/money/#prices']); expect(e[1]!.x).toContain('Day passes');
    const pages = [{ slug: 'b', title: 'B', order: 2 }, { slug: 'a', title: 'A', order: 1 }, { slug: 'c', title: 'C', order: 3 }];
    expect(prevNext(pages, 'b')).toEqual({ prev: pages[1], next: pages[2] }); expect(prevNext(pages, 'a').prev).toBeUndefined();
  });
});
