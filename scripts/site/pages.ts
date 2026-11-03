/** Generated content pages beyond the guide: keyword landing pages (site/landing/*.md) and the devlog (CHANGELOG.md). Pure of the output directory: returns html for the builder and the tests. */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { figureHtml, parseFrontMatter, renderInline, renderMarkdown, type PageMeta, type ShotInfo } from './md';
import { atomFeed, buildPosts, indexPage, loadIntros, loadReleases, postPage, type Post } from './devlog';
import { faqBlock, landingPage, type OgKey, type SiteEnv } from './templates';

/** Last commit date (YYYY-MM-DD) of a source file, or today when it is not committed yet. */
export function lastmodOf(file: string, today = new Date().toISOString().slice(0, 10)): string {
  try { const d = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); return /^\d{4}-\d\d-\d\d$/.test(d) ? d : today; } catch { return today; }
}
export interface GenPage { /** directory under the site root, no trailing slash */ path: string; html: string; src: string; lastmod: string; changefreq: string; priority: string }

export const LANDING_DIR = 'site/landing';
export const landingFiles = (): string[] => readdirSync(LANDING_DIR).filter((f) => f.endsWith('.md')).sort();
/** Every slug `lp:<slug>` may point at: the landing pages, the devlog, about and privacy. */
export const landingSlugs = (): Set<string> => new Set([...landingFiles().map((f) => f.replace(/\.md$/, '')), 'devlog', 'about', 'support', 'privacy']);

export function landingPages(env: SiteEnv, markSvg: string, pages: readonly PageMeta[], shots: Record<string, ShotInfo>, slugs: ReadonlySet<string>, gen: Record<string, string>, today = new Date().toISOString().slice(0, 10)): GenPage[] {
  const landing = landingSlugs();
  return landingFiles().map((f) => {
    const slug = f.replace(/\.md$/, ''), src = join(LANDING_DIR, f), { data, body } = parseFrontMatter(readFileSync(src, 'utf8'));
    const r = renderMarkdown(body, { rel: '../', shots, slugs, gen, landing });
    const faq = faqBlock(data.faq ?? [], { rel: '../', slugs, landing });
    const hero = data.hero ? shots[data.hero] : undefined; if (data.hero && !hero) throw new Error(`${slug}: unknown hero screenshot '${data.hero}'`);
    const mod = lastmodOf(src, today);
    const html = landingPage(env, {
      slug, title: data.title, description: data.description ?? '', heading: data.heading ?? data.title, lead: renderInline(data.lead ?? '', { rel: '../', slugs, landing }), og: (data.og ?? 'landing') as OgKey, kind: data.kind ?? 'page',
      published: data.published ?? mod, modified: mod, items: data.items ?? [], html: r.html, heroHtml: hero ? figureHtml(hero, '../') : '', faqHtml: faq.html, faqLd: faq.ld, related: data.related ?? [], markSvg, pages,
    });
    return { path: slug, html, src, lastmod: mod, changefreq: 'monthly', priority: slug === 'ski-resort-tycoon' ? '0.9' : '0.7' };
  });
}

export function devlogData(shots: Record<string, ShotInfo>): Post[] { return buildPosts(loadReleases(), loadIntros(), shots); }
export function devlogPages(env: SiteEnv, markSvg: string, pages: readonly PageMeta[], shots: Record<string, ShotInfo>): { pages: GenPage[]; feed: string; posts: Post[] } {
  const posts = devlogData(shots), newest = posts[0]?.release.date ?? new Date().toISOString().slice(0, 10);
  const idx: GenPage = { path: 'devlog', html: indexPage(env, posts, markSvg, pages, 'One post for every release of Slope Tycoon, newest first. They are built from the changelog: the highlights lead, and the smaller changes come after. I write a short intro for the bigger ones.'), src: 'CHANGELOG.md', lastmod: newest, changefreq: 'weekly', priority: '0.6' };
  return { pages: [idx, ...posts.map((p): GenPage => ({ path: p.slug, html: postPage(env, p, posts, markSvg, pages), src: 'CHANGELOG.md', lastmod: p.release.date, changefreq: 'yearly', priority: '0.5' }))], feed: atomFeed(env, posts), posts };
}
