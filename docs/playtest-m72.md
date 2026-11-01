# M7.2 review checklist: website SEO and a less AI-looking site

Site-only milestone: no game code changed, the version stays 0.3.1. Build and look at it with `npm run build:site && npm run site:dev` (http://localhost:4190/) or read the screenshots in `.weave/shots/seo-*.png` (`seo-before-*` is the old landing page, `seo-after-*` the new one).

## What changed
- **On-page SEO**: unique titles under 60 characters and descriptions of 120 to 155 for every page (a lint in `site:check` and the tests), canonical URLs, Open Graph and Twitter cards for every page type, JSON-LD (VideoGame / WebApplication, WebSite, WebPage or Article, BreadcrumbList, FAQPage that matches the visible FAQ, ItemList, BlogPosting), descriptive internal links between guide and landing pages, a "Read more" footer column, and a sitemap with `lastmod` for every page.
- **Five landing pages**: `/ski-resort-tycoon/`, `/games-like-ski-resort-tycoon/`, `/how-ski-lifts-work/`, `/browser-tycoon-games/`, `/summer-mountain-resort-game/`.
- **Devlog**: `/devlog/`, one post per released version (0.1.0 to 0.3.1) built from the CHANGELOG with your intros from `site/devlog/intros.json`, and `/devlog/feed.xml`.
- **Landing page redesign**: no more numbers strip, card grids or slideshow; screenshot-led hero, an editorial layout, your story as a pull quote, dev-note captions, "Things I like / Things I'm still fixing".
- **Copy edit** and a voice test (`tests/site/voice.test.ts`).

## Please check (your voice, your facts)
1. **Landing copy** (`site/index.html`): the hero line, the captions ("Winter, with more guests than I planned for", "Check it before you build a gondola" and so on) and the two lists. Are they you? Are the "still fixing" items true today (phones cramped, pistes over streams, walk mode needing pointer lock)?
2. **Devlog intros** (`site/devlog/intros.json`): twelve short leads written in your voice from the CHANGELOG. Edit freely; they are the only hand-written part of each post. When you cut a release, add its entry (a test fails if it is missing).
3. **`/games-like-ski-resort-tycoon/`**: I described Ski-E-O!, Skingdom, Snowtopia and Winter Resort Simulator only in general terms (from what the Ahrefs research and their store pages said) and did not link them, because the privacy rules allow only GitHub and Wikipedia links. If you want store links, decide whether to extend the allowed list (`EXTERNAL_OK` in `scripts/site/crawl.ts`). Please check that nothing there is wrong or unfair, and say whether you want that page at all.
4. **`/browser-tycoon-games/`** is deliberately short and generic. Keep, rework or drop.
5. Look at the pages in a browser at 1440, 1024 and 390 px wide.

## Search Console (needs your Google account; agents cannot do this)
1. Add the property `https://slopetycoon.com/` (DNS or HTML-tag verification).
2. Submit `https://slopetycoon.com/sitemap.xml`.
3. Use "URL inspection" then "Request indexing" for: `/`, `/ski-resort-tycoon/`, `/how-ski-lifts-work/`, `/games-like-ski-resort-tycoon/`, `/summer-mountain-resort-game/`, `/browser-tycoon-games/`, `/devlog/`.
4. Check "Pages" after a week for errors, and look at Queries after a month. Re-run the Ahrefs research in about three months (`docs/seo-research.md`, appendix).

## Share ideas (you post, agents do not)
Draft posts for r/tycoon, r/WebGames, r/skiing, Show HN, itch.io, AlternativeTo and a ski-site email are in `docs/outreach-drafts.md`. Read the notes at the top first.

## Gate that was run
`npm run site:og`, `npm run docs:img`, `npm run build:site && npm run site:check && npm run verify:site`, and the standard gate (typecheck, lint, test, build, verify:pwa). See the CHANGELOG [Unreleased] section.
