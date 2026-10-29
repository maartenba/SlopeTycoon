# Visual QA harness (headless Chrome + SwiftShader WebGL)

Agents have no GPU, but the installed Google Chrome renders the real game with software WebGL2 (SwiftShader via ANGLE). This harness drives it with `puppeteer-core`, prints **every** console message / page error / failed request (shader compile errors included) and saves PNG screenshots to `.weave/shots/`.

```
npm run shot -- --size 64 --seed 61 --start summer --hour 12 --zoom 3 --target lodge --out my-shot
   [--yaw 0.8] [--w 1600 --h 1000] [--extra "starter=1&tutorial=1"] [--eval "js run in the page before the screenshot"]
npm run shot:suite     # boot, village summer/winter, night, lodge close-up, far/128, gallery (B), starter-resort lifts, HUD 1280/1920, tutorial steps 1/4/9
```

* Starts `vite` (dev server, free port), launches Chrome with `--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --use-gl=angle --ignore-gpu-blocklist --disable-gpu-sandbox`, opens `/?size&seed&start&hints=0`, waits for `window.__slope`, positions the camera (`--zoom` = multiplier over the minimum zoom, `--target lodge|x,z`, `--yaw`), sets the hour via `__slope.setHour(h)`, waits 2.5 s, screenshots.
* Exit code 2 when any shader/WebGL error is logged (`suite` returns 2 if any shot logged an error). GL-driver "GPU stall" warnings are filtered out of the error count (still printed by `shot`).
* Harness options added for the website: `local` (a `{key: value}` map written to `localStorage` before boot and removed after the shot, e.g. the colour palette `slope.a11y.v1` = `{"palette":"cbsafe"}`; manifest entries only) and `touch` + `viewport` (phone / tablet shots, see `docs/touch.md`).
* Touch: `npm run touch:e2e` (real emulated fingers, asserts state; docs/touch.md) uses the same Chrome / SwiftShader setup.
* Code lives in `scripts/lib/harness.ts` (launch/serve/shot), `scripts/shot.ts` (CLI), `scripts/shot-suite.ts` (set).
* Gotcha: the image-capable `read` tool caches by path: write each new look to a **new file name** (`--out`) or you will be shown the old picture.
* Gotcha: the console shows the full GLSL with the failing line marked `>` (e.g. `ERROR: 0:1111: '-' : wrong operand types ... vec4 ... vec3`).
* Runtime guard (`src/render/MaterialGuard.ts`): every ~20 frames the scene's materials are checked for failed programs (`renderer.properties.get(mat).currentProgram.diagnostics.runnable === false`). It logs `Shader error in <material> (<owner>)`, shows an error toast, lists it in the F3 panel (`Render problems: N`) and, for patched built-in materials (Lambert + `onBeforeCompile`), falls back to the plain unpatched material so buildings never vanish. Custom `ShaderMaterial`s (terrain, water, props, ...) can only be reported.

## Reference screenshots

![Fresh game at boot, summer: Base Lodge at the road end, centred](img/boot-lodge-summer.webp)
![Starter resort, winter](img/starter-resort-winter.webp)

## Incident: invisible buildings (fixed)

`THREE.WebGLProgram: Shader Error ... MeshLambertMaterial ... ERROR: 0:1111: '-' : wrong operand types - no operation '-' exists that takes a left-hand operand of type 'in highp 4-component vector of float' and a right operand of type 'uniform highp 3-component vector of float'` at
`totalEmissiveRadiance += ... length(vColor - uGlass) ...`.
three r186 declares `vColor` as **vec4** (`USE_COLOR_ALPHA`) for Lambert with `vertexColors`; the night-glow patch subtracted a vec3. The wood/stone/roof programs failed to link (every frame `useProgram: program not valid`), so only the sign (unpatched material) drew. Fix: `vColor.rgb`. Test: `tests/render/materialGuard.test.ts` (string-level patched-shader checks + guard behaviour).

## World & buildings (visual pass)

