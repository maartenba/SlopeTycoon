# M8 graphics pass: owner playtest (real GPU and phone)

Everything in M8 was judged from software-rendered stills (SwiftShader, no GPU), so **only you can sign off the look and the speed**. Details and numbers: [`graphics-m8.md`](graphics-m8.md) (before / after), [`shadows.md`](shadows.md), [`graphics-audit.md`](graphics-audit.md) (the baseline). M7.6 (scene films) starts after this sign-off.

## 1. Speed (F3 shows fps / draw calls)

On your laptop, 128 map, a built-up resort with guests, default zoom and zoomed in:

| Setting | fps default zoom | fps zoomed in | OK? |
|---|---|---|---|
| Low | | | |
| Medium (the default) | | | |
| High (shadows) | | | |

- Is **Medium** as fast as 0.4.0 felt? (Medium triangles are +3 to +5 % vs 0.4.0, draw calls equal.)
- Is **High** playable? If not, tell me the fps: I can lower the shadow refresh (`ShadowRig.refreshHz`) or the window.
- 256 map at wide zoom on High: the tree shadows switch off by themselves; does it still feel fine?

## 2. Shadows (High only)

- Pan and rotate slowly over forest and the village: do shadows **shimmer, swim or crawl**? (They should only move in whole texels.)
- Run the clock from morning to evening: do shadows grow and fade smoothly, vanish at night, soften in snow or rain?
- Are they too faint, too strong or too blue? Noon with the default camera hides them behind the casters; rotate to see them.
- Do any shadows look wrong (on roofs, floating, striped, a hard edge at the shadow window)?

## 3. Phone (the one you tested 0.3.3 on)

- Open on Low and Medium. Does it get warm, drop frames or pan stiffly? (Default is Low on touch.)
- Is the map still readable with the new cliff edge and lift icons at 44 px?

## 4. The look: say what you like and what is still blocky

Per area, write 1 (worse) / 2 (same) / 3 (better) and a short note. Honest note from the agent: at default iso zoom, buildings and lifts look **very close to 0.4.0** (the rounder shapes show only in close-ups and in the ride-along); the clearest wins are the map edge, shorelines and the conifers.

| Area | Rating | Notes |
|---|---|---|
| Conifers (whorls) in winter and summer | | |
| Deciduous crowns, rocks | | |
| Animals (deer, ibex, foxes, farm animals if you built a farm) | | |
| Guests (scarf, limbs) | | |
| Buildings (hotels, barn, ranger, toilets, cannons ...) | | |
| Lift stations, towers, chairs, cabins (iso and ride-along) | | |
| Cars, bus, train, helicopter, snowcat | | |
| Map edge (rock layers) | | |
| Shorelines (rivers, ponds, ice) | | |
| Snow and grass surface | | |
| Lift drawer icons and the Buildings drawer thumbnails | | |
| Night windows and lit lifts, dusk and dawn | | |
| All four seasons | | |

## 5. Wishes for a follow-up round

List the **specific assets** you still find blocky or bulky, in priority order (building, lift, animal, guest, tree species, vehicle). I only had the budget for a part of the list; the rest of the 69 buildings were touched lightly or not at all (see the audit). Also: anything that got worse, anything you want back as it was, and whether High should become a "Shadows" toggle of its own instead of a tier.

## 6. Known gaps (from the notes)

- Only the terrain receives shadows; no self-shadowing on buildings or trees; no shadows in ride / photo / walk views; terrain casts none (no hill shadows at dawn).
- Winter pan flicker on dense conifers is about 0.09 points higher than 0.4.0 in the harness (0.65 % vs 0.56 % oscillating pixels): look for shimmer on snowy conifers while panning.
- The F3 line "Render problems" was not individually read in a shot: check it says 0 on your GPU.
