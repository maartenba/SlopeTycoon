# M6.3 human playtest checklist (Phase 6, Task 26 STOP)

Version 0.2.7. Summer content: campground, petting zoo, viewpoint, treehouse, quad base, climbing crag, rafting and canyoning bases, tackle hut + piers + fish stock + ice fishing, mountain biker and angler guests, Family Summer Camp and Angler's Paradise. Play a normal Career game (`npm run dev`, or the build) for 40-60 minutes on a 128 map (for example `?size=128&seed=5`, where the natural spring makes a good river) and go through one full year, so you see a winter, a summer and an autumn. Use F3 > debug (`__slope.sim.jumpToDay(...)`) to reach summer, and `?scenario=` is not needed. Nothing here is automated: agents cannot judge look, sound or feel. The owner decides whether M6.3 passes.

Numbers from the agents' checks (`docs/balance.md` "M6.3 STOP check"): the bot economy is unchanged, a bot with the summer buildings earns 21-25 % of its year-two income in summer (the plan's target was at least 25 %: this is the open balance question below).

## Summer build-up
- [ ] Start a Career game on 128, play the winter, reach summer. Does the Buildings drawer make the summer items easy to find (Recreation tab, season tags)? Which are locked at level 1 / 2 / 3 and do the lock texts read well? (Campground, Petting Zoo, Viewpoint open; Tackle hut, Treehouse, Quad Base, Crag from level 2; Rafting and Canyoning from level 3.)
- [ ] Does summer feel like a real second season now, or still a thin one? Compare with 0.2.6: how many guests, how much money, how many things to do?
- [ ] Is the summer income share right? Look at Finance for June to September against the year. Too low, about right, or too high?
- [ ] Ranger Rudi / the Advisor: *Summer nights: a campground*, *Campers want toilets*, *a quad base*, *Anglers need a campaign*, *Overfished*, *Family Summer Camp is ready*: shown at sensible moments, "Show me" goes to the right place.

## Each new attraction
- [ ] **Campground**: placement on gentle ground next to a footpath or hiking trail (try a trail-only spot: the inspector shows the supplied-on-foot surcharge). Tents, caravans, seats, signpost. At night the fire glows and smokes (no flicker while you orbit, no hard light), the crackle is quiet and only near it. Campers sleep, the fire evening cheers them (more with toilets within 10 tiles). Closed in winter ("Closed for the season").
- [ ] **Petting zoo**: pen with goats, sheep, rabbits and a donkey that wander inside the fence, asleep in the shed at night, nothing when zoomed far out. $8 entry, families come, the keeper is needed. Closed in snow.
- [ ] **Viewpoint**: build it on a ridge, then low down. High: hikers walk up, stop longer, the bonus goal fires. Low: almost nobody. The Photo mode *Viewpoint* button jumps to it. Looks right (platform, railing, telescope).
- [ ] **Treehouse**: refuses without a forest (message: needs at least 6 trees within 3 tiles), keeps the trees, sits on the slope without a grey skirt, rope bridge. Hikers visit.
- [ ] **Quad Base**: needs a road or footpath; every two hours between 10:00 and 16:00 a convoy of four quads with dust goes out and comes back; quiet engine drone near the camera only; closed in wind, snow and winter. The wildlife flees, the sustainability facet drops a little (never more than 3 points).
- [ ] **Climbing crag**: refused away from steep bare rock (message names the rock rule); with a rock face: climbers on ropes on the real rock, eight at a time, instructor optional (half capacity without; inspector says so), a rare twisted ankle that the patrol answers.
- [ ] **Rafting base**: needs brisk flow within three tiles. Try a natural stream, then a river you dig on a slope. Two rafts of four go downstream with splashes at the rapids, guests come back by shuttle. Closes in a storm, on ice and in late-summer low water (read the inspector).
- [ ] **Canyoning base**: needs a steep rocky stretch (gorge); descents look plausible; same closures.
- [ ] Both water bases: does the placement ghost show the route clearly, and do the refusals explain what to change?

## Anglers, fish stock, ice fishing
- [ ] **Tackle & Bait Hut** within three tiles of a lake / pond / river; **Fishing pier** on the shore (needs the hut first). Anglers (teal, cap, rod) appear at the hut, the pier and the bank, bobbers bob.
- [ ] Anglers only arrive once a hut with fish exists. Revenue (day ticket, rod hire, bait) shows up in the Finance categories.
- [ ] **Catch & release / Keep** in the hut inspector. Keep for a few days on a small pond: the stock drops fast, **Overfished** warning from the Advisor, anglers leave unhappy. Switch back: the stock regrows.
- [ ] **Ice fishing**: in a hard winter the lake freezes, anglers move onto the ice (hole, stool, rod, no pier needed), rivers are not fished. Does it look charming rather than silly? Is it a fair winter income?
- [ ] Sustainability: a healthy stock adds a little, an empty water subtracts a little (at most two points).

## Guest types and campaigns
- [ ] **Mountain bikers** (lime, helmet) show up in summer only once you have a rideable MTB trail and an open bike-capable lift; they ride the trails and rent bikes. Easy to spot in the crowd?
- [ ] **Angler** guests read as a separate, quiet crowd; they do not flood the resort.
- [ ] **Family Summer Camp** card: shows what is missing (Campground, kids area or petting zoo) and "Show me" works; with a petting zoo the bonus line appears; it does not ask for a ski school. Families arrive.
- [ ] **Angler's Paradise** card: needs a hut on water with fish; anglers arrive during it, it fades when the fish run low and is weaker in winter.
- [ ] Do the two cards fit the Marketing drawer (scrolling, wording, price and duration)?

## Rivers and tours together
- [ ] Dig a river from a spring on a slope (Landscape > Water), put a rafting base beside it, and a canyoning base where it is steep and rocky. Fill the river in: the bases close with a clear reason. Freeze: closed. Reload: all restored.
- [ ] A footpath bridge over the same river (suspension or ordinary) does not break the tour route.

## Performance and look
- [ ] A busy summer resort with all of the above on a 128 map: frame rate acceptable on your machine; F3 shows *Render problems: 0*.
- [ ] Night view of the campground, zoo and tackle hut: nothing flickers while orbiting; the fire glow is not too bright.
- [ ] The Recreation tab with 12 cards: scroll arrows and card art fine; the pricing panel lists the new items with sensible ticket ranges ($8 zoo, $12 ticket, $30 raft, $35 canyoning, $40 quad, $30 crag).

## Save and touch
- [ ] Save mid-summer with everything built (a river, a base, a hut with Keep set, a running campaign), reload: identical (hut setting, fish stock, campaign timers, campfire evening state).
- [ ] An old 0.2.6 save loads (no summer buildings): nothing changes.
- [ ] Touch (phone or tablet): placing a campground, pier and base with the two-step placement, the hut inspector toggle (Catch & release / Keep) and the Marketing cards are all usable at 44 px.

## Open questions for the owner
1. **Summer share**: the bot with the summer buildings earns 21-25 % of its yearly income in summer (the plan said at least 25 %). Is that fine, or should the summer buildings earn more (price, appeal, capacity)? Changing it moves the money goldens.
2. Quad tours' sustainability cost and wildlife scare: right amount?
3. Ice fishing in winter: keep (the current default `ICE_FISHING = true`) or cut?
4. Are the level gates (campground / zoo / viewpoint level 1, hut / treehouse / quads / crag level 2, rafting / canyoning level 3) in the right order?
