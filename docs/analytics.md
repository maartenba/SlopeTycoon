# Analytics (opt-in, anonymous)

Owner decision (supersedes the earlier "no trackers / no external requests" rule): the game and the website may use **Google Analytics 4** (`G-NX37ERE0S9`), **consent first**, and it must **never hamper offline play**. Website side: `site/assets/consent.js`, `site/pages/privacy.md`. Game side: `src/analytics/`.

## Consent contract (shared with the website)
`localStorage['slope.consent.analytics']` = `'granted'` | `'denied'` | absent (same origin on GitHub Pages, so one choice covers the site and `/play/`). **Nothing is loaded, queued or sent until it is `'granted'`.**
- First run (absent): a small, non-blocking card on the **title screen** only ("Allow anonymous stats" / "No thanks" + privacy link). It sits in the menu column (above the menu on phones), never over gameplay; it is not shown in the in-game menu once a choice exists, nor in a running game.
- **Settings > Privacy**: toggle "Share anonymous usage statistics" (off until granted), plain explanation, link to the site's privacy page (`../privacy/`, hidden when the game is not served under `/play/`). Granting loads analytics at once (no reload); revoking sets `ga-disable-G-NX37ERE0S9`, sends Consent Mode `analytics_storage: denied` and deletes the `_ga*` cookies.
- The About dialog and Help (Install & offline) say "anonymous, opt-in statistics".

## Module (`src/analytics/`)
| File | Role |
|---|---|
| `consent.ts` | pure: key, `readConsent` / `writeConsent`, `analyticsAllowed()` environment gate |
| `events.ts` | typed event names + parameter whitelist + `sanitizeEvent`; per-event caps |
| `Analytics.ts` | the only code that talks to Google: lazy script injection, gtag stub queue, Consent Mode v2, rate limit |
| `gameplay.ts` | observer-only bus subscriber, once-per-session helper, engaged heartbeat, `app_start` params |
| `ui.ts`, `index.ts` | consent / Settings adapters, the page singleton (`analytics()`) |

`tests/repo/analytics.test.ts`: no file outside `src/analytics` may name a Google host, `gtag` or `dataLayer`; the module uses no `fetch` / XHR / `sendBeacon` / `Image`; the only URL is `https://www.googletagmanager.com/gtag/js?id=G-NX37ERE0S9`; `sw/core.ts` ignores cross-origin and `dist/sw.js` names no analytics host; no CSP. Hosts that gtag itself may contact: `googletagmanager.com`, `google-analytics.com`, `analytics.google.com`.

## When it can run (environment gate)
Only a **production build on a non-local host**, with consent granted. Never: dev (`import.meta.env.DEV`), tests, `localhost` / `127.*` / `[::1]` / `*.local`, `?analytics=0`, headless / automated browsers (`HeadlessChrome`, Puppeteer, Playwright, PhantomJS user agents), so agents, harness runs and tests never pollute the owner's data. The title-screen demo never emits gameplay events (they come from the game page only). The consent card / toggle still work everywhere (the choice is stored) but nothing is sent when the gate is closed.

## What is tracked (all of it; anything else is dropped by the whitelist)
| Event | Parameters | When |
|---|---|---|
| `app_start` | version, page (menu/game), display (standalone/browser), touch (yes/no), viewport (phone/tablet/desktop) | page load (or right after the first "Allow") |
| `game_start` | mode (career/sandbox), size, scenario id or `none`, difficulty, season, tutorial yes/no | new game |
| `game_load` | mode, size | a save was loaded |
| `level_up` | level | career level reached |
| `goal_done` | goal id | goal completed |
| `scenario_result` | scenario id, won/lost, medal | scenario finished |
| `year_end` | year, stars (whole), profit bucket (loss/small/medium/large) | Resort of the Year report |
| `achievement` | achievement id | unlocked |
| `festival_booked` / `staff_upgrade` | festival id / upgrade id | booked / training started |
| `view_mode_used` | ride / walk / photo | first use per session |
| `feature_first_use` | stats (more may be added to the enum) | first use per session |
| `error` | kind: error / unhandledrejection (**class only**, no message, no stack) | max 5 per session |
| `engaged` | minutes (5, 10, ...) | every 5 engaged minutes while the tab is visible |

Never sent: save contents, resort / guest names, seeds, coordinates, exact money, anything typed, IPs are not stored by GA4. Parameter values are enums, bounded numbers or short id-like strings (`[a-z0-9_.:-]`, max 40); free text cannot pass the sanitiser. GA config: `send_page_view: false`, `allow_google_signals: false`, `allow_ad_personalization_signals: false`, `transport_type: 'beacon'`; Consent Mode v2 default all `denied`, then `analytics_storage: granted` only after consent. GA4 sets its own first-party cookies (`_ga`, `_ga_NX37ERE0S9`) once granted. In GA4 set data retention to the shortest you want.

Caps: 200 events per session, 30 per minute, per-event caps (`EVENT_CAPS`).

## Offline guarantee
1. The service worker handles same-origin requests only (`shouldCache`); Google requests are never precached, intercepted or cached.
2. The script is injected lazily by `Analytics.load()`: never awaited, never blocking boot, wrapped in try/catch (a throwing `appendChild`, CSP, ad-blocker or `onerror` is silent; no `fetch` rejections exist).
3. `navigator.onLine === false`: no script injected and every event dropped (no persistent queue, nothing replayed later). The script loads when `online` fires, only with consent and the gate open.
4. Failure: at most 2 load attempts per page (the retry only on an `online` event), so no retry storm.
5. Events before the script loads sit in the `dataLayer` stub queue (bounded by the caps) and are flushed by gtag.js once it arrives.
6. Observer only: the subscriber reads typed bus events, never writes sim state, never uses the sim Rng; `stateHash` is identical with and without it (`tests/analytics/gameplay.test.ts`).

## Verification
- `npm test`: `tests/analytics/*` (consent, whitelist, load/offline/no-consent/rate-limit, determinism), `tests/ui-dom/consent.test.ts` (card + Settings toggle, constructor rules), `tests/repo/analytics.test.ts`.
- `npm run build && npm run analytics:e2e`: real Chrome, https on the fake host `slope.test` (throw-away self-signed cert; `openssl` needed), Google hosts intercepted (stub script, never contacted). Asserts: no consent / denied / headless UA / `?analytics=0` => 0 Google requests; Allow => the gtag script is requested and `consent default` + `config` + `app_start` are queued; granted game page => exactly one script request, `game_start` queued, no seed / name / money in any event; Google blocked => the game boots, the simulation advances, no page error (the browser's own `ERR_BLOCKED_BY_CLIENT` console line is not suppressible); service worker active + origin shut down + `navigator.onLine === false` => the game boots from the cache with no Google request and no error.
- Screens: `npm run shot -- --bare 1 --out an-...` (consent card on the title screen; Settings > Privacy).

## Changing it
Add an event: extend `EVENT_SPECS` (and this table), emit through `analytics().track(...)` or the gameplay subscriber, add a sanitiser test. Never add free-text or identifying parameters. Update `site/pages/privacy.md` if what is collected changes.
