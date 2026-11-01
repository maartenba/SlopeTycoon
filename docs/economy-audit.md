# Economy + rules audit (M7.1, 0.3.1)

One consistency pass over every building, lift, campaign and guest type: a contract test that fails when a row is incomplete, an audit of the access / placement rules against the docs and the guide, a per-building ROI sandbox, bot variants that build all content, difficulty targets, and a short fix list with reasons. Everything below is reproducible with the commands in each section.

| What | Command | Where |
|---|---|---|
| Building contract (92 rows) | `npm run analysis:contract` (prints the gaps), `npx vitest run tests/repo/buildingContract.test.ts` | `scripts/analysis/contractLib.ts` |
| Access / placement table | `npm run docs:rules` (rewrites the block in [placement-rules.md](placement-rules.md)), `tests/repo/rulesTable.test.ts` | `scripts/analysis/rulesTable.ts` |
| Per-building ROI | `npm run analysis:roi [-- --only a,b --quick 1]` (~17 min, writes the table below and `.weave/analysis/roi.json`) | `scripts/analysis/buildingRoi.ts` |
| Difficulty targets | `npm run analysis:difficulty`, `npm run test:balance` | `scripts/analysis/difficultyTargets.ts`, `tests/game/balance.test.ts` |
| Content bot | `new Bot(sim, { content: 'all' })` | `src/game/bot.ts` |

## 1. Building contract (Task 7.1.1)

`runContract()` checks every `BUILDINGS` row (60), every lift (12), every campaign (15) and every shipped guest type (6) in about 1.2 s, and the test prints the full table of problems when anything fails. Per building: icon, name, description / tooltip, a mesh that builds non-empty within the triangle budget, a `buildingHeights.ts` entry, price > 0, upkeep >= 0, an **explicit unlock decision** (a row in `UNLOCKS` **or** an entry with a reason in the new `ALWAYS_AVAILABLE`, never both, never neither), an access reason that reads correctly (`isAccessReason`), the info card (Cost / Upkeep / rules), a **guide mention by name** (`site/guide/*.md` plus the generated tables, the new generated *Building reference* excluded so it cannot hide a gap), an advisor / goal / tutorial / campaign / scenario touchpoint (or an `OPTIONAL_EXTRAS` entry with a reason), a **successful placement** on a suitable site of a sandbox map (real `validatePlacement`, prerequisites placed first, terrain-bound buildings fall back to the river / rock / forest maps) and **demolition with the 50 % refund**. Lifts: icon, description, price, unlock decision, station access, guide mention. Campaigns: icon, blurb, price, unlock decision, prerequisites, guide mention. Guest types: guide mention, look hooks, required buildings exist.

**Gaps found on the first run (17 rows) and what was done** (`KNOWN_GAPS` in the test is empty):

| Gap | Rows | Fix |
|---|---|---|
| No icon and no description in the Buildings drawer | Mountain Hut, Après-Ski Bar | icons 🏔️ 🍻 and descriptions added (`ui/buildInfo.ts`) |
| Not mentioned in the player guide | Ice Rink, Shuttle Bus Depot | the Buildings page now lists all seven drawer tabs with every building in its real tab (the old list named tabs that do not exist) and explains the depot |
| No unlock decision recorded | all 44 ungated buildings, 5 lifts, 15 campaigns | `ALWAYS_AVAILABLE` in `config/unlocks.ts`, each with a reason (starter chain / needed by a goal or advisor rule / self-limiting extra / green starter / campaign prerequisites act as the gate) |
| No advisor / goal / tutorial touchpoint | Chalet, Helipad, Solar Plant, Wind Turbine, Small Hydro, Biomass Heating, Tree Nursery, Recycling Centre, Fishing Pier, Treehouse, Climbing Crag, Canyoning Base, Coffee Stand | deliberate: optional extras nothing requires (the unlock table says "no goal or Advisor rule needs it" for most of them). Listed in `OPTIONAL_EXTRAS` with a reason; the test fails if a new building has neither a touchpoint nor an entry |
| No valid site on the default sandbox map | Canyoning Base (needs a steep stream with rock walls) | the contract falls back to the 128 / seeds 5, 1, 4 maps (which have gorges); not a game bug |

Not a gap but worth knowing: **Helipad** and the energy extras have no Advisor suggestion at all; the Helipad is a level-4 air-rescue upgrade the Advisor never proposes (an owner question below).

## 2. Access / placement rule audit (Task 7.1.2)

