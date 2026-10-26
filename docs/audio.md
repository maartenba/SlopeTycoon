# Audio (Task 30)

All sound is **synthesized with the Web Audio API** – no audio files. Code lives in `src/audio/`.

| File | Role |
|---|---|
| `backend.ts` | Tiny structural `AudioBackend` interface (+ real `AudioContext` wrapper). Tests use `tests/audio/fakeBackend.ts`. |
| `AudioEngine.ts` | Lifecycle state machine (`locked → running`, `blocked` when autoplay refuses, `suspended` when tab hidden, `unsupported` = silent no-op), bus graph (voices → music/sfx/ambience bus → master → compressor → out), voice pool (≤ 24, priority stealing). |
| `synth.ts` | Noise buffers (white/pink/brown, generated once, seamless loop crossfade), envelopes, `NodeScope` (tracks/disconnects nodes), FM helper, reverb impulse (for Task 31). |
| `Sfx.ts` | One-shot recipes + `Sfx.play(name, {pitch, pan, gain, count, delay})`, rate limiting, ka-ching coalescing. |
| `Ambience.ts` | `ambienceMix(state)` (pure) + looping layers (built once) + random one-shot scheduling. |
| `eventSounds.ts` | Pure GameEvents → cues table (every event mapped or explicitly ignored; unit-tested) and news chime rule. |
| `spatial.ts`, `worldProbe.ts` | Camera-relative pan/gain; samples the sim (guest density via SpatialHash, water tiles, nearest lift/snowcat/heli/cows/buildings, altitude) into an `AmbienceState` at ~10 Hz. |
| `AudioSettings.ts` | Volumes/mute/reduce-loud/ambience-only, persisted under `slope.audio.v1`. |
| `index.ts` | `createAudio(deps)` wiring (bus subscriptions, first-gesture unlock, visibility, UI button ticks via delegated capture listener, `M` mute key, 10 Hz tick). |

UI: `⚙` in the top bar opens `<st-settings>` (4 sliders, mute, reduce-loud, ambience-only, shortcuts to graphics quality / fast nights / unmute news). A 🔇 icon (bottom-left) shows until audio is unlocked (or while muted).
Tutorial / other code can call `audio.sfx.play('chimeInfo')` etc. (`window.__slope` does not expose it; main.ts holds `audioRef`).

## NOT verified
No audio device or browser was available while writing this: **levels, harshness, loop seams as heard, FM chirp realism, and how layers blend are unverified**. Logic (mix function, limits, state machine, node budgets) is unit-tested against a fake backend. Expect to tune by ear.

## Walk mode footsteps and near-field (Task 12)
Five footstep recipes (`stepSnow / Gravel / Grass / Wood / Road`, `Sfx.ts`): noise bursts peaking 0.04-0.07 (click .18), `PRIORITY.ambience`, max 4/s, `loud` (halved by reduce-loud), pitch jitter per step. Cadence from walked distance (`stepStride`, `walkPhysics.ts`). The listener is the walker with `AMB.walkZoom` = 6 as the zoom proxy (near-field crowd / lift / birds / water). Levels are reasoned estimates, NOT heard (no audio device). See `docs/walk-mode.md`. Forest shelter: >= 10 trunks within 6 tiles of the walker lower the wind bed by up to 30 % (`AmbienceState.shelter`).

## Tunable constants (where)
- Defaults: `DEFAULT_AUDIO_SETTINGS` (master .7 / music .5 / sfx .8 / ambience .45; see Mix levels), `REDUCE_LOUD_FACTOR` (.55) – `AudioSettings.ts`.
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
Other defaults: master .7, music .5, sfx .8, `REDUCE_LOUD_FACTOR` .55. Other `layerMax` values unchanged (leaves .25, crickets .12, insects .1, crowd .3, lift .28, water .3, snowcat .3, heli .35). Zoom (`closeZoom/farZoom`) and crossfade (`fadeTc`) behaviour is untouched.

Migration: a persisted `ambience` of exactly 0.7 (the old default, `LEGACY_AMBIENCE_DEFAULT`) is read as the new default .45; any other saved value is kept. (A user who deliberately chose exactly .7 gets .45 too; accepted.)

Model: `nominalLevel(bus, layer?)` = bus volume × `layerMax` × recipe gain × noise RMS × spectral share. `NOISE_RMS` .25 (normalised noise, crest ≈3.6), `SPECTRAL_SHARE` wind .5 / crowd .5 / muffled .3 (filter chains), `RECIPE_GAIN` wind .75 / crowd 1.05 / muffled 1, `SFX_REF_PEAK` .126 (.18 typical recipe peak × .7), `MUSIC_NOMINAL` .12, `AMBIENCE_ONLY_MIN_EFFECTIVE` .15 (ambience bus × master).

Targets (`MIX_TARGETS`, tested in `tests/audio/mixLevels.test.ts`): wind peak ≤ −12 dB vs sfx; ≤ −9 dB vs music; wind+snow+crowd at peak (coherent sum) ≤ −6 dB vs sfx; ambience-only effective gain ≥ .15 (now .315, .173 with reduce-loud).

