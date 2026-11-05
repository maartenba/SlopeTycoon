# Playtest: music (owner mp3 files) + proximity audio (nature, streams, bar music)

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
1. **Game music is stopped near an open Apres-Ski Bar or Schirmbar** (open, serving): zoom in: within about a second the game music fades out and a bar song fades in (never both). Zoom out / walk away: the bar song fades out, the game music returns after a moment, **from where it stopped**. Tune `HANDOFF` (enterLevel .12, exitLevel .04, dwell, fades).
2. **No flip-flop**: zoom in and out repeatedly at the edge of the bar's reach with the mouse wheel: it must not stutter between the two musics (min times 3 s / 4 s, dwell .5 s / 2 s).
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
