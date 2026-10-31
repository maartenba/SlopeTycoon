# M6.7 / Phase 6 final human playtest checklist (Task 43 STOP)

Version 0.3.0. The last Phase 6 milestone: **Mountain Concert** (1-10 September) and **Snow Concert** (1-15 March), both next to the Summer Music Festival, plus the whole Phase 6 content set (`docs/phase6-status.md`). Agents verified everything headless (gate, balance, perf, shot suite, sanity stories, touch subset; numbers in `docs/release.md`). They cannot judge a real GPU, sound by ear or a real touch device: that is this list. Version stays pre-release (never 1.0).

## A full Career year (the main test)
- [ ] Start a **fresh Career game** on 128 (new random seed), play through one full 180-day year at speed 3 / 10 with the new content: a river, a campground, a viewpoint, a petting zoo, a hotel, a coffee stand, a gondola with a mid-station, toilets and a rail crossing or footbridge. Does the pacing of unlocks (levels 1-4) feel right, and is nothing overwhelming?
- [ ] Winter: a sleigh, snowshoe hut, snowscooter base and a backcountry route; boarders and tourers show up. Summer: campers, bikers, anglers, rafting.
- [ ] Money: is summer income healthy without the bot's help (the agents' bot reaches 21-25 % of revenue in summer)?

## Concerts
- [ ] Without a gondola / cable car the Events card says *Needs a gondola or cable car* and **Show me** opens the Lifts drawer. Build one (level 3, 3 stars): the card unlocks and shows *Next: ...* with a real date. Rudi suggests a concert within about six weeks of a possible start.
- [ ] **Mountain Concert** (starts 1-10 Sep, 2 days, $9,000): book it, watch the stage go up. Where does it land (mid-station plaza > viewpoint > gondola top > base)? Is the spot flat, free and sensible, and does it block nothing?
- [ ] At night: do the **light cones** sway gently and look good (additive, no real lights)? With *Reduced motion* on they must stand still. One modest firework at the end of the summer edition; none with Feedback Off.
- [ ] **Snow Concert** (1-15 Mar, a late-season winter edition): snow roof, warm lamps, heaters, beanies; no fireworks. Does it read as winter?
- [ ] **Sound**: near the stage you hear a very quiet distant band and crowd murmur; away from it, nothing. It follows ambience volume and mute. Too quiet, too loud, annoying?
- [ ] Everything is removed after the event. Save mid-concert, reload: the stage returns. A 0.2.9 save loads fine.
- [ ] Both editions appear in a one-year run on autopilot with a gondola; the Music Festival still happens in June-August and does not overlap the concert.

## Performance on a real GPU
- [ ] 128 map, a busy summer weekend and a December weekend with 200+ guests, tour bases, a river, hotels and a concert on: frame rate acceptable? F3 shows **Render problems: 0** and a modest draw-call count (the concert adds at most 4 calls).
- [ ] Water, rapids foam, ice, pool steam, light cones, scooter spray look right on the GPU (agents only saw SwiftShader).
- [ ] Orbiting the camera around rivers, bridges and the stage: no shimmer or popping.

## Audio by ear
- [ ] Sleigh bells, scooter hum, campfire, river, crowd bed, concert murmur: all quiet, none fighting the music. The nine music tracks still rotate.

## Touch on a real device (phone and tablet)
- [ ] Drawers tuck away when painting; digging a river, placing a mid-station and painting a backcountry route work with the two-step flow at 44 px targets; the Events card (book a concert, Show me) is usable.

## Wrap-up
- [ ] Old saves (0.2.x) load; Settings, Statistics, the year report and the guide's Events page match what you see.
- [ ] Read the **guide** (Events, Summer, Hotels, Backcountry, Rails & bridges) and the landing page once: anything out of date or contradictory?
- [ ] Decide: approve 0.3.0 as the end of Phase 6, and answer the open owner questions in `docs/phase6-status.md` / the earlier `playtest-m6x.md` files.
