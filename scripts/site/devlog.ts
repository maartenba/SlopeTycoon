/** Devlog: one post per released CHANGELOG version, generated at build time (`/devlog/` index, `/devlog/<version>/` posts, `/devlog/feed.xml`).
 * The CHANGELOG is the source of truth: Highlights lead each post and everything else is folded into "What else changed". `site/devlog/intros.json` holds the hand-written
 * intros (a tagline, a lead in the owner's voice, an optional screenshot id). A release without an intro still gets a post (a test also fails when a released version has none). */
import { readFileSync } from 'node:fs';
import { marked } from 'marked';
import { esc, figureHtml, plainText, type PageMeta, type ShotInfo } from './md';
import { AUTHOR, SITE_NAME, breadcrumbLd, crumbsHtml, personLd, shell, supportLink, type SiteEnv } from './templates';

export interface Release { version: string; date: string; intro: string; highlights: string[]; changes: string[] }
export interface Intro { tagline: string; lead?: string; shot?: string }
export const DEVLOG_TITLE = 'Slope Tycoon devlog – release notes, one post per version';
export const DEVLOG_DESC = 'The Slope Tycoon devlog: what changed in each release of the browser ski resort tycoon, from the first playable build to the latest, in plain words.';

export const slugOf = (version: string): string => `devlog/${version.replace(/\./g, '-')}`;
export const readingMinutes = (words: number): number => Math.max(1, Math.round(words / 200));

/** Plain-text first sentence, at most `max` characters (cut at a word boundary). */
export function firstSentence(md: string, max = 230): string {
  const t = md.replace(/\s+/g, ' ').replace(/\*\*/g, '').replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(t); const s = m && m[1]!.length >= 25 ? m[1]! : t;
  if (s.length <= max) return s;
  const cut = s.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:(]\s*$/, '');
  return `${cut}…`;
}

