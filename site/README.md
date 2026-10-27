# Slope Tycoon website and player guide

One repo, one GitHub Pages deployment: **`/` = website, `/guide/` = player guide, `/play/` = the game (PWA)**. No framework, self-hosted assets. Privacy: no ads, no accounts, saves stay on the device, **anonymous opt-in statistics** (Google Analytics, only after the visitor clicks "Allow"; see [Analytics and SEO](#analytics-and-seo)).

```
site/index.html          landing page template ({{placeholders}} are filled by scripts/site/build.ts)
site/assets/             site.css, site.js, shots/ (optimised WebP + index.json, committed)
site/pages/*.md          about + privacy pages (front matter: title = SEO title, heading, description)
site/guide/*.md          player guide pages (front matter: title, order, summary, screenshots)
site/shots.json          screenshot manifest: id -> harness arguments, alt text, caption, pages
site/shots-raw/          raw PNGs from the harness (git-ignored)
scripts/site/            md.ts (pipeline), generated.ts (tables from game config), templates.ts, build.ts, shots.ts, optimize.ts, crawl.ts, check.ts, verify-site.ts, dev.ts
dist-site/               build output (git-ignored): website + play/
```

## How to update the site and the guide

1. **Edit text**: change `site/guide/*.md` (or `site/index.html`, `site/assets/site.css`).
2. **New or changed screenshot**: add / edit the entry in `site/shots.json`, then `npm run site:shots -- --only id1,id2` (see below) and use `{{fig:id}}` in a guide page.
3. `npm run build:site` (builds the game into `dist-site/play` and the website around it), then `npm run site:check`.
4. Look at it: `npm run site:dev` (http://localhost:4190/) or `npm run site:preview-shots` (writes screenshots of the built pages to `.weave/shots/site-*.png`).
5. Commit `site/**` (including `site/assets/shots/*.webp` and `index.json`).

CI never re-shoots screenshots: it uses the committed WebP files.

## Guide page format

```markdown
---
title: "Money"            # quote values that contain a colon
order: 7                  # sidebar / prev-next order
summary: "One sentence for the index and meta description."
screenshots: [ui-finance]  # ids used on the page (a test checks they match the {{fig:..}} tags)
---
Text with **markdown**, tables, `code`, <kbd>K</kbd>.

{{fig:ui-finance}}              <- figure with srcset, lightbox and caption (from shots.json)
{{gen:levels}}                  <- generated block (see below)
> [!TIP] Callout. Also [!NOTE], [!WARNING], [!FUN].
[Money](page:money)             <- link to another guide page (resolved relative to the current page)
[Play](game:)                   <- link to the game
```

Headings `##` / `###` get anchors and the right-hand table of contents. Every page is added to the search index (`assets/search-index.json`).

### Generated blocks (cannot drift from the game)

`{{gen:shortcuts}}` (from `KEY_BINDINGS` in `src/ui/shortcuts.ts`), `levels`, `unlocks` (`config/progression.ts`, `config/unlocks.ts`), `lifts`, `campaigns`, `scenarios` (`config/scenarios`), `achievements`, `cosmetics`, `festivals` (`config/festivals.ts`), `staffUpgrades` (`config/staffUpgrades.ts`). The shortcut table includes every key (e.g. `I` for Statistics) because it reads `KEY_BINDINGS`. `tests/site/generated.test.ts` fails when a key binding, level, unlock, scenario or trophy is not in the output. After changing game rules, re-read the prose pages that mention numbers (time model, difficulty, goals); the tables update themselves.

## Screenshots

`site/shots.json`: `{ id, alt, caption, pages, kind: "harness" | "copy", shot: {...} }`. For `harness` entries `shot` is the options object of `scripts/lib/harness.ts` `shot()` (same names as the `npm run shot` flags in `docs/visual-qa.md`: `size seed start hour zoom target ticks pre evalJs steps viewport bare view guest vticks freeze photo* walk* touch local`; `touch: true` + `viewport` for phone / tablet shots, `local` = localStorage entries set before boot, e.g. the colour palette; `null` values are dropped). `copy` entries copy an existing image.

```bash
npm run site:shots                       # everything (about 15 min; own Vite server + Chrome, sequential)
npm run site:shots -- --only hero-winter,ui-hud
npm run site:shots -- --missing          # only ids without an optimised file yet
npm run site:shots -- --optimize-only    # re-encode site/shots-raw/*.png
npm run site:shots -- --list
```

Output: raw PNG in `site/shots-raw/<id>.png`, then WebP at 640 and 1280 px (`site/assets/shots/<id>-640.webp`, `-1280.webp`, quality lowered until the 1280 file is below 250 kB) and `index.json` (dimensions for `width`/`height`). `sharp` does the encoding; if it cannot be installed the script falls back to headless-Chrome WebP encoding. On GitHub: Actions → **Regenerate site screenshots** (manual; uploads the WebP files as an artifact).

Notes: the harness needs Chrome / Chromium (macOS paths, `/usr/bin/google-chrome*`, or `CHROME_PATH`). Landing / season shots hide the UI with an `evalJs` snippet; UI shots keep it. Because the game's look changes over time, re-run `npm run site:shots` after a graphics pass.

## Checks

- `npm test`: `tests/site/*` (markdown pipeline, generated tables, landing + every guide page render, crawler, manifest) and `tests/repo/workflows.test.ts`.
- `npm run site:check`: links / anchors / images / alt / `width`+`height` / heading order / one `<h1>` / no external URLs (except GitHub and the Ski Resort Tycoon Wikipedia link; the analytics hosts may only appear inside `assets/consent.js`) / SEO lint on every page (title < 60, description 120-155, unique, canonical, Open Graph + Twitter, JSON-LD parses, favicon links, consent script and footer link, og images 1200x630) / sitemap lists every page + `/play/` / robots.txt / no root-absolute URLs / no service worker on the website / size budgets (each 1280 px shot <= 250 kB, all shots <= 8 MB, site CSS+JS <= 150 kB).
- `npm run verify:site`: serves `dist-site` like GitHub Pages under `/` and `/slopetycoon/`, crawls it over HTTP, checks the game's manifest (`start_url ./`), the service worker at `/play/sw.js`, the 404 page, and runs `verify:pwa --dist dist-site/play`.

## Configuration (environment)

| variable | effect |
|---|---|
| `SITE_REPO` | `owner/repo` for the footer links (default `maartenba/SlopeTycoon`) |
| `SITE_URL` | absolute site root (default `https://slopetycoon.com/`) for canonical, og:image, sitemap. Defaults to the canonical domain when unset |
| `SITE_CNAME` | writes `dist-site/CNAME` for a custom domain |

The game shows **Website & guide** (About dialog) and **Player guide** (Help) links only when served under `/play/` (`src/ui/siteLink.ts`).

## Limitations

- Screenshots are software-rendered (SwiftShader) and show whatever the game looked like when they were shot.
- The website has no service worker (only `/play/` is installable); the website itself is not available offline.
- The og:image is composed with sharp using fallback system fonts.

## Analytics and SEO

**Analytics (opt-in, consent first).** `site/assets/consent.js` is on every page. Nothing is loaded or sent until the visitor clicks **Allow** on the consent bar (stored in `localStorage['slope.consent.analytics']` = `granted` | `denied`; the game in `/play/` uses the same key on the same origin). Only then it injects `https://www.googletagmanager.com/gtag/js?id=G-NX37ERE0S9` with Consent Mode v2 (default denied, update to granted), `send_page_view` after consent, `allow_google_signals: false`, `allow_ad_personalization_signals: false`. It never runs on localhost / private hosts / webdriver / HeadlessChrome, so tests and agents do not pollute the data. The footer link **Privacy & analytics settings** reopens the bar; denying removes the `_ga*` cookies and sets `ga-disable-<id>`. Without JavaScript nothing is tracked. The pure logic is unit-tested (`tests/site/consent.test.ts`). The text lives in `site/pages/privacy.md`; change it together with the code.

**SEO.** `scripts/site/templates.ts` writes unique titles (< 60 chars) and descriptions (120-155; guide pages use the optional front matter `description`, else `summary`), canonical URLs from `SITE_URL`, Open Graph / Twitter cards, `robots`, favicons (`favicon.ico` built with sharp from `public/icons`, `icon.svg`, apple-touch-icon, `site.webmanifest`), a preloaded font, and JSON-LD (`VideoGame` + `WebApplication` + `WebSite` on the landing page, `BreadcrumbList` on every other page, `AboutPage` with the author `Person`). Social cards are 1200x630 PNGs per major page (landing, guide, privacy, about) in `site/assets/og/`: after changing screenshots or card text run `npm run site:og` (headless Chrome renders the real fonts, sharp optimises) and commit them (`scripts/site/ogCards.ts` holds the design). `sitemap.xml` lists the landing page, `/guide/` and every guide page, `/about/`, `/privacy/` and the game `/play/` with `lastmod` from git; `robots.txt` allows everything and names the sitemap. The root `index.html` (the game's head) carries its own title, description, canonical and social tags for `/play/`. `404.html` is a real 404 with links.

## Checklist after ANY site / guide / feeding-screenshot change
1. `npm run site:shots -- --only <ids>` (look at the result)
2. `npm run site:og` (cards are committed PNGs; `site:check` fails if `site/assets/og/manifest.json` is stale)
3. `npm run docs:img`
4. `npm run build:site && npm run site:check && npm run verify:site`
