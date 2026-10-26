# M5.2 playtest checklist (ground-level views, about 20 minutes)

Start a **new 128 Normal game** (or Continue a save with a built resort, a chairlift and a gondola; in summer for the bike). Settings (gear icon): check Graphics (default med) and **Gameplay > Ride-along slow motion**.

**Decision needed from you**: ride mode currently slows the game to 15 % ("slow-mo") so a ski run lasts a few seconds instead of half a second. It is now a setting, **Ride-along slow motion: On/Off, default On**. Should On stay the default? (Please also say whether 15 % feels right.)

1. **Skier top to bottom**: select a skiing guest on a piste > *Ride along*. Is the horizon / the heads of other skiers at about your eye level? Does the run feel smooth, are trees and other guests believable, any pop-in or flicker of trees near you (stipple grain at 5 to 11 tiles is known)? Press **N** a few times (next guest), **C** (recentre), drag to look around, wheel for FOV. **Esc** returns to exactly where you were.
2. **Chairlift**: ride a guest on a chair (Inspect a rider on the lift line, or use N until you land on one). Do you see the chair's frame, the cable overhead at a natural place, other riders' heads at about your height, the towers passing? Does the view sway pleasantly (not nauseating)? Try Reduced motion in Settings (no sway / bob).
3. **Gondola** (needs an open gondola, a "large" resort): interior view with benches, windows, the window frame overlay.
4. **Bike** (summer): ride a mountain biker: bob / handlebar feel, trail view.
5. **Switch guest with N** repeatedly, also while the target leaves the map (should hop to another guest, no error).
6. **Photo mode (P)**: from iso, then from a ride. Try: hero shot, drag orbit, WASD / wheel, filters (Warm, Cool, Vivid, Mono, Vintage), vignette, each frame, aspect ratios, **time of day** (dusk / night), snow / rain toggle. **Save PNG** (Enter or the button): open the downloaded file: **is the sky in the file** (not transparent / black), correct framing, filter and frame applied? Check the **gallery** tab (thumbnail, larger view, Save again, Delete). **Esc** exits to the previous view.
7. **UI hides / restores**: in ride and photo only the HUD / photo panel + toasts show; after exit everything (drawers, top bar, goals, advice) is back, the camera is where it was, speed and overlays restored.
8. **Performance feel**: F3 > Perf: note fps in iso vs ride vs photo with many guests (try 256 maps and Graphics low / med / high). Does low noticeably help? Any hitching when the near trees / figures appear?
9. Anything that looked wrong close up (a figure floating or sunk into the snow, a chair too small / large for its riders, roofs filling the screen, fog colour mismatch with the sky)?
10. **Walk mode**: answered yes; see the Walk mode section below.

## Known gaps (not bugs to report)
- No depth of field, no camera roll, no hide-guests toggle in photo mode.
- Building close-up detail is minimal (walls are the iso meshes; roofs dither away within 3 tiles).
- Trees and buildings are much larger than people (chibi scale, deliberate); gondola cabins are small inside.
- Lifts that are closed (no snow) carry nobody: no POV on them.
- Real-GPU performance is unmeasured (only software rendering was available): your fps numbers are the first real data.

## Walk mode (new, desktop only: please try it)
Enter with **V** (starts on the nearest footpath), **Shift+V** / the walking-man button (top bar: click to choose where to drop in, or drag the button onto the map), the View drawer or **Walk here** in a building's inspector. **Drag with the left mouse button to look** (the cursor is never captured; Settings > Walk: mouse look = Pointer lock if you want the immersive mode, Alt frees the mouse). **T** teleports (bird's-eye drop). Esc returns to the exact iso view.
1. **Feel**: WASD + mouse. Is 1.6 tiles/s (walk) / 3.2 (run, Shift) comfortable or too fast / slow? Mouse sensitivity and FOV (Settings > Gameplay), head bob (nauseating? try turning it off / Reduced motion), run toggle.
2. **Village**: walk the path around the Base Lodge. Do lamp posts, guests, fog and sky look right at eye level? Anything clipping (camera inside a building / tree, a wall filling the screen)? You can walk through fences and lamp posts (decor has no collision): is that OK?
3. **Collision**: buildings, lift stations / towers, trees, rocks, lakes / streams are blocked (bridges are walkable). Do you slide smoothly around trunks or get stuck? Steep slopes (> 40 deg) slide you gently back.
4. **Footsteps**: snow crunch, gravel on paths, grass, wooden bridges, road. Is the level right next to the music / ambience (they should be a quiet texture)? Does the ambience change when you walk into a crowd / next to a lift?
5. **E**: look at a building / guest and press E (info card). At a lift's bottom station "E: Board ..." gives a cosmetic ride and drops you at the top. A closed lift tells you why. Nothing is charged and no guest is displaced.
6. **P** in walk mode takes you to photo mode at your eye; leaving it returns to walking.
7. **Game keeps running**: time keys + - . , work (Space hops); the sim carries on, you are invisible to guests.
8. **Start + drop (new)**: does V put you on a path, facing something sensible, never in the forest? Try Shift+V: does the figure follow the cursor, is the ring green / red correctly, does a red click drop at the nearest free spot? Drag the walking-man button onto the map and release; release over a panel / outside (cancel). Press T while walking and Esc (back to where you were).
9. **Mouse (new)**: drag to look feels right? Can you take a screenshot / leave the window / use the OS freely? Try Pointer lock in Settings: does Alt free the mouse, does a click re-capture, does Esc leave?
10. **Rough edges (new)**: lamp posts, benches, planters and hedges now block you; guests / animals nudge you; deer / sheep shy away within ~6 tiles; dusk windows glow amber; walking under a thick forest makes the wind quieter (~30 %).
Known gaps: pointer lock (and Alt-to-free) is only unit-tested, no touch, no entering buildings, no thin-segment fence collision (the lodge fence is covered by the footprint), guests do not react to you.
