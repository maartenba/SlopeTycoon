# Mobile UI: phones show the map (M7.5)

The owner's problem: on a phone, panels covered the game. This document is the audit (before and after), the `st-sheet` component, the breakpoints, and how to add a panel that behaves on a phone. Desktop (>= 1100 px) is unchanged, and checked: `npm run desktop:diff`.

## The rule
> **The map comes first.** On a phone, no default state may cover more than half of the screen, and with a drawer at its peek height and a tool active at least 40 % must stay uncovered. `npm run mobile:audit` asserts it and fails otherwise.

## How the audit measures (`scripts/mobile-audit.ts`)
`npm run mobile:audit [-- --label NAME --vp phone,land,tablet --only default,inspector --shots 0]` boots the real game with touch emulation at three viewports (phone 390x844, phone landscape 844x390, tablet 768x1024), drives every panel into view and measures the **map-visible share** = the part of the viewport not painted over by the UI.

- The UI is walked through every shadow root. An element counts as *painted* when it has a visible background (alpha >= 0.25 or an image), or is an `img`, `svg` or `canvas`. Its rectangle goes into a union (a 4 px raster); its children are not counted again. Elements bigger than 85 % of the screen (modal scrims) are skipped and their children counted instead.
- Per-panel numbers are the same measure per top-level panel (`right-col>st-hud`, `st-topbar`, `st-dock`...), in the default state.
- The result is a table in the console, `.weave/audit/<label>.md/.json`, and one screenshot per state and viewport: `.weave/shots/m75-<label>-<viewport>-<state>.png`.
- **Asserted** (exit code 1): every *default* state (default, goals open, Rudi's advice open, news open, toasts, inspector) >= 50 %, and the three *peek* states (a drawer at peek and a building / lift / terrain tool active) >= 40 %.
- **Reported only**: an open drawer (the player asked for it), and modals (Settings, Statistics, Year report, update card): a modal blocks the map by design. The title screen with the consent card is also reported.
- Limits: it measures what is painted, not what is *useful* (a transparent panel that eats touches counts as free; the sheets are built so that cannot happen: `pointer-events` only on the sheet). The `help` row cannot be reached on a phone through the harness (the `?` lives in the top bar's overflow row, `st-help`'s own button is hidden there), so it only repeats the default.

## Audit: map visible, before -> after (%)
Before = 0.3.2 (the baseline run), after = this change. Phone 390x844, landscape 844x390, tablet 768x1024.

| State | Phone 390x844 | Landscape 844x390 | Tablet 768x1024 |
|---|---:|---:|---:|
| title-consent | 39 -> **39** | 75 -> **75** | 74 -> **74** |
| default | 60 -> **65** | 48 -> **61** | 78 -> **78** |
| goals-open | 47 -> **57** | 47 -> **59** | 72 -> **72** |
| rudi-tip | 37 -> **51** | 33 -> **52** | 69 -> **69** |
| news-open | 43 -> **53** | 33 -> **52** | 72 -> **72** |
| toasts | 57 -> **64** | 40 -> **59** | 75 -> **75** |
| inspector | 31 -> **54** | 47 -> **51** | 58 -> **58** |
| drawer-buildings | 29 -> **45** | 15 -> **52** | 63 -> **58** |
| drawer-lifts | 34 -> **45** | 15 -> **52** | 63 -> **62** |
| drawer-paths | 29 -> **45** | 13 -> **52** | 63 -> **61** |
| drawer-pistes | 18 -> **45** | 13 -> **52** | 45 -> **50** |
| drawer-terrain | 36 -> **49** | 12 -> **54** | 62 -> **60** |
| drawer-landscape | 32 -> **49** | 14 -> **54** | 62 -> **62** |
| drawer-view | 40 -> **45** | 16 -> **52** | 63 -> **63** |
| drawer-finance | 23 -> **45** | 18 -> **52** | 50 -> **50** |
| drawer-ops | 47 -> **45** | 26 -> **52** | 67 -> **67** |
| drawer-marketing | 23 -> **45** | 18 -> **52** | 48 -> **50** |
| drawer-pricing | 23 -> **45** | 18 -> **52** | 54 -> **54** |
| peek-building-tool | 52 -> **61** | 39 -> **57** | 74 -> **74** |
| peek-lift-tool | 54 -> **64** | 40 -> **59** | 75 -> **75** |
| peek-terrain-tool | 25 -> **68** | 46 -> **64** | 77 -> **78** |
| settings | 52 -> **59** | 13 -> **16** | 13 -> **13** |
| statistics | 33 -> **32** | 8 -> **14** | 53 -> **53** |
| help | 60 -> **66** | 48 -> **61** | 77 -> **77** |
| year-report | 16 -> **16** | 14 -> **17** | 6 -> **6** |
| update-card | 15 -> **16** | 9 -> **13** | 6 -> **6** |

\* the baseline run of the update card was polluted (the Year report stayed open over it, which the script now closes; but a game that jumps to the year end re-opens it, so the *Year report* row above is the one that is real); the *after* numbers for the update card come from a clean run with `--only update-card`.

Reading the table:
- **Default** on the phone was 60 % (it passed already), the landscape phone 48 % (failed); after: 65 % and 61 %. The real damage was everything the player opens: drawers, the inspector, Rudi's advice, the news, and *the drawer staying open over the map while a tool is active* (a terrain brush with its drawer covered 75 % of the screen).
- Open drawers at a phone are reported at their **peek** height (the default when opened): 45 % on a phone, 52 % on a landscape phone. Dragging a sheet up trades map for room, the player's choice.
- Tablets keep the old drawers and only get a height cap (about 40-44 % of the screen), so their numbers are close to before.
- Modals stay large on purpose; Settings on a landscape phone (17 %) and the Year report (16 %) are the extreme ones. They are dialogs the player closes.

### Panel footprint in the default state (% of the screen each panel paints, before -> after)
| Panel | Phone | Landscape phone |
|---|---:|---:|
| HUD | 6.5 -> **4.1** | 7.5 -> **3.3** |
| Speed control | 9.0 -> **6.4** | 10.1 -> **5.1** |
| Tool status line | 2.0 -> 0 (hidden on phones) | 0 |
| Goals card | 4.2 -> 6.8 (one full-width chip row) | 4.7 -> 4.7 |
| Top bar | 6.8 -> 6.8 (one row, was a sideways-scrolling row of 9 buttons) | 12.8 -> **6.1** |
| Dock row | 6.8 -> 6.8 | 15 -> 15 |

## What changed per panel
| Panel | Phone portrait (<= 520 px wide) | Phone landscape (<= 520 px high) | Tablet / desktop |
|---|---|---|---|
| Dock drawers (Buildings, Lifts, Paths, Pistes, Terrain, Landscape, View, Finance, Operations, Marketing, Pricing) | Bottom **sheet** above the dock row. Opens at **peek** (grabber, tab strip, one row of compact cards); drag up for half / full. A tool chosen -> the sheet folds to its grabber; tap or drag the grabber (or a dock button) to bring the cards back. | **Side sheet** on the right (grabber on its left edge); the cards wrap into a grid. | Unchanged (a plain drawer), tablets capped at about 40-44 % of the height. |
| Inspectors (building, lift, piste, backcountry route, guest) | Sheet at peek (name + first lines); drag up for the rest | same, as a side sheet | unchanged |
| Rudi's advice card | Sheet at peek (heading + first tip) instead of a 340 px card | side sheet | unchanged |
| News / reviews panel | Sheet at peek (the chip stays at the bottom right) | side sheet | unchanged |
| Top bar | One row: Menu, Photo, Statistics, Save, Settings, `...`. The `...` button opens a second row: Rotate, Walk, Graphics, Continue, `?`, Install, Offline | same | unchanged (everything in one bar) |
| HUD card | One-line strip (money, stars, guests) + a 44 px arrow that expands date / weather / season for 8 seconds | same | unchanged |
| Speed control | One row of icon buttons (pause, 1x, 3x, 10x, night, skip); the date lives in the HUD arrow | same | unchanged |
| Goals card | One row (header + level chip), starts collapsed, capped at about 22 % of the height when open | same | unchanged |
| Toasts | Small, **one at a time** (the newest), above the dock row | same | unchanged (top centre stack) |
| Cards (goals, news, Rudi, the HUD column) | **Fade out while a finger drags the map** and come back on release (opacity only, no layout shift) | same | unchanged |
| Tool-first mode | While a placement / lift / paint tool is active the goals chip, news chip and Rudi badge are hidden (`html[data-toolfirst]`); the HUD strip, speed row and the touch tool bar (Place / cancel / undo / rotate) stay | same | unchanged |
| Modals (Settings, Statistics, Year report, update card) | Unchanged (they are dialogs) | Unchanged | unchanged |

## The sheet component: `st-sheet` (`src/ui/components/StSheet.ts`)
```html
<st-sheet label="Buildings" key="dock-buildings" peek-h="196">
  ...any content (slotted)...
</st-sheet>
```
- **A passthrough where it does not apply.** `media` (default `(max-width: 520px), (max-height: 520px)`) decides: when it does not match the element is `display: contents` with no handle, no ARIA and no size. That is why the desktop layout is pixel-identical. `side-media` (default `(max-height: 520px) and (min-aspect-ratio: 1/1)`) selects the **side** layout. `media="all"` / `"never"` force it (tests).
- **Snap states** `peek` / `half` / `full` (attribute `snap`, property `snap`, `setSnap()`, `cycle(+1|-1)`, `collapse()`). Sizes: peek = `peek-h` (default 132 px; the dock uses 196, the inspectors 120), half = 40 % of the viewport, full = the viewport minus 76 px. Event `st-sheet-snap` (`detail: { snap, size }`).
- **Handle**: a 44 px tall (side: wide) `button` (the grabber). Pointer events (mouse, touch, pen) drag it; release uses `resolveSnap()` (pure, tested): a fling faster than 0.5 px/ms moves one snap (two if it started past the next one), otherwise the snap nearest to the projected size wins. A plain tap toggles peek <-> half. `touch-action: none` on the handle.
- **Content drag with scroll chaining** (touch): a swipe on the content that goes *up* grows the sheet until it is `full`, then the content scrolls; a swipe *down* scrolls the content to its top first, then folds the sheet; a first move that is mostly *sideways* is left to the browser (card rails, tab strips). The decision is made once per gesture (`touchmove` is non-passive only for the sheet's own drags).
- **Keyboard**: the handle is focusable (`tabindex=0`); ArrowUp / ArrowDown (Left / Right in a side sheet) cycle the snaps, Home = peek, End = full; **Escape** inside the sheet collapses one step (and is swallowed; at peek it passes on to the host's own handler).
- **ARIA**: the layer has `role="dialog"` `aria-modal="false"` `aria-label` (the `label` attribute), the handle has `aria-expanded` (true unless peek) and `aria-label="Resize <label>"`.
- **Remembered state**: with a `key` the snap goes to `localStorage['slope.sheet.<key>']` (per sheet; `setKey()` switches to another sheet's remembered state). Bad values are ignored.
- **Layer rules** (AGENTS.md): the sheet is a `position: fixed` layer inside the component's own shadow root (z-index 100, no transforms; it animates `height` / `width`), never a full-size child of `#ui`. The **host never takes pointer events**; only the sheet does, so the map stays interactive beside and above it. Safe-area insets are respected (`env(safe-area-inset-*)` on the sides and the bottom padding). `prefers-reduced-motion` (and the in-game setting, through the shared motion sheet) removes the transition. `[hidden]` hides it.
- **Hooks for the owner of the content**: the host gets `data-sheet` while it is a real sheet and `data-side` in the side layout, so the content's own CSS can restyle itself (`st-sheet[data-sheet] .card { ... }`). CSS variables `--sheet-bottom` (offset above the dock row) and `--sheet-top` (the space kept free above it).
- `sheetFor(panel, label, key, peekH, watch)` wraps a panel and keeps the sheet's `hidden` in step with the panel's `style.display` (`'display'`) or `hidden` attribute (`'hidden'`); `SHEET_PANEL_CSS` is the shared stylesheet for a hosting component (the panel loses its own frame inside the sheet).

## Breakpoints
| Name | Media query | Where it is used |
|---|---|---|
| Phone portrait | `(max-width: 520px)` | full-width right column, HUD strip, one-row speed, news / Rudi chips above the dock sheet, bottom sheets |
| Phone landscape | `(max-height: 520px)` | right column at the top right, side sheets (`(min-aspect-ratio: 1/1)`) |
| "Compact" (older rule) | `(max-width: 760px), (max-height: 520px)` | the top bar scrolls sideways, `st-help` hidden, dock row scrolls (docs/touch.md) |
| Tablet | `(min-width: 521px) and (max-width: 1099px) and (min-height: 521px)` | drawers keep their look, capped at 40-44 % of the height |
| Desktop | everything else (>= 1100 px) | untouched |

No user-agent sniffing anywhere: only media queries. A narrow desktop window gets the phone layout, which is fine (and handy for testing).

## How to add a panel so that it works on a phone
1. Float it as a card? Keep it **small** and under the 50 % budget: add it to `STATES` in `scripts/mobile-audit.ts` (a `setup` snippet that shows it) and run `npm run mobile:audit -- --only your-state`.
2. A **panel that can be tall** (a list, an inspector, a form): put it in a sheet. In its shadow root: `this.root.appendChild(sheetFor(panel, 'Label', 'unique-key', 132))` and append `SHEET_PANEL_CSS` to its `css()`. Its content scrolls inside the sheet; do not give it `max-height` rules of its own under `st-sheet[data-sheet]`.
3. Anything with **buttons** needs 44 px targets (`min-height: var(--touch-min, 0px)` comes with the kit); never fork a tool by pointer type.
4. Use `@media (max-width: 520px), (max-height: 520px)` inside the component for the compact variant; never set sizes on the host from outside the shadow root except in `src/ui/styles.css`.
5. Never add a full-size child to `#ui` (it blocks every click). Modals use `modal.ts`.
6. Run the audit, `npm run desktop:diff` (it must stay SAME) and `npm run touch:e2e -- --only drawers,ui --viewport phone`.

## Desktop guard: `npm run desktop:diff`
`-- --out DIR` captures six desktop screens at 1280x800 without touch (HUD, Buildings drawer, Landscape drawer, Pricing drawer, Statistics, Settings; the 3D canvas is hidden, the clock paused, the Rudi avatar and FPS text hidden so only the UI chrome is compared). `-- --compare A B` diffs two folders per pixel in the browser (a channel delta > 6 counts) and fails above 0.05 % of the pixels. Result for this change: **0 differing pixels in all six screens** (the baseline run against itself also gives 0).

## Known gaps
- The tutorial bubble (Rudi's lesson card, 214 px) is still a floating card, not a sheet. It is only shown while the tutorial runs.
- Modals are not sheets (Settings, Statistics...). On a landscape phone Settings leaves 17 % of the map; a dialog the player closes, but the first candidate for a later pass.
- An inspector and a drawer sheet can be open together (both sit above the dock row); the later one is on top.
- Everything was measured in Chrome with touch emulation on SwiftShader. Feel, thumb reach and the notch need a real phone: `docs/playtest-m75.md`.
