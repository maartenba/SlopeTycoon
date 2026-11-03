# Playtest: music rework + proximity audio (nature, streams, Apres-Ski Bar)

**Nothing here was heard by the agent that wrote it** (no audio device): levels come from reasoned estimates and offline renders (`tests/audio/proximity.test.ts`). Please check by ear, with the ambience slider at its default (28 %) and again at 60 %. **All proximity constants live in `src/config/audioProximity.ts` (`PROX`), all music / bar-music / hand-off constants in `src/config/audioMusic.ts`**; the ambience ceilings are `AMB.layerMax` in `src/audio/Ambience.ts`.

## A. Listen to the previews first (`npm run audio:export`, folder `.weave/audio-previews/`, see its `index.md`)
Each file is a software render of the real code, normalised to -17 LUFS (music) / -15 LUFS (bar music). Judge arrangement and sound there; judge the in-game LEVEL in the game (previews are much louder than the defaults).
1. Go through `01`-`19`, `90` one by one. For each: is it still "meh"? If yes, is it the **melody**, the **timbre**, the **beat** or the **arrangement**? Do the sections read as intro / verse / chorus / bridge / outro, is the chorus bigger than the verse? Counter-melody audible but not fighting the lead?
2. Beat tracks (`11 alpine-noon`, `15 night-chill`, `19 festival`): is the swing pleasant (`MUSIC_MIX.swingLofi` .3, `Theme.swing`), do pads "breathe" with the kick (`sidechainDepth` .28 too much / too little), is the delay tail nice (`delayWet` .16, `delayFeedback` .36), are fills too frequent?
3. Piano / mallet / warm lead timbres (`12 snow-piano`, `10`, `15`): natural or toy-like? (`piano`, `mallet`, `warmLead` in `instruments.ts`.)
4. `20`-`23` the four bar variants: **danceable?** Kick / clap / off-beat hats / bass clear? Does the build-up (snare roll + riser + gap) and the drop land? Is the accordion / brass hook catchy and singable, not shrill (`accordion` / `brass` gains in `instruments.ts`, `APRES_SONG.sectionGain`)? Which variant do you like best?
5. `30 handoff-demo`: game music -> (walk up) fade out ~0.7 s, then the bar fades in -> (walk away) the bar fades out, then the game music fades back in from the start of its chord. They must never overlap; no clicks.

## B. In the game
0. Music default levels (Music 50 %): check the tracks are still quiet and restrained; the bar music (ambience bus, 28 %) should be about 3 dB hotter than the game music, clearly a party. If not: `APRES_SONG.outGain`.
1. **Game music is stopped near an open Apres-Ski Bar** (winter, open, serving): zoom in to the bar: within about a second the game music fades out and the bar music starts (never both). Zoom out / walk away: the bar fades out, the game music returns after a moment, continuing the same piece (not a new one). Tune `HANDOFF` (enterLevel .12, exitLevel .04, dwell, fades).
2. **No flip-flop**: zoom in and out repeatedly at the edge of the bar's reach and with the mouse wheel: it must not stutter between the two musics (min times 3 s / 4 s, dwell .5 s / 2 s). Too sticky? lower `exitDwell` / `minApresSec`.
3. Ambience slider at 0 or mute (M): the bar is silent and the game music must keep playing (not be paused for a silent bar). Another browser tab: everything stops, no burst on return.
4. Staying at the bar for several minutes: the song loops with a varied hook; leaving for more than 25 s and returning starts it over from the intro.
5. Time of day / season / weather: snow in the day = Snow Piano; night = Starlight or Night Chill; summer day = Summer Meadow; storm = Blizzard; tempo should be a bit slower in autumn / winter / snow.
6. Title / Menu themes: only reachable via Settings > Music style (the title demo has no audio engine). Do they fit?

## Proximity checklist (still valid, bar items updated)
1. **Apres-Ski Bar (winter, daytime or evening, bar open and serving)**: zoom in until the bar fills a good part of the screen. The party groove (see section A) should come in smoothly after the game music has faded out, clearly audible, with a faint crowd murmur. Zoom out: it should fade to silence around the default view. Too quiet/loud? `APRES_SONG.outGain` (1), `murmurMax` (0.05). Too far-reaching? `reach` (22 tiles), `zoomFar` (34).
2. The game music is STOPPED near the bar, not ducked (see section B).
3. Close the bar (or wait until after 23:00): the music must stop within a second or so. Two bars side by side: louder, but never more than the cap (`apres.cap`).
4. The bar music should sound cheerful, not shrill: if the accordion / hats are too bright lower `cutoffNear` (9500); tempo per variant is `APRES_SONG.bpms` (124-128).
5. **Birds / nature**: at the default zoom they should be rare and soft; zoomed in close (summer morning) they come forward as before. Tune `nature.far` (0.08), `nature.power` (2), `chirpGain` (0.8).
6. **Streams**: zoom in beside a stream or a dug river: a soft brook; faster (rapids) water should sound brighter and louder. Zoom out: silent. Winter with ice: silent. Tune `stream.zoomFar/zoomNear/reach`, ceilings `AMB.layerMax.stream` (0.17) / `rapids` (0.14), flow mix `stream.flow`.
7. Ponds / lakes: barely audible lapping only when very close (`pond.max` 0.45).
8. Mute (M), ambience slider at 0, and switching to another browser tab: everything including the polka must stop; coming back must not burst.
9. Zoom in and out with the mouse wheel: no zippering / pumping (layers ease over about 1 s).
