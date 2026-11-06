# Audio (Task 30)

Sound effects and ambience **mix recorded CC0 samples with sounds synthesized live with the Web Audio API** (the synth is always the fallback, see "Samples" below). The **music is mp3 files** generated with Suno and provided by the project owner (`public/audio`, see "Music" below). Code lives in `src/audio/`.

| File | Role |
|---|---|
| `backend.ts` | Tiny structural `AudioBackend` interface (+ real `AudioContext` wrapper). Tests use `tests/audio/fakeBackend.ts`. |
| `AudioEngine.ts` | Lifecycle state machine (`locked → running`, `blocked` when autoplay refuses, `suspended` when tab hidden, `unsupported` = silent no-op), bus graph (voices → music/sfx/ambience bus → master → compressor → out), voice pool (≤ 24, priority stealing). |
| `synth.ts` | Noise buffers (white/pink/brown, 9 s, DC removed, generated once, seamless loop crossfade), envelopes, `NodeScope` (tracks/disconnects nodes), FM helper (SFX only), reverb impulse (unused by music now). |
| `Sfx.ts` | One-shot recipes + `Sfx.play(name, {pitch, pan, gain, count, delay})`, rate limiting, ka-ching coalescing. |
| `Ambience.ts` | `ambienceMix(state)` (pure) + looping layers (built once) + random one-shot scheduling. |
| `eventSounds.ts` | Pure GameEvents → cues table (every event mapped or explicitly ignored; unit-tested) and news chime rule. |
| `spatial.ts`, `worldProbe.ts` | Camera-relative pan/gain; samples the sim (guest density via SpatialHash, water tiles, nearest lift/snowcat/heli/cows/buildings, altitude) into an `AmbienceState` at ~10 Hz. |
| `AudioSettings.ts` | Volumes/mute/reduce-loud/ambience-only, persisted under `slope.audio.v1`. |
| `Music.ts`, `BarMusic.ts`, `MenuMusic.ts`, `TrackPlayer.ts`, `musicPlaylist.ts`, `musicHold.ts` | The music: game player, bar player, title player, the shared mp3 player, pure selection logic and the hand-off state machine (see "Music"). Tables: `src/config/audioMusic.ts`. |
| `index.ts` | `createAudio(deps)` wiring (bus subscriptions, first-gesture unlock, visibility, UI button ticks via delegated capture listener, `M` mute key, 10 Hz tick). |

UI: `⚙` in the top bar opens `<st-settings>` (4 sliders incl. Ambience, mute, music on/off + Next track, reduce-loud, ambience-only, shortcuts to graphics quality / fast nights / unmute news). A 🔇 icon (bottom-left) shows until audio is unlocked (or while muted).
Tutorial / other code can call `audio.sfx.play('chimeInfo')` etc. (`window.__slope` does not expose it; main.ts holds `audioRef`).

## Verification status
The ambience beds are **rendered offline and analysed objectively** (software Web Audio renderer in `tests/audio/offlineBackend.ts`): headroom, DC, clicks, spectrum, whistles / hum lines, loudness range and node budgets. The music is a set of mp3 files: its logic (which track when, crossfades, hand-off, pause / mute / hidden tab) is unit-tested with a fake media element, and `npm run music:e2e` checks the real player in Chrome. **Nobody has listened to the music in the game yet**: how the transitions feel, whether the levels sit right against the SFX and the ambience, and how the tracks feel over an hour are unverified by ear (the harness has no audio device). Walk-mode footsteps, spatial pan and the sfx recipes are estimates (see the notes in their sections).

## Walk mode footsteps and near-field (Task 12)
Five footstep recipes (`stepSnow / Gravel / Grass / Wood / Road`, `Sfx.ts`): noise bursts peaking 0.04-0.07 (click .18), `PRIORITY.ambience`, max 4/s, `loud` (halved by reduce-loud), pitch jitter per step. Cadence from walked distance (`stepStride`, `walkPhysics.ts`). The listener is the walker with `AMB.walkZoom` = 6 as the zoom proxy (near-field crowd / lift / birds / water). Levels are reasoned estimates, NOT heard (no audio device). See `docs/walk-mode.md`. Forest shelter: >= 10 trunks within 6 tiles of the walker lower the wind bed by up to 30 % (`AmbienceState.shelter`).

## Tunable constants (where)
- Defaults: `DEFAULT_AUDIO_SETTINGS` (master .7 / music .5 / sfx .8 / ambience .28 since the audio redesign (.45 before, .7 originally); see Mix levels; the music loudness targets are in `audioMusic.ts`, see Music > Default level), `REDUCE_LOUD_FACTOR` (.55) – `AudioSettings.ts`.
- Compressor (threshold −16 dB, ratio 6; −24 dB in reduce-loud), `MAX_VOICES` (24), `PRIORITY` – `AudioEngine.ts`.
- Per-sfx loudness (`peak` args × `o.gain`), `maxPerSec`, `minGap`, `group`, `loud` – each entry of `RECIPES` in `Sfx.ts`.
- `AMB.closeZoom/farZoom` (zoom in visible tiles at which the view counts as close/far), `AMB.layerMax` (ceiling per looping layer), `AMB.rates` (one-shots/s), `AMB.fadeTc` (crossfade, s) – `Ambience.ts`.
- Formulas inside `ambienceMix` (season/weather/time weights, e.g. `birdSeason`, `warm`, `quiet`, night factors, crowd saturation `30` guests) – `Ambience.ts`.
- Layer sound design (filter centres, LFO speeds, osc pitches) – `LAYER_BUILDERS`.
- Listening radius / reach distances (lift 40, buildings 35, cat 60, heli 80, cows 30, `LISTEN_TILES`) – `worldProbe.ts`; pan/attenuation `ref` – `spatial.ts`.
- Tick rate: `tickEvery` (0.1 s) in `createAudio`.

## Mix levels (M5.1)
User feedback: the wind/snow bed was too loud by default. Only ambience was lowered; sfx and music levels are unchanged. No audio device was available: figures are reasoned estimates from `src/audio/mixLevels.ts` (pure), and the Task 8 playtest checks "wind no longer dominates at default settings" by ear.