/** Parses CHANGELOG.md into the released versions (newest first). `[Unreleased]` is skipped. */
export function parseChangelog(src: string): Release[] {
  const out: Release[] = [];
  for (const block of src.split(/^## /m).slice(1)) {
    const head = /^\[([^\]]+)\]\s*-\s*(\d{4}-\d\d-\d\d)/.exec(block);
    if (!head) continue;
    const lines = block.split('\n').slice(1);
    let sect = ''; const intro: string[] = [], hl: string[] = [], ch: string[] = [];
    let cur = false;
    for (const raw of lines) {
      const l = raw.trimEnd();
      const h = /^###\s+(.*)$/.exec(l);
      if (h) { sect = h[1]!.trim().toLowerCase(); continue; }
      if (/^####\s/.test(l)) continue;
      const b = /^[-*]\s+(.*)$/.exec(l);
      if (b) { (sect === 'highlights' ? hl : ch).push(b[1]!); cur = true; continue; }
      if (!sect) { if (l.trim()) intro.push(l.trim()); continue; }
      if (/^\s+\S/.test(l) && cur) { const arr = sect === 'highlights' ? hl : ch; arr[arr.length - 1] += ` ${l.trim()}`; }
    }
    out.push({ version: head[1]!, date: head[2]!, intro: intro.join(' '), highlights: hl, changes: ch.filter((c) => c.length > 20) });
  }
  return out;
}
export const loadReleases = (file = 'CHANGELOG.md'): Release[] => parseChangelog(readFileSync(file, 'utf8'));
export const loadIntros = (file = 'site/devlog/intros.json'): Record<string, Intro> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, Intro>;

const inline = (md: string): string => (marked.parseInline(md.replace(/\bTask \d+\b/g, '').replace(/\s{2,}/g, ' '), { gfm: true, async: false }) as string);
/** Fits a description into 120-155 characters: shortened at a word boundary, or padded with a closing phrase. */
export function fitDescription(text: string, min = 120, max = 155): string {
  let t = text.replace(/\s+/g, ' ').trim();
  const pad = [' A Slope Tycoon devlog post.', ' Read the full Slope Tycoon devlog post.', ' Notes from the Slope Tycoon devlog, a browser ski resort game.'];
  for (const p of pad) { if (t.length >= min) break; t += p; }
  if (t.length > max) { t = t.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/[,;:(\s]+$/, '').replace(/[.!?]$/, ''); t += '…'; }
  return t;
}
export const postTitle = (r: Release, i?: Intro): string => {
  const full = i?.tagline ? `Slope Tycoon ${r.version}: ${i.tagline} – devlog` : `Slope Tycoon ${r.version} – devlog`;
  return full.length <= 59 ? full : `Slope Tycoon ${r.version}: ${i!.tagline}`.slice(0, 59).replace(/\s+\S*$/, '');
};
export function postDescription(r: Release, i?: Intro): string {
  const base = i?.lead ? firstSentence(i.lead, 200) : r.highlights.length ? `${firstSentence(r.highlights[0]!, 100)} ${r.highlights[1] ? firstSentence(r.highlights[1], 80) : ''}` : firstSentence(r.intro, 200);
  return fitDescription(`Version ${r.version} (${niceDate(r.date)}): ${plainText(inline(base))}`);
}
export const niceDate = (d: string): string => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export interface Post { release: Release; intro?: Intro; slug: string; title: string; description: string; words: number; minutes: number; leadHtml: string; highlightsHtml: string; changesHtml: string; shot?: ShotInfo }
const MAX_CHANGES = 12;
export function buildPost(r: Release, intro: Intro | undefined, shots: Record<string, ShotInfo>): Post {
  const lead = intro?.lead ?? firstSentence(r.intro, 600);
  const highlights = r.highlights.length ? r.highlights : r.changes.slice(0, 3).map((c) => firstSentence(c, 160));
  const changes = r.changes.map((c) => firstSentence(c, 220)).slice(0, MAX_CHANGES);
  const leadHtml = inline(lead), highlightsHtml = highlights.map((h) => `<li>${inline(h)}</li>`).join(''), changesHtml = changes.map((c) => `<li>${inline(c)}</li>`).join('');
  const words = plainText(`${leadHtml} ${highlightsHtml} ${changesHtml}`).split(' ').length;
  return { release: r, intro, slug: slugOf(r.version), title: postTitle(r, intro), description: postDescription(r, intro), words, minutes: readingMinutes(words), leadHtml, highlightsHtml, changesHtml, shot: intro?.shot ? shots[intro.shot] : undefined };
}
export function buildPosts(releases: readonly Release[], intros: Record<string, Intro>, shots: Record<string, ShotInfo>): Post[] { return releases.map((r) => buildPost(r, intros[r.version], shots)); }

const dateLine = (p: Post): string => `<p class="meta"><time datetime="${p.release.date}">${niceDate(p.release.date)}</time> · version ${esc(p.release.version)} · ${p.minutes} min read</p>`;

export function postPage(env: SiteEnv, p: Post, posts: readonly Post[], markSvg: string, pages: readonly PageMeta[]): string {
  const rel = '../../', base = env.siteUrl || './', url = `${base}${p.slug}/`, i = posts.indexOf(p), newer = posts[i - 1], older = posts[i + 1];
  const ld = [
    { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: `Slope Tycoon ${p.release.version}${p.intro?.tagline ? `: ${p.intro.tagline}` : ''}`, description: p.description, url, mainEntityOfPage: url, datePublished: p.release.date, dateModified: p.release.date, author: personLd(), publisher: { ...personLd() }, image: `${base}assets/og/devlog.png`, wordCount: p.words, inLanguage: 'en', isPartOf: { '@type': 'Blog', name: `${SITE_NAME} devlog`, url: `${base}devlog/` } },
    breadcrumbLd(env, [{ name: 'Slope Tycoon', path: '' }, { name: 'Devlog', path: 'devlog/' }, { name: `Version ${p.release.version}`, path: `${p.slug}/` }]),
  ];
  const fig = p.shot ? figureHtml(p.shot, rel) : '';
  const main = `<article class="post">${crumbsHtml(rel, [{ name: 'Home', href: '' }, { name: 'Devlog', href: 'devlog/' }, { name: `Version ${p.release.version}` }])}
<h1>${esc(`Slope Tycoon ${p.release.version}${p.intro?.tagline ? `: ${p.intro.tagline}` : ''}`)}</h1>${dateLine(p)}
<p class="lp-lead">${p.leadHtml}</p>${fig}
<h2 id="highlights">Highlights</h2><ul class="hl">${p.highlightsHtml}</ul>
${p.changesHtml ? `<h2 id="what-else-changed">What else changed</h2><ul class="hl small">${p.changesHtml}</ul><p class="note">This list is shortened. The full technical list is in the <a href="${env.repoUrl}/blob/main/CHANGELOG.md">changelog</a>.</p>` : ''}
<aside class="lp-cta"><p>Want to see it for yourself? The game is free and runs in a browser tab.</p><p><a class="btn primary" href="${rel}play/">▶ Play Slope Tycoon</a> ${supportLink()}</p></aside>
<div class="pn">${older ? `<a href="${rel}${older.slug}/" rel="prev"><small>← Older</small>Version ${esc(older.release.version)}</a>` : '<span></span>'}${newer ? `<a class="nx" href="${rel}${newer.slug}/" rel="next"><small>Newer →</small>Version ${esc(newer.release.version)}</a>` : ''}</div>
<p><a href="${rel}devlog/">All devlog posts</a> · <a href="${rel}devlog/feed.xml">Atom feed</a></p></article>`;
  return shell(env, { rel, markSvg, pages, head: { rel, title: p.title, description: p.description, path: `${p.slug}/`, og: 'devlog', type: 'article', ld, feed: true }, main });
}

export function indexPage(env: SiteEnv, posts: readonly Post[], markSvg: string, pages: readonly PageMeta[], intro: string): string {
  const rel = '../', base = env.siteUrl || './';
  const ld = [
    { '@context': 'https://schema.org', '@type': 'Blog', name: `${SITE_NAME} devlog`, url: `${base}devlog/`, description: DEVLOG_DESC, author: personLd(), inLanguage: 'en', blogPost: posts.map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${base}${p.slug}/`, datePublished: p.release.date })) },
    breadcrumbLd(env, [{ name: 'Slope Tycoon', path: '' }, { name: 'Devlog', path: 'devlog/' }]),
  ];
  const items = posts.map((p) => `<li><a class="post-link" href="${rel}${p.slug}/"><b>Version ${esc(p.release.version)}${p.intro?.tagline ? `: ${esc(p.intro.tagline)}` : ''}</b><span class="meta">${niceDate(p.release.date)} · ${p.minutes} min read</span><span>${inline(firstSentence(p.release.highlights[0] ?? p.release.intro, 170))}</span></a></li>`).join('\n');
  const main = `<article>${crumbsHtml(rel, [{ name: 'Home', href: '' }, { name: 'Devlog' }])}<h1>Devlog</h1><p class="lp-lead">${intro}</p>
<p class="meta">${posts.length} posts · <a href="${rel}devlog/feed.xml">Atom feed</a> (self-hosted, nothing is requested from anywhere else)</p>
<ol class="posts">${items}</ol>
<aside class="lp-cta"><p>Every release of the game gets one post, built from the changelog.</p><p><a class="btn primary" href="${rel}play/">▶ Play Slope Tycoon</a> ${supportLink()}</p></aside></article>`;
  return shell(env, { rel, markSvg, pages, head: { rel, title: DEVLOG_TITLE, description: DEVLOG_DESC, path: 'devlog/', og: 'devlog', ld, feed: true }, main });
}

const x = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Atom feed (self-hosted). Absolute URLs from the site URL. */
export function atomFeed(env: SiteEnv, posts: readonly Post[]): string {
  const base = env.siteUrl || 'https://slopetycoon.com/', updated = `${posts[0]?.release.date ?? '2026-01-01'}T12:00:00Z`;
  const entries = posts.map((p) => `  <entry>
    <title>${x(`Slope Tycoon ${p.release.version}${p.intro?.tagline ? `: ${p.intro.tagline}` : ''}`)}</title>
    <link rel="alternate" type="text/html" href="${base}${p.slug}/"/>
    <id>${base}${p.slug}/</id>
    <published>${p.release.date}T12:00:00Z</published>
    <updated>${p.release.date}T12:00:00Z</updated>
    <author><name>${x(AUTHOR.name)}</name></author>
    <summary>${x(p.description)}</summary>
    <content type="html">${x(`<p>${p.leadHtml}</p><ul>${p.highlightsHtml}</ul>`)}</content>
  </entry>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>Slope Tycoon devlog</title>\n  <subtitle>${x(DEVLOG_DESC)}</subtitle>\n  <link rel="self" type="application/atom+xml" href="${base}devlog/feed.xml"/>\n  <link rel="alternate" type="text/html" href="${base}devlog/"/>\n  <id>${base}devlog/</id>\n  <updated>${updated}</updated>\n  <author><name>${x(AUTHOR.name)}</name></author>\n${entries}\n</feed>\n`;
}
