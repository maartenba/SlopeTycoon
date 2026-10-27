/** HTML shell pieces shared by the landing page, the guide and the info pages (pure string functions). */
import { esc, type PageMeta, type TocItem, prevNext, sortPages } from './md';

export interface SiteEnv { siteUrl: string; repo: string; repoUrl: string; version: string }
export const SITE_NAME = 'Slope Tycoon';
export const AUTHOR = { name: 'Maarten Balliauw', url: 'https://github.com/maartenba' } as const;
export const GA_HOSTS = ['www.googletagmanager.com', 'www.google-analytics.com'] as const;
export const DESC = 'Build your own ski and mountain resort in the browser: shape terrain, build lifts, groom pistes and run it through all four seasons. Free, plays offline.';
export const LANDING_TITLE = 'Slope Tycoon – Ski & mountain resort tycoon game';
export const PRIVACY_CLAIM = 'No ads, no accounts, saves stay on your device, anonymous opt-in statistics.';
export const SEO = { titleMax: 59, descMin: 120, descMax: 155 } as const;
export type OgKey = 'landing' | 'guide' | 'privacy' | 'about';
export const OG_ALT: Record<OgKey, string> = {
  landing: 'Slope Tycoon: a ski village with lifts and pistes in the mountains', guide: 'Slope Tycoon player guide over a snowy resort', privacy: 'Slope Tycoon privacy and analytics over an alpine village at night', about: 'Slope Tycoon: why I built a ski resort tycoon game',
};

/** Which other guide pages are worth reading next (internal links; a test checks the slugs exist). */
export const RELATED: Record<string, string[]> = {
  'getting-started': ['interface', 'building', 'career'], interface: ['shortcuts', 'getting-started', 'settings'], building: ['lifts-pistes', 'money', 'getting-started'],
  'lifts-pistes': ['guests-seasons', 'operations', 'building'], 'guests-seasons': ['operations', 'lifts-pistes', 'money'], operations: ['events', 'guests-seasons', 'troubleshooting'],
  money: ['career', 'guests-seasons', 'building'], career: ['achievements', 'modes', 'money'], achievements: ['career', 'modes', 'settings'], modes: ['career', 'touch', 'achievements'],
  touch: ['interface', 'settings', 'troubleshooting'], settings: ['touch', 'saves', 'interface'], saves: ['settings', 'troubleshooting', 'getting-started'], troubleshooting: ['saves', 'settings', 'touch'],
  glossary: ['getting-started', 'interface', 'shortcuts'], shortcuts: ['interface', 'touch', 'glossary'], events: ['operations', 'guests-seasons', 'money'],
};

const abs = (env: SiteEnv, rel: string, p: string): string => (env.siteUrl ? `${env.siteUrl}${p}` : `${rel}${p}`);
export const jsonLd = (data: unknown): string => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

export function personLd(): Record<string, unknown> { return { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.url }; }
export function gameLd(env: SiteEnv): Record<string, unknown> {
  const base = env.siteUrl || './';
  return {
    '@context': 'https://schema.org', '@type': ['VideoGame', 'WebApplication'], name: SITE_NAME, url: base, description: DESC, applicationCategory: 'Game', operatingSystem: 'Any', genre: ['Simulation', 'Tycoon', 'Strategy'],
    gamePlatform: 'Web browser', playMode: 'SinglePlayer', inLanguage: 'en', browserRequirements: 'Requires JavaScript and WebGL', softwareVersion: env.version, isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' }, image: `${base}assets/og/landing.png`, screenshot: `${base}assets/shots/hero-winter-1280.webp`,
    author: personLd(), sameAs: [env.repoUrl], potentialAction: { '@type': 'PlayAction', target: `${base}play/` },
  };
}
export const websiteLd = (env: SiteEnv): Record<string, unknown> => ({ '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: env.siteUrl || './', inLanguage: 'en', publisher: personLd() });
export function breadcrumbLd(env: SiteEnv, items: Array<{ name: string; path: string }>): Record<string, unknown> {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: `${env.siteUrl || './'}${it.path}` })) };
}

