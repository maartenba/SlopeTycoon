# Slope Tycoon website and player guide

One repo, one GitHub Pages deployment: **`/` = website, `/guide/` = player guide, `/play/` = the game (PWA)**. No framework, no external requests, no trackers.

```
site/index.html          landing page template ({{placeholders}} are filled by scripts/site/build.ts)
site/assets/             site.css, site.js, shots/ (optimised WebP + index.json, committed)
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

`{{gen:shortcuts}}` (from `KEY_BINDINGS` in `src/ui/shortcuts.ts`), `levels`, `unlocks` (`config/progression.ts`, `config/unlocks.ts`), `lifts`, `campaigns`, `scenarios` (`config/scenarios`), `achievements`, `cosmetics`. `tests/site/generated.test.ts` fails when a key binding, level, unlock, scenario or trophy is not in the output. After changing game rules, re-read the prose pages that mention numbers (time model, difficulty, goals); the tables update themselves.

## Screenshots

`site/shots.json`: `{ id, alt, caption, pages, kind: "harness" | "copy", shot: {...} }`. For `harness` entries `shot` is the options object of `scripts/lib/harness.ts` `shot()` (same names as the `npm run shot` flags in `docs/visual-qa.md`: `size seed start hour zoom target ticks pre evalJs steps viewport bare view guest vticks freeze photo* walk*`; `null` values are dropped). `copy` entries copy an existing image.

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
- `npm run site:check`: links / anchors / images / alt / `width`+`height` / heading order / one `<h1>` / no external URLs (except GitHub) / no root-absolute URLs / no service worker on the website / size budgets (each 1280 px shot <= 250 kB, all shots <= 8 MB, site CSS+JS <= 150 kB).
- `npm run verify:site`: serves `dist-site` like GitHub Pages under `/` and `/slopetycoon/`, crawls it over HTTP, checks the game's manifest (`start_url ./`), the service worker at `/play/sw.js`, the 404 page, and runs `verify:pwa --dist dist-site/play`.

## Configuration (environment)

| variable | effect |
|---|---|
| `SITE_REPO` | `owner/repo` for the footer links (default `maartenba/SlopeTycoon`) |
| `SITE_URL` | absolute site root (default `https://maartenba.github.io/SlopeTycoon/`) for canonical, og:image, sitemap. Derived from `SITE_REPO` when unset |
| `SITE_CNAME` | writes `dist-site/CNAME` for a custom domain |

The game shows **Website & guide** (About dialog) and **Player guide** (Help) links only when served under `/play/` (`src/ui/siteLink.ts`).

## Limitations

- Screenshots are software-rendered (SwiftShader) and show whatever the game looked like when they were shot.
- The website has no service worker (only `/play/` is installable); the website itself is not available offline.
- The og:image is composed with sharp using fallback system fonts.