| Constant | Old | New | File |
|---|---|---|---|
| `DEFAULT_AUDIO_SETTINGS.ambience` | .7 | .45 | AudioSettings.ts |
| `AMB.layerMax.wind` | .5 | .2 | Ambience.ts |
| wind recipe gust gain | .7 | .5 (LFO ±.25) | Ambience.ts |
| `AMB.layerMax.muffled` (snow/winter bed) | .25 | .175 (−30%) | Ambience.ts |
| `AMB.layerMax.rain` | .35 | .245 (−30%) | Ambience.ts |
Other defaults: master .7, music .5, sfx .8, `REDUCE_LOUD_FACTOR` .55. Other `layerMax` values were lowered again in the audio redesign (see "Ambience rework": leaves .2, crickets .05, insects .05, crowd .2, lift .16, water .2, snowcat .16, heli .2). Zoom (`closeZoom/farZoom`) and crossfade (`fadeTc`) behaviour is untouched.

Migration: a persisted `ambience` of exactly 0.7 (the old default, `LEGACY_AMBIENCE_DEFAULT`) is read as the new default .45; any other saved value is kept. (A user who deliberately chose exactly .7 gets .45 too; accepted.)

Model: `nominalLevel(bus, layer?)` = bus volume × `layerMax` × recipe gain × noise RMS × spectral share. `NOISE_RMS` .25 (normalised noise, crest ≈3.6), `SPECTRAL_SHARE` wind .5 / crowd .5 / muffled .3 (filter chains), `RECIPE_GAIN` wind .86 / crowd .92 / muffled 1 (re-derived after the ambience rework), `SFX_REF_PEAK` .126 (.18 typical recipe peak × .7), `MUSIC_NOMINAL` .12, `AMBIENCE_ONLY_MIN_EFFECTIVE` .15 (ambience bus × master).

Targets (`MIX_TARGETS`, tested in `tests/audio/mixLevels.test.ts`): wind peak ≤ −12 dB vs sfx; ≤ −9 dB vs music; wind+snow+crowd at peak (coherent sum) ≤ −6 dB vs sfx; ambience-only effective gain ≥ .15 (now .315, .173 with reduce-loud).

Estimated dB at defaults (old → new), vs sfx / vs music: wind −7.7→−21.5 / −3.2→−17.0; snow −17.7→−24.6 / −13.2→−20.1; crowd −11.3→−15.1 / −6.8→−10.6; bed total vs sfx −1.8→−9.9.

## How to tune
1. `npm run dev`, click once (audio unlocks on the first click/key), open ⚙.
2. Too harsh/loud overall → lower `REDUCE_LOUD_FACTOR`/compressor or the specific recipe `peak`. Too quiet bed → raise its `AMB.layerMax` entry.
3. A layer is audible when it shouldn't be → read its formula in `ambienceMix` (unit tests in `tests/audio/ambience.test.ts` document expected behaviour; keep them green).
4. Loops audible as a pattern → increase `NOISE_SECONDS` in `synth.ts` (now 9 s) or add another `wander` term in the layer builder.
5. Too many one-shots → lower `AMB.rates.*` or the recipe `maxPerSec`.
6. Per-layer solo while debugging: in the console, `__slope` doesn't expose audio; temporarily set `AMB.layerMax` entries to 0 in code.

# Ambience: what was wrong with the first beds (analysis, audio redesign 0.2.x)
Measured with the offline renderer. (The procedural music that the same analysis covered was replaced by mp3 files in Nov 2026 and is not described any more.)

Measured on the old layers at ambience 100 % (`tonal` = strongest narrow line vs its neighbourhood; noise is ~3-8 dB, a tone 15 dB+):
| Old layer | Finding | Measured |
|---|---|---|
| **crickets** | pure **4.3 kHz sine**, gated by a **square** 2.5 Hz LFO (and a 26 Hz square inside): a beeping tone with hard on/off edges = broadband clicks every 0.4 s | tonal **15.5 dB @ 4301 Hz**, vertical click streaks on the spectrogram |
| **insects** | white noise through a **bandpass Q 9 at 6.2 kHz** modulated at 38 Hz: a ringing, whining resonance | narrow line, high-frequency whine |
| **lift** | 48 Hz **sawtooth** + 96 Hz sine + brown noise: a tonal 48 Hz **hum** with a harmonic buzz | tonal 5.4 dB but harmonic comb below 400 Hz; -20.5 dB RMS (the loudest bed) |
| **snowcat** | 38 Hz saw + 76 Hz **square** + 9 Hz LFO | tonal **13.5 dB**, -18.9 dB RMS (loudest of all) |
| **heli, wind** | wind = bandpass centre swept +-140 Hz by a single 0.06 Hz sine (a periodic "whoosh" every 16 s) | audible periodicity, 7.9 dB line |
| **water, leaves, crowd** | single-bandpass noise with a single sine LFO each (0.5 / 0.3 / 0.17 Hz): a *pulsing hiss*, not babble; leaves = 4.5 kHz Q1 band swishing at 0.3 Hz | periodic pumping |
| **all noise beds** | one **3 s** noise buffer looped (seam crossfaded, but the loop itself repeats 20 times a minute: a perceptible swish), the brown buffer had a drifting **DC** offset | loop period 3 s |
| **birdChirp** | **FM** (carrier 2.4-3.6 kHz, ratio 1.6, index 600 Hz) = metallic bleeps, 2.2 chirps/s at peak | harmonically rich sidebands |
| **cowbell / churchBell / clank** | square-wave cowbell (540 + 810 Hz), **inharmonic church bell** (2.76 / 5.4 / 8.93 x) on every hour (up to 3 strikes) when near buildings, square clank on every lift tower | more "bells" and ringing |
Also: the one-shot `drip` and `creak` (sawtooth through a Q 6 bandpass = squeak) were louder than the beds they decorate.