The table of every building's `access` + `altAccess`, `pisteRule`, slope, auto-flatten, water, rock, `maxCount`, season and extra site rules is now **generated** from config into [placement-rules.md](placement-rules.md) (it listed 36 of 60 buildings by hand, and several lines were stale). `tests/repo/rulesTable.test.ts` fails when the block is stale, when any reason does not read as `Needs a ... next to it`, when a `path` row does not also name the road (a road always counts as a footpath), and when a ghost tip names an access the rule does not accept.

**Contradictions found and fixed**

| # | Contradiction | Fix |
|---|---|---|
| 1 | The same rule was worded in two orders: 'Needs a road or footpath next to it' (Après-Ski Bar, Solar Plant, Recycling Centre, Eco Centre, Quad Base, Rafting Base, Sleigh Stable) vs 'Needs a footpath or road next to it' (the rest), and 'road, footpath or hiking trail' (Ranger Station, Snowscooter Base) vs 'footpath, road or hiking trail' | one canonical order everywhere: **footpath, road, rail line, hiking trail, piste** (`accessReason`); three tests re-pinned |
| 2 | The info card said 'Needs footpath access' / 'Must be adjacent to a piste' (no road, different words) while the ghost, inspector and Advisor said 'Needs a footpath, road or piste next to it' | `describeRules` uses `accessReason`: one sentence in every surface |
| 3 | `docs/placement-rules.md`: hand table with 36 rows, 'min/maxAltitude: no catalog entry sets one yet' (the Wind Turbine does), 'allowRock: huts, cannon, sign only' (also toilets, viewpoint, coffee stand, tackle hut, wind turbine, small hydro), 'maxCount: Base Lodge, Train Station, Altiport' (also the Eco Centre) | generated table + the three lines corrected |
| 4 | Guide *Building* page: tabs 'Core, Services, Lodging, Kids, Safety, Operations, Snow, Water, Energy, Recreation, Transport' (the drawer has seven different tabs) | rewritten from the real tabs, every building in its tab |
| 5 | Guide access paragraph: 'a café and the stunt park also accept a piste edge' / 'the Mountain Hut, Ranger Station, Adventure Park and Alpine Farm accept [a trail]' (13 more rows accept a piste edge or trail: Magic Carpet, Toilets, Coffee Stand, Viewpoint, Campground, Tackle Hut, Treehouse, Crag, Canyoning Base, Snowshoe Hut, Snowscooter Base ...) | the paragraph states the rule once, and a generated **Building reference** table (`{{gen:buildings}}`: price, upkeep, what connects it, piste rule, season, unlock) lists every row |
| 6 | Guide: Campground 'needs a footpath or hiking trail', Eco Centre 'road or footpath' | 'footpath, road or hiking trail' / 'footpath or road' |

**Checked and consistent (no change):** hotels stay **road only** (the NEW-c decision keeps shops, chalets and apartments on a footpath **or** a road); the Train Station is `rail+path` and stands on the end of the rail stub; the +25 % remote-supply upkeep applies to every row that accepts a trail or a piste edge when it is supplied on foot only (the guide now says so for all rows); Show me / tutorial strings (`src/tutorial/strings.ts`) only name accesses the rules accept; ghost `placeTip`s are tested against the rule.

## 3. Per-building ROI sandbox (Task 7.1.3)

Method: the sandbox starter resort (`createSim` defaults, nothing opted out), one full year of 180 days from 1 December, once as the baseline and once with the building added on day 0 near the village (real placement rules, connected by road or footpath like the Bot does; a candidate site is tried until the building is **active**), up to five seeds (64 / 61, 5, 7, 23, 42; 128 / 1, 4, 6 for the terrain-bound ones). Net = income minus expenses (construction excluded) against the baseline; capex = price + levelling + the link. Because adding any building reshuffles the Rng streams the guest stream is chaotic, so **±** is the standard error of the mean over the seeds and anything below about 2 × ± is noise. **Reading the table:** it is the *marginal* value of one more building in a resort that already has the basics. Saturated services (a second café, a restaurant, a patrol hub, a second groomer garage) show no gain by design: food demand and safety needs are finite. Summer buildings are measured in a resort without hiking / MTB trails, so their numbers are lower bounds.

<!-- gen:roi -->
Year = 180 days from 1 December in the sandbox starter resort (all defaults on), averaged over up to 5 seeds where the building can be placed and connected; **±** is one standard error of that mean (the guest stream is chaotic: a change of less than ~2 × ± is noise).