export interface HeadOpts { rel: string; title: string; description?: string; path: string; og?: OgKey; ld?: unknown[]; noindex?: boolean; type?: 'website' | 'article' | 'profile'; preloadFonts?: boolean }
export function head(env: SiteEnv, o: HeadOpts): string {
  const desc = esc(o.description ?? DESC), rel = o.rel, og = o.og ?? 'landing', img = abs(env, rel, `assets/og/${og}.png`), t = esc(o.title);
  return [
    '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${t}</title>`, `<meta name="description" content="${desc}">`, '<meta name="theme-color" content="#0b1626">', '<meta name="color-scheme" content="dark">',
    `<meta name="robots" content="${o.noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large'}">`, `<meta name="author" content="${AUTHOR.name}">`,
    env.siteUrl ? `<link rel="canonical" href="${env.siteUrl}${o.path}">` : '',
    `<link rel="icon" href="${rel}favicon.ico" sizes="32x32"><link rel="icon" href="${rel}assets/icons/icon.svg" type="image/svg+xml">`, `<link rel="apple-touch-icon" href="${rel}assets/icons/apple-touch-icon.png">`, `<link rel="manifest" href="${rel}site.webmanifest">`,
    `<meta property="og:type" content="${o.type ?? 'website'}"><meta property="og:site_name" content="${SITE_NAME}"><meta property="og:locale" content="en_US"><meta property="og:title" content="${t}"><meta property="og:description" content="${desc}">`,
    env.siteUrl ? `<meta property="og:url" content="${env.siteUrl}${o.path}">` : '',
    `<meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:type" content="image/png"><meta property="og:image:alt" content="${esc(OG_ALT[og])}">`,
    `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${t}"><meta name="twitter:description" content="${desc}"><meta name="twitter:image" content="${img}"><meta name="twitter:image:alt" content="${esc(OG_ALT[og])}">`,
    o.preloadFonts === false ? '' : `<link rel="preload" href="${rel}assets/fonts/lilita-one-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="${rel}assets/fonts/nunito-latin.woff2" as="font" type="font/woff2" crossorigin>`,
    `<link rel="stylesheet" href="${rel}assets/site.css">`,
    ...(o.ld ?? []).map(jsonLd),
  ].filter(Boolean).join('\n');
}

/** Scripts at the end of <body> on every page: the consent logic (loads Google Analytics only after "Allow") and the site script. */
export const scripts = (rel: string): string => `<script src="${rel}assets/consent.js" data-root="${rel}" defer></script>\n<script src="${rel}assets/site.js" defer></script>`;

export function header(rel: string, markSvg: string): string {
  return `<header class="top"><div class="wrap"><a class="brand" href="${rel || './'}" aria-label="Slope Tycoon home">${markSvg}<span>Slope Tycoon</span></a>
<nav class="nav" aria-label="Main">${rel ? '' : '<a href="#what">The game</a><a href="#unique">Why it’s different</a><a href="#modes">Modes</a><a href="#gallery">Gallery</a><a href="#faq">FAQ</a>'}<a class="keep" href="${rel}guide/">Guide</a><a class="keep" href="${rel}about/">About</a><a class="btn primary" href="${rel}play/">Play</a></nav></div></header>`;
}

export function footer(env: SiteEnv, rel: string, guide: readonly PageMeta[] = []): string {
  const top = ['getting-started', 'lifts-pistes', 'money', 'shortcuts'].map((s) => guide.find((p) => p.slug === s)).filter((p): p is PageMeta => !!p);
  return `<footer><div class="wrap"><div><b>Slope Tycoon</b> v${env.version} (pre-release). Everything procedural. ${esc(PRIVACY_CLAIM)}<br>Fonts: Nunito and Lilita One (SIL OFL 1.1). Built with three.js (MIT).</div>
<div class="fcols"><nav aria-label="Footer: the game"><b>The game</b><a href="${rel}play/">Play</a><a href="${rel || './'}">Home</a><a href="${rel}about/">About / why I built this</a></nav>
<nav aria-label="Footer: guide"><b>Player guide</b><a href="${rel}guide/">All guide pages</a>${top.map((p) => `<a href="${rel}guide/${p.slug}/">${esc(p.title)}</a>`).join('')}</nav>
<nav aria-label="Footer: project"><b>Project</b><a href="${env.repoUrl}">GitHub (${esc(env.repo)})</a><a href="${env.repoUrl}/blob/main/CHANGELOG.md">Changelog</a><a href="${env.repoUrl}/tree/main/docs">Developer docs</a><a href="${env.repoUrl}/blob/main/THIRD_PARTY_NOTICES.md">Third-party notices</a></nav>
<nav aria-label="Footer: privacy"><b>Privacy</b><a href="${rel}privacy/">Privacy &amp; analytics</a><a href="${rel}privacy/#settings" data-consent-open>Privacy &amp; analytics settings</a></nav></div></div></footer>`;
}

