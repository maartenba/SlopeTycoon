# Fonts

Two self-hosted families, both under the **SIL Open Font License 1.1** (`public/fonts/OFL.txt`, credited in README and the About dialog). There are **no runtime requests to Google**: the files live in `public/fonts/`, are copied into `dist/fonts/`, enumerated by `vite-plugins/precache.ts` and served cache-first by the service worker, so the game looks identical offline. `npm run verify:pwa` fails if a font file is missing from the precache list or if `index.html` references `fonts.googleapis.com`.

| Role | Family | Why |
|---|---|---|
| UI (`--font-ui`) | **Nunito** (variable, wght 400–800) | A rounded, friendly sans: cosy and approachable without being childish, still very legible at the 11–13 px sizes the HUD uses. Large x-height, open counters, and clear tabular numerals (`font-variant-numeric: tabular-nums` on `.num` / `.money`, number inputs, HUD money and time) so columns of money do not jitter. One variable file covers 400–800 so buttons (700) and headings (800) cost no extra download. |
| Display (`--font-display`) | **Lilita One** (400) | A chunky, playful display face with a "ski-lodge sign" feel: used only for the logo wordmark, dialog titles, section headings and the boot splash (never for body text or numerals). |

Subsets: `latin` + `latin-ext` woff2 exactly as served by the Google Fonts CSS2 API (`Nunito:wght@400..800`, `Lilita+One`), `font-display: swap`, with the official `unicode-range` so the latin-ext file is only fetched when a character needs it. Cyrillic / Vietnamese are not bundled (the game text is English).

Files: `nunito-latin.woff2` (39 kB), `nunito-latin-ext.woff2` (35 kB), `lilita-one-latin.woff2` (11 kB), `lilita-one-latin-ext.woff2` (1.4 kB).

## How it is wired

* `src/ui/fonts.css` holds the `@font-face` rules and is imported by `src/main.ts`. They must be defined in the **document**: shadow roots inherit `font-family` from their host and use the document's faces, but `@font-face` inside a shadow root would not register.
* `src/ui/tokens.ts` exports `FONTS` and emits `--font-ui` / `--font-display` on every `:host` (`BASE_CSS` in `StElement.ts`); `src/ui/styles.css` defines the same two custom properties on `:root`. Components never hard-code a family (`tests/ui/noNativeSelect.test.ts` fails on `system-ui` in a component).
* `index.html` preloads the two latin files (`<link rel="preload" as="font" type="font/woff2" crossorigin>`) so the splash and the first menu paint use them.
* Emoji (menu / dialog icons) fall back to the system colour emoji fonts at the end of the stack.
* Canvas text: the building sign textures (`src/render/textures/sign.ts`) use `800 <size>px 'Nunito', sans-serif`. They are generated once at boot; because the font is preloaded it is normally ready, but if it has not finished loading the sign falls back to `sans-serif` (cosmetic only). The debug gallery labels keep `sans-serif`.
* Verify in the harness: `document.fonts.check('16px Nunito')` and `'16px "Lilita One"'` (printed by `npm run ui2:suite` for every shot).

## Updating / re-downloading

```
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
curl -s -A "$UA" 'https://fonts.googleapis.com/css2?family=Nunito:wght@400..800&family=Lilita+One&display=swap'
```
Download the `latin` and `latin-ext` `src:` URLs into `public/fonts/` and keep `fonts.css` in sync.
