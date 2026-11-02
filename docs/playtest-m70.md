# Playtest M7.0: Atmosphere (owner STOP)

Agents only saw SwiftShader (software GL) screenshots. Please judge on a real GPU:

1. Settings > Graphics > **Atmosphere**: Off / Low / High. Off should look exactly like 0.3.1. Default should be High on your desktop.
2. Play a few winter / autumn mornings (speed 3x from 06:00). Do **valley fog banks** show up on roughly one morning in six, with the summits clear on some? Is the fog too thick or too milky? Does it burn off by ~11:00? Does the HUD show "· fog"?
3. **Special skies**: roughly one sunrise / sunset in four should be pretty (warm sky, pink snow on the summits for ~40 min). Are plain days still plain? Is the grade subtle enough or too orange / pink?
4. Night: ride-along or walk mode: stars, moon with a phase that changes over ~30 days. Photo mode at night: saved PNG has the stars / moon.
5. Frost sparkle on a cold clear morning (High), dawn mist over a lake, a rainbow after rain (rare). Anything distracting?
6. Photo mode > Scene: the Golden hour / Foggy valley / Frosty morning / Starry night buttons appear only when the day supports them.
7. Reduced motion on: everything must be static (no drifting fog, no twinkle).
8. **Performance + flicker** on the real GPU: FPS with Atmosphere High vs Off (fog costs a few ALU ops per fragment; one extra draw call only when mist is visible). Any shimmer on the fog edge while orbiting? Any "Render problems" in F3?
9. Buildings sit crisp inside the fog (guests / animals too): fine, or should they fade?

Open questions for the owner: fog opacity (`ATMOS.fog.maxOpacity` 0.7), special-day share (~27 %), default level on mid-range laptops.

## What the agents looked at (release prep, SwiftShader)

Shots `atm2-lvl-off|low|high` (fog + special sky + stars forced, 07:48, walk view), `atm2-rainbow`, `atm2-mist2` (pond, mist vs none), and the four site shots. Honest reading:

* **Fog** (Low / High) is a grey-pink veil that lowers contrast and saturation toward the distance; buildings and trees stay visible and the hill behind them fades. Low vs High look almost the same in this view (High adds frost / mist). It reads as haze rather than a thick bank from a first-person height; from the iso camera it is a faint veil over the whole village.
* **Special sky**: warm lilac to pink horizon; subtle, not orange. The alpenglow on far snow is hard to see at this distance.
* **Rainbow**: soft pastel arc, readable, not garish.
* **Pond mist**: soft white puffs around the water, clearly there compared with the same shot without it.
* **Night**: stars and a moon with a visible phase (walk view); in the iso view the sky only shows at the corners.
* Cloud shadows in the zoomed-out iso view look like a blotchy white / blue pattern on the snow; it may read as terrain noise rather than shadow: judge on your GPU.
* Not seen: summits rising out of the fog (the demo valley is flat from the ground), the real GPU look and frame rate.