| Building | Role | Seeds | Capex | Upkeep/day | Income Δ/yr | Expense Δ/yr | **Net Δ/yr** | Payback (days) | Happiness Δ | Stars Δ | Flags |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Adventure Park | summerFun | 5 | $9,318 | $25 | $26,285 | $3,594 | **$22,691** ±$2,416 | 74 | +0.014 | -0.03 | – |
| Apartment | lodging | 5 | $9,000 | $30 | $25,407 | $5,791 | **$19,617** ±$4,490 | 83 | +0.021 | -0.03 | – |
| Small Hotel | lodging | 5 | $24,052 | $55 | $31,326 | $12,771 | **$18,555** ±$6,116 | 233 | +0.022 | +0.02 | – |
| Chalet | lodging | 5 | $5,000 | $20 | $22,131 | $4,261 | **$17,870** ±$2,953 | 50 | +0.008 | -0.03 | – |
| Luxury Hotel | lodging | 5 | $48,384 | $90 | $39,166 | $23,207 | **$15,959** ±$2,478 | 546 | +0.022 | -0.03 | slow payback (> 3 years) |
| Snowscooter Base | winterFun | 5 | $9,000 | $30 | $13,038 | $4,530 | **$8,508** ±$2,921 | 190 | +0.071 | -0.03 | – |
| Stunt Park | winterFun | 5 | $9,072 | $25 | $7,682 | $835 | **$6,846** ±$3,238 | 239 | +0.014 | +0.03 | – |
| Quad Base | summerFun | 5 | $6,500 | $25 | $10,893 | $5,203 | **$5,690** ±$1,237 | 206 | +0.035 | -0.02 | – |
| Boat Rental | summerFun | 5 | $2,500 | $10 | $5,821 | $1,079 | **$4,742** ±$2,461 | 95 | +0.054 | +0 | – |
| Small Hydro | energy | 5 | $11,000 | $3 | $1,240 | -$3,158 | **$4,398** ±$1,443 | 450 | +0.001 | +0.07 | – |
| Solar Plant | energy | 5 | $16,000 | $4 | $920 | -$3,328 | **$4,248** ±$3,019 | 678 | -0.004 | +0.04 | slow payback (> 3 years) |
| Rental | - | 5 | $3,000 | $15 | $10,075 | $6,075 | **$4,000** ±$1,663 | 135 | +0.017 | +0.04 | – |
| Shop | - | 5 | $2,000 | $10 | $5,886 | $2,801 | **$3,085** ±$752 | 117 | +0.038 | +0.03 | – |
| Solar Array | energy | 5 | $6,500 | $2 | $1,104 | -$1,847 | **$2,951** ±$790 | 396 | +0.031 | +0.05 | – |
| Magic Carpet | - | 5 | $3,000 | $10 | $2,901 | $435 | **$2,466** ±$1,713 | 219 | +0.024 | +0.05 | – |
| Wind Turbine | energy | 5 | $10,000 | $3 | $388 | -$1,601 | **$1,990** ±$1,741 | 905 | +0.025 | +0.02 | slow payback (> 3 years) |
| Après-Ski Bar | food | 5 | $7,000 | $24 | $9,128 | $7,518 | **$1,610** ±$1,287 | 783 | -0.014 | +0.02 | slow payback (> 3 years) |
| First-Aid Hut | cost centre | 5 | $1,800 | $8 | $2,365 | $1,167 | **$1,198** ±$1,162 | 270 | -0.013 | +0.02 | – |
| Heated Terrace | food | 5 | $3,500 | $14 | $2,137 | $995 | **$1,143** ±$1,752 | 551 | +0.071 | +0.02 | slow payback (> 3 years) |
| Sleigh Stable | winterFun | 5 | $5,500 | $12 | $2,909 | $1,776 | **$1,133** ±$2,122 | 874 | +0.048 | -0.01 | slow payback (> 3 years) |
| Petting Zoo | summerFun | 5 | $3,000 | $10 | $3,703 | $2,588 | **$1,115** ±$1,906 | 484 | +0.017 | +0 | – |
| Viewpoint | summerFun | 5 | $1,500 | $2 | $1,313 | $213 | **$1,100** ±$2,651 | 245 | +0.023 | -0.03 | – |
| Kids Ground | winterFun | 5 | $2,500 | $8 | $1,992 | $938 | **$1,054** ±$2,100 | 427 | +0.006 | +0.02 | – |
| Recycling & Compost Centre | cost centre | 5 | $2,500 | $2 | $1,176 | $163 | **$1,013** ±$2,141 | 444 | +0.028 | +0.05 | – |
| Ski School HQ | - | 5 | $6,000 | $25 | $3,150 | $2,192 | **$958** ±$3,494 | 1127 | +0.047 | +0.02 | slow payback (> 3 years) |
| Beach | summerFun | 5 | $3,174 | $8 | $526 | -$78 | **$605** ±$2,055 | 945 | +0.018 | -0.02 | slow payback (> 3 years) |
| Altiport | cost centre | 5 | $15,088 | $40 | $6,565 | $5,986 | **$579** ±$1,910 | 4694 | +0.001 | -0.04 | – |
| Climbing Crag | summerFun | 5 | $4,500 | $14 | $2,584 | $2,130 | **$454** ±$7,002 | 1785 | +0.009 | -0.14 | slow payback (> 3 years) |
| Alpine Farm | summerFun | 5 | $7,000 | $20 | $4,092 | $3,769 | **$324** ±$4,034 | 3893 | +0.032 | +0 | slow payback (> 3 years) |
| Tree Nursery | cost centre | 5 | $3,000 | $3 | $194 | $83 | **$110** ±$1,534 | 4895 | +0.02 | -0.02 | – |
| Ticket Office | cost centre | 5 | $2,000 | $10 | $1,313 | $1,653 | **-$340** ±$2,651 | never | +0.023 | -0.03 | – |
| Tackle & Bait Hut | summerFun | 5 | $1,800 | $6 | $813 | $1,208 | **-$395** ±$1,621 | never | +0.007 | +0 | no measurable profit (within noise) |
| Snowshoe Hut | winterFun | 5 | $2,800 | $10 | $408 | $1,014 | **-$606** ±$2,522 | never | +0.01 | -0.01 | no measurable profit (within noise) |
| Playground | summerFun | 5 | $1,800 | $6 | $837 | $1,500 | **-$664** ±$1,858 | never | +0.02 | -0.03 | no measurable profit (within noise) |
| Warning Sign | cost centre | 5 | $100 | $0 | -$955 | -$276 | **-$679** ±$4,206 | never | +0.002 | -0.02 | – |
| Biomass Heating | energy | 5 | $5,000 | $2 | -$2,321 | -$924 | **-$1,397** ±$2,759 | never | +0.006 | -0.02 | no measurable profit (within noise) |
| Train Station | cost centre | 2 | $10,000 | $30 | $3,955 | $5,595 | **-$1,640** ±$3,238 | never | +0.065 | +0.02 | – |
| Treehouse | summerFun | 5 | $2,500 | $4 | -$1,377 | $782 | **-$2,159** ±$3,512 | never | +0.031 | +0.01 | no measurable profit (within noise) |
| Snowmaking Cannon | cost centre | 5 | $800 | $5 | -$1,054 | $1,112 | **-$2,167** ±$1,945 | never | -0.015 | -0.03 | – |
| Lift Maintenance Workshop | cost centre | 5 | $6,000 | $25 | $917 | $3,100 | **-$2,183** ±$2,082 | never | +0.063 | +0.02 | – |
| Ice Rink | winterFun | 5 | $5,014 | $18 | -$541 | $1,673 | **-$2,214** ±$2,619 | never | +0.041 | -0.01 | no measurable profit (within noise) |
| Toilets | cost centre | 5 | $600 | $3 | -$1,022 | $1,516 | **-$2,539** ±$2,292 | never | +0.049 | -0.01 | – |
| Coffee Stand | food | 5 | $1,200 | $4 | -$332 | $2,426 | **-$2,758** ±$1,866 | never | +0.002 | -0.01 | no measurable profit (within noise) |
| Rafting Base | summerFun | 5 | $5,500 | $22 | $1,180 | $3,987 | **-$2,806** ±$2,070 | never | +0.054 | -0.06 | no measurable profit (within noise); dominated by Boat Rental |
| Ranger Station | cost centre | 5 | $9,000 | $25 | $2,165 | $5,882 | **-$3,717** ±$1,803 | never | +0.019 | +0.02 | – |
| Reservoir | cost centre | 5 | $7,000 | $15 | -$1,377 | $2,515 | **-$3,892** ±$1,758 | never | -0.023 | -0.02 | – |
| Campground | lodging | 5 | $3,500 | $8 | -$2,343 | $1,691 | **-$4,034** ±$1,661 | never | -0.009 | -0.02 | never profitable |
| Snowcat Outpost | cost centre | 5 | $3,000 | $12 | $2,675 | $6,810 | **-$4,135** ±$1,157 | never | -0.001 | +0.02 | – |
| Eco Centre | cost centre | 5 | $20,000 | $18 | -$1,221 | $3,171 | **-$4,392** ±$2,145 | never | +0.048 | +0 | – |
| Helipad | cost centre | 5 | $7,000 | $30 | $265 | $5,305 | **-$5,041** ±$937 | never | +0.029 | -0.01 | – |
| Lodge/Restaurant | food | 5 | $6,000 | $30 | $344 | $5,933 | **-$5,589** ±$3,211 | never | +0.053 | -0.01 | never profitable |
| Parking | cost centre | 5 | $3,052 | $8 | -$5,220 | $806 | **-$6,026** ±$1,494 | never | +0.034 | +0 | – |
| Mountain Hut | food | 5 | $3,500 | $14 | -$2,346 | $3,881 | **-$6,227** ±$2,107 | never | -0.003 | -0.05 | never profitable; dominated by Heated Terrace |
| Shuttle Bus Depot | cost centre | 5 | $4,000 | $20 | -$3,554 | $2,829 | **-$6,382** ±$2,871 | never | +0.033 | -0.03 | – |
| Café | food | 5 | $2,500 | $12 | -$2,783 | $3,687 | **-$6,470** ±$1,471 | never | -0.001 | -0.02 | never profitable |
| Ski Patrol Hub | cost centre | 5 | $4,000 | $20 | -$2,454 | $4,794 | **-$7,248** ±$2,858 | never | -0.026 | -0.05 | – |
| Canyoning Base | summerFun | 5 | $4,800 | $18 | -$6,129 | $3,750 | **-$9,878** ±$4,855 | never | +0.036 | -0.14 | never profitable; dominated by Boat Rental; dominated by Beach; dominated by Petting Zoo |
| Groomer Garage | cost centre | 5 | $5,000 | $20 | -$1,727 | $13,473 | **-$15,200** ±$1,431 | never | +0.05 | -0.03 | – |