const crumbsHtml = (rel: string, items: Array<{ name: string; href?: string }>): string => `<nav class="crumbs" aria-label="Breadcrumb">${items.map((i) => (i.href !== undefined ? `<a href="${rel}${i.href}">${esc(i.name)}</a>` : `<span aria-current="page">${esc(i.name)}</span>`)).join(' › ')}</nav>`;

export const guideTitle = (t: string): string => { const a = `${t} – Slope Tycoon guide`; return a.length <= SEO.titleMax ? a : `${t} – Slope Tycoon`; };

export function guidePage(env: SiteEnv, o: { rel: string; markSvg: string; pages: readonly PageMeta[]; slug: string; title: string; summary?: string; description?: string; html: string; toc: TocItem[] }): string {
  const { rel, pages } = o, sorted = sortPages(pages), { prev, next } = prevNext(pages, o.slug);
  const nav = (): string => sorted.map((p) => `<a href="${rel}guide/${p.slug}/"${p.slug === o.slug ? ' aria-current="page"' : ''}>${esc(p.title)}</a>`).join('');
  const toc = o.toc.length > 1 ? `<aside class="gtoc" aria-label="On this page"><b style="display:block;color:var(--muted);font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;margin:0 0 8px 10px">On this page</b>${o.toc.map((t) => `<a class="l${t.level}" href="#${t.id}">${esc(t.text)}</a>`).join('')}</aside>` : '<aside class="gtoc"></aside>';
  const related = (RELATED[o.slug] ?? []).map((s) => pages.find((p) => p.slug === s)).filter((p): p is PageMeta => !!p);
  const ld = [breadcrumbLd(env, [{ name: 'Slope Tycoon', path: '' }, { name: 'Player guide', path: 'guide/' }, { name: o.title, path: `guide/${o.slug}/` }])];
  return `<!doctype html>\n<html lang="en"><head>\n${head(env, { rel, title: guideTitle(o.title), description: o.description ?? o.summary, path: `guide/${o.slug}/`, og: 'guide', type: 'article', ld })}\n</head><body>
<a class="skip" href="#main">Skip to content</a>
${header(rel, o.markSvg)}
<div class="gwrap"><nav class="gnav" aria-label="Guide pages"><div class="search" data-search data-root="${rel}"><input type="search" placeholder="Search the guide ( / )" aria-label="Search the guide" autocomplete="off"><div class="results" hidden></div></div><b style="margin-top:18px">Player guide</b>${nav()}</nav>
<main id="main"><article><details class="mnav"><summary>Guide pages</summary>${nav()}</details>
${crumbsHtml(rel, [{ name: 'Home', href: '' }, { name: 'Player guide', href: 'guide/' }, { name: o.title }])}
<h1>${esc(o.title)}</h1>${o.summary ? `<p class="sum">${esc(o.summary)}</p>` : ''}
${o.html}
${related.length ? `<h2 id="related-pages">Related pages</h2><ul class="related">${related.map((p) => `<li><a href="${rel}guide/${p.slug}/">${esc(p.title)}</a>: ${esc(p.summary ?? '')}</li>`).join('')}</ul>` : ''}
<div class="pn">${prev ? `<a href="${rel}guide/${prev.slug}/" rel="prev"><small>← Previous</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="nx" href="${rel}guide/${next.slug}/" rel="next"><small>Next →</small>${esc(next.title)}</a>` : ''}</div></article></main>
${toc}</div>
${footer(env, rel, pages)}
${scripts(rel)}</body></html>\n`;
}

export const GUIDE_INDEX_TITLE = 'Slope Tycoon player guide – tips, controls, seasons';
export const GUIDE_INDEX_DESC = 'The Slope Tycoon player guide: getting started, building lifts and pistes, seasons, money, game modes, keyboard shortcuts, touch controls and fixes.';

