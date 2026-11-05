# Schirmbar (M7.8, release 0.6.0)

A 2 x 2 domed umbrella bar for the slopes. Owner decisions (M7.8 brief): unlocks at resort level 2, **anywhere on open ground including beside a piste or a lift station** (never ON a piste tile, never in water), no road, path or power, **winter only**, the player can **close** it, it **opens in good weather only** (the card says why it is shut), it plays **apres-ski music** nearby like the Apres-Ski Bar, skiers **stop mid-descent** like at the Coffee Stand, cheap, 50 % refund. The banner shows the **resort name** (see "Resort name" below).

All numbers live in `src/config/schirmbar.ts` (`SCHIRMBAR`, `SCHIRMBAR_REASON`); the catalog row is in `src/config/buildings.ts`, the price in `src/config/prices.ts`, the unlock in `src/config/unlocks.ts`.

| | |
|---|---|
| Catalog | `schirmbar`, category services, 2 x 2, **$1,500**, upkeep **$5/day** (also when shut), staff 1, capacity 8, season `winter` (drawer ordering only) |
| Price | $6 a drink (slider 0 - $14), ledger `restaurants`, `perUse` |
| Unlock | resort level **2** (`UNLOCKS`), Sandbox from the start; no goal or Advisor build action needs it (no deadlock) |
| Access | `none` (remote site: "skiers ski up to it"); `pisteRule 'edge'`: beside a piste or a lift station, never on a piste tile; `onWater 'never'`; slope up to 3 half-steps, auto-flatten optional |
| Energy | none: the energy grid ignores it |
| Hours | 10:00 - 17:30 (`SCHIRMBAR.hours`, `spec.hours`): the music, the stops and the sales all follow `servingNow` |

## Open / closed (`schirmbarStatus`, `src/sim/attractions/Schirmbar.ts`)
One pure function `schirmbarStatus({ season, weather: { kind, wind, fog }, playerClosed }) -> { open, reason? }`; `AttractionSystem.evalOpen` calls it for every attraction with `spec.schirmbar` (every tick; it is a handful of comparisons). Order of the reasons:

1. `playerClosed` -> **Closed by you** (any weather, any season);
2. season is not winter (calendar Dec - Mar, `seasonOf`) -> **Closed for the season (winter only)** (the same words as the other seasonal closures, so the news groups them);
3. `storm` -> **Closed: storm**; `heavySnow` -> **Closed: heavy snow**; `rain` -> **Closed: rain**;
4. wind above `SCHIRMBAR.maxWind` **0.3** -> **Closed: high wind**; fog at least `maxFog` **0.5** -> **Closed: fog**;
5. otherwise **open**: `clear`, `cloudy` and light `snow` (no new weather states; the enum is `clear | cloudy | snow | heavySnow | rain | storm`).

Calm days draw wind 0..0.35, a storm is 1, so about one winter day in seven is "high wind". The weather arrives through the new `AttractionDeps.weatherNow` (createSim: `weather.current`). The switch is `Attraction.playerClosed` (saved in the attraction instance as `closed: true`, additive: old saves have none), set by `AttractionSystem.setSchirmbarClosed(id, closed)`. A closed bar sends its guests away like any closed attraction.

## Slope stop (`GuestSim.slopeStop`)
Generalises the Coffee Stand break instead of copying it: `Decider.refresh` collects open, serving Schirmbars into `decider.stops` (`SLOPE_STOPS`; they are NOT in `FOOD`, `SNACKS`, `BAR` or the wandering `other` list, so no guest walks there on purpose), and a skier in `Act.SkiDown` checks `stopWithin` each tick:

* within `passRadius` **3 tiles** of the bar's centre (about 2 tiles from its walls),
* budget at least **$8**,
* `schirmbarStop(id, runs)`: a stateless hash, **1 pass in 4**,
* never twice on the same run: `GuestSim.barStopped` (guest id -> completed runs at the last stop) is saved in the `guests` module **only while not empty**, so a world without a Schirmbar keeps its save and its hash.

The stop is an ordinary `Act.ToBuilding` walk (same as the coffee break), service is 3 ticks, 8 places, **at most 60 guests a day** (`dailyCap`, then "turned away"; `stats.today`, `todayDay`, `todayRev`). Effect per drink: happiness +0.08, hunger -0.08, fatigue -0.12. No RNG is drawn anywhere: same seed and inputs give the same stops (`tests/sim/schirmbar.test.ts`). No "diminishing for a second Schirmbar" rule is needed: the cap, the 1-in-4 pass and the run guard already stop a cluster from multiplying income; the Apres music is capped separately (below).