No valid site on any ROI-sandbox map (measured in the contract suite instead): baseLodge, fishingPier.
<!-- /gen:roi -->

### Highlights of the table

- **Absurdly profitable (payback < 40 days, significantly):** none. Best: Adventure Park (74 days), Apartment (83), Chalet (50), Small Hotel (233 days), Boat Rental (95).
- **Dead buildings (found, fixed in section 5):** **Shop** earned about $50 a year (the souvenir stop scored 0.2 against 1.1+ for skiing), **Shuttle Bus Depot** cost $17k a year of income (bus passengers were all Solo / Budget / Adventure), **Après-Ski Bar** cannibalised restaurant income one-to-one ($17k moved from restaurants to bars) and lost $9k a year, **Wind Turbine** was dominated by the cheaper Solar Array.
- **Never profitable in the marginal sandbox, kept:** Café, Lodge / Restaurant, Mountain Hut (saturated food demand), Campground (cheap summer beds replace chalet nights when there are no hikers), Canyoning and Rafting Base (no summer crowd in this sandbox), Ice Rink, Coffee Stand, Snowshoe Hut, Treehouse, Playground, Tackle Hut (small, within noise). Intentional cost centres (patrol, first aid, helipad, ranger, workshop, snowcat outpost, reservoir, cannons, toilets, parking, ticket office, Eco Centre, groomer garage) are not flagged: they protect revenue and ratings.
- **Slow payback (> 3 years):** Luxury Hotel (546 days at $48k is fine for a VIP building), Solar Plant, Wind Turbine, Ski School HQ (it unlocks kids, schools and lessons; its own income is small), Alpine Farm, Climbing Crag, Beach.
- **Dominated:** Mountain Hut (by Heated Terrace), Rafting / Canyoning (by Boat Rental, Beach, Petting Zoo) only in a resort without summer trails.

