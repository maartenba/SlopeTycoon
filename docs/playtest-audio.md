# Playtest: music (owner mp3 files) + proximity audio (nature, streams, bar music) + recorded samples

**Nothing here was heard by the agent that wrote it** (no audio device): the logic is tested with fake media elements and `npm run music:e2e` reads the audio graph in Chrome, but nobody listened. Please check by ear, with the Music slider at its default (50 %) and the ambience slider at its default (28 %) and again at 60 %. **All music tables (track trims, playlists, situation rules, hand-off, bar level) live in `src/config/audioMusic.ts`; all proximity constants in `src/config/audioProximity.ts` (`PROX`).** The track table, the mapping and how to swap a track: `docs/audio.md` "Music".

## A. Level (the owner said the music is a bit loud: the default is now 3 dB lower)
1. Music 50 %, master 70 %: is the music now comfortable under the sound effects and the ambience, on laptop speakers and on headphones? Too quiet / still loud: change `MUSIC_TARGET_LUFS` (game / menu -20, bar -18) and recompute the `trim` column (docs/audio.md), or the slider default.
2. The title music and the in-game music should sit at the same loudness; the bar songs about 2 dB hotter than the game music (ambience bus at 28 %, `BAR_AUDIO.busBoost` +5 dB makes up for the quieter bus). If a bar song is too loud or too quiet at the default sliders: `BAR_AUDIO.busBoost`.
3. Do any two tracks differ in loudness noticeably (the trims are measured LUFS, not by ear)? Note the track and adjust its `trim` row.

## B. What plays when
1. Winter morning: Mountain Morning / Winter Early slopes alternate. From 11:00 with a busy resort: Winter Day (note: it is one song, so when it ends the next comes from the morning pair). Snow in the daytime: Winter Snow. Dusk: Evening Corner. Night: Melted Snow and Vinny F Minor alternate. Summer / spring day: Meadow Loop / Pastoral Walk. Autumn: Autumn's Gentle Sway / Autumn Gold. Storm or heavy snow: Tente Restringida. A festival: Festival groove.
2. **Changes feel natural**: the hour ticking over or a short weather flicker must not swap the song mid-way (it waits for the end); a storm, nightfall and a festival cut in with a 5 s crossfade (`MUSIC_PLAY.situationCrossfade`), never more often than every 150 s (`SITUATION.minChangeGapSec`). Too slow / too eager? `SITUATION.settleSec` (20 s), `minChangeGapSec`.
3. Crossfade at the end of a song (4 s, `MUSIC_PLAY.trackCrossfade`): smooth, or do the tail of one and the start of the next clash? Next track in Settings: 2.5 s crossfade, keeps playing while the dialog pauses the game.
4. One-song situations (Winter Day, Winter Snow, Evening Corner, Tente Restringida, Festival groove): when they end, a track from the neighbouring situation plays (`FALLBACK`). Is that acceptable, or is a pause / repeat better?
5. Pause (speed 0), mute (M), Ambience only, the Music checkbox: fades out and, when back, continues the same song where it stopped (not from the start). Switching to another browser tab: silence, and the song continues from the same place when you return, without a burst.
6. Start of a session: nothing sounds until the first click; the first song starts about 1.5 s later with a slow fade-in. Offline (after one earlier session that played the track): it works; offline with a file never played: silence, no error dialog.
7. Title screen: Seasons of Management opens (it is the title theme), Seasonal Menu follows; starting a game fades it out; the game music starts after the first click on the game page.

