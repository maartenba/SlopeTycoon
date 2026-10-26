/** Markdown -> HTML pipeline for the player guide (pure: no file access, unit-tested in tests/site/md.test.ts). */
import { marked } from 'marked';
import { parse as parseYaml } from 'yaml';

export interface ShotInfo { id: string; alt: string; caption?: string; w: number; h: number; files: { w: number; file: string }[] }
export interface Ctx {
  /** Relative prefix from the page to the site root, e.g. '../../' for guide/<slug>/index.html. */
  rel: string;
  shots: Readonly<Record<string, ShotInfo>>;
  slugs: ReadonlySet<string>;
  /** Named generated blocks (`{{gen:name}}`), already markdown/HTML strings. */
  gen?: Readonly<Record<string, string>>;
}
export interface TocItem { level: 2 | 3; id: string; text: string }
export interface Rendered { html: string; toc: TocItem[]; figures: string[]; sections: { id: string; heading: string; text: string }[] }
export interface Front { title: string; order: number; summary?: string; screenshots?: string[] }

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slugify = (s: string): string => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const stripTags = (h: string): string => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

export function parseFrontMatter(src: string): { data: Front; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) throw new Error('missing front matter');
  const data = parseYaml(m[1]!) as Front;
  if (!data || typeof data.title !== 'string' || typeof data.order !== 'number') throw new Error('front matter needs title (string) and order (number)');
  return { data, body: src.slice(m[0].length) };
}

/** `<figure>` with a responsive WebP, a lightbox link to the largest size and a caption (= manifest caption or alt). */
export function figureHtml(s: ShotInfo, rel: string): string {
  const files = [...s.files].sort((a, b) => a.w - b.w), big = files[files.length - 1]!, small = files[0]!;
  const src = (f: string): string => `${rel}assets/shots/${f}`;
  const srcset = files.map((f) => `${src(f.file)} ${f.w}w`).join(', ');
  return `<figure class="shot"><a href="${src(big.file)}" data-lightbox><img src="${src(small.file)}" srcset="${srcset}" sizes="(min-width: 900px) 760px, 100vw" width="${s.w}" height="${s.h}" alt="${esc(s.alt)}" loading="lazy" decoding="async"></a><figcaption>${esc(s.caption ?? s.alt)}</figcaption></figure>`;
}

const CALLOUT: Record<string, string> = { TIP: 'Tip', NOTE: 'Note', WARNING: 'Careful', FUN: 'Fun fact' };

export function renderMarkdown(body: string, ctx: Ctx): Rendered {
  const figures: string[] = [];
  let src = body.replace(/\{\{gen:([\w-]+)\}\}/g, (_m, n: string) => {
    const g = ctx.gen?.[n]; if (g === undefined) throw new Error(`unknown generated block {{gen:${n}}}`); return `\n\n${g}\n\n`;
  });
  src = src.replace(/^\{\{fig:([\w-]+)\}\}\s*$/gm, (_m, id: string) => {
    const s = ctx.shots[id]; if (!s) throw new Error(`unknown screenshot id '${id}'`);
    figures.push(id); return `\n${figureHtml(s, ctx.rel)}\n`;
  });
  let html = marked.parse(src, { gfm: true, async: false }) as string;
  // callouts: > [!TIP] text
  html = html.replace(/<blockquote>\s*<p>\[!(TIP|NOTE|WARNING|FUN)\]\s*([\s\S]*?)<\/blockquote>/g, (_m, k: string, rest: string) =>
    `<aside class="callout ${k.toLowerCase()}"><strong class="callout-title">${CALLOUT[k]}</strong><p>${rest}</aside>`);
  // internal links: page:<slug>[#anchor] and game:
  html = html.replace(/href="page:([\w-]+)(#[\w-]+)?"/g, (_m, slug: string, h?: string) => {
    if (!ctx.slugs.has(slug)) throw new Error(`link to unknown guide page '${slug}'`);
    return `href="${ctx.rel}guide/${slug}/${h ?? ''}"`;
  });
  html = html.replace(/href="game:"/g, `href="${ctx.rel}play/"`);
  html = html.replace(/<a href="(https?:\/\/[^"]+)"/g, '<a rel="noopener" href="$1"');
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  // heading ids + toc
  const toc: TocItem[] = [], used = new Set<string>();
  html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, l: string, inner: string) => {
    let id = slugify(inner) || 'section'; const base = id; for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id); toc.push({ level: Number(l) as 2 | 3, id, text: stripTags(inner) });
    return `<h${l} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${inner}</h${l}>`;
  });
  // sections for the search index (split at h2)
  const sections: Rendered['sections'] = []; const parts = html.split(/(?=<h2 id=)/);
  for (const p of parts) {
    const m = /^<h2 id="([^"]+)">[\s\S]*?<\/a>([\s\S]*?)<\/h2>/.exec(p);
    sections.push({ id: m?.[1] ?? '', heading: m ? stripTags(m[2]!) : '', text: stripTags(p.replace(/<(figure|table)[\s\S]*?<\/\1>/g, ' ')).slice(0, 1200) });
  }
  return { html, toc, figures, sections };
}

export interface PageMeta { slug: string; title: string; order: number; summary?: string }
export const sortPages = <T extends PageMeta>(p: readonly T[]): T[] => [...p].sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
export function prevNext<T extends PageMeta>(pages: readonly T[], slug: string): { prev?: T; next?: T } {
  const s = sortPages(pages), i = s.findIndex((p) => p.slug === slug); return { prev: s[i - 1], next: s[i + 1] };
}
export interface SearchEntry { t: string; h: string; u: string; x: string }
export function searchEntries(slug: string, title: string, sections: Rendered['sections']): SearchEntry[] {
  return sections.filter((s) => s.text.length > 20).map((s) => ({ t: title, h: s.heading, u: `guide/${slug}/${s.id ? `#${s.id}` : ''}`, x: s.text }));
}
