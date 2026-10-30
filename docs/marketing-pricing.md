# Marketing, pricing & elasticity (Task 32)

Code: `src/config/marketing.ts` (all constants), `src/sim/{Marketing,Pricing,Elasticity}.ts`, UI `StMarketing` / `StPricing` (+ `marketingFormat.ts`, `pricingFormat.ts`), dock drawers **Marketing** and **Pricing** (additive; Finance/Operations drawers untouched).

## Pricing keys (`Pricing`)
`dayPass`, `seasonPass`, building types (`stuntPark`, `iceRink`, `rental`, `cafe`, `shop`, ...), `night:<lodgingType>`, `markup:restaurants`, `markup:shops` (percent).
- `get(key)` = base price (override or default, 0 when free); `effective(key)` = base x markup x today's seasonal multiplier (what guests pay). Season passes and markups are never seasonal.
- Guards: min = 25 % of default, max = catalog cap (`prices.ts`), markup 60–160 %. Free (price 0) only through the explicit `setFree` toggle (not season pass / lodging).
- Attractions: `Attraction.price` is synced with the key (`sim.priceApi.set`, and the inspector slider calls `priceApi.setForBuilding`, so one source of truth per building type). `unitPrice()` = price x `priceScale()` (markup x seasonal).
- Not wired (honest gaps): **parking fee** (no per-use parking revenue exists in the sim) and **ski-school lesson fee** (constant `SKI_SCHOOL.fee`, per-sim override would need a Families hook).

## Seasonal schedule
3 profiles (winter / shoulder = spring+autumn / summer) x 3 day classes. Defaults are **neutral (1.00)**, range 0.5–2.0.
- Weekday = `(year*360 + day) % 7` (`Clock.weekdayOf`, 0 = Monday). Peak: Sat/Sun, holidays (`HOLIDAYS`: Dec 350–359, Jan 0–4, mid-winter 285–291, summer break 150–179) and **powder days** (winter, snowing with intensity >= 0.5). Regular: Friday. Off-peak: Mon–Thu.
- Optional powder surcharge x1.2 (toggle).
- Demand by day class (`DAY_CLASS_DEMAND`: peak 1.15 / regular 1.0 / off 0.88) multiplies arrival volume; the fair price follows (`DAY_CLASS_FAIR` 1.1 / 1 / 0.92), so a peak premium is rational but not free.

## Elasticity
Demand multiplier per guest type: `exp(-k (ratio-1))`, ratio = price / fair, clamped to [0.02, 1.6] (crowding cap).
k: solo 1.3, couple 1.0, family 1.2, **vip 0.4**, **budget 2.2**, adventure 0.9. VIPs below ratio 0.6 scale down to x0.5 (cheap = suspicious).
Fair price = default x (0.9 + 0.04 x stars) x day-class fair. Verdict: cheap < 0.85, expensive > 1.2.
Used by: arrival volume and type mix (Spawner `pricingDemand`: mix-weighted volume + per-type weight at day-pass ratio), season-pass demand (`seasonDemand` x volume at pass ratio), attraction/lodging use (deterministic per-guest roll `accepts`, no RNG), ticket affordability (`AFFORD_SHARE` per type replaces the `affordShare` stub).
With default parameters the revenue-maximising day pass for the winter mix lies strictly between the min and the cap (unit-tested); at the cap revenue is below the balanced price; free passes earn 0 (tested in the sim).

## Rating value component & exploit guards
`Pricing.valueScore()` replaces the stub: `1/(1+ratio^2)` (0.5 at fair) weighted day pass .5, lodging .2, restaurant markup .15, shop markup .15; free day pass capped at 0.4; x(1 - 0.3 x shock).
Price shock: a day-to-day jump > 35 % of any price sets `shock` (= the jump, max 1), decays x0.7/day; it lowers value and arrival volume (x(1 - 0.2 x shock)). There is no change cooldown (prices apply at once; the shock is the penalty).

## Campaigns (`CAMPAIGNS`)
| id | cost | days | targets (share boost) | volume | soft factors |
|---|---|---|---|---|---|
| families | 6000 | 14 | family +140 % | +12 % | season (winter/summer) |
| budget | 3500 | 10 | budget +160 %, solo +30 % | +15 % | pass at/below fair |
| vip | 12000 | 21 | vip +220 % | +4 % | altiport x1.3, 3★ scale, premium pass |
| summer | 7000 | 21 | adventure +140 %, family +40 % | +10 % | — |
| brand | 2500 | 10 | — | +12 % | — |
Effectiveness = season match (off-season factor per campaign) x quality (0.6 + 0.1 x stars, max 1.1) x facility bonus x price fit. Cost is charged upfront (`economy.charge(cost, 'marketing')`).

