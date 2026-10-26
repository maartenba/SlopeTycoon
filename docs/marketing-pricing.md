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

## Known limitation
Arrivals are throttled by arrival capacity (parking / road in-flight capacity) in the default starter resort: demand multipliers show in `Spawner.status().rate` but realised arrivals only grow when capacity is not binding (the tests widen `BUILDINGS.parking.capacity` temporarily). UI is untested in a browser (DOM tests only).
