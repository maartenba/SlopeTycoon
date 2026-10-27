# Changelog

All notable changes to Slope Tycoon. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning: [SemVer](https://semver.org/).

## [Unreleased]

- **Planned lift maintenance**: every lift now has an annual service. By default (Operations > Maintenance: Auto) winter lifts are serviced in April and summer-only lifts in October, or in a month you pick per lift; a service closes the lift for 2-3 days (basic) or 5-7 days (thorough, when its inspection level is thorough) but only once it is empty, is announced in the news the day before, bills 'maintenance' (cheaper with a Lift Workshop, shorter and cheaper with crew morale and the Lift mechanics course), restores condition, partly resets age and lowers the breakdown risk until the next one. Skipping it (Manual policy or a missed window) makes the lift 'service overdue' and raises its breakdown risk, escalating (x2.1 after 90 days); Ranger Rudi warns before winter. Inspector: last / next service, window, Service now, cost and risk text. Old saves load as Auto with the service clock starting at load. See `docs/lift-ops-and-debt.md`.
- **Hungry hikers**: measured first (`npm run analysis:hunger`): ordinary resorts were already mostly fine, but stressed guests left starving 6-8 % of the time and only 0-10 % of trips had a food stop. Now hikers eat before a trip when hungry (above 0.45), walk slightly more slowly into hunger, count huts / cafes / terraces / the farm shop within 8 tiles of any point of the route as food stops (lunch on the way, not only at the goal), 40 % bring a free packed lunch, and the trip planner shortens or refuses a trip that would end starving. New Ranger Rudi tip 'Hikers are going hungry' (add a hut or cafe near the trails). Results and tables in `docs/hiking.md`.
- **Almabtrieb is now easy to see**: it only runs with an Alpine Farm, and used to start silently. Now it is announced 3 days ahead (news + Ranger Rudi 'Almabtrieb in N days', 'Show me' goes to the base station), starts with a news item on 1 October, is listed in the Events panel with its date, gives a small x1.06 arrival bonus and dresses the road by the base station for its 11 days. Without a farm Rudi suggests building one. Debug: `__slope.events.start('almabtrieb')`. See `docs/festivals.md`.
- **Snowmaking switch**: every snow cannon can be turned off in its inspector, and Operations has a Snowmaking row with a global mode (On = as before, Off, Auto = pause while the snowline is above your pistes or the daily high is above +4 °C, resume when it cools) plus Turn all cannons off / on. Switched-off cannons are mothballed: no energy, no water, 15 % upkeep. Clear status lines ("Paused: snowline above this piste (1,420 m)", "Off by you", "Auto: waiting for cold") and two Ranger Rudi tips. Existing games and saves behave exactly as before (default On). See `docs/ops.md`.
- **Real calendar**: months and seasons now follow the northern hemisphere: winter Dec-Mar, spring Apr-May, summer Jun-Sep, autumn Oct-Nov (new games start 1 December). A persistent date chip in the HUD ("Sat 14 Feb · Winter · Year 1", tooltip with day of year and time), real dates in the speed panel, news, month cards, year report and save list, and the Events calendar gains today's date, countdowns, start windows and a January-December strip. Festivals moved to their real months (Christmas Market Dec, Carnival Feb, World Cup Jan-Feb, Music Festival Jun-Aug, Almabtrieb early Oct, New Year on 31 Dec). Saves are unaffected by the labels.
- **Climate follows the calendar**: the longest day is now 21 June and the shortest 21 December (was 1 Aug / 1 Feb), the coldest point of the year mid-January and the warmest mid-July, late March is spring skiing (slush in the afternoons, low pistes melt out in early April, snow stays high until June), the first snow falls on the peaks in October and reaches the valley in late November. New games start with shorter December days (lifts open 08:29). Also fixed: a game saved mid-day no longer loses that day's unbilled snowmaking energy, and animals no longer flee from stale guest positions right after a load. Re-baselined tests and balance; tables in `docs/time-flow.md` §10 and `docs/balance.md`. The speed panel's date line has a tooltip (full date and day of year) and the night-warp badge on the moon button is clearer.
- **Train Station can stand on the end of a rail line** (the rail stays under the platform; ghost tip: "Place the station on the end of a rail line, with a footpath next to it"). **Shops, chalets and apartments** now accept a footpath as well as a road; café and stunt park also accept a piste edge. **Speed panel** no longer wraps at night: the fast-night marker is a small badge on the moon button.
- **Loading indicator on the splash**: a slim progress bar with stage text ("Loading the mountain…", "Carving the terrain…", "Planting trees…", "Warming up the lifts…") driven by real boot stages (`src/ui/bootProgress.ts`, pure DOM, inline CSS in `index.html`, no layout shift, works offline). Indeterminate fallback, a slow-load hint after 8 s, an error state with a Reload button if boot throws, reduced-motion respected, `role=progressbar` + polite live text, smooth fade-out. New Game / Continue reuse it (they reload into the same boot). Dev: `?bootdelay=ms`, `?bootfail=1`, `npm run boot:shots`.

## [0.2.1] - 2026-10-27 (pre-release)

Changes since 0.2.0. Still a pre-release; not 1.0.

### Audio: rewritten music and calmer ambience
- **Nine procedural tracks** (Morning Snow, Alpine Noon, Après, Starlight, Summer Meadow, Autumn Gold, Blizzard, Title Theme, Festival) with harmonic instruments (pad, harp, guitar, electric piano, flute, strings; the bell sounds are gone), scale-correct voice leading and a pentatonic lead. Tracks are chosen to fit season, time of day, weather and busyness, never repeat back to back, and crossfade.
- **Settings**: a *Music style* selector (Auto, each track, Off) and a *Next track* button with a "Now playing" line (the music keeps playing for 25 s while the paused Settings dialog is open so you can preview it).
- **Calmer ambience**: noise beds only (no whistling oscillator tones), slow drifting modulation, quieter birds and crickets, and a lower default ambience volume (**0.28**, was 0.45).
- Verified offline: a software Web Audio renderer measures every track and layer (peak, DC, clicks, loudness, spectrum) and is cross-checked against Chrome's `OfflineAudioContext` (`npm run audio:render`, `npm run audio:crosscheck`). See `docs/audio.md`.

### Lifts: towers are no longer crazy tall
- Hard tower-height caps (head above its foot, 1 unit = 10 m): T-bar 35 m, chairs 50 m, gondolas 60 m, cable car 100 m (were 40 / 60 / 70 / 120), and a tower may not be taller than its longer adjacent span. The solver now prefers **more, shorter towers** (denser spacing, soft heights 22 / 30 / 38 / 70 m) over a few tall ones. Refusals read "Towers would need to be N m tall ...: shorten the span, clear the forest lane or pick another route". Tall towers get thicker poles and masts. Existing lifts are untouched. See `docs/lifts-clearance.md`.

### Game: anonymous, opt-in analytics
- **Google Analytics in the game** (`G-NX37ERE0S9`, `src/analytics/`), consent first: nothing is loaded or sent until `localStorage['slope.consent.analytics'] === 'granted'` (same key as the website). A small non-blocking card on the title screen ("Allow anonymous stats" / "No thanks") and **Settings > Privacy** (toggle, off until granted, link to the privacy page). About dialog updated.
- Whitelisted, typed events only (no free text, names, seeds, saves, coordinates): `app_start`, `game_start` / `game_load`, `level_up`, `goal_done`, `scenario_result`, `year_end`, `achievement`, `festival_booked`, `staff_upgrade`, `view_mode_used`, `feature_first_use`, `error` (class only), `engaged` (every 5 visible minutes). Rate limited, capped per session. One observer-only bus subscriber: `stateHash` unchanged (tested).
- **Never hampers offline play**: the script is injected lazily and never awaited; offline = nothing injected and events dropped (no queue, no retries storm); the service worker never touches Google hosts. Never active in dev, on localhost, in headless browsers, or with `?analytics=0`. New `npm run analytics:e2e` (offline / blocked / consent matrix with intercepted Google hosts). See `docs/analytics.md`.

### Website: analytics, SEO, story
- **Consent-first analytics** on the website and guide (Google Analytics `G-NX37ERE0S9`, Consent Mode v2): a small accessible consent bar ("Allow anonymous statistics?"), footer link *Privacy & analytics settings*, shared `localStorage['slope.consent.analytics']` with the game, nothing loaded until "Allow", never on localhost / headless, works without JavaScript. New **/privacy/** page. The "no tracking" claims everywhere now read: no ads, no accounts, saves stay on your device, anonymous opt-in statistics.
- **SEO**: unique titles (< 60) and descriptions (120-155), canonical URLs, Open Graph + Twitter cards with a 1200x630 card per major page (`npm run site:og`), JSON-LD (VideoGame / WebApplication, WebSite, BreadcrumbList, AboutPage), favicon set + `site.webmanifest`, breadcrumbs, related-page links, footer sitemap, `sitemap.xml` (with `/play/` and lastmod) and `robots.txt`, a real 404 page, SEO tags on the game's own `index.html`. `site:check` lints all of it.
- **About**: "Why I built this" section on the landing page and a full **/about/** page.

## [0.2.0] - 2026-10-26 (pre-release)

Second pre-release (still not a 1.0). Adds Phase 5 (goals, ride-along, photo & walk modes, progression, scenarios, achievements, staff, festivals, stories, rivals, build depth), touch support, colour-blind palette, Statistics, named regions, the Landscape drawer and redesigned Terrain / View drawers.

### Release prep (0.2.0)
- Version bumped to **0.2.0** (package, lockfile, About label, service-worker cache version, README, docs, site). Still a pre-release; not 1.0.
- **Website and guide updated**: new guide page *Touch & tablets*, a Statistics section in *Money*, the redesigned Terrain drawer in *Building* (and the Landscape intro: trees only there; build in any season), the View drawer in *The interface*, region names in *Getting started*, the colour-blind palette and Touch setting in *Settings*, a text-field note in *Shortcuts*; landing page gets touch, colour-blind and statistics cards, facts and an updated FAQ. 7 new screenshots (`ui-terrain-drawer`, `ui-view-drawer`, `ui-stats`, `touch-phone-hud`, `touch-phone-place`, `touch-tablet`, `cbsafe-pistes`) and a re-shoot of every picture. Harness: `local` option (localStorage before boot).
- Docs: `progression.md`, `depth.md`, `ui-kit.md`, `visual-qa.md`, `release.md`, README and AGENTS.md brought up to date.

### Drawers
- **Terrain and View drawers redesigned** like Buildings / Pistes / Landscape: card rail with procedural SVG icons, key badges, cost hints, hover info cards, selected states, grouped sections (Sculpt; Camera / Modes / Overlays / Season) and a side control column (target, brush, slope, live ghost cost + tiles). The View drawer gains rotate, zoom and ride-along cards. All hotkeys unchanged.

### Touch and accessibility
- **Touch support** for tablets and phones (`docs/touch.md`): one-finger pan, pinch zoom, two-finger twist rotate, tap to select or aim, a two-step building placement (ghost first, then tap again or press Place), long press to cancel, a pan / paint toggle for drag tools, a two-finger tap for undo, on-screen controls (and a joystick) for walk, ride-along and photo mode, 44 px targets, a compact layout for narrow and short screens, safe-area insets and no page zoom / scroll / pull-to-refresh. Settings > Accessibility > Touch controls: Auto / On / Off (Auto follows `(pointer: coarse)`). Desktop behaviour is unchanged.
- **Touch verified end to end** (`npm run touch:e2e`, `docs/touch.md`): real emulated touch on phone, phone landscape and tablet (585 checks) found and fixed: a walk joystick that never worked (`touch-action`), a Pause button that hopped, lost taps on a busy frame, a vanishing Select hover info, a twist that lost its first degrees, one-tap lift stations (now two-step), no photo pan, hotkeys firing while typing in a text field, a Pistes drawer without a usable card rail, drawers covering the whole landscape map (tuck away + options button), and many targets under 44 px. Holding a finger on a button shows its tooltip.
- **Colour-blind-safe palette** (Settings > Accessibility > Colour palette): Okabe-Ito based piste difficulty, overlay and status colours; reduced motion now also stills the animations inside the UI panels.

### Statistics
- **Statistics dialog** (`I`, top bar chart button, pause menu; `docs/stats.md`): charts of guests, cash, rating with the sustainability facet and revenue by category over 30 days, a year, two years or all time (older days are kept as monthly summaries). Colour-blind-safe palette, keyboard / hover readout and a numbers table. The history is observer-only and adds well under 50 KB to a save after five years.

### Named mountains
- **Region and peak names**: every seed now has a region name (e.g. "Ember Range") and peak names, shown in New Game (with a map thumbnail), the HUD card tooltip, the title caption and the year report. Flavour only; deterministic and independent of the simulation.

### Landscape drawer and bug round
- **Build in any season**: every building, lift, path, road, piste, trail and landscape item can be placed in any season (it always could in the rules; the season badges, dimming and "not usable until" wording read like a lock and are now plain hints). Releasing a piste stroke over the slope-profile card now still ends the stroke. The Landscape drawer now uses the same cards, hover cards, key badges and select controls as the other drawers.
- **Landscape drawer** (`docs/landscaping.md`): dig and fill ponds (unlock at resort level 2), boulders and trees, and garden decor (bench, lamp, flower bed, hedge, fence, wall, fountain). Undoable, saved, ponds freeze in winter.
- **Trees live in one place**: planting and clearing trees (species, density, brush) are only in Landscape > Nature; the Terrain drawer is terraforming only. Keys 1/2, G and [ ] work as before while a tree tool is active.
- **Decor polish**: the bench is now a real slatted park bench (backrest, armrests, iron frames) and the lamp post a proper park lamp (plinth, tapered pole, glowing lantern); the Landscape drawer no longer repeats the Terrain drawer's tools (terraforming lives in **Terrain** only).
- **Fixes**: *Show me* on the level-up card and goals always lands on the right drawer card with a highlight; hiking and biking trails can be painted in winter; the starter resort no longer has a decorative parking pad (a real Parking building instead); dock crash, roof snow and coplanar flicker fixes.
- **Website and guide**: Landscape section in *Building*, new screenshots (`ui-landscape`, `landscape-pond`), re-shot Almabtrieb and Staff pictures, regenerated unlock tables.

### M5.4: depth (staff, festivals, stories, rivals, build tools)
- **Staff** (`docs/staff.md`): a compact **Staff** tab in the Operations drawer with four crews (instructors, patrol, groomers, lift operators), wage level and morale; Auto by default, which keeps the simulation bit-identical to before. Six one-off **training courses** (instructors, patrol, snowcats, lift mechanics, rangers, hospitality), one at a time, each with a cost, training days and a small upkeep.
- **Events and festivals** (`docs/festivals.md`): an Events calendar in the Marketing drawer. Book a Christmas Market, Winter Carnival, Summer Music Festival or World Cup race; the Almabtrieb, New Year, critic visits (announced three days ahead) and powder days happen by themselves. Every running festival **visibly dresses the village** (bunting, flags, banners with the festival name, market stalls, a procession of decorated cows / costumed revellers / racers, a grandstand and finish arch for the World Cup) in 3 draw calls; restrained fireworks on New Year's Eve and festival finales (off with Feedback intensity Off).
- **Story guests** (`docs/stories.md`): a few arrivals carry a name and one wish; the inspector shows it with **Pin** and **Follow**. Observer only: a good resort grants wishes (small tip, one news line), a miss leaves one mild review.
- **Rivals, market standing and sustainability** (`docs/rivals.md`, `docs/rating.md`): two or three neighbouring resorts, your standing in the rating panel (bounded effect on arrivals, never in scenarios or the tutorial), a **region** row in the year report, a **sustainability** rating facet (energy per guest, trees felled vs planted, habitat; 8 % of the score) and the **Green Resort** award.
- **Build depth** (`docs/build-depth.md`): one undo / redo stack for every build action (placements, lifts, path / road / rail / piste strokes, bulldozing, terraform and planting drags), a **slope profile** card (altitude, difficulty colours, snowline) while drawing pistes or lifts, and **Suggest a run** (a snow-safe line on the fall line; nothing is built).
- **Fix: black runs.** Stored piste difficulty is 0..3 but was read as 1..4 with a clamp, so Green and Blue read the same and Black read as Red; the *Open a black run* goal was unreachable. Goals now read per-difficulty tile counts: **Paint an easy run** (green or blue) and **Green, blue and red runs** (mixed).
- **Fix: festival dressing never appeared in a real game.** Roads and paths carry occupancy flags, which the dressing treated as buildings. Only buildings and lifts block it now (regression test added).
- **Scene richness**: soft piste ground, village plazas, gardens, hedges and walls, curved paths, district roofs, better cables; a new **Ranger Rudi** avatar; wildlife paw emote; clearer hut status ("needs a footpath, road or piste next to it").
- **Playtest feedback**: snowmaking cannon spray, the game pauses while Settings (and other dialogs) are open, gentler summer (support loan), ten demo towns.
- **Website and guide**: new guide page *Events, guests' stories & the region*, a Staff section in *Operations & safety*, undo / redo and slope-profile text, generated festivals and staff-course tables (from `config/festivals.ts` / `config/staffUpgrades.ts`), landing section and facts, 11 new or re-shot screenshots (all screenshots re-shot).

### Website and player guide (one repo, one GitHub Pages deployment)
- **`site/`**: one-page landing (hero crossfade, features, unique-elements band, facts strip, keyboard-accessible screenshot gallery, FAQ), a **player guide** of 16 Markdown pages with callouts, TOC, prev/next and client-side search, all self-hosted (Nunito / Lilita One, no trackers, no external requests, ~12 kB CSS+JS).
- **Production layout**: website at `/`, the game (PWA, service worker scope + manifest) at `/play/`. `npm run build` is unchanged (standalone `dist/`); `npm run build:site` builds both into `dist-site/`. The dev URL (`vite dev` at `/`) is unchanged.
- **Generated tables that cannot drift**: keyboard shortcuts (from `KEY_BINDINGS`), levels, unlocks, lifts, campaigns, scenarios, trophies and cosmetics are rendered from the game's own config at build time (tests fail when a key is undocumented).
- **Regeneration pipeline**: `site/shots.json` manifest → `npm run site:shots` (QA harness, resumable with `--only` / `--missing`) → optimised WebP (640 / 1280 px) in `site/assets/shots/`. Manual workflow `site-shots.yml` regenerates them on ubuntu and uploads an artifact.
- **Checks**: `npm run site:check` (static crawler: links, anchors, images, alt, heading order, budgets), `npm run verify:site` (HTTP crawl under `/` and `/slopetycoon/`, game manifest/SW under `/play/`); `verify:pwa` takes `--dist` / `--no-404`. `pages.yml` deploys `dist-site`.
- Game: **Website & guide** link in About and **Player guide** link in Help (only when served under `/play/`).

### Less flicker when rotating / zooming
- **LOD hysteresis** (+-6 %) on every zoom threshold (trees, rocks, terrain far LOD, guest impostors): zooming near a threshold no longer toggles the level every frame (measured 23-115 flips in a 24-120 frame wobble -> 0).
- **Cross-fade between tree / rock levels** in the iso view: the new level is built first, then both fade per tree (stable per-instance hash, no screen noise) over 0.4 s: no more forest-wide flash, no holes.
- Terrain far-LOD swap on 256 maps is atomic (no holes, no double draw); cells just outside the view are built ahead, nearest the centre first; terrain shader noise (rock grain, flower dots, snow glints) fades before it gets sub-pixel.
- New `npm run flicker` measurement tool (oscillating pixels, pop events, LOD flips, heatmaps, contact sheets) and `docs/flicker.md`. Remaining: thin tree / fence geometry still shimmers a little (mesh pass later).

### Lifts: clearance over trees and buildings, seat off the cable axis
- **Cables no longer run through forests or roofs.** `validateLift` keeps the carrier bottom (`LiftParams.drop` measured from the meshes) 0.3 above the mature canopy of trees / shrubs, building roofs and other lifts' towers; towers get taller / denser to clear them. Trees the towers cannot clear are cut as a **forest lane** (default on, "Clear forest lane (L)" next to Auto-flatten; the preview says `Clears 34 trees under the line ($X)`, only trees within 1.8 tiles of the line, net of timber income). Off: `Cable would pass through trees: raise towers or clear a lane`. Roofs taller than 2.0 are never overflown (`Cable would hit Base Lodge`); a chalet or shop roof is fine. Terrain clearance now also covers both strands and the carrier's real drop (gondolas hung below the ground before). Docs: `docs/lifts-clearance.md`.
- **Plant tool** refuses trees whose mature crown would reach an existing lift cable.
- Lazily maintained tree obstacle map (dirty prop chunks) keeps validation ~1 ms; success rates are unchanged with lane clearing on (T-bar 91.3 %, chair 94.5 %, gondola 95.5 %, cable car 95.3 % in forest vs 91.7 / 95.0 / 95.9 / 95.5 before).
- **Ride-along / walk-mode lift boarding**: the rider's seat is now on the chair (outer half, per-guest seat) instead of on the cable axis, so towers pass beside you, not through your head (`docs/ride-along.md`).

### Demo towns (title screen + debug menu)
- **Ten demo town archetypes** (`src/game/demoTowns.ts`, `docs/demo-towns.md`): Alpine Village, Family Valley, Luxury Resort, Summer Hiking Hub, Lakeside Beach Town, Snow Fortress, Big Mountain (256: funicular, cable car + six more lifts), Cosy Hut Hamlet, Festival Town, Rescue Base. Built through the real placement / lift / piste APIs relative to the terrain (anchors + site scoring + seeded variation), valid on any map size / seed; vetted seeds in `src/config/townSeeds.ts` (`npm run analysis:towns`).
- **Title screen**: every start shows a random vetted town (never the previous one), season from the town, a camera that visits what the town is about (farm, beach, heli pad, altiport, festival bar...), a corner caption and **Shuffle** (Space / N). `?town=<id>&townseed=<n>` for QA. Large 256 town only on capable devices.
- **Debug menu**: town select (+ Random nice town), seed + dice, Build town (two-click), Reset map, checklist of what was built / failed; console `__slope.populateTown(id?, seed?)`.

### M5.3 playtest feedback: time and level pacing
- **Top speed 10×** (was 8×): buttons 1× / 3× / 10× = a game day of 150 / 50 / 15 s. With fast nights a 180-day year is about **33 min** at 10× (was 56 min at 8×), a 60-day winter about 11 min.
- **Skip to…** (fast-forward): the ⏭ button next to the speed buttons (and **K** for the next month) runs the simulation as fast as the machine allows: Next month, Next season, Next event. A pill shows progress and ETA; Esc, Space or any click cancels. It stops by itself on important news (critical incident, stranded guests, bankruptcy / debt warnings, level-up, goal chapter, scenario end, year report), never while a dialog is open, never in ride-along / walk / photo mode or the tutorial, and pauses while the tab is hidden. While it runs the view redraws at about 10 fps with point guests, no popups / particles, sound ducked, and month autosaves collapse into one. The simulation is unchanged: N ticks fast-forwarded give the identical state as N ticks at normal speed.
- **Level pacing about 30 % sooner**: on the bot L3 now arrives ~30 days in (mid first winter; was ~50) and L4 at the end of the first year / early year 2 (was late year 2); L5 / L6 scaled alike.
- Scenario deadlines show their real-time length at 1× / 3× / 10× (tooltips).

### M5.3: balance and playtest readiness (Task 18)
- **Career**: a small hill now grows into an alpine destination: resort levels 1-6, nine big items unlock on the way (the basics are never locked). On the balance bot the second level arrives in the first week, the third at the end of the first winter and the fourth in year 2. Old saves still load as Sandbox.
- **Scenarios**: six hand-made challenges with medals; the bot reaches bronze on all of them. **Resort of the Year** report at the end of every in-game year (about 33 minutes at 10x with fast nights); **40 achievements**, a trophy shelf and 13 cosmetic rewards.
- Checked: all suites green, observers cost well under a millisecond per game day, saves grow by about 24 KB. Playtest checklist: `docs/playtest-m53.md`.
- Small layout fixes: the Settings columns no longer touch the dialog edge, the main menu fits 1000x700 with the new Scenarios / Trophies buttons, the Buildings tab strip fades at its edge.

### M5.3: achievements, trophy shelf and cosmetic rewards (Task 16)
- **40 achievements** (`src/config/achievements.ts`, data-driven, 3 tiers: common / notable / rare; 4 hidden; scopes any / career / scenario) with pure event trackers (`src/sim/meta/Achievements.ts`): counters, thresholds, streaks, windows, distinct sets, year-report and scenario-medal trackers. Observer only: no RNG, never writes the sim, `stateHash` unchanged (the per-game `achievementsRun` save module is flagged `observer`). Sandbox games cannot earn career / scenario achievements and tag the rest `sandbox`.
- **Profile**: `ProfileStore` v2 holds unlock records, lifetime counters (guests across games, photos, walked metres...) and cosmetics; survives deleting save slots; **Reset profile** (Settings > Cosmetics, with confirmation) clears achievements, cosmetics and scenario medals, never saves.
- **Feedback**: one small iconed toast per unlock (max one per 10 s, held during the tutorial) with the quiet chime; confetti only for rare tier-3 unlocks and only when the feedback policy allows it.
- **Trophy shelf** (`st-trophies`, main menu / pause menu / Settings): summary, scenario medals, filters, cards with progress bars, `???` for hidden ones.
- **Cosmetics** (Settings > Cosmetics, live, defaults unchanged): 5 building palettes, 4 village bunting sets, 3 premium photo frames (Alpine badge, Film noir, Gold frame), 4 lift chair colours; each unlocked by one achievement. New icons: trophy, star, lift, cross, coin, paw, medal.
- Debug `__slope.achievements.unlock(id)`. `docs/achievements.md`.

### M5.3: scenarios, medals and the local profile (Task 15)
- **Six shipped scenarios** (`src/config/scenarios/*.json`): First Tracks, Family Valley, Powder Dreams, Summer Escape, Alpine Giant, Safe Slopes, each with a fixed scanned seed, a concept-fitting terrain preset, rules (snowfall, weather, guest mix, costs, loans, starting debt, bears, incident / avalanche bias), objectives with weights, a deadline in game days, bronze / silver / gold medals and a score (objective points + speed + margin). Picker: main menu **Scenarios** or the New Game **Scenarios** tab; starts via `?scenario=<id>`. No import / export / sharing (D8).
- **Engine**: `ScenarioDef` JSON schema with a strict validator (unknown keys, ranges, building / fact / lift references, deadlines), `ScenarioRunner` (daily, deterministic, events `scenario:objective` / `scenario:finished`), save module `scenario` (old saves have none), `st-scenario-card` (replaces the goals card; deadline countdown in the game calendar, objective bars, **Finish now**), win / lose dialog (auto-pause, medal, breakdown, previous best, *Continue playing (sandbox mode)* / Retry / Back to menu).
- **Profile** (`ProfileStore`, IndexedDB `slope-profile`, LocalStorage fallback): best medal / score / time and attempts per scenario; safe against corruption and quota; separate from the save slots; has an `achievements` namespace for Task 16.
- **Bot policies** per scenario (`src/game/botPolicies.ts`): the bot reaches bronze on all six (never gold). Seed scan + calibration scripts in `scripts/analysis/`. `docs/scenarios.md`.

### M5.3: game modes, resort levels, selective unlocks (Task 14)
- **Career (default) / Sandbox**: New Game "Game mode" radio (Career preselected), `?mode=career|sandbox`, stored in the save (`config.mode` + new `progression` module). **Old saves load as Sandbox** (everything unlocked).
- **Resort level L1-L6** from stars, lifetime guests, best day, profit months, goal chapters and 12-month profit (`src/config/progression.ts`, `src/sim/progression/Progression.ts`); evaluated daily and latched. Calibrated to the balance bot: L4 in year 2 on every map size.
- **9 gated items** (`src/config/unlocks.ts`): 6-seat chair + 6-person gondola (L2), funicular (L3), helipad + 10-person gondola + 8-seat bubble chair (L4), cable car + altiport + VIP campaign (L5). Everything else, the basics, safety and the tutorial chain stay always available. Validators (`validatePlacement`, `validateLift`, `Marketing`) return `Unlocks at level N: Name` and `placeBuilding` / `placeLift` refuse locked items (sim-side). The tutorial runs with `unlockAll`; the starter / demo resort builders bypass the gate; the bot has `respectUnlocks`.
- **UI**: gold "L4" lock badges + level reason in the Buildings / Lifts drawers, locked Marketing cards, a level chip + level panel in the Goals card (progress bar, missing criteria, next unlocks), HUD tooltip, a single confetti burst + news row + small "Level N" card with Show me per new item.
- Debug `__slope.progression.setLevel(n)`. `docs/progression.md`, `scripts/analysis/progressionCalibrate.ts`.

### M5.3: Resort of the Year report (Task 17)
- **Year-end report** (`st-year-report`): when an in-game year (180 days) ends a dialog shows the headline ("Resort of the Year: Silver"), cover photo, four stat tiles with year-over-year chips, nine award medals (bronze / silver / gold), three charts (profit per month, rating, guests per month) and highlights (best / toughest month, busiest day, best season, top earner, safety record, snowiest week, longest warm spell, wildlife, goals, level). It pauses the game while open and restores the previous speed on close (never during the tutorial, the title demo or after bankruptcy; it queues behind other dialogs). **Remind me later** / Esc keep it in **Finance > Reports** (past 10 reports with their covers). Settings > Gameplay > **Year-end report** switches the dialog off. The last month's card says "Year report ready".
- **Save image**: composes a 1200x675 PNG (cover, headline, stat tiles, medals) on a canvas and downloads it locally. No share button, link or code (D8; `tests/repo/noSharing.test.ts` covers the new files).
- **Cover**: a small framed shot of the current iso camera (sky painted, centre-cropped to 16:9, JPEG <= 30 kB) taken through the photo-mode export code; skipped without WebGL (a gradient cover is drawn).
- **StatsHistory** (`src/sim/meta/StatsHistory.ts`): daily ring buffer of the last 360 days (guests, family arrivals, peak guests, income / expenses by category, rating, happiness, incidents, runs, snow depth, skiable share, piste quality, weather, temperature, queue minutes, wildlife) with series / summary / monthly / year queries (shared with the statistics screen, Task 30). Read-only observer driven by `Economy.onDayClosed`; saved as `stats` v1.
- **Awards** (`src/config/yearAwards.ts`): data-driven, tiers from a ratio against regional baselines behind a `BaselineProvider` interface (rivals replace the static table in Task 23). `docs/year-report.md`.
- Save modules `stats`, `yearReports` (old saves load empty); event `year:report`; debug `__slope.stats.demoYear()`, `__slope.yearReport.show()`.

### Time flow: 150 s day, 1x / 3x / 8x, comfortable agent speeds, 15-day months (user feedback: "everything is too fast")
- **Pacing**: a game day lasts 150 s at 1x (was 24 s); speed buttons are now **1x / 3x / 8x** (day 150 / 50 / 19 s; 1.6 / 4.8 / 12.8 ticks/s, max tick rate 40 -> 13). Space pauses, `+` / `-` cycle the speeds. Fast nights stay x3.
- **Agent speeds** (per tick, see `docs/time-flow.md` section 8): walk 2.5 / 3.4 / 5.0 tiles per tick by map size (4 / 5.5 / 8 tiles/s on screen, was 90), hike 1.9, bike 3.1, ski 6.25 / flat 1.4, cars / buses / trains / planes 5 / 3.75 / 7.5 / 12.5, patrol sled 5 / walker 1.25, helicopter 9.4, snowcat 1.9 / 3.75, fauna / livestock / wildlife x6.25 (same on-screen speed as before). Skiers run at 8-12 tiles/s (was 100-130). Lifts, excursions and the sim logic are unchanged.
- **Calendar**: months are 15 days long (180-day year: spring 30, summer 60, autumn 30, winter 60 days), so a winter takes 150 min at 1x and **18.75 min at 8x**. Snowline / daylight curves are keyed by year fraction, melt per degree-day x2, tree growth, holidays, debt day limits and the season pass price (300) scale with it; loan / overdraft rates are halved per month so annual economics keep their proportions (bot balance: profit by year 2 on every map). `SAVE_FORMAT_VERSION` 2 with a calendar migration (old saves load with the same month / season).
- **Render**: guests are drawn along their real path between ticks (no more corner cutting over buildings / water: 0 vs 94-303 sampled crossings), gait phase is real-time based (no slow-down with the long day), tick-rate aware smoothing for sleds / snowcats / helicopters / rangers, guests become cheap impostor points at 8x in the iso view.
- **Ride-along slow motion** (setting still on by default) is target-speed based: the followed guest never looks faster than ~9 tiles/s, so it does nothing for skiers at 1x and slows the game at 3x / 8x.
- Tests: pacing / calendar / seasons-reachable / ride factor / gait / path interpolation / impostor tests (`tests/core/timeModel.test.ts`), on-screen speed budget per map size (`tests/sim/guests/ScreenSpeed.test.ts`), calendar save migration (`tests/persist/calendarMigration.test.ts`); old day-number tests moved to the 180-day year. Analysis harness: `npm run analysis:timeflow` with models `M0` (old) / `I` (implemented).

### Walk mode: start on a path, Street-View drop, no mouse capture, rough edges (user feedback)
- **Start position**: V / the dock's Walk button enter on the nearest footpath (roads count 6 tiles farther, rail never) to the iso view centre within 24 tiles, validated with the walker's own collision world (never in a trunk / solid tile); else in front of the Base Lodge door; else the nearest free tile to the village centre. Faces the nearest building (2-14 tiles away) or along the path. A path tile with a wall within 2 tiles costs +4 so you start with a view, not a wall (`walkStart.ts`, pure, deterministic; 20 seeds x 64 and 5 x 128 tested).
- **Choose start (Street View style)**: Shift+V or a click on the top-bar Walk button opens drop mode: a pegman figure follows the cursor, a ring draped on the terrain shows the tile (green = walkable, red = blocked with a dim snap ring on the nearest free tile), click to drop in, Enter = nearest path, Esc cancels. The Walk button can also be dragged onto the map and released to drop. **T** while walking = teleport: bird's-eye drop (Esc goes back to where you were). Inspector "Walk here" unchanged.
- **Mouse**: default is now **drag to look** (hold the left button; no pointer lock, the cursor stays free and is hidden only while dragging, screenshots / OS shortcuts work). Settings > Gameplay "Walk: mouse look: Drag (default) / Pointer lock" (`slope.walk.v1.mouseLook`); in lock mode Alt / Tab frees the mouse until the next click, Esc leaves walk mode, the HUD shows "Alt: free mouse".
- **Rough edges**: collision for lamp posts, benches, planters and hedge shrubs of the village decor (one `buildWalkWorld()`: Occupancy, water + bridges, trunks / rocks, decor); farm / pasture fences were already solid (inside the building footprint). Spawn / teleport push-outs no longer register as speed (no spike, no stray footstep). Guests and animals softly push you out of their personal space (0.4 tiles). Animals within 6 tiles shy away from the walker (display offset only: the sim never sees the walker, `stateHash` unchanged). Windows and lamp glass glow warm amber at dusk (near view). Forest wind shelter: the wind bed drops up to 30 % with >= 10 tree trunks within 6 tiles of the walker (audio probe `shelter`).
- Harness: `--walk-start default|choose:x,y`, `--walk-drop x,y` (drop marker shot). `docs/walk-mode.md`, `docs/playtest-m52.md`.

### M5.2: walk mode (Task 12, requested by the user)
- Walk mode (V, top-bar / View drawer button, **Walk here** in the building inspector): first-person on foot at 1.6 tiles/s (Shift = 3.2), mouse look with pointer lock (drag fallback), Space hops, terrain following on the true triangulated surface, 40 deg slope limit with a gentle slide, circle collision against buildings, lift stations / towers, lakes / streams (bridges are walkable), trees and rocks, map-edge clamp, substepped (no tunnelling). Esc / V restores the exact iso pose. Desktop only, render-only (`stateHash` unchanged, not saved). `docs/walk-mode.md`.
- E inspects the building / guest / animal in front (compact card) or boards a lift at its bottom station: a cosmetic ride on the real cable path at real pace, dropped at the top; closed lifts say why. The walker is not a sim guest (nothing is charged or queued).
- Footsteps by surface (snow, gravel, grass, wood, road: five quiet synthesized `Sfx` recipes) with cadence from distance walked; the walker is the audio listener (near-field crowd / lift / birds / water via `AMB.walkZoom`).
- P in walk mode opens photo mode at the walker's eye and returns to walking. View state machine: iso <-> walk, walk <-> photo legal, ride <-> walk illegal.
- Settings > Gameplay: walk mouse sensitivity (0.5-2x), FOV (60-100), invert Y, head bob, run toggle (`slope.walk.v1`). Walk HUD variant (location, altitude, compass, hint, crosshair, prompts, info card).
- Harness: `--view walk --walk-at --walk-yaw --walk-pitch --walk-script`; `npm run perf:ground` walk rows (178 draw calls on 128 med).

### M5.2: ground-level views readiness (Task 13)
- Ride rig scale fix: figures are drawn 0.52 units tall (not the assumed 1.15), eye heights are now ~0.9 x that (ski 0.47, board 0.45, foot 0.47, bike 0.50; were 0.98 / 0.95 / 1.02 / 0.92) so the camera is at head height of the guests next to you; `FIGURE_HEIGHT` = 0.52 with tests; chair / gondola eyes checked against the seat / cabin geometry (unchanged); iso untouched.
- Building roofs (all `roof` layers) now dither away within 3 tiles of a ground camera (`uNearHide`, like station roofs); tree cross-fade narrowed (TREE_FADE_W 4 -> 3); a capped near tree / rock cell now keeps the NEAREST instances to the camera instead of the first in storage order.
- Graphics quality caps for ground views (`QUALITY_PRESETS[q].ground`): near-LOD radius, near tree / rock caps, near figure count, fog range, terrain detail texture; low turns the near LOD off.
- Settings > Gameplay: "Ride-along slow motion" (default On).
- `npm run perf:ground` (draw calls / triangles / JS update time in ride and photo on 64 / 128 / 256; budget <= 350 draw calls on 128), `docs/ground-level.md`, `docs/playtest-m52.md`, ride + photo shots in the shot / ui suites.

### M5.2: close-up LOD (ground cameras only; iso is unchanged)
- Near variants selected by the pure `nearLod(cameraKind, distance)` (`src/render/lod/nearLod.ts`): orthographic cameras always get the base level, ground cameras get `near` < 6 tiles (60 m), `mid` < 20, `far`, with hysteresis. Figures: the 40 nearest guests use a detailed mesh (mittens, boot soles, collar + zip, goggles + strap, helmet vent, hair volume, pole baskets, ski / snowboard bindings, pack yoke; <= 400 triangles). Lifts within 6 tiles swap to chairs with a curved backrest / piping / grip jaws / safety-bar handles, gondola / cable-car / funicular interiors (floor, benches, pole), towers with sheave plates and rungs, and a round, light, spiral-striped cable (the flat dark band is gone). Station roofs and canopies dither away within 3 tiles of the camera.
- Trees within ~80 m use higher-poly crowns (12 segments, noise displacement, ridged bark trunks, branch bundles; instance cap per cell), rocks get 500 facets, and all tree / rock bands now cross-fade with complementary stipple masks (no popping). Terrain gets a procedural micro-detail (albedo grain, normal ripple, crack specks, close-range crystal glints) that fades out beyond ~45 m and is exactly zero in iso.
- Debug: `__slope.view.freeCam(x, y, z, yaw, pitch)` and `--vjs` in the shot harness.

### M5.2: photo mode
- Photo mode (P, camera button in the top bar, View drawer): free orbit camera with FOV 20-90, render-only time of day and snow / rain toggle, filters (Warm, Cool, Vivid, Mono, Vintage), vignette, frames (thin border, Polaroid, film strip), aspect presets and a Hero shot. UI is hidden except a compact collapsible panel. The game pauses while composing (optional), and leaving restores the previous view exactly. `stateHash` is unaffected.
- Save photo = a PNG download to your device (sky and fog painted into the export, 1x / 2x clamped to the GPU and memory limits) plus a quiet shutter sound. The newest 30 photos stay in a local, device-only gallery (IndexedDB database `slope-photos`, separate from the saves). No sharing features. `docs/photo-mode.md`.

### M5.1: a calmer, friendlier game
- Incidents are never fatal: critical cases end in hospitalisation (a heavier safety penalty), trapped skiers are dug out or hospitalised, long lift strands end in an evacuation. News now says Rescued / Dug out / Hospitalised / Evacuated. Old saves migrate automatically.
- Quiet feedback layer: small `+$` popups for notable sales, build puffs, and confetti only for major milestones. Settings > Gameplay > *Feedback intensity* (Off / Subtle / Lively). Subtle is the default. Reduced motion tones everything down. See `docs/fun-feedback.md`.
- Occasional guest emotes (hungry, cold, tired, happy, angry) and a small star-change chip next to the rating in the HUD.
- A short career of 20 goals in four chapters, three shown at a time, each with a small cash grant and a "Show me" button.
- Advisor "Ranger Rudi": an Advice badge with ranked, plain-spoken suggestions you can dismiss.
- Guest reviews in a new Reviews tab of the news panel: mostly plain feedback, with the odd light remark.
- "Welcome back" recap after Continue, and an optional month-end summary card.
- Undo (Ctrl+Z / the undo button) for recent placements and bulldozing.
- Accessibility: text size 90 to 130 %, reduced motion, month-end summary toggle.
- Quieter wind and snow ambience at default settings.
- The game now reports version 0.1.0.
- Known gaps: the scared emote for animal sightings is not wired up yet; goal grants only show as quiet news rows; audio levels have not yet been checked by ear.
- Dev: a headless micro-benchmark for the feedback layer (`tests/perf/feedbackLayer.test.ts`), grant checks in the balance sweep, UI suite shots for Reviews and settings at 1920.

### Fixed (M5.1)
- At narrow window widths the Advice badge covered the first build-drawer card; it is now a small corner badge.

### Added
- UI overhaul (`docs/ui-kit.md`, `docs/fonts.md`): self-hosted fonts **Nunito** (UI, variable 400-800) and **Lilita One** (titles / logo), OFL, preloaded, precached (offline), `--font-ui` / `--font-display` tokens, tabular numerals; no requests to Google (`verify:pwa` checks).
- Shared UI kit in `BASE_CSS`: buttons (primary / danger / ghost / icon), fields, checkbox + toggle, range sliders, tabs, scrollbars, `data-tip` tooltips, `kbd`, focus rings. Dev page `/?uikit=1`.
- `st-select`: themed dropdown with a keyboard-navigable listbox popup (arrows / Enter / Esc / typeahead, ARIA, outside-click) replacing every native `<select>` (top bar, New game, Operations, Debug, News, Dock, Lift inspector). Tests: `tests/ui-dom/select.test.ts`.
- One dialog system (`src/ui/modal.ts`, `st-modal`): same frame (icon + title + ✕, scrolling body, footer), widths sm 420 / md 640 / lg 920, a single stack with z-order, Esc closes only the top dialog, focus trap + restore, backdrop click. New Game, Save / Load, Settings, Help, About, Pause, confirms and the bankruptcy screen all use it; the main menu is a screen underneath.
- Procedural logo (`src/ui/logo.ts`): full / badge / mark / wordmark SVG, used in the main menu, About, boot splash, favicon and the PWA icons (rasterised from the same geometry by `scripts/gen-icons.ts` with the installed Chrome, procedural fallback). Boot splash with 'Loading…'.
- Save discoverability: **Save** button in the top bar (tooltip 'Save game (Ctrl+S) · saved 2 min ago'), **Ctrl+S**, 'Save game' / 'Load game' in the pause menu, Save / Load tabs (Save first) in the dialog, 'Game saved' toast, ⌂ Menu now opens the main menu as a screen over the paused game (Resume, Save game, Load game, New game, Settings, Help, About, Quit to title).
- Settings dialog with sections Audio / Graphics (quality dropdown) / Gameplay (fast nights, hints, replay tutorial, unmute news) / Accessibility; reachable from the menu, top bar and pause menu.

### Changed
- **New games always start with a fresh random seed** (shown as a readable name like Alpine-Fox-1234, editable, 🎲 re-rolls); a URL without `?seed=` is random too (`parseConfig(params, rnd)`); only explicit seeds, the tutorial (61) and tests are fixed.
- Main menu: logo on top and a 320 px button column with icons instead of full-width flat bars. `#ui` now has `z-index:22` (above the title-demo vignette / blur, below its fade) which fixed the blurred / veiled menu; tooltips use z-index 30.
- Sign textures use Nunito.
- Web manifest `background_color` matches the splash (#1d3b6e).

### Fixed
- Save / Load (and Settings) opened behind or beside the main menu card; Settings appeared in a different place than the other dialogs.

### Added
- Winter evenings (`sim/Evening.ts`, `EVENING` in `config/balance.ts`, `docs/balance.md` 'Evenings'): hourly demand curves for food/drink venues per season (winter après bump from 16:00 + dinner peak 18:30-21:00; summer lunch peak 12:00 + terrace evenings 18:30-22:00), venue opening hours (08:00 - 23:00 winter / 22:30 summer, evening-shift staff cost, 15 % evening premium on prices), overnight guests stay active until ~22:30 (dinner, drinks, ice rink, then back to the lodging), and 20-35 % of winter day guests stay for après-ski until 19:00-20:00. New per-guest `eve` counter (saved). Inspector shows each venue's busiest hour.
- Après-Ski Bar (Services, 4x3, $7,000, staff 4, capacity 70, road or path): own `bars` ledger line, price key `apresBar`, glowing string-light mesh, chimney smoke, catalog/placement docs and tests.
- Marketing campaigns have hard prerequisites (`Marketing.canStart`), shown as a ✓/✗ list with a disabled Start button; running campaigns pause when one disappears and are cancelled after 3 days (`marketing:cancelled`). See `docs/marketing-pricing.md`.
- 'Go to' for location-specific warnings: news rows get a '⌖ Go to' button and critical/important toasts a 'Go to' action (avalanche, wildlife, incidents, stranded riders, lift breakdowns / closures, attraction closures, inactive buildings). The camera glides there (`CameraController.focusOn`), buildings are selected and a pulsing marker ring is shown. `NewsItem.focus`.
- `ui/text.ts` (`sentence`, `title`, `displayName`, `humanizeId`) and a message audit test: news, toasts, reasons, placement text, campaign labels and tutorial strings start uppercase and never leak raw ids.

### Fixed
- Warnings showed raw ids and lowercase reasons ('cafe closed. no snow at 1,450 m'); they now read 'Café closed. No snow at 1,450 m'.

### Added
- GitHub Pages hosting: `.github/workflows/pages.yml` (deploy on push to `main`), `ci.yml` (PRs), `extra-tests.yml` (manual perf/balance), `public/.nojekyll`, generated `dist/404.html` (redirect, not precached), `.gitattributes`, `.editorconfig`, `.nvmrc`. Scripts: `build:pages`, `deploy:check`, `preview:pages` (subpath server), `deploy:gh-pages` (manual branch deploy, `--dry-run`), `release`, `verify:pwa -- --base /repo/`. See `docs/deploy.md`.

### Added
- Hiking excursions (`sim/guests/Excursion.ts`, `TrailGoals.ts`, `docs/hiking.md`): hikers/bikers commit to a route and walk it in compressed game time (1.5-4.5 h, map-scale independent, O(1) per tick), with a stop at the goal (+ hut lunch), dusk fit, trail-closure and bear turn-backs and save/load. Trail goals are scored by appeal (altitude, huts, summits, lift tops, fitness, daylight, safety) with a pull to the top third; hikers/bikers ride the foot/bike lift up first. Top-third share of hikers 19/13/1 % -> 53/54/34 % (64/128/256). New 'Hiker lift ticket' price (`hikerPass`).
- Mountain Hut beds (12) and overnight treks: ~15 % of solo/couple/adventure guests book a bed (`night:mountainHut`, default $45), walk up, sleep in the hut (hidden) and walk down the next morning; bed counts in the hut inspector and the guest inspector shows 'On excursion: ... (45% . ETA 1h40)'.
- Seasonal daylight (`sim/Daylight.ts`): sunrise/sunset follow the year (winter 07:45-16:45, summer 05:15-20:45). Lighting sun path and dusk/dawn glow, fast nights, guest arrival window and day-guest leave time, lift schedules ('Auto (daylight)' default), grooming window, ambience/music/church bell and the HUD season tooltip all follow the sun. See `docs/ski-exploration.md`.
- Skier exploration: per-guest lift memory (novelty), a chosen line (via tile) per run scored by crowd/novelty/difficulty, faster skiing/walking and shorter pauses (about 2x the runs per day, 2-3x more distinct pistes per skier), 'Piste traffic' overlay and 'runs today' in the piste inspector. `npm run analysis:ski`.
- Bears roam visibly: den + territory, rest/wander/forage cycle, winter hibernation, hungry autumn raids towards buildings, mother + cub, 'bear sighted' paw marker; 1-3 / 2-4 / 4-8 bears on 64 / 128 / 256 maps.
- Bear threat field scares guests (happiness, 'Saw a bear!', activity aborted), steers hikers/bikers/attractions away (lost trail revenue), and feeds a decaying wildlife-scare level that lowers arrivals and the Safety rating. New *Wildlife threat* and *Ranger coverage* overlays; events `wildlife:scare`, `wildlife:hazed`, `wildlife:relocated`.
- Ranger Station (Safety & Ops, $9,000): deterrence, ranger ATV response (haze, then tranquilise + relocate repeat offenders), bear-proof bins, inspector with rangers +/- and 'prevented scares this month'. See `docs/nature.md`.

## [0.1.0] - 2026-10-23 (pre-release)

First tagged pre-release; previously labelled 0.9.0 internally. Playtest build, not a 1.0. Built in four phases, each approved after a human playtest.

### Added

#### Phase 1: engine, terrain, tools
- Tile grid with vertex heights, occupancy and tile types; isometric camera (WASD pan, 90° and continuous rotation, zoom).
- Seeded procedural terrain with presets, lakes, streams (`Streams.ts`), forests and rocks; named seeds; map sizes 64 / 128 / 256.
- Chunked terrain meshes with procedural grass / rock / snow textures, snowline blending and far-LOD macro meshes; instanced trees and rocks with LOD; water shader.
- Picking and terraform tools (raise / lower / flatten, corner and area), minimal UI shell and debug panel.

#### Phase 2: construction
- Building catalog and procedural meshes (see `docs/models.md`, gallery key B); grid-snapped placement with rotation, bulldoze, dependency locking and range rules (`docs/placement-rules.md`).
- Paths, pistes, roads and rail; piste difficulty by slope.
- Lifts: stations, auto-placed towers, cables and moving carriers; variants (including funicular), operating hours, breakdowns, energy cost (`docs/lift-ops-and-debt.md`).

#### Phase 3: simulation
- Tick loop, speeds 1x / 2x / 3x, calendar, season cycle, weather, altitude snowline and snow cover with melt; fast nights.
- Guests with needs and navigation, arrivals by road / rail / altiport, families, ski school and childcare, every winter and summer attraction.
- Economy: monthly finances, tickets, loans and debt, upkeep, wages; resort rating and notifications.
- Operations: nightly grooming and snowmaking, patrol and sled rescues, helicopter, avalanches, wildlife (bears, wolves) and warning signs, fauna, farms and livestock, planting, smoke.
- Performance pass (spatial hash, nav graph, time-sliced queues, instanced guest renderer, graphics presets; `docs/perf.md`).

#### Phase 4: release features
- Synthesized Web Audio ambience and effects, and generative seasonal music (`docs/audio.md`); audio settings panel.
- Marketing campaigns (Families, Budget, VIP, Summer Adventure, ...) and seasonal pricing menus with price elasticity (`docs/marketing-pricing.md`).
- Save system: SaveRegistry, gzip'd versioned envelope with CRC, migrations, IndexedDB with LocalStorage fallback, slots, quick save, rolling autosave, `.slope` export / import, `?continue=1` (`docs/saves.md`).
- PWA: manifest, procedural icons, hand-written service worker with versioned precache, update toast, offline indicator, install button (`docs/pwa.md`).
- Interactive tutorial with ranger assistant, "Show me" / "Do it for me", contextual hints (`docs/tutorial.md`).
- Title screen, New Game dialog (size, seed, preset, start season, difficulty, money, starter loan), pause menu, Help, About (shows the package version).
- Balance pass: arrival rates, starting money, energy, difficulty levels, size-independent arrival-to-ride time (`docs/balance.md`).
- Release tooling: `npm run size`, `npm run release:check`, `docs/release.md`.

### Fixed (notable playtest findings)
- Invisible lakes: water was never instantiated; wired, plus streams and wet-terrain attribute.
- Terrain made gentler and more varied per seed.
- Default tool is now *select* (terraforming only via the Terrain drawer).
- Help overlay and other full-screen children of `#ui` swallowed all clicks; click diagnostics added (dev builds only).
- Boot errors: custom-element constructors no longer set attributes; the bankrupt dialog ignored `[hidden]`; boot lodge mesh missing (BuildingsView now syncs all buildings); road meshes follow the terrain diagonal.
- Summer snow render bug: far-LOD terrain meshes never refreshed snow, and the debug slider did not change sim snow; snowline / melt curves retuned; start-season option.
- Pacing: the 180 s/day pace was reverted to 24 s/day at 1x; fast nights warp the quiet hours.
- News volume reduced (news quieting); lift and piste naming and a piste inspector added.
- Economy: arrival throttling and unrealistic early profits rebalanced; vehicles and guests no longer take hours to cross large maps.
- Persistence determinism issues found by the round-trip tests (rating guard, lift boarding windows, patrol / heli state, families, spatial hash).
- Production builds no longer log pointer diagnostics to the console; stale `TODO(networks)` comment removed.

### Known issues
See `docs/release.md` ("Known issues / unverified").