### Hard prerequisites (`CampaignDef.prereqs`, checked by `Marketing.canStart(id)`)
A campaign **cannot start** unless every prerequisite holds; `start()` returns `Requires: <list>` without charging. `canStart` returns `{ ok, missing[], checks[] }` (`checks` = label + ✓/✗ + the building type that fixes it). The UI shows the list with ✓/✗, disables the button ("Requirements missing") and greys the ROI preview. `blocker()` (used by the bot and the tutorial) includes them.
| id | requires |
|---|---|
| families | active Ski School HQ **and** a kids area (Kids Ground, Playground or Magic Carpet) |
| budget | an open lift, an open ski piste, active Parking |
| vip | Altiport **or** luxury lodging (>= 2 active chalets/apartments; the Base Lodge does not count, every resort has one), resort rating >= 3★, a restaurant / café / hut / terrace / bar |
| summer | summer season, Adventure Park or an MTB trail, a bike-capable open lift or a hiking trail, active Rental |
| brand | an open lift and a restaurant / café / hut / terrace / bar |
**Running campaigns** re-check the prerequisites every day. While one is missing the campaign is *paused* (effectiveness 0, orange warning in the Running list, `lapsed` counter); it resumes when the item returns and is **cancelled after `PREREQ_GRACE_DAYS` (3) days** (no refund, cooldown applies, history entry "cancelled (Requires: ...)", low-volume event `marketing:cancelled` -> news "Campaign cancelled: <name>. Requires: ..."). Season is a prerequisite only for the summer campaign (others keep the soft off-season factor).
Effect: Spawner `marketingFn` returns weights `1 + boost x s` per target type and volume `1 + sum(volumeBoost x s)`. Max 2 running; strengths sorted and weighted `0.6^i` (diminishing returns). After the end the effect decays linearly over 4 days (tail). Cooldown per campaign (`cooldownDays`).
Uplift = arrivals during the run - baseline/day x days, baseline = mean daily arrivals of the previous 14 days (influenced days excluded when >= 3 clean days). **This is crude** (no seasonal/weather correction and the early-game ramp inflates it): treat as an indication.
ROI preview: extra guests = baseline x (days + 2) x volumeBoost x effectiveness, +/-35 % range; revenue = guests x (day pass + $40); shows cost per extra guest. Needs ~1 day of arrival history (shows "—" before).
Events (low volume, 'important' news): `marketing:started`, `marketing:ended`, `marketing:cancelled`. State (`marketing`, `pricing`) is saved with the 'economy' system.