Estimated dB at defaults (old → new), vs sfx / vs music: wind −7.7→−21.5 / −3.2→−17.0; snow −17.7→−24.6 / −13.2→−20.1; crowd −11.3→−15.1 / −6.8→−10.6; bed total vs sfx −1.8→−9.9.

## How to tune
1. `npm run dev`, click once (audio unlocks on the first click/key), open ⚙.
2. Too harsh/loud overall → lower `REDUCE_LOUD_FACTOR`/compressor or the specific recipe `peak`. Too quiet bed → raise its `AMB.layerMax` entry.
3. A layer is audible when it shouldn't be → read its formula in `ambienceMix` (unit tests in `tests/audio/ambience.test.ts` document expected behaviour; keep them green).
4. Loops audible as a pattern → increase `NOISE_SECONDS` in `synth.ts` or add LFO depth in the layer builder.
5. Too many one-shots → lower `AMB.rates.*` or the recipe `maxPerSec`.
6. Per-layer solo while debugging: in the console, `__slope` doesn't expose audio; temporarily set `AMB.layerMax` entries to 0 in code.

# Music (Task 31)

Generative, no samples. Files: `theory.ts` (modes, chords, voice leading, PRNG), `musicThemes.ts` (per-season themes, time/weather layer tables, `MUSIC` constants), `musicComposer.ts` (pure `composePiece(seed, season, root)` → note events as data; re-exported from `Music.ts`), `musicState.ts` (pure state → `MusicParams` + smoothing), `instruments.ts` (oscillator instruments, node-budgeted), `Music.ts` (lookahead scheduler).

- **Scheduler**: `setInterval` every `MUSIC.tickMs` (25 ms) in `createAudio` calls `music.tick()`, which schedules notes up to `MUSIC.lookahead` (150 ms) ahead on the backend clock in 1/4-beat steps; notes that would land in the past are skipped (counted in `stats.late`). Tempo changes affect only the step duration, never pitch.
- **Composition**: each piece = form of 8-bar sections (`ABAB` / summer `AABA`), 4-degree progression per section (2 bars per chord), pad (voice-led triads), bass (whole / root-fifth / pulse), arp (chord tones, rests), melody (motif + rhythm templates, chord tones on strong beats, range clamped to scale idx 7..16, phrase-end rests, resolution on last bar), optional shaker. Every pitched note is a scale tone. Pieces are 85–110 s; between pieces a 10–30 s silence; each new piece changes key (4th/5th/2nd/3rd move). Seed = hash(seed, day, piece index, season).
- **Layers**: events carry a `rank`; they play when `rank < layerWeight`. Weights come from `musicState` (night sparse/slow ×0.85 tempo, dawn builds over 5–8 h, dusk, rain/snow, snowstorm = pads only, tension thins melody/perc). Smoothed with a 3 s time constant.
- **Speed**: 1× = theme bpm (70–90); 3× ×1.12; 10× ×1.25 (speed index 2 / 3); the music and ambience are ducked (not persisted) while a fast-forward runs. Paused (speed 0) fades out (`pauseMusicAtZero`, default on) and resumes where it left off.
- **Season change**: current track fades out over `crossfadeSec` (8 s) while a new-season piece fades in.
- **Tension**: incidents (`incident:avalanche/created/escalated`) raise tension (decays, tc 25 s) → low drone each bar + thinner texture. `rating:changed` up → glockenspiel jingle (min 8 s apart). Tension doesn't start music during a silence gap.
- **Voices**: ≤ `MUSIC.maxVoices` (12) concurrent, own pool (not the SFX pool); nodes disposed after release; one shared convolution reverb (generated impulse `reverbImpulse`, 2.2 s) via per-instrument sends; `createConvolver` is optional on `AudioBackend`.
- **Settings** (`slope.audio.v1`): `musicOn`, `pauseMusicAtZero`, `muteMusicInMenus` (placeholder, unused) + existing music volume.

Tuning knobs: `THEMES[*]` (bpm, modes, roots, progressions, form, instruments, rest chances, vel), `MUSIC.*` (voices, lookahead, crossfade, gaps, jingle gap, reverb wet/seconds, speedMul), `NIGHT/DAY/DUSK/HOURS/WEATHER_LAYERS`, per-instrument peaks/decays in `DEFS` (instruments.ts), `RANGE` (composer).

**Not verified by ear**: no audio device. Timbres (the "guitar" is a filtered saw/triangle + noise pick, not true Karplus-Strong; bell FM index; flute breath), reverb size, levels, musicality of the generated phrases and the crossfade feel are unverified. Logic (determinism, scale membership, voice cap, node bounds over 15 virtual minutes, no late events, crossfade/pause/resume) is unit-tested with the fake backend.

## Feedback sounds (M5.1)
- `money:changed` no longer plays a ka-ching by itself: the FX layer (`src/render/fx`) plays one quiet ka-ching (gain 0.4) only when a significant +$ popup appears, at most once per 3 s. `Feedback intensity: Off` therefore silences it.
- `building:placed` = soft thunk (`thud` gain 0.45, pitch 1.1). `milestone` (major only) = one `chimeImportant` at gain 0.55 (shares the `alert` limiter group with the news chime, so they never stack); minor milestones are silent.
