# M8 audit: owner check (5 minutes, before any model work)

Source: [`docs/graphics-audit.md`](graphics-audit.md) (task 8.0). Nothing was changed in the game; this is the list the agents want your eyes and wishes on **before** 8.2-8.7 start. Contact sheets: [categories](img/graphics-audit-categories.webp), [all buildings](img/graphics-audit-buildings.webp). The agent's view came from software-rendered stills (SwiftShader), so **your real-GPU opinion beats mine**.

## 1. Rate the ranked list (agree / disagree / skip)

For each item write 1 (leave alone) .. 5 (fix first). My ranking is on the left.

| Rank | Item | What I saw | Your rating |
|---|---|---|---|
| 1 | Map edge / cliff skirt | flat brown-grey gradient slab | |
| 2 | Lift drawer icons | the same yellow cabin for almost every chairlift | |
| 3 | Snowcat | stack of boxes | |
| 4 | Animals (deer, ibex, ...) | rectangular bodies, stick legs | |
| 5 | Cars and other road vehicles | box stacks, 5 car styles look alike | |
| 6 | Ride-along close parts (T-bar seat, chairs, tower, helmets) | big chunky boxes | |
| 7 | Conifers | stacked cones, no branching | |
| 8 | Guests | thin tube limbs, cubic heads | |
| 9 | Rocks | uniform faceted blobs | |
| 10 | Terrain surface | snow = large soft blotches | |
| 11 | Water edges | tile-shaped zigzag stairs | |
| 12 | Deciduous trees | lumpy blobs, trunk hidden | |
| 13 | Main buildings (lodge, chalet, apartment, hotels ...) | good, but gable boxes with thin eaves | |
| 14 | Lift stations, towers, chairs / cabins at iso zoom | boxy canopies, tiny carriers | |
| 15 | Low-end buildings (Stunt Park, Adventure Park, Playground, Sled Rental, Boat Rental, Snowscooter Base) | flat plank layouts | |
| + | Shadows (8.6) | nothing casts a shadow | |

## 2. Your wishes (add or remove items)

- Anything you dislike that is **not** on the list? (a specific building, lift, guest, animal, the title screen, the logo ...)
- Anything on the list that you **want kept as it is** (charm over realism)?
- Which 3 things should the promo video show off most?

## 3. Decisions the agents need (small)

1. **Trees are 59-92 % of all iso triangles** (92 % on a 256 map). A +25 % cap on the whole frame leaves little room if trees grow. OK to give trees only about +10 % (conifer 72 -> 80 triangles, oak 140 -> 150) and spend the rest on buildings / lifts / guests / animals? yes / no / other:
2. **Shadows on high:** the extra shadow pass redraws the casters, which adds draw calls and triangles on high only. OK to count D8-2 "+0 draw calls" for the **main pass** only and report the shadow pass separately? yes / no:
3. **Lift drawer icons** are 2D icons, not rendered meshes: OK to redraw them as per-family icon art (T-bar, fixed chair, detachable, bubble, gondola, cable car, funicular)? yes / no:
4. **Water edges**: I would smooth the *drawn* shoreline only (sim tiles stay square). OK? yes / no:
5. Anything you want to stay **exactly as 0.4.0**:

## 4. Optional real-GPU look (2 minutes)

Open the game at 100 % on your normal monitor, **Graphics: med**, and look at: a forest edge in winter, the village at dusk, a deer herd, the snowcat and parking lot, a T-bar ride-along (V / the ride button), a river. Tell me if the "blocky" feeling I scored matches yours, and report the F3 **fps** for med on a 128 map (this is the real baseline the agents cannot measure).
