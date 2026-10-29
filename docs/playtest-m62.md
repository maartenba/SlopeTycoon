# M6.2 + M6.6 human playtest checklist (Phase 6, Tasks 18 and 40 STOP)

Version 0.2.6. Rivers, springs, flow, ice, the suspension footbridge, mid-stations and the six-seat chair. Play a normal Career game (`npm run dev`, or the build) for 30-40 minutes on a 128 map (for example `?size=128&seed=5`, where the first natural spring makes real rapids); tick what you see. Anything that feels wrong: note the seed, what you did and a screenshot. What the agent already checked (headless, SwiftShader, no GPU): `npm run phase6:sanity` (river + bridges + mid-station gondola + ride-along + save / reload, identical state), the standard gate, `test:balance`, `test:perf`, `shot:suite`, `analytics:e2e`, `offline:splash`, the touch subset, and `npm run flicker` on a river and a mid-station scene. What it cannot judge: how it looks and feels on a real GPU, real frame rate, audio, pointer lock, a real finger.

## Rivers and springs (level 2 in Career)
- [ ] Landscape drawer > Water: **Dig river**, **Place spring**, **Fill in river** cards; the lock text on the first two below level 2 reads well, **Fill in river** is never locked.
- [ ] Cyan rings mark 1-3 natural springs while the Water tab is open (and only then); the **Springs** button hides them. A spring with a river on it turns grey-blue.
- [ ] Press on a spring, drag to a lake, a stream or the map edge: the ghost shows the route (blue to orange = how deep it cuts), its length, drop and price, and it follows the fall line without you drawing it. Release digs it; the channel is one tile wide.
- [ ] Refusals read well: not on a source, uphill, too deep, a building / lift / path in the way, ends in dry ground.
- [ ] Undo / redo of a whole river is one step; **Fill in river** puts the ground back (refused under a bridge: *A bridge crosses the river: remove the bridge first*, and while another river joins it).
- [ ] **Place spring** ($250) works on rising ground; also from the Terrain drawer.
- [ ] Save, reload: the river, the springs and the carved ground are exactly as before.
- [ ] Digging a river does not break the piste tools: a piste cannot be painted over a river (frozen or not).

## Flow and ice (look)
- [ ] Rivers on a steep slope show rapids: white water, moving texture, a few splashes (not more than a handful at once). Calm stretches look smooth. The direction of the ripples is downstream.
- [ ] Spring (April-May) runs faster than late summer; use `__slope.sim.jumpToDay(...)` (F3 debug) if you do not want to wait.
- [ ] Winter: after a few cold days the dug river freezes over (white, still), a hard thaw opens it again; natural streams / ponds / lakes look as they did before.
- [ ] No shimmer or crawling water while orbiting the camera (compare with a natural stream).
- [ ] F3 shows *Render problems: 0* in the river scenes.

## Bridges over rivers and the suspension footbridge (level 3)
- [ ] Drag a footpath, a hiking trail, an MTB trail and a road across a dug river: each gets its bridge at the usual price (*over stream*).
- [ ] Drag a footpath / hiking trail across a deep gorge, a lake or a wide river (5-12 tiles): it becomes a suspension footbridge by itself; the ghost names span, deck level and price ($400 a tile + $800). Too long reads *Span too long: max 12 tiles*; steep banks *Too steep: the banks are too uneven ...*.
- [ ] The bridge looks right: two towers, sagging cables, plank deck that dips a little, snow on it in winter, hand ropes.
- [ ] Guests walk across on the deck; hikers stop mid-span for the view (hiking version); the Rudi / viewpoint wording does not mention anything odd.
- [ ] **Walk mode**: enter walk mode on one bank and walk over the suspension bridge and a normal footbridge (this was a wall in 0.2.5 builds until the sanity walk found it): the camera follows the deck, no sliding back, footsteps change to wood.
- [ ] Bulldoze the bridge: all of it goes, half is refunded, undo brings it back; save / load keeps it.

## Mid-stations and the six-seat chair (level 3 for the chair)
- [ ] Build a gondola (or cable car, or a detachable chair); select it: the inspector shows *Stations: 2* and **Add mid-station** (not for T-bars, fixed-grip chairs, funicular).
- [ ] Add mid-station: the ghost snaps to the nearest valid spot, shows price / ride time or the refusing segment; click builds it (hall with platforms and a *MID STATION* sign, cabins slow down in it), the lift must be empty first.
- [ ] Guests ride to the mid-station and get off about a third of the time; they take a run from there (build a piste starting at the mid-station: it becomes its own run). Nobody pays twice for the same day.
- [ ] Summer: hikers / bikers ride up and walk the trails from the station nearest their goal (the mid-station as a trailhead).
- [ ] The cable car stops at every station (capacity drops); gondola / chairs keep their cadence.
- [ ] Remove mid-station refunds half of the extra cost; undo / redo work; save / load keeps the stations.
- [ ] Ride-along on a guest riding the lift: the camera goes through the mid-station and the guest gets off as expected. Walk mode: board at the bottom or mid station, <kbd>E</kbd> gets off at the mid-station.
- [ ] **Chairlift (6-seat, high-speed)**: teal station, visor chairs; compare its capacity with a quad and a six-pack in the lift inspector (more than a quad, a bit slower to board than the six-pack).
- [ ] Night: the mid-station is readable (lamp posts); no flicker on the cable or the hall while orbiting.

## Touch (phone and tablet)
- [ ] Phone upright and tablet: open Pistes & Trails, pick Ski piste, switch to paint mode: the drawer steps aside when you touch the map, the ☰ button in the left column brings it back, a tap on the dock brings it back too.
- [ ] Landscape drawer on a phone: dig a pond, dig a river (tap the end again or **Place** to confirm), place a spring.
- [ ] Mid-station and suspension bridge are usable with 44 px targets; the lift inspector buttons are reachable.

## Performance and general
- [ ] Frame rate with a river in view and a gondola with mid-stations on a 128 / 256 map feels like before (note the F3 numbers).
- [ ] Nothing in an old save changed (load a pre-0.2.6 save: lifts are plain two-station lifts, no rivers, the natural springs appear only on the Water tab).
- [ ] Anything about the writing, prices or unlock levels that feels off.

Sign-off: the owner approving the river look, the rapids / ice and the mid-station on a real GPU closes Tasks 18 and 40.