## 4. Bot variants and difficulty targets (Task 7.1.4)

`Bot` option **`content: 'all'`** (default `false`: the default bot and its goldens are untouched). It paints the hiking + MTB trails like `summer`, and in every month in which the normal wish list built nothing it adds up to three more buildings from `CONTENT_WISHES` (every catalog building the normal wishes do not name, one of each, cheapest first; prerequisites first; unaffordable ones wait without blocking the rest; whole-map site search for lake shore / river / rock face / forest; the rail stub for the Train Station). `tests/game/balance.test.ts` (BALANCE=1) asserts on 128 / seed 1 that **all 60 building types stand after three years** and nobody is bankrupt, and on the 64 map that at least 50 types stand on Relaxed / Normal / Challenging without bankruptcy. A bot that builds everything is a stress test, not a target: it loses money in year 3 on 128 (the late hotels, altiport and Eco Centre are big capex) and dents year 2 on 64.

**Difficulty targets** (default career bot, respects the unlock gate, lifts left on; measured by `npm run analysis:difficulty`, asserted as bands in the balance suite):

| Difficulty | Year 1 | Year 2 | Year 3 | Summer per 15-day month | Lowest cash | Bankrupt |
|---|---|---|---|---|---|---|
| Relaxed | +15k .. +80k | +195k .. +235k | +185k .. +225k | +10k .. +14k | $124k .. $139k | 0 / 10 runs |
| Normal | -15k .. +50k | +135k .. +165k | +125k .. +160k | +5k .. +10k | $49k .. $64k | 0 / 10 |
| Challenging | -22k .. +45k | +95k .. +145k | +100k .. +137k | +2k .. +7k | $12k .. $26k | 0 / 10 |

