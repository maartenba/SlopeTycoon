# Events, festivals and set dressing (M5.4, Task 21)

An **Events calendar** with player-booked festivals and a few automatic events. Every running festival is **visibly dressed in the world**: bunting, flags, banners with the festival name, market stalls, a procession (cows / costumed people / racers) and, for the World Cup, a grandstand and a finish arch. Restrained fireworks mark New Year and festival finales.

Code: `src/config/festivals.ts` (data), `src/sim/events/EventCalendar.ts` (sim), `src/render/festival/*` (dressing, procession, pure layout), `src/render/meshes/festival/*` (procedural meshes), `src/render/fx/Fireworks.ts`, `src/ui/components/StEvents.ts` + `src/ui/eventsFormat.ts`, save module `events` (`src/game/saveState.ts`). Tests: `tests/sim/events.test.ts`, `tests/render/festivalDressing.test.ts`, `tests/ui-dom/events.test.ts`.

## The events

Dates use the real calendar of `docs/time-flow.md` "Calendar" (15-day months, sim day 0 = 1 April, a new game starts 1 December); windows in sim days of the year are in `src/config/festivals.ts`. The Events panel shows today's date, a January-December strip with event markers, countdowns ('in 12 days') and each festival's start window.

| Event | Kind | When | Days | Cost | Arrivals | Needs |
|---|---|---|---|---|---|---|
| Almabtrieb | automatic (retrofit) | the descent of the herds, 1-11 October (`phaseFor` = `descend`; the window is `almabtriebWindow()`, derived from it, so they cannot disagree), needs an Alpine Farm | 11 | - | x1.06 (plus the old guest cheer in `Livestock`) | a farm with cows |
| Christmas Market | booked | start 1-9 Dec (sim day 120-128) | 8 | $3,000 | x1.18 | Base Lodge, 2 stars, level 2 |
| Winter Carnival | booked | start 1-11 Feb (sim day 150-160) | 5 | $4,000 | x1.20 | Base Lodge, 2.5 stars, level 3 |
| Summer Music Festival | booked | start 1 Jun - 11 Aug (sim day 30-70) | 4 | $6,000 | x1.35 | Base Lodge, 3 stars, level 3 |
| World Cup Race | booked | start 6 Jan - 15 Feb (sim day 140-164) | 3 | $15,000 | x1.30 | Base Lodge, a black piste, 3.5 stars, level 4 |
| New Year | automatic | the last day of December (the eve, 'Dec 15', sim day 134) and 1 January | 2 | - | x1.10 | - |
| Critic visit | automatic | every 80-140 days, **announced 3 days ahead** (a news item) | 1 | - | review effect | - |
| Powder day | automatic | a snowfall >= `POWDER.minIntensity` in winter, 8-day cooldown | 1 | - | x1.20 | - |

A booking needs `leadDays` of notice, the right season and start window, no overlap with another booking, the level gate (Career), the stars, the lodge / black piste and the cash. Cancelling before the start refunds 80 %. Bookings pay into the `marketing` ledger category. While a festival runs every guest gets a small daily happiness cheer (`cheer`), and the spawner's attractiveness is multiplied by `EventCalendar.arrivalMult()` (exactly 1 with nothing on).

**Critic score** (`criticScore`): `0.6 x stars + 1.25 x guest mood + 0.75 x open-piste share - 0.5 if incidents are open`, rounded to half steps, clamped 0..5. A score >= 4 gives x1.12 arrivals for 10 days, <= 2 gives x0.92, anything between changes nothing.

**Automatic events are off in headless sims** (`createSim({ autoEvents })`, default `false`; `main.ts` turns them on except in the title demo). Booked festivals work everywhere. This keeps every pre-existing headless test / balance run / golden hash untouched: only the new `events` save module appears (excluded in `tests/sim/staff.test.ts`). With `autoEvents: true`, New Year, critic and powder days do change arrivals slightly.

### Almabtrieb: how to see it

Why it was easy to miss: it only exists with an Alpine Farm, the first autumn of a new game (1 Dec start) is 10 months away, and it used to start silently. Now:

* **Rudi** suggests an Alpine Farm (spring to early autumn, Base Lodge built, farm unlocked; 'Build' places it) with 'Build an Alpine Farm to see the Almabtrieb in autumn'. With a farm he says 'Almabtrieb in N days' (from 5 days ahead) / 'Almabtrieb is on'; 'Show me' goes to the base station, where the dressing stands.
* **News**: 'Almabtrieb in 3 days: ...' (once a year), 'Almabtrieb begins!' on 1 October, and the existing 'Almabtrieb! The decorated cows are back ...' once 60 % of the herd is home (guest cheer).
* The **Events panel** lists it under 'Coming up' with its date and on the month strip; while it runs it shows 'day N of 11'.
* Dressing (bunting, flags, banner 'Almabtrieb', decorated-cow procession 9:00-17:00) on the road / path nearest the base lift station for the 11 days; a x1.06 arrival bonus. All of it needs `autoEvents` (real game, not the title demo) and a farm with cows.
* **Debug**: `__slope.events.start('almabtrieb')` (any event id, optional days) runs it from today; `__slope.events.jump()` jumps the date to 3 days before (announcement), `jump(0)` to the first day; `.active()` / `.upcoming()` list events. Newly saved calendars keep the notice flags (`almNoticed`, `almBegan`; additive).
* Fast-forward ('Skip to' next season / month) lands exactly on 1 October and does not hide it; at 10x the 11 days last about 2.7 minutes.

## Set dressing

`placeDressing(world, festival, seed, taken?)` is **pure and deterministic**. The anchor is the road / path nearest the **base lift station** (the lowest lift's bottom), else the village, else the lodge. It returns:

* a **chain** of up to 24 road / path tiles (the longest line of network tiles around the anchor; a row of free ground, a plaza, if there is no road nearby);
* **poles** on both road edges (inside the road tile) with **bunting** strings between neighbours (re-uses the village `pennant` / `cord` geometry) and **flags** on some poles;
* **banners** spanning the road, carrying the festival name (one shared canvas atlas, one row per label);
* **market stalls** on the nearest free, non-steep tiles beside the road, facing it;
* World Cup: a **grandstand** and **finish arch** at the foot of the black piste, racers on its line (`blackPisteLine`);
* the **procession loop** (out along one edge of the road, back along the other).

Nothing stands on water, buildings or tiles another festival already took (`taken`). Everything is **view only**: no Occupancy, no pathing, no sim effect (tested: occupancy flags and the nav terrain version are unchanged). A separate render RNG is used (`renderRng`), never the sim RNG.

`FestivalDressing` builds the props of all running events into **3 draw calls** (`FESTIVAL_DRAW_CALLS`): one merged vertex-coloured solid mesh, one textured banner mesh (double-sided boards), one procession instanced mesh (only the kind in use has instances: decorated cows, costumed revellers, racers). With no running event every mesh is empty, `propCount()` is 0 and no geometry is left. The procession walks only in the day (9:00-17:00). The decorated cow (`createDecoratedCowGeometry`: flower headdress, ribbons, bell on a red strap) is not a nature species: only the festival procession uses it.

## Fireworks

`Fireworks` (`src/render/fx/Fireworks.ts`) fires 5 single-colour shells, ~2.4 s apart (~13 s real time), through the shared `Particles` pool (new `spark` kind, no extra draw call): at New Year (the eve) and on the last night of a festival, only when it is dark (night factor >= 0.6 and after 17:00), once per event and day. **Suppressed when Feedback intensity is Off** (this includes fast-forward) and with reduced motion (`fireworksAllowed`). Once started a show runs in real time, so fast nights do not cut it short.

## UI

`st-events` sits next to the campaigns in the **Marketing** drawer: running events, "Coming up" (with Cancel for bookings), and a card per bookable festival (cost, days, uplift, needs, a start-date `st-select`, Book). A card is locked with its reason when level / stars / lodge / piste are missing.

## Save

Module `events` v1 (booked festivals, history, critic schedule + notice flag, review effect, powder cooldown, calendar RNG). Additive: older saves have nothing booked.

## Not covered / limits

* `Sparkles.ts` (subtle glitter) from the original file list was not built: the fireworks + dressing cover the brief.
* The World Cup racers / grandstand are covered by unit tests but were not photographed (the starter resort has no black piste).
* Real GPU frame rate of the dressing is unmeasured (the harness runs SwiftShader); the draw-call budget (`<= 3` extra) is asserted in tests.