export function guideIndex(env: SiteEnv, o: { rel: string; markSvg: string; pages: readonly PageMeta[] }): string {
  const { rel } = o;
  const ld = [breadcrumbLd(env, [{ name: 'Slope Tycoon', path: '' }, { name: 'Player guide', path: 'guide/' }])];
  return `<!doctype html>\n<html lang="en"><head>\n${head(env, { rel, title: GUIDE_INDEX_TITLE, description: GUIDE_INDEX_DESC, path: 'guide/', og: 'guide', ld })}\n</head><body>
<a class="skip" href="#main">Skip to content</a>
${header(rel, o.markSvg)}
<main id="main"><div class="wrap" style="padding-top:40px;padding-bottom:60px">${crumbsHtml(rel, [{ name: 'Home', href: '' }, { name: 'Player guide' }])}<p class="eyebrow">Player guide</p><h1>Everything you need to run your resort</h1>
<p class="lead-in">Friendly, current, and checked against the game. Tables of keys, levels, scenarios and trophies are generated from the game itself, so they never go stale.</p>
<div class="search" data-search data-root="${rel}" style="max-width:520px;margin:22px 0"><input type="search" placeholder="Search the guide ( / )" aria-label="Search the guide" autocomplete="off"><div class="results" hidden></div></div>
<noscript><p>Search needs JavaScript. Browse the pages below instead.</p></noscript>
<div class="gcards">${sortPages(o.pages).map((p) => `<a href="${rel}guide/${p.slug}/"><b>${esc(p.title)}</b><span>${esc(p.summary ?? '')}</span></a>`).join('')}</div>
<p style="margin-top:28px">New here? Start with <a href="${rel}guide/getting-started/">Getting started</a>, then <a href="${rel}play/">play Slope Tycoon</a>. Curious about the project? Read <a href="${rel}about/">why I built it</a> or the <a href="${rel}privacy/">privacy &amp; analytics</a> page.</p></div></main>
${footer(env, rel, o.pages)}
${scripts(rel)}</body></html>\n`;
}

export interface InfoPage { slug: 'privacy' | 'about'; title: string; description: string; heading: string; html: string; og: OgKey; type?: 'website' | 'profile' }
/** Plain content page (privacy, about) generated from site/pages/<slug>.md with the guide's look. */
export function infoPage(env: SiteEnv, o: InfoPage & { markSvg: string; pages: readonly PageMeta[] }): string {
  const rel = '../', ld: unknown[] = [breadcrumbLd(env, [{ name: 'Slope Tycoon', path: '' }, { name: o.heading, path: `${o.slug}/` }])];
  if (o.slug === 'about') ld.push({ '@context': 'https://schema.org', '@type': 'AboutPage', name: o.title, url: `${env.siteUrl || './'}about/`, mainEntity: { ...personLd(), '@type': 'Person', description: 'Developer of Slope Tycoon' } });
  else ld.push({ '@context': 'https://schema.org', '@type': 'WebPage', name: o.title, url: `${env.siteUrl || './'}privacy/`, author: personLd() });
  return `<!doctype html>\n<html lang="en"><head>\n${head(env, { rel, title: o.title, description: o.description, path: `${o.slug}/`, og: o.og, type: o.type, ld })}\n</head><body>
<a class="skip" href="#main">Skip to content</a>
${header(rel, o.markSvg)}
<main id="main" class="info"><article>${crumbsHtml(rel, [{ name: 'Home', href: '' }, { name: o.heading }])}<h1>${esc(o.heading)}</h1>
${o.html}
<p><a class="btn primary" href="${rel}play/">▶ Play Slope Tycoon</a> <a class="btn ghost" href="${rel}guide/">Read the player guide</a></p></article></main>
${footer(env, rel, o.pages)}
${scripts(rel)}</body></html>\n`;
}

/** 404 page for the website: no redirect (a real 404), noindex, links back. Absolute links when the site URL is known so they work at any depth. */
export function notFoundPage(env: SiteEnv): string {
  const b = env.siteUrl || '/';
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found – Slope Tycoon</title><meta name="robots" content="noindex"><meta name="theme-color" content="#0b1626">
<link rel="icon" href="${b}assets/icons/icon.svg" type="image/svg+xml"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1626;color:#e8f0fb;font:18px/1.6 Nunito,system-ui,sans-serif;text-align:center;padding:24px}h1{font:400 2.4rem 'Lilita One',Nunito,system-ui,sans-serif;margin:.2em 0}a{color:#ffb84d}nav{display:flex;gap:18px;justify-content:center;flex-wrap:wrap;margin-top:18px}</style></head>
<body><main><h1>This piste is closed</h1><p>We could not find that page. It may have moved, or the link is a little off.</p>
<nav aria-label="Where to go next"><a href="${b}">Slope Tycoon home</a><a href="${b}play/">Play the game</a><a href="${b}guide/">Player guide</a><a href="${b}about/">About</a><a href="${b}privacy/">Privacy &amp; analytics</a></nav></main></body></html>\n`;
}

export function sitemapXml(base: string, urls: Array<{ path: string; lastmod: string; changefreq: string; priority: string }>): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${base}${u.path}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>\n`;
}
export const robotsTxt = (base: string): string => `User-agent: *\nAllow: /\n\nSitemap: ${base}sitemap.xml\n`;
