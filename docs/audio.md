# Audio (Task 30)

All sound is **synthesized with the Web Audio API** – no audio files. Code lives in `src/audio/`.

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
| `index.ts` | `createAudio(deps)` wiring (bus subscriptions, first-gesture unlock, visibility, UI button ticks via delegated capture listener, `M` mute key, 10 Hz tick). |

UI: `⚙` in the top bar opens `<st-settings>` (4 sliders incl. Ambience, mute, music on/off + **Music style** + Next track, reduce-loud, ambience-only, shortcuts to graphics quality / fast nights / unmute news). A 🔇 icon (bottom-left) shows until audio is unlocked (or while muted).
Tutorial / other code can call `audio.sfx.play('chimeInfo')` etc. (`window.__slope` does not expose it; main.ts holds `audioRef`).

## Verification status
Since the audio redesign (below) the music and ambience are **rendered offline and analysed objectively** (software Web Audio renderer, cross-checked against Chrome's own `OfflineAudioContext`). That verifies headroom, DC, clicks, spectrum, whistles / hum lines, loudness range, harmonicity, determinism and node budgets. **Nobody has listened yet**: whether it sounds pleasant, whether the levels sit right against the SFX, and how pieces feel over an hour are unverified by ear (the harness has no audio device). Walk-mode footsteps, spatial pan and the sfx recipes outside the ones changed below are still estimates (see the notes in their sections).

## Walk mode footsteps and near-field (Task 12)
Five footstep recipes (`stepSnow / Gravel / Grass / Wood / Road`, `Sfx.ts`): noise bursts peaking 0.04-0.07 (click .18), `PRIORITY.ambience`, max 4/s, `loud` (halved by reduce-loud), pitch jitter per step. Cadence from walked distance (`stepStride`, `walkPhysics.ts`). The listener is the walker with `AMB.walkZoom` = 6 as the zoom proxy (near-field crowd / lift / birds / water). Levels are reasoned estimates, NOT heard (no audio device). See `docs/walk-mode.md`. Forest shelter: >= 10 trunks within 6 tiles of the walker lower the wind bed by up to 30 % (`AmbienceState.shelter`).

## Tunable constants (where)
- Defaults: `DEFAULT_AUDIO_SETTINGS` (master .7 / music .5 / sfx .8 / ambience .28 since the audio redesign (.45 before, .7 originally); see Mix levels), `REDUCE_LOUD_FACTOR` (.55) – `AudioSettings.ts`.
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

# Why it sounded weird (analysis, audio redesign 0.2.x)
User feedback: *"The background music is weird (the bells in it)… some of the background noise is also weird. Can we make it more palatable?"* Everything below was measured with the offline renderer (`npm run audio:render`, spectrograms in `.weave/shots/audio-old-*.png`, old code rendered from git HEAD for comparison; the old reverb convolver was not rendered, so the old music was analysed dry). Numbers are from that analysis.

## Music: the bells
- **Root cause 1: inharmonic FM bell as the winter lead.** `bell` = FM carrier with modulator ratio 3.5 (index 0.9 x f): partials land at **1.00, 2.50, 2.76, 4.50 x f0** (measured: -18 / -12 / -18 dB vs the fundamental) plus a stretched 2.76x sine; 2.4 s decay (-60 dB), 70 % reverb send. Non-integer partials read as a *bell/gong* and clash with every pad chord (they do not belong to any key). The winter theme used it for the **melody**, summer used a marimba (partials 1/4/10x), autumn a "handpan" (1/2/3x, harmless), spring a flute.
- **Root cause 2: the glockenspiel** (`glock`, sine x2 and a sine at **5.4x**, 1.7 s decay) played the winter **arpeggio** on the grid (a note every beat, 25 % rests) and the **rating-up jingle** (4 glock notes). So bells were the arp, the lead and the jingle: constantly present, very regular.
- **Contributing**: high register (melody indices 7..16 = up to 2 octaves + a 7th above the root; bell partials reach 5 kHz+), long reverb (2.2 s, noise impulse decaying cubic) that smeared the clusters, a 70 % wet send, random walk melodies with passing tones against held triads (the `aeolian/dorian/phrygian-free` modes were fine, the *voicing* of bell partials was not), and the old **perc "shaker"** = white noise highpassed at 6 kHz (hiss ticks).
- **Not the cause**: pitch picks were all in scale (tested), levels were fine, no clicks.
- Other old instruments: `pluck`/`guitar` were bright-burst saws closing from 7-9 x f0 (a "zap" at each attack, plus a white-noise pick at 3-4 x f0 up to 5 kHz), the flute had a 5 Hz vibrato from the first sample (wobbly) and white breath noise.

## Ambience: the weird noises
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

# Audio redesign (music + ambience)

Current default ambience volume is **0.28**; saved values of exactly .7 or .45 (both former defaults, `LEGACY_AMBIENCE_DEFAULT` / `PREVIOUS_AMBIENCE_DEFAULT`) migrate to it, any other saved value is kept (`DEFAULT_AUDIO_SETTINGS.ambience`); the .45 figures above are the intermediate value.

## Music engine
Files: `theory.ts` (modes, chords, voice leading, pentatonic subsets), `musicThemes.ts` (**nine tracks**, `MUSIC` constants, layer tables), `musicSelect.ts` (pure fit scores + seeded no-repeat choice), `musicState.ts` (state -> tempo/layer weights), `musicComposer.ts` (pure `composePiece(seed, track, key)` -> note events), `instruments.ts` (soft oscillator instruments), `Music.ts` (lookahead scheduler, crossfades, reverb).

### Tracks (`musicThemes.ts`)
| Track | When (auto) | Mood / sound | bpm | Scales | Notes |
|---|---|---|---|---|---|
| **Morning Snow** | dawn - morning, esp. winter | bright, clear: pad + harp arpeggio + soft pluck lead | 76 | ionian / lydian | pentatonic lead, 2 bars per chord |
| **Alpine Noon** | midday / afternoon | warm major: pad, guitar plucks, pluck lead, brush backbeat only if busy | 84 | ionian / mixolydian | |
| **Après** | dusk (also early night, late afternoon) | gentle jazz: electric piano chords (7ths) + piano lead + guitar + soft brushes | 72 | dorian / mixolydian | seventh voicings, brushes on 2 and 4 (baseline) |
| **Starlight** | night | sparse pad, slow harp arpeggio, very sparse harp lead | 60 | aeolian / dorian / lydian | **4 bars per chord**, no percussion |
| **Summer Meadow** | summer (and spring) days | airy flute lead (delayed vibrato, breath), guitar, pad; shaker only if busy | 88 | ionian / lydian / mixolydian | AABA form |
| **Autumn Gold** | autumn days / evening | strings pad, guitar, electric piano lead | 70 | dorian / aeolian / mixolydian | |
| **Blizzard** | storm / heavy snow (only then) | dark drone, low strings, sparse harp | 52 | aeolian / dorian | transposed down an octave, 4 bars per chord |
| **Title Theme** | menu context (`menu: true`; the title demo has no audio engine, see below) | calm cinematic: strings, harp, piano | 78 | lydian / ionian | transposed -5 |
| **Festival** | a festival is on (or the resort is very busy by day) | a touch livelier: pluck lead, guitar, brushes, pulse bass | 98 | ionian / mixolydian | AABAB form (~100 s) |
Harmonically: all pitched notes are scale tones; the **lead is restricted to the mode's pentatonic subset** (no semitone clashes), triads/sevenths are **voice-led** (nearest-position voicing, compact), pads and basses are **held across a chord's bars** (slow harmonic rhythm), keys move by 4th/5th/2nd/3rd between pieces, and no piece is in the same key as the last. Pieces are 85-130 s (32-40 bars); each new piece = seeded variation of progression, motif and rhythm (`hash(seed, day, piece index, track)`).

### Instruments (`instruments.ts`): no bells, nothing inharmonic
`pad` (3 detuned saws -> low-pass opening slowly, 2 s swell), `strings` (detuned saw choir, vibrato fading in, band-limited 110 Hz-1.7 kHz), `epiano` (sine + fast-dying 2nd partial + trace 3rd, 12 ms attack), `pluck` / `guitar` (saw+triangle through a closing low-pass, no bright burst, very soft pick), `harp` (sines, 3 kHz ceiling), `flute` (triangle+sine, vibrato after 0.5 s, whisper of pink breath), `sub` (sine + triangle, low-passed at 300 Hz, low level), `brush` / `shaker` (pink noise bands with 12-14 ms swell, low-passed 5-6.5 kHz), `drone` (tension). A test (`tests/audio/offline.test.ts`) asserts every spectral peak within 30 dB of the strongest sits on an integer multiple of the fundamental (<= 1.5 %).
Signal path: voice -> (stereo pan, deterministic per layer: pad voices spread, arp by pitch, lead +-0.2, bass centre) -> track gain -> gate (pause/mute fade) -> **music bus tone low-pass 5.2 kHz** -> bus -> master -> compressor. **Reverb** = feedback-delay network (6 damped combs 43-97 ms, feedback 0.84, 2.6 kHz damping, two stereo taps, 30 ms pre-delay, return 0.3), no impulse buffer (cheaper and identical in the offline renderer); sends are 8-30 % per instrument.

### Choosing tracks
- `trackFit(track, ctx)` (0..1): from season, day part (shifted by sunrise/sunset), weather, `busy` (guests/300), `festival`, `menu`. Storm / heavy snow allow **only Blizzard**; Blizzard needs weather; Title only in the menu; every state has at least one track (tested for all 24 h x 4 seasons x 6 weathers).
- `chooseTrack`: weighted draw (fit^2) from a seeded PRNG, **never the previous track (and avoids the one before) while an alternative fits**; a lone fitting track (a long storm) repeats with a new key / seed.
- A running track is swapped (8 s crossfade, `MUSIC.crossfadeSec`) when it no longer fits (`fit < 0.12`, checked every 2 s) after it has played >= 30 s; first piece fades in over 3.5 s; between pieces **12-35 s of silence**.
- Weights per layer (pad/bass/arp/melody/perc) come from time of day and weather as before (night = pads + sparse; storm = pads only; tension thins). **Percussion is a detail**: it only plays when the resort is busy (`busy x 1.2`) or on tracks with a baseline (Après .55, Festival .7).
- Game speed 1/3/10x = tempo x1 / 1.12 / 1.25 (pitch never changes); paused fades out; music + ambience are ducked during fast-forward.

### Player settings (Settings > Audio)
- **Music style** (`musicStyle` in `slope.audio.v1`): *Auto (fits the moment)*, each track by name, or *Off* (= the Music checkbox). Changing it crossfades immediately.
- **Next track** + "Now playing" line (in-game Settings only): crossfades to another piece; the Settings dialog pauses the game, so a Next / style change keeps the music audible for 25 s (`MUSIC.previewSec`) while paused so it can be previewed.
- Existing: Music / Ambience / Effects / Master sliders (Ambience volume already existed), Pause music at speed 0, Reduce loud sounds, Ambience only.
- The title-screen demo (`DEMO`) has no audio engine (unchanged), so the *Title Theme* plays only if a menu context is fed (`music.setInputs({ menu: true })`; not wired to any menu yet) or when chosen as the style.

## Ambience rework
Rules: **noise beds only** (no oscillator tones, no resonant filters: every Q <= 1 (lowpass/highpass Q is in dB: 0)), modulations are **slow sines or sums of unrelated slow sines** (`wander`), never square/saw gates, two noise reads at unrelated playback rates per layer, noise buffer **9 s** (was 3 s) with DC removed, nothing narrow above 5 kHz, ceilings lowered (`AMB.layerMax`: leaves .2, crickets .05, insects .05, crowd .2, lift .16, water .2, snowcat .16, heli .2; wind .2 / rain .245 / muffled .175 unchanged).
| Layer | New design |
|---|---|
| wind | pink + 0.83x-rate brown -> low-pass 620 Hz (centre drifts on 0.043 / 0.071 Hz) -> high-pass 60 -> gust gain drifting on 0.037 / 0.071 / 0.13 Hz (+-0.31 total) |
| rain / leaves | pink x2 -> high-pass 700 / 1400 -> low-pass 5.2k / 4.2k, slow gain drift (the old white-noise "static" and 0.3 Hz swish are gone) |
| crickets | two raspy band-limited-noise voices (3.9 / 4.4 kHz, Q 4) with smooth sine pulse trains (19 / 23 Hz) in slow phrases (1.1 / 0.8 Hz); no hard gates; ceiling .05 |
| campfire (Phase 6 Task 19) | band-passed pink noise (2.6 kHz, Q 0.7) with two unrelated fast sine pops (9.1 / 3.7 Hz); only near an open campground on summer evenings (18:30-22:30), close in, not in rain; ceiling .035 (the quietest layer); 8 nodes |
| concert (Phase 6 Task 41) | pink noise through three broad band-passes (196 / 294 / 700 Hz, Q 1: a faint G-major bed + murmur, no oscillator tone), slow sine drift; only while a Mountain Concert runs (`WorldProbe.concerts`, reach 30 tiles), camera near, 11:00-23:00, damped in rain / snow; ceiling .04; 12 nodes (the ambience node budget in the test is 220 now) |
| insects | faint 2.4 kHz band "meadow air" (the Q 9 whine is gone) |
| crowd | three broad formant bands (350 / 900 / 2300 Hz) of pink noise, amplitude drifting at 0.4 / 3.1 / 4.7 Hz, low-pass 3 kHz |
| lift | brown rumble (low-pass 220) + soft 650 Hz band, slight 0.8 Hz drift; no oscillators (the 48 Hz saw hum is gone) |
| water | three drifting noise bands (450 / 1300 / 3000 Hz), unrelated rates 0.55 / 0.93 / 1.7 Hz |
| snowcat / heli | brown rumble + band throb (6.5 Hz, +-10 %) / low-passed pink with soft 8.5 Hz chop; no saw / square / sine |
One-shots: **birdChirp** = pure sine with a short up-down glide (+ faint 2nd harmonic), smooth attack, 2-4 syllables, peak .035, max 3/s and `AMB.rates.birds` 0.8/s (was 2.2); only daytime spring/summer, quiet by weather (unchanged formulas); **cowbell** = two soft low sines (400/600 Hz), rate .15/s; **churchBell** = harmonic partials only (1/2/3), peak .07 (was an inharmonic ring at .16); **clank** = triangle thunk + soft noise, .35/s; drip / creak quieter and softer. The UI `bell` and `kaching` sfx are unchanged (not background). The **jingle** on rating-up is three soft harp notes (pentatonic) at most every 12 s.

## Offline verification (what the tests prove)
- `tests/audio/offlineBackend.ts`: a **software Web Audio renderer** (oscillators with polyBLEP, buffer sources, biquads with Web-Audio Q semantics, panner, delay, compressor with measured makeup gain, param automation incl. `setTarget`, audio-rate param inputs, 128-sample blocks) that runs the **real** `Music` / `Ambience` / `Sfx` / `AudioEngine` (`tests/audio/renderHarness.ts`). `npm run audio:crosscheck` renders the same tracks / beds in **Chrome's own OfflineAudioContext** and compares: levels agree within ~1.5 dB and centroids within ~10 % (apres 345 vs 308 Hz, wind 168 vs 171, rain 2198 vs 2219) after calibrating the compressor makeup (+5 dB). It is not bit-exact (k-rate filter coefficients, compressor curve).
- `tests/audio/offline.test.ts` (~17 s): per track (9) at worst-case volume: peak < 0.9, |DC| < 1e-3, no clicks (`clickScore` < 25 and max step < .25), RMS -42..-14 dBFS, spectral centroid 80-1500 Hz, < 1 % energy above 4 kHz and < 0.1 % above 8 kHz, loudness range < 15 dB over 4 s windows, stereo width, graph nodes < 500; determinism (bit-identical per seed); crossfade / Next with no click or 9 dB jump; pause fade-out really silent and clean resume; every pitched partial harmonic; per ambience state (12): peak, DC, clicks, **tonal line < 7 dB** (old crickets 15.5), bursts < 12 dB, < 1 % above 8 kHz, nodes < 330; ambience RMS < -30 dBFS at default volumes; birds quiet, smooth, < 6 kHz.
- `tests/audio/musicSelect.test.ts`, `music.test.ts` (fake backend): fit table, no-immediate-repeat, determinism per seed, all pitched notes in scale / lead pentatonic, voice-led pad leaps <= 7 scale steps, nine distinct tracks, 15 min bounded nodes / <= 14 voices / no late events, style lock, Next, preview-while-paused, context swap with minimum play time.
- Previews: `npm run audio:render [-- --seconds 90 --only apres,ambience]` writes `.weave/audio-preview/v2-<track>.wav|ogg` (+ `old-*` A/B renders of the previous music / ambience) and spectrograms to `.weave/shots/audio-v2-*.png` (git-ignored). Typical output (peak / RMS at music 100 %, centroid): Morning Snow 0.39 / -22.7 dB / 286 Hz, Après 0.64 / -24.1 / 280, Starlight 0.35 / -26.9 / 314, Summer Meadow 0.41 / -20.4 / 487, Blizzard 0.15 / -30.7 / 192. At the default settings (music .5, master .7) that is roughly **-33 dBFS RMS**, well below the sfx peaks.

## NOT verified (by ear)
- Whether it is actually pleasant: melodic quality of the generated phrases, the feel of the harmonic rhythm, whether the brush / shaker / flute timbres convince, whether the reverb tail is pleasing and not metallic (6 combs without allpass diffusion can colour: judge on real speakers), whether the tracks are different enough from each other.
- Absolute levels against the sfx on real hardware and small laptop speakers (the music is deliberately warm: centroid 200-500 Hz, bass at low level; on tiny speakers the sub notes disappear and the harmony thins).
- How often tracks swap in real play (the fit table is reasoned), whether 12-35 s of silence between pieces feels right.
- Real GPU/CPU cost of ~150-330 live audio nodes (beds are always built, as before, but with more LFO nodes: 175 live nodes with all layers vs ~100 before); the renderer only counts nodes.

## Feedback sounds (M5.1)
- `money:changed` no longer plays a ka-ching by itself: the FX layer (`src/render/fx`) plays one quiet ka-ching (gain 0.4) only when a significant +$ popup appears, at most once per 3 s. `Feedback intensity: Off` therefore silences it.
- `building:placed` = soft thunk (`thud` gain 0.45, pitch 1.1). `milestone` (major only) = one `chimeImportant` at gain 0.55 (shares the `alert` limiter group with the news chime, so they never stack); minor milestones are silent.