## Campaigns v2, early batch (Phase 6 Task 50)
Four more rows in `CAMPAIGNS` (existing buildings only; the first five rows are unchanged). Numbers are starting points. `maxConcurrent: 2` and `stackFactor` are unchanged.
| id | name | targets (share boost) | requires | seasons (off-season factor) | cost / days / cooldown | volume | extras |
|---|---|---|---|---|---|---|---|
| train | Come by Train 🚆 | budget +80 %, solo +40 %, couple +30 % | `railStation`, `stationPath` | all (1) | 4000 / 21 / 14 | +6 % | `railBias` 0.25, Shuttle Depot x1.15 |
| parkJam | Snowboard Park Jam 🏂 | adventure +120 %, solo +40 % | `stuntPark`, `openLift`, `rental` | winter, spring (0.2) | 5000 / 10 / 21 | +8 % | x1.2 with a stunt park within 12 tiles of an open lift's top station (`parkLift`) |
| hikeBike | Hike & Bike Weekends 🥾 | couple +90 %, solo +60 %, family +30 % | `summerSeason`, `summerAccess`, `dining` | summer, autumn (0.3) | 4500 / 14 / 14 | +10 % | `dayClassMult` peak 1.4 / Friday 0.8 / Mon-Thu 0.6 |
| festival | Festival Season 🎪 | family +30 %, couple +30 % | `bookedFestival` (start only) | all (1) | 3000 / 10 / 30 | +15 % | `window: 'festival'`: x1 inside the window, x0.2 outside |
New prerequisites: `railStation` (active Train Station and `arrivals.rail.available`: served by the rail line from the entry), `stationPath` (the station is active = within walking reach of the lodge by path, or a Shuttle Depot serves it: the Dependencies rule, not a new BFS), `stuntPark` (active Stunt Park), `bookedFestival` (a booking running or starting within `FESTIVAL_CAMPAIGN.prereqDays` = 7 days; `startOnly`, i.e. not re-checked while the campaign runs, so the festival may end first). New facilities: `shuttle` (active Shuttle Depot), `parkLift`. Each unmet prerequisite shows a **Show me** button on the card (Buildings drawer on the building, pans to the Train Station, or scrolls to the Events calendar).
**Engine extensions** (all optional per row): `dayClassMult` (live factor per day class from `Pricing.dayClass()`: weekends / holidays / powder = peak, Friday = regular, Mon-Thu = off; applied each day to a running campaign, shown as "Today: x0.6" in the Running card, averaged for the ROI preview); `window: 'festival'` (inside = a booked festival runs or starts within `FESTIVAL_CAMPAIGN.leadDays` = 3 days; outside x`FESTIVAL_CAMPAIGN.outside` = 0.2; `Marketing.effect()` also caps `boost` so that festival `arrivalMult` x campaign boost <= `ELASTICITY.maxVolume` 1.6); `railBias` (summed over running campaigns with the stack factor, capped at `TRAIN_CAMPAIGN.maxBias` 0.5).
**Come by Train**: there is no timetable model. Trains are visual vehicles and the station capacity is **150 concurrent guests** (`buildings.ts`, `Arrivals.evaluateArrivals`), so the campaign is tied to that capacity, not to a frequency (a second station / frequency upgrade is out of scope). The Spawner's car/train choice (both modes available) was `rng.chance(0.7)` for the road; it is now `rng.chance(0.7 x (1 - railBias))` (bit-identical with no campaign: one draw, same value). `modeOk` still refuses a mode at capacity, so the shift saturates at 150 and the road keeps the rest. Measured (`tests/sim/marketingTrain.test.ts`, demo resort, seed 7, 21 days): rail share of arrivals 33.6 % -> 50-52 %, mean cars in the car park 14.5 -> 7.6 guests, peak rail load 29-35 of 150. Rivals: market share is unchanged by campaigns (the result card still shows target share before / during). The running card shows "By train: N % of arrivals (station N/150)".
**Sustainability sub-input** `trainShare`: share of the last `TRAIN_SUSTAIN.days` = 14 days' arrivals by rail; linear to `full` = 30 %; worth **at most +3 facet points** (`trainSharePoints`, `TRAIN_SUSTAIN`), always on (not only while the campaign runs), facet still capped at 100. Rating effect <= 3 x 0.08 = 0.24 score points (docs/rating.md).
**Flags (goldens)**: arrivals by mode are tracked by default (`createSim({ campaignsV2: false })` opts out; only the title demo does); it adds `rail` to the saved marketing day log and enables the sustainability input. Goldens are recorded with it on (no effect on a bot that builds no train, docs/balance.md).
**Advisor** (`marketing.trainIdle`, `marketing.parkingFull`, both Show me -> the Come by Train card): station served and < 5 % of recent arrivals by rail (keep < 8 %), or the car park at >= 95 % (keep 85 %) while the station has room (< 80 % loaded); only when the campaign is startable and affordable.

## Summer campaigns (Phase 6 Task 51)
Two more rows in `CAMPAIGNS` (appended; the first nine rows are unchanged). Numbers are starting points.
| id | name | targets (share boost) | requires | seasons (off-season factor) | cost / days / cooldown | volume | extras |
|---|---|---|---|---|---|---|---|
| summerCamp | Family Summer Camp ⛺ | family +160 %, **school** +40 % (`extraTargets`, Task 52) | `summerSeason`, `campground`, `kidsOrZoo` | summer (0.2) | 6000 / 14 / 21 | +8 % | `priceAlign: 'cheap'`, x1.2 with an active Petting Zoo (`pettingZoo` facility) |
| angler | Angler's Paradise 🎣 (Lakeside Escape) | **angler** +180 % (`extraTargets`), couple +40 %, solo +20 % | `tackleHut`, `water` | summer, autumn, winter while `ICE_FISHING` (0.3; winter x0.5 via `seasonMult`) | 3500 / 14 / 14 | +5 % | effectiveness x fish-stock factor (below) |
New prerequisites: `campground` (an active Campground), `kidsOrZoo` (an active Kids Ground, Playground, Magic Carpet **or** Petting Zoo; no Ski School, so it never overlaps the winter Families campaign), `tackleHut` (an active Tackle & bait hut), `water` (a lake, pond or river that an active hut reaches holds fish stock >= `ANGLER_CAMPAIGN.minStock` = 40 %; unfished water counts as 85 %). Each unmet building requirement has **Show me** (opens the Buildings drawer on the Campground / Petting Zoo / Tackle & Bait Hut).
**Engine extensions**: `extraTargets` (boost per EXTRA guest type id; the Spawner multiplies the type weight by `MarketingState.types[id]`, so Angler's Paradise lifts anglers without lifting every solo guest; anglers' segment is `solo`, so the `solo` +20 % also applies to them); `seasonMult` (extra factor in a season that is in `seasons`); `fishFactor` + `MarketingContext.fishStock()` (mean stock of the waters the active huts reach): the **Fish stock** factor is `clamp(stock / 0.8, 0.3, 1)` (breakdown line "Fish stock"), frozen at the start like every effectiveness, and below 30 % the card warns "Overfished". At the default Catch & release a campaign's extra anglers cost only `FISH.depleteRelease` 0.0008 per catch (docs/anglers.md), far below the daily regrowth; with Keep the Advisor's Overfished rule speaks first.
**Advisor** (`marketing.summerCamp`, `marketing.anglers`; Show me -> the campaign card): "A Campground is ready: try Family Summer Camp" (summer, >= 10 guests, campaign startable, cash >= $8,000 / keep $6,000) and "Anglers need a campaign: Angler's Paradise" (not spring, startable, cash >= $5,000 / keep $3,500).
School groups ride along on Family Summer Camp (+40 %, Task 52 below). Seniors come with Wellness & Views.

