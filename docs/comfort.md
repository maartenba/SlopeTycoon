# Comfort need and Toilets (Phase 6, Tasks 7-8)

Guests have a third bodily need next to hunger and fatigue: **comfort** (stored as `GuestStore.urge`, 0 = fine .. 1 = desperate). It is on by default (`createSim({ comfortNeed })`; pass `false` for a neutral baseline, e.g. an old-needs probe). Direct `GuestSim` constructions in tests stay off.

## The need (`src/sim/guests/Needs.ts`)
| Constant | Value | Meaning |
|---|---|---|
| `urgeWalk` / `urgeIdle` | 0.010 / 0.005 per tick | growth while walking / otherwise (not while sleeping); 240 ticks = one day, so a day guest reaches the seek mark after about 6-8 game hours |
| `urgeSeek` | 0.55 | above this the guest looks for a toilet |
| `urgePenalty` | 0.18 | the happiness target loses `0.18 * urge^2` (never more than 0.18) |

Unmet comfort never ends a visit and never causes injuries; it only drags happiness toward a lower target and can colour a review (`comfort.neg`, three lines, one of them light). Inspector thoughts: "I could do with a toilet." (> 0.55), "I really need a toilet!" (> 0.8).

## Restoring comfort
* **Toilets** (`src/sim/attractions/Toilets.ts`): 1x1, $600, upkeep $3/day, no staff, no price (free), 4 slots, 1-tick service, `urgeTo 0`, +0.02 mood. Access: footpath, or hiking trail, or a piste edge (`pisteRule: edge`, not ON a piste tile). Hut site rules (slope <= 2, optional flatten, rock allowed). Never gated by Career levels (goals and the Advisor may ask for them).
* **Dining venues** lower the urge to at most 0.25 when a guest eats (`urgeTo` in the restaurant specs); so a village with cafes is never desperate, but toilets are the cheap, direct fix.
* **Cleanliness**: a block that served more than `TOILET_USES_PER_DAY` (70) guests today is *overrun*: users keep an urge of 0.3 and get no goodwill. The counter lives in the attraction stats (`today`, `todayDay`) so it survives a save. The inspector shows "Used today: n/70".

## Decision (`src/sim/guests/Decision.ts`)
`Intent` kind `relief` (never a wandering target): when `comfort` is on and the urge >= 0.55 the guest scores `1.4 + 2.5 * (urge - 0.55) - 0.02 * distance` for the nearest open toilet; no RNG is drawn, so guests that do not seek keep their random stream. It competes with eating, skiing and (in the evening) dining.

## Advisor (`toilets.none`, Rudi)
Fires with >= 12 guests when no active toilet exists, or when >= 25 % of the guests in the resort have an urge > 0.8 (keep: 15 %). Builds near the busiest piste, else near the lodge.

## Facilities facet (`src/sim/meta/Facilities.ts`)
Score = 45 % comfort satisfaction (1 - share of guests with urge > 0.8) + 25 % toilet cover of a quarter sample of open piste tiles + 15 % cover of the Base Lodge + 15 % toilets per guest (one block per 40 guests). A toilet within 20 tiles covers in full, a dining venue at 0.6. Hints: "Build toilets near the village and the busy pistes", "Guests are desperate for a toilet: add more", "Toilets are overrun: add more", "No toilets near the busiest pistes", "Too few toilets for this many guests" (positive: "Well equipped"). Weight 6 %; see docs/rating.md for the weights and the star distributions. The facet is only measured while the comfort need is on.

## Free starter toilet
`buildStarterResort` places one Toilets block beside the village footpath at no charge (`StarterOptions.toilet`, default = the comfort flag). A career game starts with a Base Lodge only; the facet and the advisor push the player to build one.

## Saves
`urge` is saved as an extra guest column only while any guest has a non-zero value, and mixed into the guest hash only then. A resort without the need (flag off) is therefore byte-identical, and saves from before load all guests comfortable. No `SAVE_FORMAT_VERSION` bump.

## Golden impact
Switching the need ON changed guest behaviour; the goldens (`tests/sim/staff.test.ts`, the `yearReport` snapshot) were re-recorded at M6.1 with before / after numbers in `docs/balance.md` ("M6.1 re-record"): bot money 203294.15 -> 191483.30 (-5.8 %), still profitable on every map in the balance sweep.
