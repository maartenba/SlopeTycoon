# Resort rating, news & closures (Task 27)

**Rating** (`src/sim/Rating.ts`, inputs in `RatingInputs.ts`): evaluated once per in-game day (`rating` system). Score 0–100 → stars = score/20 in half-star steps.
Components (weight): happiness 25% (avg guest happiness + recent 'satisfied' leavers), safety 20% (incident penalty, response time, unresolved; capped at 60 without a Ski Patrol Hub),
variety 15% (attraction types, lift kinds, green/blue/red/black coverage, seasonal offer), piste quality 12%, queues 12%, crowding 4%, value 12% (stub: day-pass price vs default until Task 32),
plus bonuses (restaurants, lodging vs demand, up to +6). Unresolved incidents also multiply the total (−7% each, max −35%). Components are smoothed per day (α=0.35).
`Rating.breakdown()` returns component scores + hints ('Too few green runs', 'Long queues at Chairlift 1', 'Add a Ski Patrol Hub').
`rating:changed {stars, previous, reason, score}` is emitted only on star-level change, with hysteresis, max once per day.
Spawn: `Spawner.setAttractiveness(fn)`; `Rating.attractiveness(openLifts)` = 0.3 + 1.2·score/100 (×0.15 with no open lift).

**Closures**: `OpenStatus.closeTiles` now maintains `closedMask` (NavWorld.closed): all tiles of a closed piste + swept tiles are non-traversable/non-standable for skiers; flips are journaled
(`takeClosureFlips`, merged into `NavWorld.consumeFlips`) so paths revalidate; lifts are re-evaluated (a lift with no open descent closes); guests on closed tiles walk to the nearest standable tile (radius 10) or leave.

**News/toasts**: `ui/newsFormat.ts` (pure, one entry per GameEvent or explicit 'ignored'), `StNews` (bottom-right collapsible feed, click = focus camera, category mute checkboxes persisted in localStorage),
`ui/toastLimiter.ts` (coalesce ×N, max 4 visible, severity priority, mutes). `StGuestInspector` + `ui/guestInfo.ts`; HUD `st-rating` (stars + smiley, tooltip, click for bars/hints). No dock drawer was added.
