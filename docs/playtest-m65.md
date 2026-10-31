# M6.5 human playtest checklist (Phase 6, Task 35 STOP)

Version 0.2.9. Winter adventures and the backcountry: Sleigh Stable, Snowshoe Hut, Snowscooter Base, paintable **Backcountry routes** with an avalanche danger from 1 to 5, the **Snowboarder** and **Ski tourer** guest types, the **Powder Hounds** campaign and the retargeted **Snowboard Park Jam**. Play a normal Career game (`npm run dev`, or the built game) on 128 in winter, aim for resort level 3 so everything is unlocked (the sleigh and the snowshoe hut at level 2, the scooter base and backcountry at level 3), with a Ski Patrol Hub and a Mountain Hut or restaurant. Try one 64 map as well. All of it is ON, no flag.

Numbers from the agents' checks (`docs/balance.md` "M6.5 STOP check"): the bot paints no route and builds no tour base, so it draws no tourers; the Snowboarder carve-out moved the bot economy by -5.0 % (64 / 61, 360 d), +1.1 % (128 / 7) and +1.3 % (64 / 5); boarders are injured at 4.8 per 1000 guests, the same as budget / couple guests. `npm run backcountry:sanity`, `winter:tours`, `winter:sanity`, `summer:sanity`, `phase6:sanity` and `play:sanity` all pass.

## Winter tours
- [ ] **Sleigh Stable** (level 2, Recreation tab, $5,500): place beside a road. The ghost / refusal text says what to build beside it. A sleigh with a horse and six passengers leaves every two hours from 10:00; ticket $25. Do the bells (very quiet, close camera only) fit? Is the sleigh readable at the default zoom?
- [ ] **Snowshoe Hut** (level 2, $2,800): needs a **Hiking trail** touching the hut. Does the placement tip make that clear? A footpath alone gives access but no route: is the closed reason (*Needs a connected route of 6-24 tiles starting at the base*) understandable? Eight walkers in a line with poles and packs. **Known cosmetic gap:** the poles are thin and hard to see at the default zoom.
- [ ] **Snowscooter Base** (level 3, $9,000): convoy of six scooters on a road, footpath or trail, never a piste; snow spray puffs; the engine hum (quiet). Wildlife scatter near the route; check Statistics / sustainability: the penalty is capped at 3 points, shared with the Quad Base.
- [ ] All three close in a **storm**, outside winter (*Closed for the season*) and when the snow is unstable; the snowshoe walk is the most careful one.
- [ ] Roofs of the three bases: the snowy roofs read slightly **lavender** on the shaded side (the game's snow shading); acceptable, or too pink?
- [ ] The Advisor tip *Winter idea: off-piste fun* appears (30+ guests, a lodge, some road) and opens the Buildings drawer on the sleigh.
- [ ] Are the three worth their price? Sleigh and scooter tickets pay back inside a season with 30+ guests; the hut is cheap but small.

## Backcountry routes and danger
- [ ] **Pistes & Trails > Backcountry route** (level 3, $15 a tile): paint from a lift top / hut / piste end / trail; painting from nothing says it is not connected. Violet dashed track and flag poles every few tiles, trees are not cleared for you. Is it clear this is not a piste (no grooming, no colour)? Erase it again.
- [ ] Select a route tile: the inspector shows the **danger rose** and a name (*Low (1)* ... *Very high (5)*), Open / closed reason, length, patrol cover. Pennant colours on the poles follow the level; a closed route's poles have a dark cross-bar. Is the colour-blind palette setting respected, and is the text enough on its own?
- [ ] After a snowstorm (heavy snow for a day or two on a steep route) the danger climbs. **At 4 the route closes by itself** (*Avalanche danger 4*), a news line appears, nobody is on it. It reopens when the snow has settled or after the 04:00 control blast with a Ski Patrol Hub close by. Does the danger move at a pace you can follow (hourly)? Does it feel too slow or too fast on a real map? (Agents tested with injected slab loading on a flat approach.)
- [ ] **Override**: tick *Open at danger 4+* (and *All routes*): a confirmation asks first (*Open at danger 4? Burials possible; patrol required.*); un-tick needs none. At 4+ with the override the Advisor warns *kept open at danger 4+*, and an open route outside patrol cover warns too.
- [ ] **Nobody dies**: a slide over a busy route buries guests; patrol / the helicopter dig them out or they go to hospital. Check the wording of every news line and inspector text: injuries only.
- [ ] Do regular advanced skiers and boarders going off-piste use open low-danger routes (they prefer them)?

## Guests
- [ ] **Snowboarders** (purple jackets, beanies, boards): about a third of the winter crowd, none in summer. They fill the Stunt Park and like wide pistes; a catwalk-heavy resort gets a few unhappy reviews. Do the Statistics "Guests by type" card and the guest inspector name them? Do you notice the change from the old purely cosmetic boarders?
- [ ] **Ski tourers** (red shell, backpack, touring skis; level 2): they appear only while an open route below danger 4 exists, take one lift up and skin up the route, spend little and love a mountain hut. How many do you see per day? Do they stop when you close the route or the danger rises to 4? When you override a route at 4+, they still stay away (regular skiers may not).
- [ ] A tourer already on a route when the danger rises keeps going until they finish (compressed-time excursion): acceptable?

## Campaigns
- [ ] **Powder Hounds** (winter, $5,500, 10 days): card shows the three requirements (open route below 4, active Ski Patrol Hub, restaurant / café / mountain hut) with working *Show me*; it **pauses while every route is closed**; a powder day makes it stronger. Do tourers and riders rise after it starts?
- [ ] **Snowboard Park Jam** now targets Snowboarders: the card text says so; the rise appears in the boarder share. Two Advisor tips (*Powder Hounds*, *Snowboard Park Jam*) show up at sensible moments.
- [ ] The Marketing drawer with 14+ cards still scrolls and reads well (also on a phone).

## Saves, performance, touch
- [ ] Save mid-winter with a route, a storm in progress, a closed route and an override set, reload: identical danger, closure and override. An old 0.2.8 save loads and nothing changes until you paint a route.
- [ ] A busy December weekend on a 128 map with all three tour bases, a route and 150+ guests: frame rate acceptable; F3 shows *Render problems: 0*.
- [ ] Touch (phone or tablet): paint a route with the two-step flow, open the route inspector (tap a flag), tick the override and confirm at 44 px targets.

## Owner questions
1. **Economy**: the bot's 360-day money on 64 / seed 61 is -5.0 % (other seeds +1 %): acceptable, or tune the boarders' spend?
2. **Boarder safety**: boarders have 4.8 injuries per 1000 guests (the same as the core types they come from, +33 % against everybody else). Leave it?
3. **Tourer volume**: winter weight 0.04, spring 0.025 (about 3 tourers in a winter week on the agents' test resort). Enough to make a route worth painting?
4. **Danger pacing**: the danger is recomputed once per game hour from the existing avalanche model; a route on a flat approach never rises on its own. Should flat routes be exempt from the danger scale entirely, or is that fine?
5. **Scooter vs. wildlife**: the capped 3-point sustainability penalty (shared with quads): keep?