## C. Bar songs and the hand-off
1. **Game music is stopped near an open Apres-Ski Bar or Schirmbar** (open, serving): zoom in: within about a second the game music fades out and a bar song fades in (never both). Zoom out / walk away: the bar song fades out, the game music returns after a moment, **from where it stopped**. Tune `HANDOFF` (enterLevel .28, exitLevel .09, dwell, fades). Since 2026-11-06 it starts only slightly closer (about 12 tiles from the bar, zoomed in) and the bar song stays for at least 10 s (`HANDOFF.minApresSec`: 4 -> 30 -> 10 on 2026-11-06, 30 was too long; the game music keeps 30 s).
2. **No flip-flop**: zoom in and out repeatedly at the edge of the bar's reach with the mouse wheel: it must not stutter between the two musics (min times 3 s / 10 s, dwell .5 s / 2 s).
3. The first bar song is fetched when you come into reach of the bar: is there a silent gap between the game music fading out and the bar song starting on a slow connection?
4. Staying at the bar: the four songs (Ski Hut Groove, Polka Party Time, Alpine Après-Ski, Après-Ski Brass) alternate and crossfade; leaving for less than 25 s and coming back resumes the same song, after longer the next one plays (`BAR_AUDIO.restartAfterSec`).
5. Ambience slider at 0 or mute: the bar is silent and the game music keeps playing. The faint crowd murmur under the songs: does it clash? If so lower `PROX.apres.murmurMax` (.05) or remove the layer.
6. Close the bar (or wait until after closing time): the song fades out within a second or so and the game music returns. Two bars side by side: louder, never more than the cap (`PROX.apres.cap`).

## D. Proximity checklist (unchanged)
1. **Birds / nature**: at the default zoom rare and soft; zoomed in close (summer morning) they come forward. Tune `nature.far` (0.08), `nature.power` (2), `chirpGain` (0.8).
2. **Streams**: zoom in beside a stream or a dug river: a soft brook; faster (rapids) water brighter and louder. Zoom out: silent. Winter with ice: silent. Tune `stream.zoomFar/zoomNear/reach`, ceilings `AMB.layerMax.stream` (0.17) / `rapids` (0.14), `stream.flow`.
3. Ponds / lakes: barely audible lapping only when very close (`pond.max` 0.45).
4. Mute (M), ambience slider at 0, and switching to another browser tab: everything stops; coming back must not burst.
5. Zoom in and out with the mouse wheel: no zippering / pumping (layers ease over about 1 s).


## E. Recorded samples (CC0 recordings, 2026-11-06; nobody has heard any of this: the checks below are all by ear)

Use `?size=64&seed=61`, headphones, ambience slider at the default (28 %), effects at the default. Compare once with `?nosamples=1` (the synthesised versions only): the recording version should feel like the same game with more real sounds, not louder. After the first minute the recordings are cached; the very first footsteps / beds may still be the synth (that is by design: the synth plays until a file is decoded).

