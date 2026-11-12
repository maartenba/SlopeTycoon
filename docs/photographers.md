# Photographers

A guest type that comes for the light (index 13, `photographer`). Code: `src/config/photographers.ts` (every number), `src/sim/guests/PhotoLight.ts` (the light), `PhotoBuzz.ts` (the small arrival bonus), `Decision.ts` (`choosePhoto`), `GuestSim.ts` (`photoShoot`, `photoSession`), `Spawner.ts` (arrival weight). Tests: `tests/sim/guests/photographers.test.ts`; real page: `npm run photographer:sanity`.

## Light (pure of seed, day, weather)
The sim rolls the same `specialSky` (dawn / dusk quality 0.6..1) and `fogDay` (inversion mornings) the Atmosphere layer draws (docs/atmosphere.md), without the render-side "yesterday was wet" memory, which the sim cannot know after a load: after-rain skies can look special on screen without the sim counting them. Storm, rain and heavy snow give no light; snow halves the plain light.
* Shoot windows (`lightAt`): dusk `sunset - 1.25 h .. + 0.5 h`, dawn `sunrise - 0.25 .. + 1.25`, inversion fog `sunrise + 0.25 .. 9.5 h` (quality 0.6 + 0.4 x fog). Quality = the special quality, or 0.3 on a plain day.
* Arrivals (`arrivalLight`): weight x `0.3 + 0.7 x min(1, 2 x light)`: 0.3 away from the light, about 0.8 on a plain golden hour (dusk window `sunset - 3 .. - 0.5 h`, dawn `sunrise - 0.5 .. + 1.5`), up to 1.0 on a special day, times the type's season share and weather row (storm 0, rain 0.15, heavy snow 0.2).

## Behaviour
1. Needs an active Viewpoint or Treehouse (`requires`), level 2. No viewpoint = no photographer (the plain bot builds none).
2. In a shoot window with an unused session bit (`GuestStore.eve`: 1 morning, 2 evening; photographers keep the bits until 04:00), it sets out `walkLead` (1.5 h) before the light for the best spot: score = view x spec weight x (0.5 + 0.5 light) - 0.012 x distance. A trail goal tile exists (snow-free trail): a one-way Excursion hike (planning allowed until sunset + 2.5 h, never turned back, always packs a lunch). Otherwise the building is reached by foot (footpath beside it); winter needs that footpath.
3. At the spot (`photoShoot`): the `photo:taken` event (light, shots = 3 + round(4 x quality)), happiness + 0.1 x quality, the view's own `viewed` effect, the stop lasts 0.5-1.0 h by quality. Late (no light) = an ordinary visit, no photo.
4. Then the normal day: a hot drink (`foodPrefer` terrace / café / hut, `eatBonus` 0.5). Photographers leave at sunset + 1 h on a day with an evening light, else with the day guests.
5. Look: `HairStyle.Beret` (flat beret) and a camera body + lens at the chest. No raised-camera pose and no flash animation (not done).

## Effects
* Spend: only what they buy (a coffee, lift tickets): budget 90-170, no ticket of their own. Small on purpose.
* Photo buzz (`PhotoBuzz`, observer state, saved as `photoBuzz` only once a photographer has shot): each session adds 0.0015 x light, capped at +4 % arrivals, x0.85 each day (the Tourist Office is a flat +6 %).
* News: a milestone the first time ("Photographers have arrived for the light"); the achievement **Golden hour** (20 sessions on one special-sky day, `photo:golden`); the Rudi tip `photo.viewpoint` (a viewpoint stands, no photographer yet).
* Sound: the Photo-mode `shutter` role, quiet, only when the camera is near the spot (`main.ts`).
* No campaign ("Photo Weekend" skipped: the campaigns table needs prerequisites and a price model for little gain).

## Balance
No viewpoint = no photographer, and the balance bot builds none, so goldens are unchanged. `npm run analysis:roi` has no row for them (the type has no building of its own).