## Music (mp3 files, owner decision 2026-11-05)
All music is **generated with Suno and provided by the project owner** (no licence asserted beyond "owner-provided"; the in-game credit is "Music: generated with Suno."). It replaced the procedural music (the generators, instruments, `audio:export` and the Music style selector are gone). Sound effects and ambience stay procedural. Files: `public/audio/*.mp3` (clean ASCII names; `public/audio/README.md` lists the owner's original titles). Tables and tunables: **`src/config/audioMusic.ts`** (`TRACKS`, `PLAYLISTS`, `FALLBACK`, `SITUATION`, `MUSIC_PLAY`, `HANDOFF`, `BAR_AUDIO`, `MENU_MUSIC`); pure logic: `src/audio/musicPlaylist.ts`.

### Code
| Code | Role |
|---|---|
| `TrackPlayer.ts` | Plays the files: one `<audio>` element per track -> `MediaElementAudioSourceNode` -> track gain (trim x fade) -> the destination the owner class gives it. The bytes are fetched with a plain GET (a 200 the service worker can cache) and played from a blob URL, so a file is never decoded to PCM (a decoded track would be ~70 MB). Equal-power fades on the track gain. Elements are paused while the engine is not running (hidden tab, blocked) or held, and continue exactly where they were. A load failure resolves null. |
| `Music.ts` | The in-game music: situation tracking, playlist rotation, crossfades, pause / mute / speed 0 gate, hand-off hold. Graph: track -> hold (hand-off) -> gate (pause / mute) -> music bus. |
| `BarMusic.ts` | The music next to an open bar (owned by `Ambience`): bar playlist, proximity low-pass + level, hand-off fade. Graph: track -> low-pass -> level -> fade gate -> **ambience** bus. |
| `MenuMusic.ts`, `menuAudio.ts` | Title screen / main menu (own engine + settings, no sim). |
| `musicPlaylist.ts` | Pure: `situationFor`, `SituationTracker` (hysteresis), `pickNext` / `nextInPlaylist` (never the same track twice), fades, trim, day parts. |
| `musicHold.ts` | The hand-off state machine (unchanged logic). |

### Track table
Loudness measured with `ffmpeg -af ebur128` on the committed files; trim = 10^((target - LUFS) / 20); targets: game and menu -20, bar -18 LUFS.

| File | Title | Used for | Size | LUFS | Trim |
|---|---|---|---|---|---|
| `menu-seasons-of-management.mp3` | Seasons of Management | Title theme and main menu | 1.8 MB | -15.9 | 0.624 |
| `menu-seasonal-menu.mp3` | Seasonal Menu | Main menu (alternates) | 1.9 MB | -15.6 | 0.603 |
| `game-winter-mountain-morning.mp3` | Mountain Morning | Winter, dawn to late morning | 2.0 MB | -15.8 | 0.617 |
| `game-winter-early-slopes.mp3` | Winter Early slopes | Winter, dawn to late morning | 2.0 MB | -14.3 | 0.519 |
| `game-winter-day.mp3` | Winter Day | Winter day, busy resort | 2.4 MB | -15.4 | 0.589 |
| `game-winter-snow.mp3` | Winter Snow | Snowing in the daytime | 2.4 MB | -17.6 | 0.759 |
| `game-evening-corner.mp3` | Evening Corner | Dusk / winter evening | 0.8 MB | -16.6 | 0.676 |
| `game-night-melted-snow.mp3` | Melted Snow | Night (calm) | 2.5 MB | -16.4 | 0.661 |
| `game-night-vinny-f-minor.mp3` | Vinny F Minor | Night (chill lo-fi alternative) | 1.7 MB | -16.4 | 0.661 |
| `game-summer-meadow-loop.mp3` | Meadow Loop | Spring / summer day | 2.0 MB | -15.7 | 0.610 |
| `game-summer-pastoral-walk.mp3` | Pastoral Walk | Spring / summer day | 2.2 MB | -15.3 | 0.582 |
| `game-autumn-gentle-sway.mp3` | Autumn's Gentle Sway | Autumn day and evening | 2.3 MB | -16.3 | 0.653 |
| `game-autumn-gold.mp3` | Autumn Gold | Autumn day and evening | 2.8 MB | -16.0 | 0.631 |
| `game-storm-tente-restringida.mp3` | Tente Restringida | Storm / heavy snow | 0.6 MB | -17.8 | 0.776 |
| `game-festival-groove.mp3` | Festival groove | Festival on | 2.4 MB | -15.8 | 0.617 |
| `apres-ski-hut-groove.mp3` | Ski Hut Groove | Next to an open bar | 2.2 MB | -16.1 | 0.804 |
| `apres-polka-party-time.mp3` | Polka Party Time | Next to an open bar | 1.7 MB | -16.5 | 0.841 |
| `apres-alpine-apres-ski.mp3` | Alpine Après-Ski | Next to an open bar | 1.7 MB | -16.1 | 0.804 |
| `apres-ski-brass.mp3` | Après-Ski Brass | Next to an open bar | 1.6 MB | -16.5 | 0.841 |
The files are 37.0 MB in total (63.1 MB as provided).

### Situation -> playlist (`PLAYLISTS`, rules in `situationFor`)
| Situation | When | Tracks (alternate, never the same twice in a row) |
|---|---|---|
| `storm` | storm or heavy snow, any hour | Tente Restringida |
| `night` | night (hours shift with sunrise / sunset), any weather but a storm | Melted Snow (calm), Vinny F Minor (chill lo-fi alternative) |
| `festival` | a festival is on, day or dusk | Festival groove |
| `snow` | snowing, dawn or day (any season) | Winter Snow |
| `autumn` | autumn, dawn to dusk | Autumn's Gentle Sway, Autumn Gold |
| `dusk` | dusk (any season but autumn) | Evening Corner |
| `winter-morning` | winter, dawn to late morning (before 11:00), and an afternoon that is not busy | Mountain Morning, Winter Early slopes |
| `winter-day` | winter, 11:00 to dusk, resort busy (guests / 300 >= .35 on, < .2 off) | Winter Day |
| `summer` | spring and summer days | Meadow Loop, Pastoral Walk |
| title / menu | main menu | Seasons of Management (always first, it is the title theme), Seasonal Menu |
| bar | next to an open Apres-Ski Bar or Schirmbar | Ski Hut Groove, Polka Party Time, Alpine Après-Ski, Après-Ski Brass |

Rain and cloud do not change the pick. A playlist with a single track would repeat itself, so when it ends the next track comes from `FALLBACK[situation]` (Winter Day -> the winter morning pair, Evening Corner -> the night pair, Tente Restringida -> the night pair, Festival groove -> the summer pair, ...): a track is never repeated back to back.

### When the music changes (hysteresis)
- A new situation must hold for `SITUATION.settleSec` (20 s) before it counts: the hour ticking over, a short snow shower or a flickering storm change nothing. "Busy resort" has its own on / off thresholds.
- Most changes wait for the playing track to end; the next track then comes from the new situation. Only a **storm, nightfall or a festival** cut in with a 5 s crossfade (`MUSIC_PLAY.situationCrossfade`), and never more often than every 150 s (`SITUATION.minChangeGapSec`). **Airtime (owner 2026-11-06)**: a playing track is never replaced by such a cut-in before it has really played `MUSIC.minPlaySec` = 30 s (media time; a pause or a hand-off does not count); a cut-in that is refused stays pending (the committed situation still differs) and applies at second 30 (`mayCutIn` in `musicPlaylist.ts`). "Next track" is an explicit action and is always immediate; a track that simply ends crossfades as before. The title music only crossfades at a track's end (no change).
- At a track's end the next one starts 4 s early and crossfades (`MUSIC_PLAY.trackCrossfade`). The next track is picked and **preloaded** while the current one plays.
- **Next track** (Settings) crossfades over 2.5 s to another track of the situation and keeps the music audible for 25 s while the game is paused by the dialog.
- Pause (speed 0 with "Pause music at speed 0"), mute, Ambience only and the Music checkbox fade the gate to 0, then **pause the element** (position kept); resuming continues where it stopped. A hidden tab suspends the audio context and pauses the elements the same way.

### Loading and failure
Nothing is requested before the first pointer / key press (the engine unlock), and the first track only after `MUSIC_PLAY.startDelay` (1.5 s), never during boot. A file that fails to load is skipped for the next candidate; when every candidate fails (offline with nothing cached) the music stays silent, one console warning is printed and the next try is 60 s later. Nothing else in the game depends on the music.

### Hand-off with the bar music (`musicHold.ts`, unchanged logic)
`main -> toApres -> apres -> toMain -> main`. The bar level (proximity x zoom window) must reach `HANDOFF.enterLevel` (**.28**, was .12) for `enterDwell` (.5 s) and the game music must have played >= `minMainSec` (3 s): the game music **fades out over 0.7 s**, then it is paused (position kept) and the bar song starts and fades in over 0.8 s. Leaving: the level must stay below `exitLevel` (**.09**, was .04) for `exitDwell` (2 s) and the bar song has been up >= `minApresSec` (**30 s**, was 4 s; `MUSIC.minPlaySec`): the bar song fades out (0.6 s) and is paused, then the game music **fades back in over 0.9 s from where it stopped** (the old "rewind to the start of the chord" is gone; with files there is nothing to re-strike). The two never overlap: the envelopes are products of exclusive phases (tested for random level walks), and the integration test checks the elements: a bar element only plays in apres / toMain, a game element only in main / toApres (plus the short silent idle before an element is paused). When an open bar comes into reach (level > 0) the first bar song is **fetched ahead**, so the hand-off does not wait for a download.

**Slightly closer (owner 2026-11-06)**: zoomed in, the bar music now starts about 12.5 tiles from an open bar (was 16.7, 75 %) and hands back at about 17.5 tiles (was 19.4, 90 %); with the camera right at the bar it starts at zoom 26.7 (was 29.3); `PROX.apres` (reach 22, zoom 34..12) and the bar gain curve are unchanged (tests/audio/airtimeAndHonk.test.ts computes the distances). Back at the bar within `BAR_AUDIO.restartAfterSec` (25 s) the same song resumes where it stopped; after longer, the next song of the rotation plays (unless the song has not had its 30 s yet: then it resumes); a song that ends while you stand there crossfades (2.5 s) into the next. The bar music runs on the **ambience bus** (the Ambience slider governs it, nothing plays with the slider at 0 or while muted); `BAR_AUDIO.busBoost` (+5 dB) makes up for the quieter default bus so the bar sits at its target loudness at default sliders. Proximity still shapes it: low-pass 1200 Hz (far) to 9500 Hz (near) and a level gain `minGain .3 + .7 x level`. The crowd murmur layer (`apres`, ceiling .05) is kept; it does not clash.

### Default level (-3 dB)
The owner found the music a bit loud at the old default. All trims are normalised to targets 3 dB lower than the procedural music's (game and menu -20 instead of -17 LUFS, bar -18 instead of -15) through the trim table, so the **slider range and defaults (Music 50 %) are unchanged**: at the same slider position the music is 3 dB quieter. Menu music included.

#### Second step: -1.2 dB (owner playtest, 2026-11-05)
After a real playtest the Music slider (a plain 0-100 linear gain: `busGains().music = slider / 100`, default 50, `src/ui/components/StSettings.ts`) read **16** and was still too loud; **14** felt right. 20 log10(14 / 16) = **-1.16 dB**, so every loudness target is lowered by 1.2 dB through the trim table (slider range, default and the bus untouched; game, bar and title music equally):

| Group | Target before | Target now | Trim change |
|---|---|---|---|
| game | -20 LUFS | **-21.2 LUFS** | x 0.871 (-1.2 dB) |
| menu (title) | -20 LUFS | **-21.2 LUFS** | x 0.871 |
| bar | -18 LUFS | **-19.2 LUFS** | x 0.871 (the bar bus boost `busBoost` 1.78 is unchanged) |

Total against the old procedural music: -4.2 dB at the same slider position. The saved slider value stays 16: it now sounds like 14 did relative to 16. Nobody could listen to it from here: tune `MUSIC_TARGET_LUFS` in `src/config/audioMusic.ts` (and recompute the `trim` column, `tests/repo/musicAssets.test.ts` checks it).

### Bar music notes (visual cue)
While an Apres-Ski Bar or Schirmbar is open and serving, a few small music notes drift up from its roof (`src/render/ApresNotes.ts`, tunables `APRES_NOTES`): render-only, ONE shared instanced layer for all bars (1 draw call, `ApresNotesView`), main-pass cost a few CPU writes per frame. Notes are a pure function of the bar id and the layer's own render clock (accumulated frame time; no sim state, no `Math.random`, hashed start spots), rise 1.3 tiles over 3.6 s with a small sideways sway and fade in / out, and pop (+22 % size) on a 125 bpm beat (each bar has its own beat offset: each plays its own song). Only near the camera (full at view height <= 45, gone at >= 75), the nearest 12 bars. **Quality**: Low 2 notes per bar, Medium 4, High 6 (from `QUALITY_PRESETS.particles`). **Reduce motion**: three still notes, no drift, no pulse. **Closed / shuttered / hours over**: none (the notes fade out in 0.8 s). The music does not have to be audible for the cue to show. Not done (kept minimal): bunting sway, window-glow pulse, silhouettes inside, speaker throb. Tests: `tests/render/apresNotes.test.ts`; by eye: `npm run shot` at dusk (see `docs/schirmbar.md`).

### How to swap a track, add one, or switch the music off
- **Swap**: put the new mp3 into `public/audio` under the same name. Re-encode first (`ffmpeg -i IN.mp3 -map 0:a -map_metadata -1 -c:a libmp3lame -q:a 6 -joint_stereo 1 public/audio/NAME.mp3`; every committed mp3 stays in git history forever, so encode once, then commit), measure it (`ffmpeg -i f.mp3 -af ebur128 -f null -`, the "I:" line of the summary), and update `lufs` and `trim` (= 10^((target - lufs) / 20), 3 decimals) of its row in `TRACKS`, plus the README row. `tests/repo/musicAssets.test.ts` checks files, trims and the size budget.
- **Add**: a new file, a `TRACKS` row, an entry in a playlist, the README row.
- **Switch off**: the Music checkbox in Settings (no fetch, silent); the title music: `MENU_MUSIC.enabled = false` or `?nomenumusic=1`; the in-game music: empty the playlists in `audioMusic.ts`.

### Offline, cache and storage (see `docs/pwa.md`)
`audio/` is **not precached** (the 2048 kB budget is untouched; mp3 does not compress). The service worker's generic same-origin runtime cache (cache-first) stores a file the first time it is fetched (a plain 200 GET, which is why the player fetches the bytes instead of letting an `<audio>` element send 206 range requests). The cache is **per build version** (`slope-tycoon-<version>`), so a new release deletes the old cache and files are fetched again as they play. Storage impact: only tracks that were played are cached; a long session that touches every situation caches at most the whole folder, **about 37 MB**, once per build. Offline without a cached copy the music is silent (one console warning); sound effects and ambience are unaffected. The title screen registers the service worker too (`docs/pwa.md`), so the menu music is cached from a first-time visitor's first title visit.

### Tests and checks
`tests/audio/musicPlaylist.test.ts` (every season x hour x weather x festival x busy x sunrise maps to a non-empty playlist, never the same track twice, hysteresis, fades, trim), `music.test.ts` (fake media: nothing before a gesture, trim routing, crossfade, hysteresis, storm cut-in and gap, mute / speed 0 / hidden-tab pause and exact resume, Next, load failures), `handoff.test.ts` (state machine, never-overlap for random level walks and for the elements, rotation, ramped hold gain), `menuMusic.test.ts`, `proximity.test.ts`, `tests/repo/musicAssets.test.ts` (every mapped file exists, trim table complete, size budget, no other audio files, plain tags).

**Real page: `npm run music:e2e`** (needs `npm run build`): loads the built game over https in Chrome (SwiftShader) and checks that no mp3 is requested before a gesture, the files are served as `audio/mpeg`, there are no console errors, a situation change triggers a crossfade, an open bar triggers the hand-off to a bar song and back, and the title music (`npm run menu-music:e2e`) fades out when a game starts. It reads the audio graph state; **it cannot hear anything**.

## Samples (recorded CC0 sounds, owner decision 2026-11-06)

**Debug and limits added for the "faint honk" report (2026-11-06; `docs/playtest-audio.md` section F)**: `__slope.audio.log(true | 'all' | false)` and `.counts()` (`src/audio/audioLog.ts`) list every one-shot and loop start with id, `sample` / `synth`, gain and time; `npm run audio:census` measures a busy resort. Guards: `SAMPLE_RETIRED` (roles whose recording is not played; `churchBell`), `SAMPLE_MIN_GAP` (a sample inside its gap is dropped, never replaced by the synth), `PlayOpts.noSample` (event cues), the village chime cap `AMB.church` (60 s gap, 2 strikes, bells level .3; before no gap, 3 strikes, .15) and `PROX.crossing` for the level-crossing bell (reach 30 tiles of the looked-at spot x zoom window 40..14; before 70 tiles from the camera body at any zoom). Tests: `tests/audio/airtimeAndHonk.test.ts`.

A second owner-approved exception to "everything but the music is procedural": 88 mono mp3 files in `public/audio/sfx` (7.5 MB, CC0 / public domain recordings the owner picked from the staging library; every file with its source, author and licence in `public/audio/README.md`, tested in `tests/repo/sfxAssets.test.ts`). **The synthesised sounds stay as the fallback**: a sample that is not decoded yet, failed to load, was never cached offline, or is switched off simply leaves `Sfx.ts RECIPES` / `Ambience.ts LAYER_BUILDERS` in charge. Credit line: "Music: generated with Suno. Sound recordings: CC0, mostly from Freesound (see the audio README)." (About dialog, `THIRD_PARTY_NOTICES.md`). Nobody has listened to any of this from here (agents have no audio device): the trims are computed from measured levels, not tuned by ear (`docs/playtest-audio.md` section E).

### Code and config

* `src/config/audioSamples.ts`: ONE table (`SAMPLE_DEFS`: id, role, tag, trim, loop, decode rate, gain jitter, pitch jitter, licence key, measured duration / peak / rms), the pools (`POOLS`), the bed slots (`BED_SLOTS`: sample, gate, synth layer, weight), the global switches (`SAMPLES`: `enabled`, `dir`, `memoryCapMB` 40, `maxJobs` 2, `retryAfterSec`, `silentSec`, `bedsOnLow` false, `crossingHold`) and the extra-roll rates (`SAMPLE_RATES`).
* `src/audio/SamplePlayer.ts`: fetch + decode on demand, the decoded cache (LRU eviction of IDLE buffers above the cap), one-shots as normal engine voices (`playShot` / `playExtra`), looping beds on the ambience bus (`updateBeds`, `ring` for the crossing bell). `src/audio/sampleMix.ts`: the pure parts (gates from the ambience mix, slot targets, synth coverage, no-immediate-repeat pick, jitter).
* `Sfx.play()` asks `SamplePlayer.playShot()` first (same limiter, priority, bus, 'reduce loud sounds' scaling) and plays the synth recipe when it returns false. `Ambience.update()` drives the beds and multiplies each synth layer by `1 - coverage` (plus a `keep` share: crowd 25 %), so while a bed is still loading the synth bed carries the sound and fades out as the recording fades in.
* `AudioApi.samples` is on `window.__audio.samples` (`stats`, `loadedIds`, `activeBeds`, `memoryBytes`, `roleReady(role)`).

### Loading, memory and failure

* Nothing is requested before the engine runs (a user gesture, so long after the first paint). A one-shot role loads its whole pool the first time it is asked for (the synth plays that first time, so a footstep is never delayed); a bed loads when its slot first becomes audible (gate x weight x ceiling > 0.002). At most 2 fetch + decode jobs run at once.
* Plain GET of `audio/sfx/<id>.mp3` relative to the page (works under `/play/` and `/slopetycoon/play/`), then `decodeAudioData`. Beds are decoded at their own rate (22.05 kHz / 32 kHz, via an `OfflineAudioContext`) so a 30 s bed costs 2.6 MB instead of 5.8. Worst realistic scene (wind x2 + gust, crowd, 3 lift beds, stream, rain) is about 25 MB decoded (all 29 beds together would be 61 MB, all one-shot pools 14 MB, which is why the cap and the LRU exist); the cap is 40 MB: above it the least recently used IDLE buffer is dropped (a bed that plays keeps its buffer). A bed that stays under 0.002 for 6 s is stopped and its source freed, restarting at a random offset.
* A failed fetch / decode is remembered per file (retry after 90 s, one console warning in total) and never throws. Beds do not play on the **Low** graphics tier (`SAMPLES.bedsOnLow`); one-shots do. Mute, the master / effects / ambience sliders, ambience-only, reduce-loud and the hidden-tab suspend work unchanged: samples go through the same buses.
* The service worker caches them like the music (cache-first runtime cache, not precached: `precache.ts` skips `audio/`; `npm run verify:pwa` checks the 88 files are served as `audio/mpeg`, each under 400 kB, the folder under 12 MB). A new build gets a new cache name and the old one is deleted on activate. The first time through, samples play only after being cached online; offline before that the synth plays.
* Loops: browsers add encoder padding to mp3, so beds are played as decoded AudioBuffers with `loop = true` (the LAME / Xing header gives a gapless decode). `npm run sfx:e2e` decodes every bed in real Chrome and checks its length equals the source length and the wrap-around jump is at most 4x the typical sample step (worst 2.58; a measurement of the decoded output, not a listening test).

### What plays what

Trim = linear gain per file (one-shots: peak at gain 1 -> `SAMPLE_TARGETS.peak[role]`, which sits at or a little above the synth recipe's own peak; beds: rms -> 0.08 at the layer ceiling, about the synth layer's own nominal rms, 1.5 dB under it for wind). Mixer defaults are untouched.

| Role | Files | Trim | Fallback |
|---|---|---|---|
| `stepSnow` | walk-mode footsteps on snow (dry 3 + wet 2) (5) | 0.124-0.146 | `stepSnow` synth burst |
| `stepGravel` | gravel / snow-gravel steps + a mud step as the damp alternative (6) | 0.125-0.951 | `stepGravel` synth |
| `stepGrass` | hiking boot / grass / leaves steps (10) | 0.117-0.127 | `stepGrass` synth |
| `stepWood` | wood steps (3) | 0.118-0.125 | `stepWood` synth |
| `stepRoad` | stone steps (3) | 0.12-0.124 | `stepRoad` synth |
| `thud` | dull thud + 2 light generic steps: building placed, lift built (3) | 0.877-0.898 | `thud` synth |
| `birdChirp` | snow partridge, herring gull (warm seasons, 20 %), night bird (warm nights, rare); the quieter-overall / louder-zoomed-in rule is unchanged (it lives in the mix, not in the files) (7) | 0.06-0.161 | `birdChirp` synth |
| `cowbell` | cowbell (2) | 0.105-0.109 | `cowbell` synth |
| `churchBell` | one church bell strike (1). **RETIRED** (`SAMPLE_RETIRED`, 2026-11-06: the 0.43 s dense clip read as a honk; the synth bell plays) | 0.19 | `churchBell` synth |
| `bell` | bell ding: lift opened / repaired (pitch 1.5) (1) | 0.299 | `bell` synth |
| `clank` | squeaky-wheel segments of the chairlift recording (see the cut note below) (2); at most one per `SAMPLE_MIN_GAP.clank` (12 s), ambient only (lift event cues use the synth: `noSample`), `AMB.rates.clanks` .35 -> .08 | 0.198-0.577 | `clank` synth |
| `creak` | tree creak, winter nights (1) | 0.074 | `creak` synth |
| `avalanche` | avalanche / distant explosion recordings (3) | 1.047-1.641 | `avalanche` synth |
| `thunder` | rain-and-thunder recordings (30 s each), about once every 75 s of storm; ambience bus (2) | 0.673-0.681 | new `thunder` synth recipe (low brown-noise rumble) |
| `rustle` | dry-leaf rustles, autumn, rate follows the leaves level; the synth leaves bed drops to 40 % once decoded (7) | 0.168-0.251 | none needed (the synth leaves bed carries it) |
| `lap` | pond wave, rate follows the water level; the synth bed drops to 60 % (1) | 0.18 | none (the synth water bed) |
| `sleighBell` | sleigh bell shakes, rate follows the sleigh level; the synth bed drops to 40 % (2) | 0.076-0.078 | none (the synth sleigh bed) |

| Bed | Layer | Fallback |
|---|---|---|
| wind (light: `bed-wind-01`, `-02`; gust `bed-wind-gust-01`; storm `bed-wind-storm-01`) | wind | synth wind layer (to 0 once covered) |
| rain (`bed-rain-01`, `-03`; storm: `bed-rain-02`) | rain | synth rain layer |
| crickets (`bed-crickets-01`) | crickets | synth crickets |
| crowd (`bed-crowd-01`) | crowd | synth crowd murmur (keeps 25 %) |
| lift (`mach-chairlift-seg1`, `-seg2`, `mach-skilift-01`; under-hum `mach-lifthum-01`, `-02`) | lift | synth lift rumble |
| stream (`bed-brook-01`, `-02`, `bed-river-01`) / rapids (`bed-rapids-01`, `bed-river-02`); the flow class mapping is unchanged | stream / rapids | synth stream / rapids |
| snowcat (`mach-snowcat-01`) | snowcat | synth snowcat |
| helicopter (`mach-heli-01`) | heli | synth heli |
| campfire (`bed-campfire-01`) | campfire | synth campfire |
| snow cannon (`mach-cannon-01`), near a RUNNING cannon (new layer `cannon`, ceiling 0.06) | cannon | new synth air hiss |
| birds (`bed-birds-01`, ceiling 0.05), morning (`bed-morning-01`, 0.035), cow herd (`bed-cowbells-01`, 0.05), drips (`bed-drips-01`, 0.05) | extra beds | none (extras: silent until decoded) |
| level crossing (`bed-crossing-01`, ceiling 0.07): a loop that plays while the barrier ticks (`ring()`) | crossingBell | the synth ding-ding one-shot |

Bird calls: partridge by default, a gull now and then in summer / spring, a rare night bird on warm nights (`PlayOpts.tag`); level and rate are still the old `birds` mix, quieter overall and louder zoomed in.

### Spare (picked by the owner, NOT shipped: no existing game sound or layer to map to)

* `bicycle-bell` x2 (no bike bell sound exists; the lift `bell` took the bell ding), `bell-ding` 1-3 (not picked).
* `chairlift__fs519459-andriiperevodchyk-passing-chair` (a carrier passing a tower: the engine has no such event).
* `road-traffic` Varniu (a distant road layer needs road proximity in the world probe, which is not cheap here).
* `helicopter` Chinook (a maybe; the other helicopter is the bed), `road` StoneL1 (a maybe), the whole `30-cc0-sfx-loops` set picked (machine-01 / 02 / 04 / 06 / 11, noise-03, rain, alarm-02, rolling, saw: no matching game sound; the generated `alarm` stays; the rain bed is the three rain recordings).
* Everything marked 'maybe' by the owner, and the unclear-provenance (Public Domain Mark) folder, stay in the staging library.

### The chairlift cut (owner note)

`fs180942-jc144940-chairlift-1`: the real lift only starts at about 25-26 s of the source (squeaky wheel). Everything before is CUT; two clean segments are shipped as `mach-chairlift-squeak-01` (cleaned-file 24.6-27.6 s) and `-02` (28.6-32.0 s), used as the `clank` one-shots near a running lift. Documented in the staging `cleaning-log.md`.

### How to swap, add or switch off a sample

* Swap: replace `public/audio/sfx/<id>.mp3` (keep the name; mono, 96 kbps one-shot at 44.1 kHz or 80 kbps loop at 22.05 / 32 kHz; ffmpeg `-map_metadata -1 -write_id3v2 0`), re-measure peak and rms (`ffmpeg -i f.mp3 -af volumedetect -f null -`), update `dur`, `peakDb`, `rmsDb` and `trim` in `SAMPLE_DEFS` and the row in `public/audio/README.md` (the repo test needs the licence row and key).
* Add: add the file, a `SAMPLE_DEFS` row (role = an existing one-shot role, or `bed` + a `BED_SLOTS` row with a gate), the README row. New role: add it to `SHOT_ROLES` and `SAMPLE_TARGETS`, give it a synth recipe (or make it an extra like `rustle`).
* Only CC0 / public domain files: the repo test allows the four licence keys only. Committed binaries stay in git history: encode once.
* Switch off: `?nosamples=1` in the URL, or `SAMPLES.enabled = false` (nothing is fetched, the synth plays); beds alone: `bedsOnLow` / the Low tier.

### Tests and checks

`tests/audio/samples.test.ts` (table integrity, pure picks / jitter / gates / coverage, fallback while loading, failed fetch / decode, the disable switch, the memory cap, beds start / crossfade / stop, the Low tier, crossing loop, extras, thunder), `tests/repo/sfxAssets.test.ts` (files = table, names, size guard, licence rows and keys, no unclear-provenance material), `npm run sfx:e2e` (real Chrome, see above; it cannot hear anything).

## Ambience rework
Rules: **noise beds only** (no oscillator tones, no resonant filters: every Q <= 1 (lowpass/highpass Q is in dB: 0)), modulations are **slow sines or sums of unrelated slow sines** (`wander`), never square/saw gates, two noise reads at unrelated playback rates per layer, noise buffer **9 s** (was 3 s) with DC removed, nothing narrow above 5 kHz, ceilings lowered (`AMB.layerMax`: leaves .2, crickets .05, insects .05, crowd .2, lift .16, water .2, snowcat .16, heli .2; wind .2 / rain .245 / muffled .175 unchanged).
| Layer | New design |
|---|---|
| wind | pink + 0.83x-rate brown -> low-pass 620 Hz (centre drifts on 0.043 / 0.071 Hz) -> high-pass 60 -> gust gain drifting on 0.037 / 0.071 / 0.13 Hz (+-0.31 total) |
| rain / leaves | pink x2 -> high-pass 700 / 1400 -> low-pass 5.2k / 4.2k, slow gain drift (the old white-noise "static" and 0.3 Hz swish are gone) |
| crickets | two raspy band-limited-noise voices (3.9 / 4.4 kHz, Q 4) with smooth sine pulse trains (19 / 23 Hz) in slow phrases (1.1 / 0.8 Hz); no hard gates; ceiling .05 |
| campfire (Phase 6 Task 19) | band-passed pink noise (2.6 kHz, Q 0.7) with two unrelated fast sine pops (9.1 / 3.7 Hz); only near an open campground on summer evenings (18:30-22:30), close in, not in rain; ceiling .035 (the quietest layer); 8 nodes |
| carnival (M7.4) | pink noise through a tuba (130 Hz) and a horn (392 Hz) band-pass, pulsed at the oompah beat (about 1.9 Hz); ceiling 0.036; only while the Carnival parade street is near (`WorldProbe.carnivals`, 24 tiles), 10:00 - 16:00, damped by rain; follows the ambience volume and mute |
| concert (Phase 6 Task 41) | pink noise through three broad band-passes (196 / 294 / 700 Hz, Q 1: a faint G-major bed + murmur, no oscillator tone), slow sine drift; only while a Mountain Concert runs (`WorldProbe.concerts`, reach 30 tiles), camera near, 11:00-23:00, damped in rain / snow; ceiling .04; 12 nodes (the ambience node budget in the test is 290 now) |
| insects | faint 2.4 kHz band "meadow air" (the Q 9 whine is gone) |
| crowd | three broad formant bands (350 / 900 / 2300 Hz) of pink noise, amplitude drifting at 0.4 / 3.1 / 4.7 Hz, low-pass 3 kHz |
| lift | brown rumble (low-pass 220) + soft 650 Hz band, slight 0.8 Hz drift; no oscillators (the 48 Hz saw hum is gone) |
| water | three drifting noise bands (450 / 1300 / 3000 Hz), unrelated rates 0.55 / 0.93 / 1.7 Hz |
| snowcat / heli | brown rumble + band throb (6.5 Hz, +-10 %) / low-passed pink with soft 8.5 Hz chop; no saw / square / sine |
One-shots: **birdChirp** = pure sine with a short up-down glide (+ faint 2nd harmonic), smooth attack, 2-4 syllables, peak .035, max 3/s and `AMB.rates.birds` 0.8/s (was 2.2); only daytime spring/summer, quiet by weather (unchanged formulas); **cowbell** = two soft low sines (400/600 Hz), rate .15/s; **churchBell** = harmonic partials only (1/2/3), peak .07 (was an inharmonic ring at .16); **clank** = triangle thunk + soft noise, .35/s; drip / creak quieter and softer. The UI `bell` and `kaching` sfx are unchanged (not background). The **jingle** on rating-up is three soft harp notes (pentatonic) at most every 12 s.

## Proximity audio (nature, streams, Apres-Ski Bar; Nov 2026)
Owner feedback: nature was too loud everywhere, streams were silent, and the Apres-Ski Bar had no music. **Every level that depends on camera proximity lives in ONE table: `src/config/audioProximity.ts` (`PROX`)**; the pure curves are in `src/audio/proximity.ts` (tests: `tests/audio/proximity.test.ts`). "zoom" is the visible world height in tiles (small = close; walk mode counts as 6). Nothing here touches the sim (audio is observer-only, `stateHash` unchanged); the sampling runs at `PROX.tickEvery` = 0.1 s (10 Hz), layer gains ease with `setTargetAtTime` (`AMB.fadeTc` 0.9 s), so nothing zippers while zooming.

| Feature | Curve | Notes |
|---|---|---|
| Nature (birds, crickets, insects, cowbells, leaves, drips) | `natureGain(close) = far + (1 - far) * close^power`, far .08, power 2; `close` = 0 at zoom 60 .. 1 at zoom 10 | Old bird curve was `0.4 + 0.6 * close` (0.70 at the default zoom 36); now 0.33 there, 0.08 zoomed right out, 1.0 (unchanged) fully zoomed in. Chirp gain x0.8. |
| Stream / river (`stream` + `rapids` layers) | smoothstep zoom window (silent at zoom >= 38, full at <= 14) x `(1 - d / 12)^1.6`, d = tiles to the nearest `Stream` tile (`WorldProbe`, scanned only while zoomed in) | Flow class (from `sim.flow`, via `streamClassAt`): calm = soft brook, brisk = full brook + some rush, rapids = rush + a quieter brook. `iceFrozen` (global river ice) = silent. Ceilings .17 / .14. |
| Ponds / lakes (`water` layer) | tile fraction near the camera x zoom window (30 .. 10) x .45 | Very soft lapping; silent under ice (`iceFrozen`). Old floor of 0.3 at any zoom is gone. Ceiling .08. |
| Apres-Ski Bar (`apres` layer + `BarMusic.ts` songs) | per bar `(1 - d / 22)^1.5`; bars add, the sum is capped at 1; x zoom window (silent at >= 34, full at <= 12) | Only a bar that is built, active, open AND serving (`attractions.servingNow`, 08:00-23:00 in winter, 22:30 summer) is passed to the probe. Rain damps 30 %. |

**Bar music** (`src/audio/BarMusic.ts`, owner-provided mp3 songs; see "Music" above): the **game music stops** while it is audible (hand-off with hysteresis). It sits on the ambience bus, so it follows the Ambience slider (default 28 %) and mute; nothing plays with the ambience slider at 0 or while muted. Proximity still shapes it: its low-pass goes from 1200 Hz (far) to 9500 Hz (near, `PROX.apres.cutoffFar / cutoffNear`) and the level follows `apresLevel`. The `apres` layer remains a quiet crowd murmur bed (ceiling .05).

Node budget: the three new layers add about 44 live nodes (stream 17, rapids 9, apres 12, plus gains), so the ambience test budget went from 236 / 250 to 290 / 310; the bar music is one media element and a few gain / filter nodes.

## Offline verification (what the tests prove)
- `tests/audio/offlineBackend.ts`: a **software Web Audio renderer** (oscillators with polyBLEP, buffer sources, biquads with Web-Audio Q semantics, panner, delay, compressor with measured makeup gain, param automation, 128-sample blocks) that runs the **real** `Ambience` / `Sfx` / `AudioEngine` (`tests/audio/renderHarness.ts`) for the ambience and SFX tests: per ambience state (12): peak, DC, clicks, **tonal line < 7 dB**, bursts < 12 dB, < 1 % above 8 kHz, nodes < 330; ambience RMS < -30 dBFS at default volumes; birds quiet, smooth, < 6 kHz. It has no media-element routing, so the music players do nothing there (by design).
- The music logic is tested with a fake backend and a fake media element (`tests/audio/fakeBackend.ts`: `FakeMedia`, `fakeMediaHooks`).

## NOT verified (by ear)
- Whether the **transitions** feel right: the 4-5 s crossfades between two different songs, the 0.7 s fade-out into a bar song, the way a song resumes after the hand-off.
- The levels: the -20 / -18 LUFS targets (3 dB below before) against sound effects and ambience on real hardware and on small laptop speakers, and the bar level (+5 dB bus compensation) against the game music.
- Whether the situation rules feel right over an hour of play (how often tracks change, whether a one-track situation such as a long storm or a busy winter day feels repetitive with the fallback tracks).
- Real browsers' behaviour of media elements in a suspended context (we pause them explicitly), autoplay edge cases, and phones.
- Real GPU/CPU cost of the ambience beds (about 175 live nodes with all layers); the tests only count nodes.

## Feedback sounds (M5.1)
- `money:changed` no longer plays a ka-ching by itself: the FX layer (`src/render/fx`) plays one quiet ka-ching (gain 0.4) only when a significant +$ popup appears, at most once per 3 s. `Feedback intensity: Off` therefore silences it.
- `building:placed` = soft thunk (`thud` gain 0.45, pitch 1.1). `milestone` (major only) = one `chimeImportant` at gain 0.55 (shares the `alert` limiter group with the news chime, so they never stack); minor milestones are silent.

## Schirmbar (M7.8)
The Schirmbar counts as a bar for the apres proximity: `src/main.ts` `apresBars` lists `apresBar` and `schirmbar` (active, open, serving), so the same gating applies (open, serving hours 10:00 - 17:30 for the Schirmbar, zoomed in, near) and the levels / cap in `src/config/audioProximity.ts` are shared. See `docs/schirmbar.md`.