Bands in the test (about ±25 % around these): year 2 Relaxed 150k..280k, Normal 100k..215k, Challenging 70k..175k; every summer month positive on average; cash never below zero; no bankruptcy. A human-like bot (no summer attractions, lifts left on, reserve $2k) lands inside the same bands.

**Observation for the owner (no change made):** Normal vs Challenging differ by only about 10-20 % in year 2 (Relaxed is +35 % above Normal), and nobody goes bankrupt on any difficulty. A competent bot finds every setting comfortable; a real player will not (the early game is tight, see the first-year numbers). If Challenging should feel clearly harder, its multipliers in `config/balance.ts` can be tightened; that is a design call.

## 5. Fix list (Task 7.1.5), each with a reason

| Change | Before -> after | Reason |
|---|---|---|
| **Shop** souvenir stop score `Decision.ts` 0.2 -> **0.45** | shop income ~$50 -> ~$5k a year; ROI net -$1.9k -> +$3.1k/yr, payback 117 days | a $2,000 building that earned nothing. 0.6 made it absurd ($23k/yr, 1.0 = $70k), 0.5 pushed the 64 / 61 bot to -7 % so **0.45** (the bot stays within ±5 %) |
| **Shuttle Bus Depot**: bus passengers drawn from the normal mix of the day (`Spawner.ts`) | income -$16.9k -> -$3.6k a year; net -$20.2k -> -$6.4k | the depot silently turned 15 % of arrivals into budget guests and cost a resort $17k of lodging and lessons for no benefit. It is still a cost centre (it makes the Train Station and Altiport reachable); the bot builds none |
| **Après-Ski Bar** price $10 -> **$18** (max 45), upkeep $28 -> **$24** (`prices.ts`, `buildings.ts`) | net -$9.3k -> +$1.6k..+$3.9k a year | the bar moved restaurant spend 1:1 into the bars line and cost $7.5k a year. Now it pays for itself and keeps its evening happiness |
| **Wind Turbine** rated output 2.4 -> **3.4** (`energy.ts`) | net -$2.8k -> +$2.0k a year | dominated by the Solar Array (more expensive, less output) |
| Guide, info cards, ghost text | see section 2 | consistency |
| Tests re-pinned | `rivals` green-bot energy margin 2.5 -> 4.5 points (75.2 vs 79.3), `Exploration` 128 / 1 pistes per guest 1.6 -> 1.5 | the changed guest stream moved the energy-per-guest facet / sat on the old bound: tree and habitat facets stay exact |

Left alone on purpose (documented, owner questions below): saturated food and safety buildings, the energy extras (sustainability choices, payback 6-25 years by design), summer buildings (need trails), and Challenging's modest gap to Normal.

Goldens, bot-economy deltas and the re-record are in [balance.md](balance.md) "M7.1 re-record".

## 6. Questions for the owner

1. **Challenging** is only 10-20 % below Normal for the bot (section 4). Tighten it?
2. The **Helipad** and the energy extras have no Advisor suggestion. Add Rudi tips (level 4 air rescue after a remote incident; a wind turbine on high ground), or keep them as discoverable extras?
3. **Campground** (budget summer lodging) loses money when there are no hikers: it needs the trail network and toilets to shine. Fine as a summer-plan building, or should it bring its own small crowd?
4. Food buildings are saturated by design. Is "a second café adds nothing" the behaviour you want, or should a larger resort keep rewarding more cafés (per-guest hunger demand scaling with size)?