Findings (before): "blue-grey / white" crowns in summer were **spring blossom** bleeding into early summer. The season weights crossfade linearly, so on summer day 1 the spring weight is 0.33 and blossom white/pink was mixed 1/3 into green crowns. Fix: blossom only appears at spring weight > 0.55 (`smoothstep(0.55, 0.95, uSeason.x)`); summer tint maths moved to `src/render/props/treeTint.ts` (GLSL generated from the constants, hue/saturation tests in `tests/render/worldLook.test.ts`). Rocks darker (0x56534f) and 0.7x smaller, summer moss on up-faces. Winter leaves drop earlier (threshold 0.3 + 0.4 h), purple maple tones reduced, conifer snow caps stronger.
Terrain: lower-sun "relief light" + wrap, cavity darkening on steep / sun-averted faces, cool blue shade tint (strongest on snow), snow drift bump normals + sparkle, snow albedo headroom (no clipping to flat white), faint contour tone, 10 % depth haze, cliff skirt strata + dark foot + fade into the sky colour. Sky is a CSS gradient behind a transparent canvas (`Lighting.skyElement`, `skyGradient`, follows time of day).
Animals: see `docs/nature.md` (Motion).

![Village, summer noon](img/world-village-summer.webp)
![Village, winter noon](img/world-village-winter.webp)
![Village at night: lamp posts and window glow](img/world-night.webp)
![Lodge close-up: chamfered walls, eave thickness](img/world-lodge-close.webp)
![Forest close-up, summer: lush green crowns, moss rocks](img/world-forest-summer.webp)
![Deer herds in the meadow](img/world-deer-meadow.webp)
![Winter forest, snow relief](img/world-winter-forest.webp)
![Gallery (key B)](img/world-gallery.webp)
![Starter resort + lifts, winter](img/world-lifts.webp)
![128 map, far view](img/world-far-128.webp)

## Guests & vehicles

Guests are no longer capsules: `src/render/GuestRenderer.ts` draws merged low-poly humans (`src/render/meshes/Figures.ts`) in **8 instanced gear batches** (walk, hike, ski, board, bike, lift seat, skate, lying) + the far impostor = **9 draw calls**. Appearance is a pure function of guest id/type/season (`src/render/guestAppearance.ts`, `describeAppearance(id, type, winter, kid?)` for inspectors): 8 skin tones, 8 hair colours, 9 head styles (bald, short, long, ponytail, bun, beanie, helmet+goggles, cap, sun hat), slim/average/stocky builds, male/female, child 0.65 / teen 0.88 / adult / senior scale, 16 jacket colours, 8 trouser colours, winter (jacket, gloves, helmets/beanies) vs summer (t-shirt, shorts, caps/sun hats) vs swimwear (beach). Gear comes from the sim state: ski modes -> skis+poles or snowboard (~30 % boarders, stable per guest), hike -> boots+poles+backpack, bike -> mountain bike with spinning wheels, riding -> seated pose, Using at an ice rink -> skates, beach/injured -> lying (towel / red sled). Per-instance attributes carry colours/build/phase/speed; limb swing, sway, bob and wheel spin run in the vertex shader (`Lambert` + `onBeforeCompile`, so scene lights = day/night/season consistent). Heading comes from the tick movement; the update loop does no per-guest allocation. Ski-school instructors, kids on sleds/magic carpet and lift seat position are **not** specially modelled / not verified with a real rider (no riders occurred in the headless sim runs).

Vehicles (`src/render/meshes/VehicleModels.ts`, `Vehicles.ts`): lofted rounded bodies with window bands, wheels with hubs, head/tail lights (unlit, brighter at night), 4 civilian styles (hatchback, sedan, SUV, van) + sports car for VIP, 8 colours, roof skis (winter) / bike (summer) on ~40 % of cars, coach + shuttle minibus with window bands and stripes, loco + 2 carriages with pantograph, propeller plane with spinning propeller. Models are cached per look and shared; each vehicle = 2 draw calls (body + lights), plane 3. Vehicles pitch with the terrain and bob slightly.

