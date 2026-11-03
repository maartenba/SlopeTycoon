/**
 * Music tunables (owner feedback, Nov 2026: "the music is meh", Apres bar needs beats, game music must stop near the bar).
 * ONE table for everything the generative music and the bar-music hand-off need; proximity levels stay in `audioProximity.ts` (`PROX`).
 * Nothing here was tuned by ear (agents have no audio device): change numbers HERE, then listen to `npm run audio:export`.
 * Docs: docs/audio.md ("Music rework"), by-ear checklist: docs/playtest-audio.md.
 */
export const MUSIC_MIX = {
  /** Ping-pong delay send: return level (0 = off) and feedback. The delay time follows the tempo (dotted eighth). */
  delayWet: 0.16, delayFeedback: 0.36, delayDamp: 2400,
  /** Gentle "sidechain" of pads / counter melody against the kick on kit tracks: depth (0..1) and release time constant (s). */
  sidechainDepth: 0.28, sidechainRelease: 0.11,
  /** Swing of the off-beat eighths on kit tracks as a fraction of an eighth (0 = straight, 0.33 = triplet shuffle). */
  swingLofi: 0.3, swingPop: 0.12,
  /** Per-season and per-weather tempo factors (applied on top of time of day and game speed). */
  seasonTempo: { winter: 0.97, spring: 1, summer: 1, autumn: 0.96 } as Record<string, number>,
  weatherTempo: { clear: 1, cloudy: 0.98, snow: 0.94, rain: 0.94, heavySnow: 0.9, storm: 0.9 } as Record<string, number>,
} as const;

/** Hand-off between the game music and the Apres-Ski Bar music: the game music STOPS (fades out, holds its position, fades back in); the two never sound together. */
export const HANDOFF = {
  /** Bar level (proximity x zoom window, 0..1) to start the bar music / to give the game music back. enter > exit = hysteresis. */
  enterLevel: 0.12, exitLevel: 0.04,
  /** The level must stay beyond the threshold this long (s) before the state flips (no flip-flop while zooming). */
  enterDwell: 0.5, exitDwell: 2,
  /** Minimum time (s) spent in each steady state before the next switch may start. */
  minApresSec: 4, minMainSec: 3,
  /** Fades (s): game music out (before the bar music starts), bar music in, bar music out (before the game music returns), game music back in. */
  mainFadeOut: 0.7, apresFadeIn: 0.8, apresFadeOut: 0.6, mainFadeIn: 0.9,
  /** After the hold the game music resumes at the start of the current chord (a bar or two back) so a held pad is re-struck instead of missing. */
  resumeRewind: true,
} as const;

/** Apres-Ski bar party music (src/audio/apresSong.ts + Apres.ts). */
export const APRES_SONG = {
  /** Tempo (bpm) of the four variants chosen by seed (124 to 128 = danceable party-schlager / EDM-polka). */
  bpms: [126, 124, 128, 125] as readonly number[],
  /** Key roots (MIDI) a seed may pick from. */
  keys: [48, 50, 53, 55] as readonly number[],
  /** Max live voices of the bar music (CPU cap) and the lookahead (s). */
  maxVoices: 30, lookahead: 0.4,
  /** Peak loudness: bar music out gain at level 1 (ambience bus). Hotter than the game music on purpose, it is a party. */
  outGain: 1,
  /** Velocity scale per section kind (the arrangement's dynamics: the drop is the loudest, the verse, intro and break sit lower, the build-up rises through the roll itself). */
  sectionGain: { intro: 0.6, verse: 0.72, build: 0.85, drop: 1, break: 0.65, outro: 0.55 } as Record<string, number>,
  /** Absence (s) after which the song restarts from its intro instead of continuing. */
  restartAfterSec: 25,
  /** Section plan in bars: [kind, bars]. intro (filtered chords + hats), verse (kick, clap, offbeat hats, bass), build (snare roll + riser), drop (full), break (no kick, hook solo), outro. */
  form: [['intro', 4], ['verse', 8], ['build', 4], ['drop', 8], ['break', 4], ['build', 4], ['drop', 8], ['outro', 4]] as ReadonlyArray<readonly [string, number]>,
} as const;

/** `npm run audio:export` (scripts/audio-export.ts): preview folder, encoding, loudness targets (LUFS, integrated). */
export const EXPORT = {
  dir: '.weave/audio-previews', /** 40960 Hz: one 25 ms scheduler step is exactly five 128-sample blocks in the software renderer, so audio time == render time. mp3s are resampled to 44.1 kHz. */ sampleRate: 40960, mp3Kbps: 192,
  seconds: 75, apresSeconds: 90,
  /** The renders are normalised to these loudness targets so the owner can compare tracks fairly (in the game the bus sliders make them quieter). */
  musicLufs: -17, apresLufs: -15, maxPeak: 0.89,
} as const;
