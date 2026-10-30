# M6.4 human playtest checklist (Phase 6, Task 30 STOP)

Version 0.2.8. Hotels and calmer guests: Small Hotel, Luxury Hotel with a steaming heated pool, Coffee Stand, Senior and School group guests, Wellness & Views and School Trips campaigns. Play a normal Career game (`npm run dev`, or the built game) on 64 or 128, aim for resort level 4 so both hotels are unlocked, and tick the boxes. Agents verified only what a headless browser can see (`npm run winter:sanity`, screenshots); feel, pacing and "does this read well" are yours.

Numbers from the agents' checks (`docs/balance.md` "M6.4 STOP check"): a bot that builds no hotel earns the same as before; the two new guest types move the bot's money by +8.7 % / +1.4 % / -3.2 % on three seeds (average +2.3 %).

## Hotels
- [ ] **Small Hotel** (level 3, Lodging tab): needs a road; refusal text reads well off a road. 40 rooms, $40 a night, a lobby restaurant that sells meals and fills in the evening. Does it feel like a worthwhile step up from chalets / apartments for $24,000?
- [ ] **Luxury Hotel** (level 4): 6 x 6 footprint, road, flat ground (auto-flatten). Look at it from all four rotations, at dusk and at night: warm windows, glowing pool, loungers, umbrellas. Anything clipping, floating or ugly?
- [ ] **Pool steam**: below 5 C a white plume rises over the pool (thicker when colder, also at night). Zoom in and out and orbit: no flicker, nothing popping, no steam in summer or above 5 C. Visible enough against snow in daylight (the agents could only see it clearly at dusk)?
- [ ] **Who sleeps in the suites**: the guide and docs say VIPs fill them first and others only overflow. Build a Luxury Hotel and watch the Rooms line in the inspector for a week without the VIP campaign: is it too empty to be worth $90 a day? (The agents saw 0 suites used in a summer week and 5 in a winter week on a small resort.) Run **VIP High-Rollers** and see it fill.
- [ ] **Pool use**: inspector shows Rooms, Pool x/20 and the Pool heating cost; heating about $17 a day in winter and more than a quarter of that in summer. Is the energy cost visible enough in Finance? Does solar / wind offset it (60 % cap)?
- [ ] The **Advisor** tip *VIPs need luxury lodging* (busy, 3+ stars, hotel unlocked, none built): shown at a sensible moment, "Show me" opens the Buildings drawer on the hotel.
- [ ] VIP campaign card now lists *Altiport, Luxury Hotel or 2+ chalets/apartments/hotels* and turns green with just a Luxury Hotel.

## Coffee Stand
- [ ] Place it beside a piste end, a lift bottom and a footpath; refused on a piste. Cheap ($1,200), a wisp of steam by day.
- [ ] Does it sell? Check its inspector after a day at a lift bottom vs. in a quiet corner. **Known gap:** skiers do **not** stop mid-descent (guests only decide at lift bottoms, piste ends and buildings); the plan's wording "skiers stop mid-run" is not literally met. Does that matter, or do stands feel dead? (If dead, a "passing within 2 tiles of an open stand" rule is the follow-up; it would move the ski goldens.)
- [ ] It does not replace the lodge or the café at lunch, and it does not fix the comfort urge (toilets do).

## Seniors and School groups
- [ ] **Seniors** (lilac cardigan, grey hair): appear from level 2 once a terrace, café or toilets exists, mostly on weekdays and in the quiet seasons. Do you notice them? Do they stay on green / blue / red runs, queue for the terrace and café, tire fast, ask for toilets?
- [ ] **School class** (orange bibs, 1 teacher + 8-15 children, arrives by coach): only weekdays, only 1-8 December, January and summer weekdays, never on a public holiday, and only with a ski school / kids ground / carpet (winter) or a playground / petting zoo / campground (summer). Does the class walk together to the ski school or petting zoo, queue, learn, eat and leave together? Does a full resort turn the coach away without a glitch?
- [ ] Are classes **too accident-prone**? On the agents' test resort the year-2 incident count went from 8 to 18 with the two new types and the safety award fell (`docs/balance.md`); check Statistics > Safety on yours.
- [ ] Do the two types feel like a real second crowd, or a trickle? (Seniors are 4-6 % of arrival weight, classes 1.5-2 % per arrival but 9-16 people each.)
- [ ] The guest inspector names the type; the reviews mention them sensibly.

## Campaigns
- [ ] **Wellness & Views** ($8,000, 21 days): card shows the pool-or-two-viewpoints, restaurant / terrace and toilets requirements with working *Show me* buttons, premium price alignment, seniors and couples uplift. Seniors rise after it starts.
- [ ] **School Trips** ($4,000, 14 days): requirements ski school, kids area and cheap lodging; the effect is weekday-only (check a weekend: weak). Stronger while Come by Train runs.
- [ ] **Come by Train** and **Family Summer Camp** now also push seniors / classes a bit: unsurprising?
- [ ] Advisor tips *Seniors and couples would love Wellness & Views* and *Quiet weekdays: try School Trips* appear at sensible moments (not in the first December week of a new game for the school tip).
- [ ] The Marketing drawer with 13+ cards still scrolls and reads well (also on a phone).

## Summer, energy, saves and touch
- [ ] A Luxury Hotel in **summer** on a road-connected site: looks right (blue roof, pool without steam), pool heating still costs a little.
- [ ] A busy December weekday on a 128 map with both hotels, a coffee stand, seniors and a class: frame rate acceptable; F3 shows *Render problems: 0*.
- [ ] Save mid-December with everything built, reload: identical (suites, pool slots, campaign timers). An old 0.2.7 save loads and nothing changes until you build.
- [ ] Touch (phone or tablet): placing both hotels and the stand with the two-step placement, reading the hotel inspector and the two new campaign cards at 44 px targets.

## Owner questions (answered)
1. **Luxury Hotel economy**: answered, couples in (about 45 % of couples, 12 % of others, more in winter / weekends, 4 nights of budget); VIPs still first. Check on the playtest that a mid-game resort fills about 40-70 % of the suites without VIPs.
2. **Coffee stand mid-run stops**: answered, a skier skiing within 2 tiles of an open stand (a little hungry or tired) stops 1 pass in 3, then carries on. Check that stands beside a piste feel alive, and that nobody stalls on the way.
3. **School groups and safety**: measured, classes cause 0 injuries (families 0.3-2.8 per 1000); the 8 -> 18 was noise from a shifted arrival draw. No change.
4. **Pool steam**: good, no change.
5. **Bot economy shift** (+8.7 % on 64 / 61, other seeds within +-3 %): still to confirm as acceptable.