Harness additions: `--ticks N` advances the sim before the shot (starter resorts are quiet: a handful of guests after 3000 ticks, so the shots above force guests/vehicles with `--eval` scenes: set `loop.setSpeed(0)`, `guestSim.store.add(...)`, `state/moveMode`, `px/py` for heading+speed, `spawner.vehicles.push(...)`).

![Skiers and boarders streaming down a slope, queue at the bottom, winter](img/graphics-slope-winter.webp)
![Gear gallery, winter: walkers, hikers, skiers, boarders, bikers, lift riders, skaters, lying](img/graphics-gear-winter.webp)
![Gear gallery, summer outfits: shorts, caps, sun hats, backpacks, bikers](img/graphics-gear-summer.webp)
![Zoom 1 (figures, not points) on the slope](img/graphics-far-winter.webp)
![Vehicles by day: cars with roof racks, coaches, train, plane](img/graphics-vehicles-day.webp)
![Vehicles at night: headlight glow](img/graphics-vehicles-night.webp)
![Parking lot with the new cars, summer](img/graphics-parking-summer.webp)

## UI

Harness additions: `--viewport 1280x800`, `--steps "click:<css | tutorial-id | button text/title/aria-label>;key:F3;mouse:x,y;wait:ms"` (clicks pierce shadow roots), `--overlap 1` (prints bounding-box overlaps between the always-visible panels; transient modals are skipped), `--bare 1` (boot without `?size/seed`, i.e. the title screen). `npm run ui:suite [-- filter]` takes ~30 screens (menu, HUD at 1280/1920/1000, every drawer, all panels open, new game/settings/help/save-load/pause, tutorial steps + spotlight) and reports overlaps per shot.

* Anchor zones: `src/ui/layout.ts` (+ `tests/ui/layout.test.ts`). Assistant bottom-left above the dock row (bottom:84), debug button bottom-left (opens as a panel top-left under the top bar), build drawer (see 'Build drawer') between the assistant column and the news column, news bottom-right (244 px), resort goals card in the right column under the HUD block (zone `right-goals`, see docs/goals.md). Under 1100 px the assistant starts minimised (avatar badge) and the news header collapses to an icon badge.
* Icons: `src/ui/icons.ts` (inline SVG: sun/cloud/snow/rain/storm/moon/guests/mountain/pause/news/bulb/mute/smileys, `starRow()` with full/half/empty stars, `starFills()`); no emoji glyphs or `½` in the HUD any more.
* Tokens: `src/ui/tokens.ts` (spacing/radius/font size/colour custom properties injected in every `:host` via BASE_CSS, focus-visible outlines, thin scrollbars, emoji font fallbacks).

![Boot framing 1920x1080](img/ui-boot-1920.webp)
![All panels open at 1280x800: dock drawer + debug + assistant + news](img/ui-all-panels-1280.webp)
![Lifts drawer (11 variants) with info card](img/ui-lifts-drawer.webp)
![Tutorial spotlight ring on the Buildings dock button](img/ui-tutorial-spotlight.webp)
![Inspector + assistant](img/ui-inspector-assistant.webp)
![New game dialog](img/ui-new-game.webp)
![Narrow 1000x700](img/ui-narrow-1000.webp)
![Finance drawer](img/ui-finance.webp)


## Build drawer

