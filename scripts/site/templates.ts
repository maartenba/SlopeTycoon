/** HTML shell pieces shared by the landing page and the guide (pure string functions). */
import { esc, type PageMeta, type TocItem, prevNext, sortPages } from './md';

export interface SiteEnv { siteUrl: string; repo: string; repoUrl: string; version: string }
export const DESC = 'Slope Tycoon: a cosy browser ski-resort tycoon. Shape the mountain, build lifts, groom pistes and run your resort through all four seasons. Free, offline, no tracking.';

export function head(env: SiteEnv, o: { rel: string; title: string; description?: string; path: string; preloadFonts?: boolean }): string {
  const desc = esc(o.description ?? DESC), rel = o.rel, abs = (p: string): string => (env.siteUrl ? `${env.siteUrl}${p}` : `${rel}${p}`);
  return [
    '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(o.title)}</title>`, `<meta name="description" content="${desc}">`, '<meta name="theme-color" content="#0b1626">', '<meta name="color-scheme" content="dark">',
    env.siteUrl ? `<link rel="canonical" href="${env.siteUrl}${o.path}">` : '',
    `<link rel="icon" href="${rel}assets/icons/favicon.svg" type="image/svg+xml">`, `<link rel="apple-touch-icon" href="${rel}assets/icons/apple-touch-icon.png">`,
    `<meta property="og:type" content="website"><meta property="og:site_name" content="Slope Tycoon"><meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${desc}">`,
    env.siteUrl ? `<meta property="og:url" content="${env.siteUrl}${o.path}">` : '',
    `<meta property="og:image" content="${abs('assets/og.png')}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Slope Tycoon: a ski village in the mountains">`,
    `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(o.title)}"><meta name="twitter:description" content="${desc}"><meta name="twitter:image" content="${abs('assets/og.png')}">`,
    o.preloadFonts === false ? '' : `<link rel="preload" href="${rel}assets/fonts/nunito-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="${rel}assets/fonts/lilita-one-latin.woff2" as="font" type="font/woff2" crossorigin>`,
    `<link rel="stylesheet" href="${rel}assets/site.css">`,
  ].filter(Boolean).join('\n');
}

export function header(rel: string, markSvg: string): string {
  return `<header class="top"><div class="wrap"><a class="brand" href="${rel || './'}" aria-label="Slope Tycoon home">${markSvg}<span>Slope Tycoon</span></a>
<nav class="nav" aria-label="Main">${rel ? '' : '<a href="#what">About</a><a href="#unique">Why it’s different</a><a href="#modes">Modes</a><a href="#gallery">Gallery</a><a href="#faq">FAQ</a>'}<a class="keep" href="${rel}guide/">Guide</a><a class="btn primary" href="${rel}play/">Play</a></nav></div></header>`;
}

export function footer(env: SiteEnv, rel: string): string {
  return `<footer><div class="wrap"><div><b>Slope Tycoon</b> v${env.version} (pre-release). Everything procedural, nothing tracked.<br>Fonts: Nunito and Lilita One (SIL OFL 1.1). Built with three.js (MIT).</div>
<nav aria-label="Footer"><a href="${rel}play/">Play</a><a href="${rel}guide/">Player guide</a><a href="${env.repoUrl}">GitHub (${esc(env.repo)})</a><a href="${env.repoUrl}/blob/main/CHANGELOG.md">Changelog</a><a href="${env.repoUrl}/tree/main/docs">Developer docs</a><a href="${env.repoUrl}/blob/main/THIRD_PARTY_NOTICES.md">Third-party notices</a></nav></div></footer>`;
}

export function guidePage(env: SiteEnv, o: { rel: string; markSvg: string; pages: readonly PageMeta[]; slug: string; title: string; summary?: string; html: string; toc: TocItem[] }): string {
  const { rel, pages } = o, sorted = sortPages(pages), { prev, next } = prevNext(pages, o.slug);
  const nav = (): string => sorted.map((p) => `<a href="${rel}guide/${p.slug}/"${p.slug === o.slug ? ' aria-current="page"' : ''}>${esc(p.title)}</a>`).join('');
  const toc = o.toc.length > 1 ? `<aside class="gtoc" aria-label="On this page"><b style="display:block;color:var(--muted);font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;margin:0 0 8px 10px">On this page</b>${o.toc.map((t) => `<a class="l${t.level}" href="#${t.id}">${esc(t.text)}</a>`).join('')}</aside>` : '<aside class="gtoc"></aside>';
  return `<!doctype html>\n<html lang="en"><head>\n${head(env, { rel, title: `${o.title} · Slope Tycoon player guide`, description: o.summary, path: `guide/${o.slug}/` })}\n</head><body>
<a class="skip" href="#main">Skip to content</a>
${header(rel, o.markSvg)}
<div class="gwrap"><nav class="gnav" aria-label="Guide pages"><div class="search" data-search data-root="${rel}"><input type="search" placeholder="Search the guide ( / )" aria-label="Search the guide" autocomplete="off"><div class="results" hidden></div></div><b style="margin-top:18px">Player guide</b>${nav()}</nav>
<main id="main"><article><details class="mnav"><summary>Guide pages</summary>${nav()}</details>
<h1>${esc(o.title)}</h1>${o.summary ? `<p class="sum">${esc(o.summary)}</p>` : ''}
${o.html}
<div class="pn">${prev ? `<a href="${rel}guide/${prev.slug}/" rel="prev"><small>← Previous</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="nx" href="${rel}guide/${next.slug}/" rel="next"><small>Next →</small>${esc(next.title)}</a>` : ''}</div></article></main>
${toc}</div>
${footer(env, rel)}
<script src="${rel}assets/site.js" defer></script></body></html>\n`;
}

export function guideIndex(env: SiteEnv, o: { rel: string; markSvg: string; pages: readonly PageMeta[] }): string {
  const { rel } = o;
  return `<!doctype html>\n<html lang="en"><head>\n${head(env, { rel, title: 'Player guide · Slope Tycoon', description: 'The Slope Tycoon player guide: getting started, building, seasons, money, modes, shortcuts and more.', path: 'guide/' })}\n</head><body>
<a class="skip" href="#main">Skip to content</a>
${header(rel, o.markSvg)}
<main id="main"><div class="wrap" style="padding-top:40px;padding-bottom:60px"><p class="eyebrow">Player guide</p><h1>Everything you need to run your resort</h1>
<p class="lead-in">Friendly, current, and checked against the game. Tables of keys, levels, scenarios and trophies are generated from the game itself, so they never go stale.</p>
<div class="search" data-search data-root="${rel}" style="max-width:520px;margin:22px 0"><input type="search" placeholder="Search the guide ( / )" aria-label="Search the guide" autocomplete="off"><div class="results" hidden></div></div>
<noscript><p>Search needs JavaScript. Browse the pages below instead.</p></noscript>
<div class="gcards">${sortPages(o.pages).map((p) => `<a href="${rel}guide/${p.slug}/"><b>${esc(p.title)}</b><span>${esc(p.summary ?? '')}</span></a>`).join('')}</div></div></main>
${footer(env, rel)}
<script src="${rel}assets/site.js" defer></script></body></html>\n`;
}
