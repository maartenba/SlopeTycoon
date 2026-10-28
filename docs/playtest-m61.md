# M6.1 human playtest checklist (Phase 6, Task 12 STOP)

Version 0.2.3. Play a normal Career game (`npm run dev`, or the build) for 20-30 minutes; tick what you see. Anything that feels wrong: note the seed, what you did and a screenshot.

## Toilets and urges
- [ ] A new career game has one free toilet near the village footpath.
- [ ] Open a guest inspector after a while: thoughts like "I could do with a toilet." appear, and the guest walks to the toilet and the urge drops.
- [ ] Build more toilets: beside a footpath, on a hiking trail, on a piste edge (NOT on a piste tile). Check the $600 price and $3/day upkeep.
- [ ] With no toilets and 12+ guests Ranger Rudi nags; the rating panel shows the **Facilities** bar with a sensible hint.
- [ ] One toilet block with a lot of guests shows "Used today: n/70" and goes *overrun*.
- [ ] Mood sag from an unmet urge feels mild (no one leaves because of it).

## Level crossings and trains
- [ ] Build a rail line with a Train Station, then drag a footpath across the line at a right angle: tooltip shows the crossing and $150.
- [ ] When a train approaches the barriers close, lamps blink, a quiet bell rings (and fades when you zoom away); guests wait on the approach side and carry on afterwards. No guest or car is ever on the track with a train.
- [ ] A road across the line ($400) makes cars wait.
- [ ] Refused cases read well: diagonal stroke, next to another crossing, at the station, on a bridge.
- [ ] Bulldoze the crossing tile: plain rail again. Undo / redo it.
- [ ] Set **Cross rails** to **Bridge** and cross again: a timber footbridge with stairs ($900); guests walk up and over and never wait. Ranger Rudi suggests it when many guests waited.
- [ ] Known gap: walk mode and ride-along do not climb the footbridge stairs (walk mode follows deck height now but was not verified on the stairs).

## Bridges over streams, ponds and gaps
- [ ] Paths drawer: pick Footpath (or Road / a trail) and drag across a pond or gap: the matching bridge is part of the stroke. Tooltip: span, deck height, supports, price (or the reason).
- [ ] Footbridge connects two footpaths; guests walk across on the deck (not under it).
- [ ] Hiking bridge for a Hike trail, MTB bridge for an MTB trail: hikers / bikers use it.
- [ ] Road bridge (one lane) lets cars drive to a car park on the far side; it needs flat banks.
- [ ] Refusals: too long (> 4, road > 3), bank in water, something under the span, "Bridges only cross water or a gap".
- [ ] Bulldoze any tile of a bridge: all of it goes, half refunded; undo brings it back. Save / load keeps it.
- [ ] Rail never bridges ("Rail cannot cross water").

## Campaigns
- [ ] Marketing drawer shows **Come by Train**, **Snowboard Park Jam**, **Hike & Bike Weekends**, **Festival Season** with requirements and **Show me** buttons.
- [ ] Come by Train with a served Train Station near the lodge: the car park empties a bit, the card shows "By train: n % (station n/150)"; Rudi suggests it when the station idles or the car park is full. Without a station the card says what is missing.
- [ ] Snowboard Park Jam needs a Stunt Park. Hike & Bike Weekends: strong on weekends, weak Mon-Thu. Festival Season: only works around a booked festival.

## Access and upkeep
- [ ] A Mountain Hut / Ranger Station / Adventure Park / Alpine Farm served only by a trail works, and the inspector says "Supplied on foot: +25% upkeep" (a footpath or road next to it removes the surcharge).

## Inert on purpose (must NOT be visible yet)
- [ ] **Viewpoints**: no viewpoint building can be placed; Photo mode has no Viewpoint button unless one exists (the system is dev-docs only, `docs/viewpoints.md`).
- [ ] **Tours**: nothing is offered anywhere (`docs/tours.md`); no new inspector rows or UI.
- [ ] Lodging tiers / guest-type framework: nothing new in the UI beyond the Statistics "Guests by type" card.

## Also check
- [ ] Phone / tablet: toilets card, Cross rails control are tappable (44 px), no overflow in the Paths drawer (the automated phone drawers check passed).
- [ ] Balance feel: the first year is a bit tighter than 0.2.2 (bot profit -5.8 % in the golden); is it still fun?
- [ ] Performance on your GPU with several crossings, bridges and many guests.