Low-profile drawer (feedback: the old 2-row grid + big info card covered ~60 % of a 1000 px tall window). Buildings (6 tabs), Lifts, Paths & Roads and Pistes & Trails are **one horizontal rail** of fixed 96x116 cards (64 px thumbnail, name, price, 1-9 number badge) with: wheel→horizontal scroll (`wheelToHorizontal`), arrow keys / Home / End between cards, ◀ ▶ buttons + edge fades only when there is overflow (`edgeState`), scroll snap, a thin visible scrollbar, and `scrollIntoViewLeft` when keys 1-9 pick an item. Header = ONE row: title, tab strip (scrolls horizontally, no wrapping), rotate ⟲ ⟳, Auto-flatten, close. Total height ≈ 170 px (≤ 190, `DRAWER_MAX_H`), directly above the dock, between the assistant column (left 352 px) and the news column (right 252 px; 72/80 px badge insets under 1100 px), max 1200 px wide (`drawerBox` in `src/ui/layout.ts`, same numbers as the CSS vars `--dl/--dr`).
The detailed info is a floating popover (320 px wide, max 220 px tall, absolutely positioned above the hovered/focused card, flips to the card's right edge via `popoverLeft`, hidden on mouse leave and as soon as a placement starts) so hovering never changes the drawer size. Panel drawers (Finance, Operations, Marketing, Pricing) keep their panels and are capped at min(46 vh, 380 px). Terrain / View use compact wrapped rows (≈140 px).
Harness steps added: `move:x,y` (hover only), `wheel:dy`. Suite entries `ui-s-drawer-*` (popover, lifts, tabs at 1000, 1920, everything open, pistes/terrain/finance at 1000): no overlaps at 1280x800, 1920x1080, 1000x700.

![Buildings drawer at 1000x700 with the info popover](img/drawer-buildings-1000.webp)
![Lifts (11 variants) at 1920x1080, popover on the 7th](img/drawer-lifts-1920.webp)
![Everything open at 1280x800: debug + assistant + news + drawer + popover](img/drawer-all-panels-1280.webp)

## Daylight shots
`--eval "__slope.sim.jumpToDay(300, 16.4); __slope.loop.setSpeed(0); __slope.setHour(16.4)"` sets the date (sun times follow the day) and the hour; `__slope.covOverlay.setMode('traffic')` shows the piste traffic overlay. Reference shots: `img/daylight-*.png` (see `docs/ski-exploration.md`); no shader errors were logged (the 4 'errors' per shot are the filtered GPU-stall driver warnings).

![Piste traffic overlay (64 starter, 1400 ticks)](img/daylight-traffic-overlay.webp)

## Menu demo (live title-screen backdrop)

The title screen runs the REAL game headless-of-UI: `?` (no params) boots `boot()` with `DEMO = true` (src/main.ts): `createSim` on a dedicated demo map (seed 7, 128 map; 64 on low-memory devices; override with `?demoseed=&demosize=`), `buildDemoResort(sim, 'large')` (src/game/demoResort.ts: ~90 ms), 150-260 guests (`spawnGuests`, topped up every morning), the normal renderer / lighting / precipitation / smoke / wildlife, **no game UI** (`if (ui && !DEMO)`), audio off, no autosave, canvas `pointer-events:none`. Pacing: `TickLoop.timeScale` = 1.5 (`demoTimeScale()`: 150 s day / 100 s) → one in-game day = ~100 s (fast nights off), so dawn, noon, sunset (window glow, lamp posts) and night (snowcats grooming) all happen on screen. Every ~3 min `DemoScene` fades to black, `jumpSimToDay` switches winter <-> summer, fades back in. `src/render/DemoCamera.ts` is the camera director (POIs: village, lift stations, pistes, lakes, train, snowcat, a skier, a gondola/chair carrier, animals; wide / medium / close framings 9-30 visible tiles tall, eased dolly + yaw drift, always looking towards the map centre so the void stays behind; follow shots track moving things; `prefers-reduced-motion` = one static wide village shot with a very slow drift). A CSS vignette + soft blur patch sit behind the menu card (z-index 20, menu is 30). Clicking New game / Continue / Tutorial / Load calls `demo.dispose()` (DisposeBag: timers, scene geometry + materials + textures, renderer, tick loop) before the page navigates. No WebGL = static preview, then the plain gradient background.

Harness: `npm run demo:shots -- --seed 7 --tag x [--only wide,village] [--size 64|128]` loads `?demoscene=1&nomenu=1`, freezes the director (`__slope.demo.hold`), runs the sim to chosen hours (`__runTo`) and frames points of interest (`__frame(id, visibleTiles, yawOffset)`). Debug: `scripts/demo-debug.ts` prints console / crash / navigation events. The harness dev server now runs with `SLOPE_NO_HMR=1` (no file watching: edits by other people no longer reload the page mid-shot) and is killed as a process group.

![Title screen over the live demo](img/demo-menu.webp)
![Wide view, winter morning](img/demo-wide-winter.webp)
![Village by day: lodge, chalets, parking, train, lifts, queue](img/demo-village-day.webp)
![Gondola bottom station beside the green run](img/demo-gondola-station.webp)
![Lake and deer herd](img/demo-lake-winter.webp)
![Sunset: guests heading home, lights coming on](img/demo-sunset.webp)
![Night: window glow, lamp posts, snowcats on the slope](img/demo-night-glow.webp)
![Summer variant (after the season jump)](img/demo-summer.webp)

Debug panel (F3 -> "Debug tools (cheats)"): *Populate demo resort (cheats)* (two-click arm, Level select Starter / Medium / Large, shows a checklist of built counts + failures), *Spawn guests*, *Find bear* (cycles; in winter shows the dens: "Bears are hibernating (in dens)"), *Spawn bear* (never while hibernating; only when no bear roams), *Spawn bear near camera*, *Find deer / animals*. Harness API: `__slope.populateDemo(level)`, `findBear()`, `spawnBear()`, `findAnimal(species)`, `spawnGuests(n, mix)`.


## UI kit & dialogs

`npm run ui2:suite [-- filter]` (`scripts/ui2-suite.ts`, env `UI2_PREFIX` = output prefix) shoots the title menu and every dialog at 1280×800 / 1920×1080 / 1000×700, from the menu AND from the in-game pause menu / top bar, prints `document.fonts.check` for Nunito and Lilita One for every shot and the panel-overlap report (`.layer` dialogs are ignored by the report). The harness got a `type:text` step (keyboard). Dev pages: `/?uikit=1` (all controls) and `/?uikit=logo-full|logo-badge|logo-wordmark|logo-mark|logo-light`.

Incident (fixed): the title menu looked veiled / blurred. Cause: `#ui` is a stacking context at z auto, so the title demo's body-level vignette + blur layers (z 20, `src/render/DemoScene.ts`) painted OVER the whole menu even though the menu has z-index 30 *inside* #ui. Fix: `#ui { z-index: 22 }` (above vignette / blur, below the fade-to-black at 25); body-level tooltips (`GhostTip`, `PathTool`) moved to z 30. Lesson: z-indexes of components only compare inside `#ui`; anything appended to `body` needs a z-index relative to 22.

![Title menu: logo, 320 px button column](img/ui2-menu.webp)
![New game dialog above the menu, themed dropdown open, fresh random seed](img/ui2-newgame-dropdown.webp)
![Settings dialog: Audio, Graphics, Gameplay, Accessibility](img/ui2-settings.webp)
![Save tab (pause menu stays underneath)](img/ui2-save.webp)
![Load tab with a saved game](img/ui2-load.webp)
![Confirm dialog stacked over the Load dialog](img/ui2-confirm.webp)
![In-game menu over the running game](img/ui2-game-menu.webp)
![Top-bar graphics dropdown](img/ui2-topbar-dropdown.webp)
![UI kit page](img/ui2-kit.webp)

Logo candidates (A = chosen full logo, B = badge, C = wordmark only; light theme and mark):

![A full](img/logo-a-full.webp) ![B badge](img/logo-b-badge.webp) ![C wordmark](img/logo-c-wordmark.webp) ![A light](img/logo-a-full-light.webp) ![mark](img/logo-mark.webp)


## Farm & cattle (Alpine Farm QA)

Placing a farm and checking livestock through the seasons: `npm run shot -- --size 128 --seed 61 --start summer --hour 12 --eval "..." --out farm-x` where the eval calls `__slope.populateDemo('large')` (now includes an Alpine Farm), `sim.jumpToDay(140, 10)`, advances `loop.advance(1)` a few hundred ticks and aims `renderer.controls` at the herd centroid of `sim.nature.livestock.animals` (`hidden === false`). The title-screen demo (`--bare 1`) can be steered the same way: `__slope.demo.hold = true; __slope.demo.seasonsEnabled = false; __slope.jumpSimToDay(120, 10)`, then hide `#ui` and the aria-hidden overlay divs.

![Summer meadow: cows, sheep and goats around the farm](img/farm-summer-meadow.webp)
![Farm close-up](img/farm-closeup.webp)
![Demo resort in summer with the farm](img/farm-demo-summer.webp)

## M5.1 additions
`npm run ui:suite` now also shoots `ui-s-news-reviews-1280` (News > Reviews tab with sample reviews) and `ui-s-settings-1920`. The HUD shots show the Goals card, the Advice badge and the star-delta chip; `npm run recap:shot -- --mode recap|month [--w --h]` shoots the Welcome back and month cards. At widths under 1100 px the Advice badge is a small corner badge on the avatar (it used to cover the first drawer card).

## Photo mode
See `docs/photo-mode.md`: `--view photo --photo-hero 1 --photo-filter warm --photo-frame polaroid --photo-aspect 16:9 --photo-hour 17.4 --photo-save 1 --photo-from ride` (export lands in `.weave/shots/photo-export-<out>.png`; the harness fails if a pixel is transparent).

## Walk mode
See `docs/walk-mode.md`: `--view walk --walk-at lodge|station|x,y --walk-yaw 12 --walk-pitch -5 --walk-script "w:2;look:30,0;e"` (headless: drives the pure walker with synthetic keys; prefix shots `walk-`).

## Ground-level views (ride-along)

See `docs/ride-along.md`: `--view ride|lift --guest auto --freeze 1 --vticks N --pre "js"` in `npm run shot`, `__slope.view.*`.

![Skier POV beside a lift tower](img/ride-ski-1.webp)
![Chairlift POV, winter](img/ride-lift-1.webp)

## Ground-level suites + perf (Task 13)
`npm run shot:suite` now also takes `suite-ride-ski`, `suite-ride-lift`, `suite-photo-hero`, `suite-photo-dusk-film`; `npm run ui:suite` takes `ui-s-ride-hud-{1280,1920}` and `ui-s-photo-panel-{1280,1920}`. `npm run perf:ground` prints the ride / photo draw-call / triangle / JS update table (docs/perf.md). `--vjs` also runs in photo mode. Handy page calls: `__slope.view.setQuality('low'|'med'|'high')`, `__slope.view.freeCam(...)`. A fresh scene for skier-next-to-skier shots: place guests by writing `guestSim.store` (state 0, act 5, moveMode 3, x/y/z, px/py behind) around the target and `__slope.view.ride(id)`; sample terrain with `import('/src/world/Props.ts').surfaceHeight(__slope.grid, x, z)`.

## Glitch fixes

User reports: *a first-aid hut half in the snow*; *iso winter night: cloudy blotchy terrain, near-black road, farm with a floating pale pasture*. Repro helper: `scripts/glitch-shot.sh <name> <type> <spread half-steps> <seed> <season> <hour> [zoom] [yaw]` (places the type on the first footprint with that corner spread, clears nearby trees, aims the camera; scene in `scripts/glitch-scene.js`).

* **Buried / floating buildings** (root cause): `BuildingsView` seated every mesh on the LOWEST footprint corner with a fixed 0.4 plinth, so with a footprint spread of 1-2 half-steps (0.5-1.0 wu, allowed for first-aid hut, farm, ranger, kids ground, ...) the uphill side was buried; non-foundation types (farm, cannon, sign) had no plinth at all and the pasture slab was cut by the terrain. Fix: `seatOf()` (`src/sim/PlaceBuilding.ts`) puts the pad on the HIGHEST corner and the stone plinth reaches the lowest corner (`depth = spread + 0.12`, never less than 0.4; spread <= 2 half-steps => <= 1.12). Non-foundation types get a plain stone skirt of that depth; magic carpet (`gentleSlope`) keeps the lowest-corner seat; flat (`needsFlat`) footprints are unchanged (0.4). The mesh is rebuilt when terraforming changes the plinth depth. Placement rules/auto-flatten policies are unchanged.
* **Night terrain blotches/banding** (root cause): the snow-drift normal bump (scale 0.55) and the contour tone `sin(y)` are tuned for the sun; under the faint blue moon they were the only large variation left and read as cloudy tiles + horizontal bands. Both are now scaled by `dayK = smoothstep(0.25, 0.55, uSkyColor.b)` (0.3 / 0 at night).
* **Near-black road**: asphalt albedo ~0.07 * night radiance ~0.01. `NET_NIGHT` (set with the lighting) adds a small cool emissive floor to the road/path/rail material (`NET_NIGHT_GLSL`).
* **Road 'kinks'**: not reproduced as a mesh bug. Tile centre-lines of adjacent tiles meet exactly at the edge midpoints (new test), strips are draped per vertex; the one-tile jogs come from the network itself (diagonal roads/paths are tile staircases, see the zig-zag path to the hub). Not changed.
* Building snow caps get a per-patch variation (roof no longer a flat pale slab).

![Night, before: blotchy terrain, near-black road](img/glitch-night-before.webp)
![Night, after: calm terrain, readable road](img/glitch-night-after.webp)
![First-aid hut on a slope: pad on the high corner, plinth to the low corner](img/glitch-firstaid-plinth.webp)
![Alpine farm on a slope, summer](img/glitch-farm-slope-summer.webp)

## Progression shots (M5.3)

New Game with Career preselected: `npm run shot -- --bare 1 --viewport 1280x800 --steps "click:New game;wait:700" --out prog-newgame`. Drawers with level locks: `--extra "starter=1&hints=0" --steps "click:Lifts;wait:500;mouse:820,640;wait:600"` (hover the locked 6-seat chair) and `"click:Buildings;wait:500;click:Safety;wait:500"` (`dock-locks-m53`). Level-up card: `--eval "setTimeout(()=>window.__slope.progression.setLevel(2),400)" --steps "wait:1200" --out prog-levelup`. Final images: `docs/img/progression-*.png`.


## Flicker measurement
`npm run flicker -- [--only 64-winter] [--kinds rotfine,rotpop,zoomfine,zoompop,jitter,still,sheet] [--tag name] [--off trees,guests,...]` sweeps the camera (yaw / zoom) in the harness and reports oscillating pixels, popping events and LOD flips with heatmaps and contact sheets in `.weave/shots/flicker-*`. Method, causes and results: **docs/flicker.md**. `scripts/lib/harness.ts` `protocolTimeout` is now 30 min (long in-page sweeps).

## docs/img policy

* `docs/img/` holds only images that markdown or `site/shots.json` references, as **WebP** (quality ~82, max width 1920). Budget: no PNG over 400 kB and the folder at most 25 MB (enforced by `tests/repo/docsImages.test.ts`).
* Harness scripts (`shot`, `soft-shots`, `town-shots`, `recap-shot`, `glitch-shot`, ...) write PNGs to `.weave/shots/` (git-ignored). Copy a keeper into `docs/img/` as PNG, then run `npm run docs:img` (`-- --dry-run` to preview sizes): it converts to WebP, rewrites `.png` references in markdown/`site/shots.json`, deletes the PNG and updates `docs/img/manifest.json`. It is idempotent.
* Never commit raw captures: `docs/img/raw/` is git-ignored for scratch use.
* Delete images no document references (the test does not enforce this; check with `grep -rF <name> docs README.md site`).

## Rich-look comparison (before / after)

`npm run town:shots -- --only alpine,family,luxury,hiking,bigmountain --tag rich-before|rich-final --shots wide,close,summer` (same cameras before and after; the 'before' shots came from a clean `git worktree` of HEAD). Contact sheet `img/rich-before-after.webp` (left before, right after) and six single shots `img/rich-*.webp` (webp, <= 400 kB each). See docs/models.md 'Rich-look pass'.

![Before / after](img/rich-before-after.webp)
![Village, summer](img/rich-village-summer.webp)
![Alpine, summer](img/rich-alpine-summer.webp)
![Luxury, summer](img/rich-luxury-summer.webp)
![Family, winter](img/rich-family-winter.webp)
![Big mountain, winter](img/rich-bigmountain.webp)
![Alpine, winter](img/rich-alpine-winter.webp)

- The harness hides `st-toast` in every shot (`ShotOpts.toasts: true` keeps them), so seasonal closure toasts never end up in documentation screenshots.