## Senior + School campaigns (Phase 6 Task 52)
Two more rows in `CAMPAIGNS` (appended after the summer ones; the first eleven rows keep their numbers except the two additions in the last paragraph). They target the **Senior** and **School group** guest types (docs/guest-types.md) through `extraTargets` (boost per EXTRA guest type id; no new `GuestTypeKey`, so the saved marketing day log and every `Record<GuestTypeKey, ...>` are unchanged). Numbers are starting points.
| id | name | targets (share boost) | requires | seasons (off-season factor) | cost / days / cooldown | volume | extras |
|---|---|---|---|---|---|---|---|
| wellness | Wellness & Views 🧖 | **senior** +160 % (`extraTargets`), couple +60 % | `poolOrViews`, `dining`, `toilets` | summer, autumn, winter (spring 0.5) | 8000 / 21 / 21 | +5 % | `priceAlign: 'premium'`, `minStars: 3` |
| school | School Trips 🚌 | **school** +200 % (`extraTargets`) | `skiSchool`, `kidsArea`, `cheapLodging` | winter, summer (0.4) | 4000 / 14 / 21 | +10 % | `priceAlign: 'cheap'`; **`dayClassMult { off: 1.5, regular: 1.2, peak: 0.3 }`** = weekdays only (Mon-Thu x1.5, Fri x1.2, weekends / holidays x0.3); x1.15 while Come by Train runs (`trainCampaign` facility) |
New prerequisites (`createSim` `met`): `poolOrViews` = an **active lodging whose attraction spec has the pool amenity** (Lodging v2, `spec.amenity === 'pool'`: the Luxury Hotel, but any future building with the amenity counts; no building id is named) **or** at least `VIEWS_MIN` = 2 active viewpoint buildings (`BuildingDef.viewpoint`: Viewpoint, Treehouse); `toilets` = an active Toilets block; `cheapLodging` = an active Apartment, Campground or Base Lodge (the plan's "base lodge rooms", so it is met in every resort that has its lodge). Show me opens the Buildings drawer on `viewpoint` / `toilets` / `apartment`.
**Train synergy**: `bonus: { id: 'trainCampaign', factor: 1.15 }`. Like every effectiveness it is read when the campaign **starts** (the "Facility bonus" line in the breakdown), so start Come by Train first. **Come by Train** also gets `extraTargets { senior 0.6, school 0.5 }` (the segment targets are untouched).
**Pricing keys**: the new types have no `GuestTypeKey` of their own; they follow their marketing segment (`segmentKey`): Senior = **couple** (`SENSITIVITY` 1.0, `AFFORD_SHARE` 0.9), School group = **budget** (2.2 / 0.55, so a dear day pass costs a class trip far more than a senior). So `SENSITIVITY` / `AFFORD_SHARE` needed no new keys (a test pins the mapping); the Budget Skiers campaign and the price elasticity of the budget segment therefore also move school groups, Hike & Bike / couple campaigns also move seniors.
**Advisor** (`marketing.wellness`, `marketing.school`; Show me -> the campaign card): "Seniors and couples would love a Wellness & Views campaign" (not spring, >= 10 guests, 3 stars, startable, cash >= $12,000 / keep $8,000) and "Quiet weekdays: try the School Trips campaign" (January or summer, startable, cash >= $6,000 / keep $4,000; not in a new game's first December week).
**ROI preview**: the "+X % arrivals" line now counts `extraTargets` too (it showed nothing for the Angler campaign before).

## Known limitation
Arrivals are throttled by arrival capacity (parking / road in-flight capacity) in the default starter resort: demand multipliers show in `Spawner.status().rate` but realised arrivals only grow when capacity is not binding (the tests widen `BUILDINGS.parking.capacity` temporarily). UI is untested in a browser (DOM tests only).