## Audio
`src/main.ts` `apresBars` (the world probe's bar provider) lists `apresBar` **and** `schirmbar`, each only when active, open and serving: so the bar counts as a bar for `apresProximity` (summed, capped by `PROX.apres.cap`), is gated like the Apres-Ski Bar (zoomed in, near, open) and hands off the game music in the same way. `src/audio/*` is untouched. A visual cue shows the same open / serving state: music notes drift up from the dome (`src/render/ApresNotes.ts`, `docs/audio.md` "Bar music notes"; the open bar is selected by `apresNotesBars()` in `main.ts`).

## Look (`src/render/meshes/schirmbar.ts`)
Described in the file header: an eight-sided glass pavilion on a round deck, a 16-wedge striped yellow / white roof with a golden finial, a pole and a Bavarian blue-white flag, a red banner band around the lower ring (the door side stays free), counter, stools, seated guests, string lights, four high tables with yellow cloths, a ski rack. **1,980 triangles open**, 940 closed (budget 2,000), two builders (`schirmbar`, `schirmbar:closed`) so no new draw calls: the usual wood / roof / sign layers of one building group. The roof is on the `roof` layer, so the roof-snow shader dusts it; glass panes, lamps and string lights use the glass colour and glow at night like windows. Closed: the roof is pulled down to the deck, dark panels, no crowd, no tables, no lights. `BuildingsView.variantOf` swaps the group (cached geometry) when the open flag or the resort name changes. All world-space plain colours: flicker-safe; thin parts are at least 0.03.

## Resort name (`src/sim/ResortName.ts`)
* `sanitizeResortName`: plain text, tags / entities / control characters dropped, whitespace collapsed, **24 characters at most**; empty falls back to `defaultResortName(seed)` (one of ~125 curated, invented names such as *Alpenglow*, *Val Clair*, *Pine Ridge* from `RESORT_NAMES`; a pure function of the seed, no Rng draw).
* New Game: a **Resort name** field (text input + dice; follows the seed until edited), passed as `?name=` (written only when it differs from the seed default). Settings > Gameplay > **Resort name** renames at any time. The name shows on the banner, in the level tooltip of the HUD, in the Year-end report subtitle and as the Photo mode file name.
* Saved in a **new observer save module `resort`** (version 1, `{ name }`, additive: an older save has none and gets the seed default, with the usual "older save" warning list). It is an observer module, so `stateHash` and every golden are unchanged; `SAVE_FORMAT_VERSION` stays 3 (no reshaping of existing data, so no migration is needed; `tests/game/schirmbarSave.test.ts` covers the missing-module path).
* Banner: `createBannerTexture(name)` (`textures/sign.ts`): a 512 x 128 red canvas band, `NAME  ·  APRES-SKI`, linear filtering, no mipmaps, shrunk to fit; `BuildingMeshes.setResortName` re-skins newly created groups.

## UI
The inspector card shows Open / "Closed: reason", the **Closed** switch (a checkbox, 44 px row on touch), today's guests / cap and income, the price slider and the staff buttons. Rudi: `schirmbar.suggest` (winter, a lift and a settled crowd, none built yet, unlocked and affordable). Guide: `site/guide/schirmbar.md`.

## Balance
`npm run analysis:roi -- --only schirmbar,coffeeStand,apresBar` (sandbox starter resort, 5 seeds, one year): Schirmbar **net +$2.5k +- $3.3k a year, income +$271**, i.e. within noise like the Coffee Stand (-$2.8k +- $1.9k) and far under the Apres-Ski Bar's income (+$9.1k a year, upkeep $24/day). The sandbox sites are around the village, away from the ski line, so this is the pessimistic case. A well placed bar in a headless winter (64 / seed 61, bar on the busiest ski tile): **$30 - $126 a day on open days** at 19 - 95 guests, i.e. about $3k a year in a modest resort, $900 of it upkeep; the cap (60 drinks, $360 a day) bounds a big resort at roughly $9 - 14k a year, below the Apres-Ski Bar's takings and with no road, power or parking behind it. No goldens move except the `progression` part of the staff golden (the new level-2 unlock row): `docs/balance.md` "M7.8".

## Tests
`tests/sim/schirmbar.test.ts` (status table over every weather kind, season and the switch; catalog; stop hash; a real resort: placed with no access, open / storm / switch, drinks and income under the cap, deterministic, a storm sells nothing), `tests/game/schirmbarSave.test.ts` (name sanitising, default, URL, save and old save; the switch survives a reload with an identical hash; placement beside a lift station, refused on a piste tile and on water), `tests/render/schirmbar.test.ts` (triangles, banner + roof layers, footprint, wedge winding, closed drape), `tests/repo/buildingContract.test.ts` (the contract row), the advisor tests (`schirmbar.suggest`), `npm run schirmbar:sanity` (real page).
