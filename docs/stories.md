# Story guests and wishes (M5.4 Task 22)

About 1.5% of arrivals become a **story guest**: a named guest ("Marta from Graz") with ONE wish. They are ordinary guests; nothing about how they move or decide changes.

## Rules
- **Observer only.** `src/sim/guests/Stories.ts` reads the guest store at the end of every guest tick (`GuestSim.afterUpdate`). It never steers a guest, so the resort can only grant a wish by being good. The wish is picked from what the resort can currently offer (`WishNeed`: black piste, a meal venue, an après bar, a ski school, trails).
- **Own RNG stream** (`seed ^ 0x5707`): the sim RNG and every other module are untouched. Off by default (`createSim({ stories: true })`; main.ts turns it on, not in the title demo), so headless sims, goldens and the other balance tests keep their numbers. Cap: 8 active story guests.
- **Save module `stories`** (v1, additive: `reset()` for old saves): active stories, counters, last 12 outcomes, the pin, the RNG state and the daily tip bookkeeping. Part of `stateHash` (it changes money when enabled).

## Wishes (`src/config/storyWishes.ts`, data + wording)
| Kind | Resolves | Needs |
|---|---|---|
| `runs` | N runs (3 for beginners, 4-6 otherwise) | - |
| `black` | reached a black piste (`runMax` = 3); advanced guests, not kids | black piste |
| `meal` | visited a food venue (`FOOD` set) | meal venue |
| `apres` | visited the après bar | après bar |
| `lesson` | `lesson:started` lists the guest (kids only) | ski school |
| `excursion` | `Act.Excursion` seen | trails |
| `shortQueue` | N runs; fails at once when a lift queue wait exceeds 6 min | - |
| `happyDay` | judged when the guest heads home (happiness >= 0.7) | - |

Checking is the pure `checkWish(kind, n, obs)`. Venue visits are seen from the heading (`Act.ToBuilding` target) plus the visit counter, or from `GState.Using`. A guest who leaves with the wish open is judged on what they did (`guest:left`).

## Outcomes
- **Success**: a tip of $30-80 into the `other` ledger category (capped at $150 per day across all stories), +0.08 mood for that guest, and one plain news line.
- **Failure**: one plain news line and one **mild review** (3 stars when the guest was content, else 2) in the Reviews tab. No other penalty.
- Event `story:resolved { guestId, name, wish, outcome, text, tone, tip, x, y }` -> News (`milestone` category, tier `info`, "Go to" focus on where the guest was last seen). Silent in the audio mix, never a toast, never confetti, ignored by fast-forward stops.
- **Voice**: plain, short, past tense. About 1 in 8 success lines is a light one; failures and reviews are never light (`STORY.lightShare`).

## Inspector
Select a story guest: the card title is the name, with the wish line and progress ("Wants to ski 5 runs (2 / 5 runs)"), plus **Pin** (the guest stays in the card, and comes back when you select someone else who then leaves, until the wish resolves; closing the card unpins) and **Follow** (the camera keeps the guest in view; stops when the guest leaves or the card closes). Ride along works as for any guest. No sharing of any kind.

## Balance
`tests/sim/stories.test.ts` runs the bot two years on 64 / seed 61 with and without stories: profit delta 0.94% (limit 5%), ~30 granted and ~30 failed stories, tips well under 1% of income.

## Related fix: piste difficulty codes (found while building this)
`Networks.difficulty` is stored 0..3 (Green 0 .. Black 3, also the dock override). `pisteDifficulty` / `DIFFICULTY_LABELS` are 1..4 but clamped the stored value straight in, so Green AND Blue read as 1 (Green), Red read as Blue and **Black read as Red**; code 4 never occurred, which made the "Open a black run" goal impossible. `pisteDifficulty` now returns stored + 1 (`tests/sim/pisteDifficulty.test.ts`). Checked and correct as they were: the World Cup prerequisite (`createSim` hasBlackPiste, `EventCalendar`, `dressingWorld` all use the stored code 3), the ground mask (`+1` already), `Coverage` (1..4). Knock-on changes, all data-only:
- Goals now read a per-difficulty tile count per connected piste (`createSim` goal world `pistes()`), not the majority difficulty of a whole network.
- `greenRun` is now "Paint an easy run" (green or blue tiles >= 12); before the fix "difficulty 1" meant exactly that, so play is unchanged. `mixedRuns` needs 5 tiles of each of green / blue / red (was 8 of "1/2/3", i.e. never really red).
- Saves: nothing stored changes (the stored codes were always right). Auto-generated piste names follow the true label from now on ("Black Run 1" instead of "Red Run 1"); custom names are untouched.