- [ ] **Footsteps variety** (walk mode): snow, gravel / path, grass, wooden bridge or deck, road / stone. No two identical steps in a row, a small pitch and volume wobble, no machine-gun repetition at a run. Level: a texture under the ambience, not an event (about as present as the old synthesised steps).
- [ ] **Birds not too present**: spring / summer mornings zoomed out they are faint, zoomed in they come forward (the owner's earlier rule). Partridge calls by default, a gull now and then, a rare night bird on a warm night. None of them should startle.
- [ ] **Wind and rain beds, loop seams**: stand still 2 minutes in a storm (wind) and in rain (zoom in): no audible click, bump or "the same second again" every 25-30 s (wind plays two beds of 30.5 s and 26.5 s so they never line up). Light wind to storm crossfades without a gap. Rain at the default is below the old synthesised rain (it was already loud).
- [ ] **Crowd** (a busy base area, zoomed in): the recording (it is a shouting / speaking crowd) should not sound like a stadium; it sits under the synth murmur at about the old level. If it is too much: lower the `crowd` gate weight in `BED_SLOTS` or raise `SYNTH_KEEP.crowd`.
- [ ] **Lift hum near stations** (zoom in on a running lift): a soft mechanical bed with a squeaky-wheel clank now and then; not a tonal drone (the two short hum loops under it are the risk: if one loops audibly, remove `lift-hum` / `lift-hum-b` from `BED_SLOTS`).
- [ ] **Thunder** (a storm): rare (about once every 75 s), distant, rumbling, not louder than the wind bed's gusts; it must not make you jump.
- [ ] **Snow cannon** (a running cannon at night / cold, zoom in beside it): a steady hiss that fades out within about 14 tiles; silent when the cannon is paused or off.
- [ ] **Bells**: church hour strike (one bell per strike), cowbells near pastures in summer (and the herd bed under them), the crossing bell as a loop while a train passes the barrier, sleigh bells near a sleigh ride, the lift-opened bell ding.
- [ ] **Avalanche** (a controlled release or a natural one): a deep rumble / distant blast, loud enough to notice, not harsh. 'Reduce loud sounds' halves it.
- [ ] **Autumn rustle, pond lapping, tree creaks, drips**: all very quiet; the leaves rustle in autumn wind, lapping only zoomed in at a lake in spring / summer.
- [ ] **Mute / sliders**: M mutes samples and beds immediately; the effects slider scales footsteps / bells / avalanche, the ambience slider scales beds, thunder, birds, bells.
- [ ] **Offline** (after one session online): airplane mode, reload, play: recordings still play (cached); a sound that was never played online is the synth.


## F. The faint beep / honk (owner report after 0.6.0, 2026-11-06; nothing here was heard by the agent)

What was found by measurement (`npm run build && npm run audio:census`: the large demo resort on 128 / seed 5 at speed 3, ambient and event sounds counted with the new debug log, ~90 s per camera position): the **church hour chime** was by far the most frequent sound. A game hour is 6.25 s at 1x, any building counts as the village, and the chime was a 0.43 s dense recording: 18 to 50 strikes per real minute at speed 3 (about one per game hour, so a strike group every ~6 s of daytime at speed 1). Now 2 to 3 a minute and the soft synthesised bell. Table (counts per 90 s, speed 3, before -> after): churchBell 27 / 42 / 75 -> 3 / 2 / 4 (default view / on a lift / in the village); chairlift squeak 1-2 -> 0 (the lifts of the demo were not busy, see the by-ear checks); everything else (beds starting, ka-ching, news chime, creak, blip) unchanged and at most a few per minute. I could NOT reproduce a honk from the crossing bell (the demo resort has no level crossing) or from cars (there is no car or horn sound in the game: `grep -ri "horn\|honk" src/audio` finds nothing).

To match what you hear to a line (about 3 minutes):
1. Open the game, press F12 (console) and run `__slope.audio.log(true)`. Every ambient one-shot and every loop that starts now prints a line: time, kind (`shot` / `loop` / `ring`), id, `sample` or `synth`, the file for samples and the gain. `__slope.audio.log('all')` also prints UI and event sounds (clicks, hover ticks, chimes); `__slope.audio.log(false)` stops.
2. Play at speed 1, zoomed in over houses and a lift, until you hear the beep. Note the line that scrolled by at that moment: its id tells the culprit (`churchBell` = the hour chime, `clank` = the lift squeak, `crossingBell` / `crossing-a` = the rail crossing, `birdChirp`, `cowbell`, `chimeImportant` / `alarm` / `blip` / `hover` = UI and event sounds).
3. `__slope.audio.counts()` lists every id with its count and per-minute rate since the log was switched on (`log(true)` again resets it).
4. Compare with `?nosamples=1`: if the beep stays, it is a synthesised sound (source `synth` in the log); if it goes, it is a recording.
5. Tell me the id. If it is not on the list above, the `hover` tick (2.2 kHz, on every button you move over) is the next candidate; it is a UI sound and not part of this change.

Checks after the fix: the hour passes without a bell at every hour (at most one chime a minute); the lift squeak is rare (about one every 12 s at most, only zoomed in on a running lift); the crossing bell is heard only when you look at a crossing with a train coming and are zoomed in; the music: a song that just started is not replaced by night or a storm before 30 s (Next track works at once); apres-ski music begins only when you are clearly near the bar (about 12 tiles, zoomed in) and a bar song is not cut by a quick fly-by.
