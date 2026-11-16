# Mobile UI v2: real-phone audit, proposal and implementation

Status: **implemented** and **released in 0.7.0** (2026-11-16). Sections 1-4 below are the audit and the proposal as written on 2026-11-15; section 0 says what was built, what changed against the proposal and the measured results. A static mockup lives in `.weave/mobile-mockup/index.html` (git-ignored, local).

## 0. Implemented (2026-11-16)

Owner decisions that shaped it: one **speed chip** with a popover; the **stars stay icons** at 360 px (the smiley goes first, then the guest icon; half-stars were never needed); the **dock row is hidden in tool mode** and *Options* in the tool bar re-opens the current sheet; Rudi's floating avatar became a **44 px badge** (with a count dot that opens the advice sheet) and *Rudi's tips* / *News* are also in the **...** menu; during placement a **profile sparkline** in the tool bar with the full chart on tap (desktop is **not** changed: follow-up below); **event toasts are held** while a tool is active; the real phone is a **Motorola G7** (412x866 CSS px, inner 412x762 under Chrome's bars).

What exists now:
- `src/ui/phoneCards.ts` (+ `tests/ui/phoneCards.test.ts`): the coordinator. `html[data-phone-mode]` = `idle | tool | sheet | modal` from (open dialogs, `html[data-toolfirst]`, registered sheet cards). Registered cards (drawer, goals, scenario, Rudi's advice, news, inspector) are **exclusive**: the newest opened closes the others. It also sets `html[data-phone-card]` (which cards are open) and `data-chip-hidden` on Rudi / news. It integrates the M7.5 `data-toolfirst` / `data-camdrag` (inputs, not duplicated). `__slope.phoneCards.open()` is the debug handle.
- **Top row** (`styles.css`, `StTopBar`, `StHud`, `StSpeedControl`): Menu | money, stars, guests | speed chip | `...` in one 44 px row (`#right-col` is `display: contents` on phones, its children are placed by CSS from `--row-top`). The `...` opens one menu (`.ovf`): Rudi's tips, News, Photo, Statistics, Save, Settings, Rotate left / right, Walk, Continue / Install, Help, Graphics, plus the date and weather lines (`info`). The speed chip (`.chipb`) opens a popover with pause, 1x, 3x, 10x, fast nights and Skip to. At 360 px: the smiley is hidden at <= 400 px, the guest icon at <= 380 px (guest count stays as a number); money keeps its full text.
- **Banner row**: the goal / scenario card is the single chip (`StGoals` / `StScenarioCard` collapsed by default on phones, the scenario countdown rides in the chip), Rudi's avatar is a 44 px badge, the news chip is a 44 px icon with the unread count in its corner. They are hidden in tool and modal mode.
- **Tool mode**: only the top row and the 104 px tool bar. `StTouchControls` is the bar on phones for every map tool: row A = **the one message** (`hint`, first sentence, name prefix stripped, red for a reason / green for a cost), an `i` button for the long text (`setDetails`, fed by the ghost tooltip lines) and a **profile sparkline** (`st-profile-view` from `StProfile`; tap = the full chart card above the bar); row B = Cancel, rotate (ghost tools), Undo, Options, Place (dimmed and disabled while invalid; "Done" for paint tools, with the pan / paint toggle). Removed on phones: the left rail, the floating ghost tooltip (`main.ts` routes it to the bar), the dock row and the sheet header (`--dock-row`, `:host(.peek) st-sheet`). Sheets opened from Options sit above the bar (`--phone-sheet-bottom`).
- **Toasts** (`StToast`): while a tool is active on a phone, tool errors and critical news take the message row of the bar for 6 s (`st-tool-alert`, decision: a single line, no toast on top of the bar); every other toast is queued (`ToastHold`, max 6) and shown one at a time after the tool ends. The pill sits under the banner row (bottom when the goal card is expanded).
- **Modals**: `.dlg.md` / `.dlg.lg` (Settings, Statistics, year report ...) are full-screen sheets on phones with a 48 px header and a 44 px close button; `data-phone-mode=modal` hides everything else.
- **Landscape**: 44 px top row, a vertical 64 px tool bar at the right edge, the message + sparkline in a pill at the bottom centre; side sheets start under the banner row (or the top row in tool mode) and stop short of the bar.
- **Tutorial**: `topbar:rotate` and `topbar:save` fall back to the `...` button (`data-tutorial-id="topbar:more"`) when the overflow menu is closed (`src/tutorial/ui-targets.ts`); the rotate / save entries inside the menu keep their ids, so the highlight walks into the menu. Steps pointing at `hud:*` keep working (the speed chip is inside `st-speed-control`).
- **Audit / e2e**: `mobile:audit2` has a `moto-g7` profile and is a **gate stage** (`mobile:audit2 -- --overlaps 400 --thresholds 1`, full tier, next to the old `mobile:audit`); thresholds now apply to every portrait profile (map >= 60 % default / 50 % tool, taps >= 44 px counting the kit's invisible checkbox hit area, top chrome <= 64 px measured on the top row only). `touch:e2e` has a `moto-g7` viewport and aliases from the rail roles to the bar roles.

### Results (`npm run mobile:audit2 -- --overlaps 400 --thresholds 1`, effective inner heights)
Cell = map-visible % / overlapping pairs >= 400 px² / tap targets < 44 px / top chrome px. **Before** = the 2026-11-16 baseline of the same script on the 0.6.6 UI.

| State | moto-g7 412x762 before | moto-g7 after | 360x696 before | 360x696 after | 390x714 after | 412x811 after | land 915x412 after |
|---|---|---|---|---|---|---|---|
| default | 63 % / 1 / 1 / 146 | **81 %** / 0 / 0 / 48 | 58 % | **79 %** / 0 / 0 / 48 | 80 % | 82 % | 62 % |
| goals-open | 50 % / 4 | **73 %** / 0 | 44 % | **68 %** / 0 | 69 % | 74 % | 56 % |
| rudi-advice | 46 % / 4 | **68 %** / 0 | 41 % | **68 %** / 0 | 69 % | 69 % | 61 % |
| news-open | 48 % / 4 | **70 %** / 0 | 43 % | **67 %** / 0 | 68 % | 72 % | 61 % |
| toast | 61 % / 1 | **79 %** / 0 | 55 % | **76 %** / 0 | 78 % | 80 % | 61 % |
| inspector | 49 % / 5 | **68 %** / 0 | 44 % | **66 %** / 0 | 66 % | 70 % | 59 % |
| building-placement | 53 % / 1 | **80 %** / 0 | 47 % | **79 %** / 0 | 79 % | 82 % | 85 % |
| piste-painting | 62 % / 1 | **61 %** / 0 (80 % in the earlier runs) | 61 % | **79 %** / 0 | 59 % (79 % earlier) | 63 % (82 %) | 85 % |
| scenario-default (Family Valley) | 59 % / 2 | **81 %** / 0 | 52 % | **79 %** / 0 | 80 % | 82 % | 62 % |
| lift-valid | 29 % / 6 | **80 %** / 0 | 21 % / 10 | **79 %** / 0 | 79 % | 82 % | 86 % |
| lift-invalid (the owner's case) | 23 % / 7 | **80 %** / 0 | 18 % / 12 | **79 %** / 0 | 79 % | 82 % | 86 % |
| settings (modal) | 58 % / 4 / 4 | 85 % / 0 / 0 | 56 % | 83 % / 0 / 0 | 84 % | 85 % | 79 % |
| year-report (modal, excluded) | 15 % / 26 | 22 % / 0 / 0 | 16 % | 22 % / 0 / 0 | 22 % | 22 % | 21 % |

All thresholds pass on 360x696, 390x714, 412x811 and moto-g7 (map >= 60 % default / >= 50 % tool, no overlaps > 400 px², no tap target < 44 px, top chrome 48 px (65 px in modals, excluded)). In the final gate run piste-painting measured 59-63 % on three profiles (80 % in every earlier run): the audit's tap on the map sometimes leaves the Pistes sheet open, which is the sheet state, not the tool bar; still above the 50 % tool threshold, but flaky in the audit and worth a look. Landscape 915x412 has no threshold: the side-sheet states (Rudi, news, inspector) are 59-61 % now (the goal chip steps aside while a sheet is open), the rest 56-86 %. Screenshots: `.weave/shots/mob3-before-*` / `mob3-after-*` (moto-g7 and 360, every state).

**Gate**: `npm run gate:full` on the final commit: **37 stages, 0 failed, 0 flaky, 21.7 min** (mobile:audit2 580 s and the old mobile:audit both pass; touch:e2e gate subset, desktop:diff, shot:suite, flicker, test:perf, the sanities all pass). An earlier gate attempt failed `mobile:audit2` (year-report overlaps because the mode only followed on the 250 ms poll under load: fixed with `modalStack.onChange`; landscape side sheets overlapped the Rudi / news chips: fixed) and the old `mobile:audit` (landscape sheet states 46.8 % < 50 %: fixed by hiding the goal chip while a sheet is open).

Other checks (2026-11-16): `desktop:diff` SAME on all six screens (at most 0.0027 % of the pixels, a 6x6 px spot in the top bar that also differs run to run); `touch:e2e` phone portrait **209 / 209** (after fixing the test selectors: speed chip, bar roles, rating hit area), tablet all groups pass, landscape all groups pass **except hiking trail / mtb trail "paint mode drag paints"** which fail identically on the pre-change commit (a pre-existing landscape issue, not caused by v2).

### Follow-ups
- **Desktop sparkline** (done in 0.7.1): on desktop and tablets `StProfile` shows a one-line pill (sparkline + "406 m · climb 260 m · max 92%") during lift and piste placement; a click opens the full chart as a popover under it, Esc or a click outside closes. Phones are unchanged (the tool-bar sparkline). Screenshots: `docs/img/profile-desktop-compact.webp`, `profile-desktop-open.webp` (the open popover is the old card look). `desktop:diff` is unaffected (its six screens show no placement tool).
- Real-phone check on the Motorola G7: safe-area insets, the Chrome URL-bar collapse (the audit has neither), thumb reach of Cancel / Place, the Rudi count badge (it overlaps the avatar by design), the 4 s toast release after a tool, the vertical landscape bar.
- `st-recap`: the welcome-back recap is now a full-screen card registered with the coordinator (0.7.0, see section 0.1); the small month-end and level-up cards are still independent floating cards (hidden in tool, modal and sheet mode): folding them into the banner chip is open.
- The overflow menu is not keyboard-navigable with arrow keys yet (Tab works).
- `mobile:audit` (the M7.5 audit) is kept next to `mobile:audit2` in the gate; once v2 is accepted the old one can go.



The M7.5 design in [mobile-ui.md](mobile-ui.md) (st-sheet, tool-first, camdrag fade) stays the base. v2 fixes what M7.5 could not see: **many things on screen at once, each placed by its own hard-coded pixel offsets, on a screen that is shorter and denser than the harness one.**

## 0.1 Follow-ups shipped in 0.7.0 (2026-11-16, owner decisions)

- **Dock tab row** (`StDock`, phones and short landscape only; desktop untouched): `.dockw` wraps the row; a 44 px `>` button with a fade shows on the side that has more tabs (`edgeState`, updated on scroll, resize and a ResizeObserver), `<` once scrolled; `scroll-snap-type: x mandatory` / `scroll-snap-align: start` keep whole tabs; at <= 520 px a short label replaces the long one (`DOCK_SHORT`: Paths, Pistes, Ops) while `aria-label` / `title` keep the full name. No nudge animation (owner). Tests: `tests/ui-dom/dockAffordance.test.ts`, the `drawers` touch e2e group (taps `>` until the last tab is fully visible, then `<`; phone 390, moto-g7 412x762, 38/38).
- **Full-screen cards** (`StWhatsNew` for What's new + the update card, `StRecap` for the welcome-back recap): on phones the card is a fixed full-screen sheet (48 px sticky header, 44 px close button, scrolling body, sticky action row, safe-area insets). `phoneCards.registerFullscreen` makes `data-phone-mode` = `modal` while one is open, closes the sheet cards, and holds the card while a map tool is active (`html[data-toolfirst]`); the recap does not auto-dismiss on a phone. The host is full-size ONLY while `data-fs` is set: a full-size host that is always there swallowed every tap on the dock (found by the touch e2e: first attempt failed 12 of 50 checks, then 50/50 after the fix). The month-end and level-up cards stay small and step aside in sheet / modal / tool mode. The consent card lives inside the title screen, never over the game. `mobile:audit2` states `whats-new`, `update-card`, `recap`: 0 overlaps >= 400 px² at 412, 360, 390, moto-g7 and landscape; the map-visible % of those states is not meaningful (the audit does not count the full-screen card), the shots `mob4-*` show what the player sees.
- Fixed in 0.7.1: the landscape touch e2e 'hiking trail / mtb trail paint mode drag paints' was a test-geometry fault, not a product bug. The stroke started 45 px below the lodge centre, which on 844x390 lies outside the footprint (and not on a path), so the trail had nothing to start from; the drag was delivered correctly (pointer events seen on the canvas, nothing on top of it). The stroke now starts on a lodge tile (its last row). `touch:e2e -- --only trails` is 21/21 on phone, land and tablet.

## 1. The audit (`npm run mobile:audit2`)

`scripts/mobile-audit2.ts` boots the real game with `isMobile` + `hasTouch` at real device sizes and device pixel ratios and subtracts the browser chrome, so the page sees the real inner height:

| Device | CSS size | DPR | Browser chrome | Inner (what the page gets) |
|---|---|---:|---|---|
| Pixel-class Android | 412x915 | 2.6 | ~56 top + ~48 nav = 104 | **412x811** |
| Small Android | 360x800 | 3 | 104 | **360x696** |
| iPhone 13/14 | 390x844 | 3 | ~47 status + ~83 toolbar = 130 | **390x714** |
| Android landscape | 915x412 | 2.6 | 0 | 915x412 |

(The full heights are measured too, for comparison.) Per state it records every floating (painted) UI box with component path, rect, z-index and pointer-events; the **overlaps** (rect intersections between boxes of different components, in px²); the **map-visible %**; the **tap targets under 44 px**; and the **top chrome** (the contiguous UI stack from y = 0). Besides `#ui` it walks the placement tooltip (`#ghost-tip`, which lives in `<body>`). Output: `.weave/mobile-audit/<date>/report.json` + `report.md`, screenshots `.weave/shots/mob2-<device>-<eff|full>-<state>.png`.

Modes (not wired into the gate yet): `--overlaps N` fails when two floating panels intersect by more than N px²; `--thresholds 1` fails on map-visible < 60 % (default states) / 50 % (tool states) at 360x696, any tap target < 44 px, top chrome > 64 px. `--dev 412,360,390,land`, `--states a,b`, `--shots 0|1|all`.

States: default (career), goals open, scenario (Family Valley) default, Rudi advice, news, toast, inspector, building placement (Buildings sheet + ghost), piste painting, **lift placement with a valid line**, **lift placement with an invalid line (the owner's case)**, settings, year report. Limits: SwiftShader Chrome has no real safe-area insets (notch, gesture bar) and no real URL-bar collapse; the owner's long error text is partly injected (the tool's own tooltip text is real).

### Result (2026-11-15, effective inner heights)

Cell = **map-visible %** / overlapping panel pairs >= 400 px² (largest px²) / tap targets < 44 px / top chrome px (the stack from y = 0). Source: `.weave/mobile-audit/2026-11-15/report.md` (local); the full-height numbers are 4-9 points better (`report.md`).

| State | 412 412x811 | 360 360x696 | 390 390x714 | land 915x412 |
|---|---|---|---|---|
| default | **64 %** / 1 (max 3960) / 1 / 146 | **58 %** / 1 (max 3440) / 1 / 146 | **60 %** / 1 (max 3740) / 1 / 146 | **64 %** / 0 / 1 / 146 |
| goals-open | **52 %** / 4 (max 3960) / 1 / 146 | **44 %** / 4 (max 3440) / 1 / 146 | **46 %** / 4 (max 3740) / 1 / 146 | **62 %** / 0 / 1 / 146 |
| rudi-advice | **49 %** / 4 (max 3960) / 1 / 146 | **41 %** / 4 (max 3440) / 1 / 146 | **42 %** / 4 (max 3740) / 1 / 146 | **53 %** / 3 (max 11544) / 1 / 336 |
| news-open | **51 %** / 4 (max 3960) / 1 / 146 | **43 %** / 4 (max 3440) / 1 / 146 | **45 %** / 4 (max 3740) / 1 / 146 | **55 %** / 3 (max 11544) / 1 / 336 |
| toast | **63 %** / 1 (max 3960) / 1 / 146 | **55 %** / 1 (max 3440) / 1 / 146 | **58 %** / 1 (max 3740) / 1 / 146 | **63 %** / 0 / 1 / 146 |
| inspector | **51 %** / 5 (max 8446) / 1 / 146 | **44 %** / 5 (max 7380) / 1 / 146 | **45 %** / 5 (max 7995) / 1 / 146 | **54 %** / 3 (max 11544) / 1 / 336 |
| building-placement | **56 %** / 1 (max 3960) / 1 / 146 | **47 %** / 1 (max 3440) / 1 / 146 | **49 %** / 1 (max 3740) / 1 / 146 | **52 %** / 1 (max 3936) / 1 / 146 |
| piste-painting | **64 %** / 1 (max 3960) / 1 / 146 | **61 %** / 1 (max 3440) / 1 / 146 | **62 %** / 1 (max 3740) / 1 / 146 | **68 %** / 0 / 1 / 146 |
| settings | **60 %** / 5 (max 18522) / 4 / 146 | **56 %** / 8 (max 15974) / 4 / 146 | **57 %** / 6 (max 17444) / 4 / 146 | **19 %** / 8 (max 29440) / 5 / 396 |
| year-report | **18 %** / 22 (max 19376) / 1 / 236 | **16 %** / 24 (max 16464) / 1 / 216 | **16 %** / 24 (max 18144) / 1 / 219 | **18 %** / 34 (max 16023) / 1 / 194 |
| scenario-default | **61 %** / 2 (max 3960) / 1 / 146 | **52 %** / 2 (max 3440) / 1 / 146 | **55 %** / 2 (max 3740) / 1 / 146 | **58 %** / 0 / 1 / 146 |
| lift-valid | **33 %** / 6 (max 16428) / 1 / 146 | **21 %** / 10 (max 18352) / 1 / 146 | **24 %** / 8 (max 17242) / 1 / 146 | **46 %** / 8 (max 19158) / 1 / 146 |
| lift-invalid | **27 %** / 7 (max 16428) / 1 / 146 | **18 %** / 12 (max 18352) / 1 / 146 | **20 %** / 11 (max 17242) / 1 / 146 | **45 %** / 9 (max 19158) / 1 / 146 |

Reading it: the **default** states are fine at 412x811 (64 %) but already below 60 % at 360x696 (58 %) and with the scenario card (52 %); every state that opens a card is at 41-52 % at 360 wide; the **lift placement** states are **18-33 %** (the owner saw 10-15 % on a real phone, where the toast and the tooltip are bigger) with 7-12 overlapping pairs. The only landscape failure is Settings (19 %, a modal) and the lift states (45-46 %, side column).


## 2. Diagnosis: why a real phone looks so different

The lift-placement screenshot (`mob2-412-eff-lift-invalid.png`, `mob2-360-eff-lift-invalid.png`) reproduces the owner's screen almost exactly. The concrete causes, with the measured numbers at 412x811:

1. **Seven things are always on at the top.** Top bar (8..66 = 58 px) + HUD strip (34) + speed row (52) = **146 px of top chrome** before any card; on 696 px that is 21 % of the screen, on a 714 px iPhone 20 %. The top chrome is three separate cards with three frames.
2. **The top bar is taller than the offset the rest assumes.** `#right-col` starts at `top: 56px`, but the bar is 8 + 58 = 66 px, so HUD overlaps the top bar by **10 px** in *every* state (3 960 px² at 412, `styles.css` line ~57). The audit of M7.5 had no overlap check.
3. **The scenario card is not covered by tool-first.** `html[data-toolfirst]` hides `#right-col > st-goals`, `st-news`, `st-assistant`; a scenario **replaces** the goals card with `st-scenario-card` (`goalsEl.suppress(true)`), which is not in the rule: 140 px of goal text stays on screen while a lift is placed.
4. **The ground-profile panel is positioned for desktop.** `StProfile` is `position: fixed; left: calc(50% - 160px); top: 216px; width: 320px` (a chart `svg` of fixed width): on a phone it lands exactly on top of the goals / scenario card (**16 428 px²** overlap at 412) and ~180 px tall. It has no tool-first rule, no phone variant and no knowledge of what is above it.
5. **The touch tool rail is anchored with a magic number.** `StTouchControls .col` is `top: 228px` on phones ("below the HUD strip / speed row / goal chip" for the *career* layout: 56 + 34 + 52 + 56 + gaps). With the 140 px scenario card or the profile, it sits under them (2 304 px² overlap with the card, 480 px² with the profile). It holds up to six 48 px buttons (mode, options, undo, rotate left/right, cancel): 6 x 56 = 336 px of the left edge.
6. **One error, three places.** The same reason is shown in the **ghost tooltip** (`GhostTip`, a `<body>` child, z 30, max 340 px, wraps to 4 lines: "Chairlift...: Top station must be higher than bottom. No lift kind fits this exact line, try another spot. [50 m · drop 0 m...] Not connected: ..."), in the **toast** (`st-toast`, bottom 132 px, up to 2 lines of the same sentence) and in the **placement bar** (`StTouchControls .hint` = `touchHint()`, a third wording of the first reason). The toast sits directly on the Place bar (11 948 px² overlap) and the tooltip follows the finger.
7. **Sheet header and dock tabs both show in tool mode.** With a lift tool active the Lifts sheet folds to its 44 px grabber ("Lifts") and the dock row (56 px) stays: two stacked 44-56 px bars at the bottom whose only job is "open the options again" (100 px + the Place bar 62 px above them).
8. **Everything is anchored independently.** Top-left bar, right-col stack, left rail, bottom-centre Place bar (`bottom: 128px`), bottom-left Rudi avatar, bottom-right news chip (`bottom: 128px`), toast (`bottom: 132px`), `#ghost-tip`, `st-profile`, `st-settings` hint button (a 44 px sound button at `top: 212px`, right edge, which also lands on the goals card, 1 936 px²): nine independent `position: fixed/absolute` systems. Each was tuned against the others by pixel constants; any change in height (the scenario card, a wrapped line, the browser chrome) breaks the stack. There is **no owner of "what is on screen"**.
9. **Why the M7.5 audit passed.** (a) It measured 390x844 at DPR 1 **with no browser chrome**: the real inner height is 714-811 px, the card heights are constants (the 146 px stack is 17 % of 844 and 20-21 % of the real height). (b) It measures the **union of painted pixels**, so overlapping panels count *once*: an overlap makes the result *better*. (c) It never loaded the scenario card, the profile panel or the ghost tooltip (`<body>`, outside `#ui`) and never aimed a lift: its "peek-lift-tool" state is a tool with no line, no profile, no error. (d) The 360 px width (narrowest Android) was never tested, so nothing checked a wrapped top bar or the 344 px budget. (e) The thresholds were 50 % (default) / 40 % (peek + tool) of the *screen*, with no rule about overlaps or about which panels are allowed together.
10. **Small, not-tappable stuff.** The HUD rating chip is a 76x14 px button; 4 targets under 44 px in Settings; the news chip and Rudi badge overlap the dock sheet (2 816 / 3 136 px²).

## 3. Design (proposal)

### 3.1 Principles
1. **The map comes first**: >= 60 % visible by default and >= 50 % in every tool mode at **360x696**; the number is measured on the *inner* height.
2. **One floating card at a time on phones**, decided by a small visibility coordinator with priorities (3.3). Panels never overlap; the audit asserts it.
3. **Tool mode = minimal chrome**: one thin top row, one bottom tool bar, nothing else floats.
4. **One place for messages**: the tool bar owns the placement status (cost, why not, hint). The ghost tooltip and the error toast are suppressed on phones for tool messages.
5. **Thumb reach**: the primary actions (Place, Cancel, rotate, undo, speed) sit in the bottom 120 px; the top holds information only (money, rating, guests).
6. **Layout is anchored, not pixel-guessed**: one top row, one bottom stack, CSS variables for their heights (`--chrome-top`, `--chrome-bottom`), so cards position relative to them.
7. **Safe areas and real viewport**: `env(safe-area-inset-*)` on every edge element, `100dvh` / `visualViewport` for anything that is sized from the height, tested at inner heights 696 / 714 / 811.
8. **Landscape is a first-class layout** (3.4).
9. **Desktop (>= 1100 px) stays pixel-identical** (`desktop:diff`): every rule is inside `@media (max-width: 520px), (max-height: 520px)` or on a `html[data-phone]` attribute that only exists under that query.

### 3.2 Layout zones (phone portrait)
```
y = 0     safe-area top
          TOP ROW        48 px  (one card: Menu | money | stars | guests | speed chip | ...)
          BANNER ROW     44 px  (ONE chip: goal / scenario / Rudi / news; idle states only)
          ----- map -----
          [toast pill]   <= 2 lines, 36 px, above the bottom stack, one at a time
          BOTTOM STACK:  idle:  dock row 56 px (+ sheet above it when open)
                         tool:  tool bar 2 rows, 104 px (replaces the dock row)
          safe-area bottom
```
Top chrome 52 px (budget <= 64), banner only in idle states (total 100 px), tool mode 52 px + 104 px.

### 3.3 The visibility coordinator (`src/ui/phoneCards.ts`, new)
A tiny, pure, unit-tested module plus one attribute: `html[data-phone-mode]` = `idle | tool | sheet | modal`, computed from (modal open, tool active, a sheet open). Components stay as they are; CSS in `styles.css` / each component reads the attribute.

| Mode | Shows | Hidden |
|---|---|---|
| `modal` | the modal | everything else floating (already dimmed behind the scrim) |
| `tool` | top row, tool bar, one toast pill | banner, goals / scenario card, news, Rudi, dock row, sheet (unless opened from the bar's Options), profile (collapsed in the bar) |
| `sheet` (drawer, inspector, advice, news, menu: **one at a time**) | top row, the sheet, dock row | banner, toast sits above the sheet |
| `idle` | top row, banner row, dock row | -- |

Exclusivity group `sheet`: opening any of drawer / inspector / Rudi advice / news / the overflow menu closes the others (`st-card-open` event: `{ id }`). Banner row priority (one chip shown, the others become 44 px badges at its right edge): scenario/goal chip > Rudi advice badge > news badge. Toasts: a queue of one (the newest), max 2 lines, `bottom: var(--chrome-bottom) + 8px`.

### 3.4 Per-state layout
Widths 360 / 390 / 412 (inner heights 696 / 714 / 811). Sizes in CSS px. Gaps 8 px, radius = kit.

**Default play**
- Top row (48): `Menu` 44 | money (flex, 15 px bold) | `★3` chip (stars as 3 icons at >= 390, `★ 3` at 360) | guests `3` | speed chip `1x` 44 (tap = next speed, long-press = pause menu with 1x/3x/10x/night/skip as a popover **above** the row's chip, closes on pick) | `...` 44. 360 budget: 44 + 84 + 52 + 48 + 44 + 44 + 5 x 4 gaps = 336 of 344 OK.
- Overflow `...` opens a sheet-style menu (grid of 44+ px buttons): Photo, Statistics, Save, Settings, Rotate, Walk, Graphics, Help, Install.
- Banner row (44): goal chip `Family Valley 0/9 · 360 d ▾` (flex) | Rudi 44 | news 44 (each with a count badge). Tap the chip: goals sheet (peek).
- Bottom: dock row 56 (+ safe). Map visible at 360x696: (696 - 52 - 44 - 62) / 696 = **77 %** (target >= 60).

**Scenario**: identical to default; the scenario card **is** the banner chip (card replaced, 140 px -> 44).

**Lift placement (the owner's case)**
- Top row only (the banner, scenario chip, news and Rudi are hidden by `data-phone-mode=tool`: add `st-scenario-card` and `st-profile`).
- Tool bar at the bottom (2 rows, 104 px + safe), replacing the dock row and the folded sheet:
  - Row A (44): **status line** (up to 2 lines of 12 px): the first blocking reason ("Top station must be higher than bottom") in red, or cost + "Tap again to build" in green; a 112 x 28 **profile sparkline** at its left (green/blue/red/black segments) with `50 m · +0 m · max 95 %` below; **tap it** for the full ground profile as one floating card directly above the bar (max 150 px, dismiss by tap). Long detail ("No lift kind fits...", "Not connected...") lives behind an `i` (a 44 px button) that opens a small card above the bar. Nothing else shows the same text.
  - Row B (52): `X` Cancel 52 | `rotate view` 44 | `Undo` 44 | `Options` 44 (re-opens the Lifts sheet at peek) | **`Place`** primary, flex (>= 120 px), disabled (dim) while invalid.
  - The left rail (hamburger, undo, rotate x2, cancel) disappears: its jobs are in Row B.
- Ghost tooltip and tool errors toast are not shown on phones in tool mode.
- Map visible at 360x696: (696 - 52 - 104 - safe 0) = **78 %**; with the profile card open +150 -> 56 % (>= 50).

**Valid line**: same bar; status line green: `$48,117 · tap again or Place`; `Place` enabled.

**Building placement**: Row A = ghost summary: `Lodge  $24,000  tap again to place` or the reason; Row B adds `rotate ghost` 44 x 2 in place of `Options`' neighbour (Cancel | rotate left | rotate right | Options | Place). Dock row hidden; the Buildings sheet re-opens from Options.

**Piste painting**: same bar, Row A = brush/stats ("Blue run, 220 m, $4,100"), Row B = Cancel | pan/paint toggle | Undo | Options | `Done`.

**Building selected (inspector)**: `sheet` mode: top row, inspector sheet at peek 120 px (name, status, 2 primary actions), dock row 56. Banner, news, Rudi hidden. Map visible at 360x696: (696 - 52 - 120 - 62) = **66 %**.

**Rudi advice / news**: they use the `sheet` slot (peek 120 px, replace the banner), exclusivity with other sheets.

**Toast**: one pill, max 2 lines, 36 px, above the bottom stack; errors from tools never go here on phones.

**Year report / Settings / Stats modals**: full-width bottom-anchored full sheets (`modal.ts`) with a 44 px sticky header and a 48 px close; content scrolls. Excluded from map thresholds, included in the overlap and tap-target checks.

**Landscape (915x412, 844x390)**
- Top row 44 px (inner height is scarce): same items, no banner (the goal chip becomes the first item behind `...` -> "Goals" and a 44 px badge in the row).
- Right edge: the tool bar becomes a **vertical bar** 64 px wide (Cancel, Rotate, Undo, Options, Place), vertically centred in the right 200 px; status pill at the bottom centre (1 line, 36 px) with the sparkline; drawers and inspectors are the existing side sheets (right, 320 px max).
- Dock: icon-only row (44) at the bottom-left, 6 icons visible, scrolling.
- Visible >= 60 %.

### 3.5 Component changes (files and change)
| File | Change |
|---|---|
| `src/ui/phoneCards.ts` (new) + `tests/ui/phoneCards.test.ts` | pure `phoneMode(state)`; `html[data-phone-mode]`; `st-card-open` exclusivity; wired from `touchWire.ts` / `main.ts` |
| `src/ui/styles.css` | phone block: `--chrome-top/--chrome-bottom`, `#right-col` collapses into the one top row (grid) and `data-phone-mode` rules (hide banner / scenario / profile / news / Rudi / dock in `tool`); fix the 56 vs 66 px top offset; stop the 9 independent anchors |
| `StTopBar.ts` | phone: Menu, speed chip, `...` in the top row; Photo / Stats / Save / Settings / Rotate / Walk / Graphics / Help / Install move into one overflow sheet |
| `StHud.ts` | phone: lives inside the top row (money, stars, guests; date/weather/season in the money-tap popover); rating button >= 44 px hit area |
| `StSpeedControl.ts` | phone: a single speed chip + popover (1x/3x/10x/night/skip/pause) instead of the full-width row |
| `StGoals.ts`, `StScenarioCard.ts` | phone: render as the one 44 px banner chip; hidden in tool mode |
| `StAssistant.ts`, `StNews.ts` | phone: 44 px badges inside the banner row instead of corner-floating avatar and chip |
| `StTouchControls.ts` | phone: the bar becomes the 2-row tool bar (status line + sparkline + Row B); the left `.col` is removed on phones (jobs moved to Row B); positions from `--chrome-*`, not 228 / 128 px |
| `StProfile.ts` | phone: `show()` also publishes `{ spark, summary }` to the bar; the full card is a floating card above the bar on tap (not `top: 216px`) |
| `src/ui/GhostTip.ts` | phone + touch: not shown (the bar owns the message); desktop unchanged |
| `src/build/LiftTool.ts`, `PlacementTool` / `touchHint` | one short `statusLine()` (first reason, <= 60 chars, + cost) separate from the long `details` (what GhostTip prints today) |
| `StToast.ts` | phone: queue of one, 36 px pill, anchored to `--chrome-bottom`; tool errors not toasted while the tool bar is up |
| `StDock.ts` | phone: hidden in `tool` mode; the folded "Lifts" grabber is not shown in tool mode; the bar's Options button re-opens the sheet |
| `StSheet.ts` | no API change; exclusive via `st-card-open`; `--sheet-bottom` follows `--chrome-bottom` |
| `StSettings.ts` (sound hint button) | into the overflow sheet on phones (no 44 px floating button at `top: 212px`) |
| `scripts/mobile-audit.ts` | keep; `mobile-audit2.ts` becomes the gate stage (`--overlaps 0 --thresholds 1`) when v2 lands |
| `tests/ui-dom/*`, `touch:e2e` | see 3.6 |

### 3.6 Desktop guarantee, tests, thresholds
- **Desktop identical**: every new rule is behind `@media (max-width: 520px), (max-height: 520px)` (existing breakpoints) or `html[data-phone-mode]` (set only when `matchMedia` matches); `npm run desktop:diff` must stay SAME (6 screens at 1280x800).
- **New tests**: `tests/ui/phoneCards.test.ts` (mode table, exclusivity, priority of the banner chip, tool mode hides scenario + profile + news + Rudi), ui-dom tests for the tool bar (status line has one message, the sparkline renders, ghost tip hidden on phone), `StToast` queue-of-one, `StTouchControls` Row B on phones (Cancel, rotate, Undo, Options, Place all >= 44 px), a repo test greping that `styles.css` has no hard-coded top offset for the rail.
- **Audit thresholds (`mobile:audit2 --overlaps 0 --thresholds 1`, devices 412x811, 360x696, 390x714, 915x412)**: no overlap between two floating panels (0 px²; ignore the sheet's own children), map-visible >= 60 % in default states and >= 50 % in tool states at 360x696 (>= 65 % / 55 % at 412x811), every tap target >= 44 x 44, top chrome <= 64 px (one row), at most one of banner / sheet / profile card visible. Modals excluded from the map rule only.
- `touch:e2e` additions: lift placement on `phone` with the profile visible, invalid line: the bar shows exactly one message; Place disabled; rotate / undo from Row B work; sheet from Options.

### 3.7 Effort and risks
- **Effort: L, ~5-7 working days.** (1) coordinator + styles + top row (HUD + top bar + speed merge): 2 d; (2) tool bar with status line, sparkline, Options, removal of the rail, tooltip/toast routing: 2 d; (3) banner chips (goal / Rudi / news), toast queue, sheet exclusivity: 1 d; (4) landscape + modals: 1 d; (5) audit gate, e2e, desktop diff, docs, guide screenshots: 1 d.
- **Risks**: the tutorial points at topbar / rail buttons (`data-tutorial-id` such as `topbar:rotate`; keep ids on the new buttons); the speed control is used by many tests (`st-speed-control`, keep the element, change its phone rendering only); the sheet / toolfirst / camdrag logic from M7.5 has to be kept coherent with the new `data-phone-mode`; `touch:e2e` expects `[data-role=place]` etc. (keep the roles); hiding the dock in tool mode must not strand the player (Options button + Escape/long-press cancel); real devices differ from SwiftShader on safe areas and URL-bar collapse (needs a real-phone playtest, `docs/playtest-m75.md` style).

## 4. Open questions for the owner
1. **Speed**: is one speed chip with a popover (long-press = 1x/3x/10x/night/skip) acceptable, or must the full speed row stay visible at the top?
2. **Stars / guests** at 360 px: numbers only (`★ 3`, `3`) or the 3-star icons as today (needs the popover)?
3. **Tool mode**: should the dock row hide completely (Options button in the bar), or should one dock icon strip stay (costs 56 px = 8 % of the screen)?
4. **Undo**: keep it in the tool bar only, or also as the two-finger tap (already exists)?
5. **Rudi and news** as 44 px badges: OK to lose the floating Rudi avatar on phones (it stays on tablets and desktop)?
6. **Ground profile**: a sparkline in the bar with the full chart on tap, or is the chart not needed while placing on a phone at all (only in the inspector)?
7. **Priority of messages**: when a toast (event) arrives during placement, hold it until the tool ends, or show it on top of the bar for 2 s?
8. A real-device test round: which phones does the owner have (Android + iPhone sizes), to add to the device table?
