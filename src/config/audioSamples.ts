/**
 * Recorded sound samples (owner decision 2026-11-06: a SECOND exception to "everything but the music is procedural"; AGENTS.md, public/audio/README.md, docs/audio.md "Samples").
 * ONE table for every shipped file in `public/audio/sfx/` (CC0 / public domain recordings the owner picked), the pools they belong to, the per-file trims and the bed slots.
 * The synthesised sounds (Sfx.ts RECIPES, Ambience.ts LAYER_BUILDERS) are the FALLBACK and are never removed: a sample that is not loaded yet, failed to decode or was never cached
 * offline simply leaves the synth in charge. Nothing here was tuned by ear (agents have no audio device): the trims level every file to the synth it sits next to (see `SAMPLE_TARGETS`);
 * change numbers HERE. Disable everything: `SAMPLES.enabled = false` or `?nosamples=1` in the URL. Swap / add a file: docs/audio.md "Samples".
 */
import type { LayerId } from '../audio/Ambience';

/** Licence keys allowed in the repo (tests/repo/sfxAssets.test.ts): public domain or CC0 only. `-collection` / `-freesound`: CC0 per the collection / Freesound page, the owner verifies on the page (public/audio/README.md). */
export const SAMPLE_LICENCES = ['CC0', 'PD', 'CC0-collection', 'CC0-freesound'] as const;
export type SampleLicence = (typeof SAMPLE_LICENCES)[number];

/** One-shot roles. The first 14 replace an existing synthesised `Sfx` recipe of the same name (the recipe stays as the fallback); `rustle`, `lap` and `sleighBell` are extra one-shots layered on top of the synth beds (no fallback needed: the beds carry it). */
export const SHOT_ROLES = ['stepSnow', 'stepGravel', 'stepGrass', 'stepWood', 'stepRoad', 'thud', 'birdChirp', 'cowbell', 'churchBell', 'bell', 'clank', 'creak', 'avalanche', 'thunder', 'rustle', 'lap', 'sleighBell'] as const;
export type ShotRole = (typeof SHOT_ROLES)[number];
/** Roles that are extras (no synth recipe of that name). */
export const EXTRA_ROLES = ['rustle', 'lap', 'sleighBell'] as const satisfies readonly ShotRole[];

export interface SampleDef {
  /** File name without `.mp3` (`public/audio/sfx/<id>.mp3`; clean ASCII kebab-case). */
  id: string;
  /** Pool the file belongs to; `bed` = a seamless loop used through `BED_SLOTS`. */
  role: ShotRole | 'bed';
  /** Sub-pool (birdChirp: partridge | gull | night; stepGravel: damp). */
  tag?: string;
  /** Linear gain applied to this file so it sits at the level of the synth next to it (one-shots: peak -> `SAMPLE_TARGETS`; beds: rms -> `SAMPLE_TARGETS.bedRms`). Always trim * peak <= 8 * target (tested). */
  trim: number;
  loop?: boolean;
  /** Decode rate for beds / long clips (the file was encoded at this rate; decoding at it keeps the memory down). Absent = the context rate. */
  rate?: number;
  /** +- fraction of random gain per play. */
  gainJitter: number;
  /** +- fraction of random playback-rate (pitch) per play, on top of the caller's pitch. */
  pitchJitter: number;
  licence: SampleLicence;
  /** Measured on the shipped mp3 (ffmpeg volumedetect): duration (s), peak and mean (rms) level dBFS. */
  dur: number; peakDb: number; rmsDb: number;
}

/** Level targets the trims were computed from (peak, linear, per one-shot role at gain 1; the synth's own peaks are 0.03-0.07 for the quiet roles, 0.6-0.9 for avalanche / thud) and the rms a bed reaches at its layer ceiling. */
export const SAMPLE_TARGETS = { peak: { stepSnow: 0.08, stepGravel: 0.08, stepGrass: 0.08, stepWood: 0.08, stepRoad: 0.08, thud: 0.6, birdChirp: 0.06, cowbell: 0.06, churchBell: 0.12, bell: 0.2, clank: 0.15, creak: 0.05, avalanche: 0.7, thunder: 0.45, rustle: 0.12, lap: 0.1, sleighBell: 0.05 } as Record<ShotRole, number>, bedRms: 0.08 } as const;

/** Global switches and limits. */
export const SAMPLES = {
  /** Master switch (also `?nosamples=1`). false = the synthesised sounds only, nothing is fetched. */
  enabled: true,
  /** Relative to the page (works under `/play/` and `/slopetycoon/play/`); the service worker runtime-caches it (not precached, like the music). */
  dir: 'audio/sfx/',
  /** Decoded PCM we keep (MB): the least recently used IDLE buffers are dropped above it (buffers of playing beds are never dropped, so a busy scene may exceed it briefly). */
  memoryCapMB: 40,
  /** At most this many fetch + decode jobs at once (never blocks a footstep: the synth plays until the buffer is ready). */
  maxJobs: 2,
  /** A failed file is retried at the earliest after this many seconds (offline -> online). */
  retryAfterSec: 90,
  /** Beds are stopped (and their source freed) after being this long below `silentBelow`. */
  silentSec: 6, silentBelow: 0.002,
  /** Beds start at a random offset so two sessions (and two beds of one layer) do not line up. */
  randomOffset: true,
  /** The crossing bell loop plays while the view reports a ding (one every ~0.4 s): it fades out this long after the last one (s). */
  crossingHold: 0.9,
  /** Beds are not played on the Low graphics tier (CPU / memory on the weakest machines); one-shots still are. */
  bedsOnLow: false,
} as const;

/** Minimum gap (s) and bus for the extra one-shot roles (the others take theirs from their `Sfx` recipe). */
export const EXTRA_ROLE_META = { rustle: { gap: 0.6 }, lap: { gap: 1.2 }, sleighBell: { gap: 0.5 } } as const;

export const SAMPLE_DEFS: readonly SampleDef[] = [
  { id: 'step-snow-dry-01', role: 'stepSnow', trim: 0.133, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.44, peakDb: -4.4, rmsDb: -23.0 },
  { id: 'step-snow-dry-02', role: 'stepSnow', trim: 0.128, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.67, peakDb: -4.1, rmsDb: -25.0 },
  { id: 'step-snow-dry-03', role: 'stepSnow', trim: 0.127, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.5, peakDb: -4.0, rmsDb: -24.3 },
  { id: 'step-snow-wet-02', role: 'stepSnow', trim: 0.124, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.31, peakDb: -3.8, rmsDb: -22.4 },
  { id: 'step-snow-wet-03', role: 'stepSnow', trim: 0.146, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.43, peakDb: -5.2, rmsDb: -23.2 },
  { id: 'step-gravel-snowcove-01', role: 'stepGravel', trim: 0.46, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.47, peakDb: -15.2, rmsDb: -35.4 },
  { id: 'step-gravel-snowcove-02', role: 'stepGravel', trim: 0.791, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.69, peakDb: -19.9, rmsDb: -37.3 },
  { id: 'step-gravel-snowcove-03', role: 'stepGravel', trim: 0.951, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.64, peakDb: -21.5, rmsDb: -39.4 },
  { id: 'step-gravel-steps-01', role: 'stepGravel', trim: 0.125, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.7, peakDb: -3.9, rmsDb: -32.6 },
  { id: 'step-gravel-stones-01', role: 'stepGravel', trim: 0.137, gainJitter: 0.15, pitchJitter: 0.05, licence: 'PD', dur: 1.02, peakDb: -4.7, rmsDb: -34.3 },
  { id: 'step-mud-01', role: 'stepGravel', tag: 'damp', trim: 0.137, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.25, peakDb: -4.7, rmsDb: -28.7 },
  { id: 'step-grass-boot-01', role: 'stepGrass', trim: 0.117, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0-freesound', dur: 0.36, peakDb: -3.3, rmsDb: -22.6 },
  { id: 'step-grass-boot-02', role: 'stepGrass', trim: 0.125, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0-freesound', dur: 0.26, peakDb: -3.9, rmsDb: -24.5 },
  { id: 'step-grass-boot-03', role: 'stepGrass', trim: 0.12, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0-freesound', dur: 0.28, peakDb: -3.5, rmsDb: -25.2 },
  { id: 'step-grass-boot-04', role: 'stepGrass', trim: 0.12, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0-freesound', dur: 0.27, peakDb: -3.5, rmsDb: -24.8 },
  { id: 'step-grass-boot-05', role: 'stepGrass', trim: 0.125, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0-freesound', dur: 0.28, peakDb: -3.9, rmsDb: -22.6 },
  { id: 'step-grass-boot-06', role: 'stepGrass', trim: 0.118, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0-freesound', dur: 0.23, peakDb: -3.4, rmsDb: -23.6 },
  { id: 'step-grass-short-01', role: 'stepGrass', trim: 0.122, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0-freesound', dur: 0.15, peakDb: -3.7, rmsDb: -22.9 },
  { id: 'step-grass-leaves-01', role: 'stepGrass', trim: 0.127, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.39, peakDb: -4.0, rmsDb: -27.5 },
  { id: 'step-grass-leaves-02', role: 'stepGrass', trim: 0.12, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.47, peakDb: -3.5, rmsDb: -25.7 },
  { id: 'step-grass-fall-01', role: 'stepGrass', trim: 0.125, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.21, peakDb: -3.9, rmsDb: -25.2 },
  { id: 'step-wood-01', role: 'stepWood', trim: 0.125, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.24, peakDb: -3.9, rmsDb: -26.7 },
  { id: 'step-wood-02', role: 'stepWood', trim: 0.124, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.24, peakDb: -3.8, rmsDb: -21.0 },
  { id: 'step-wood-03', role: 'stepWood', trim: 0.118, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.31, peakDb: -3.4, rmsDb: -23.4 },
  { id: 'step-stone-01', role: 'stepRoad', trim: 0.124, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.22, peakDb: -3.8, rmsDb: -29.5 },
  { id: 'step-stone-02', role: 'stepRoad', trim: 0.12, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.33, peakDb: -3.5, rmsDb: -23.1 },
  { id: 'step-stone-03', role: 'stepRoad', trim: 0.121, gainJitter: 0.15, pitchJitter: 0.05, licence: 'CC0', dur: 0.33, peakDb: -3.6, rmsDb: -22.5 },
  { id: 'thud-dull-01', role: 'thud', trim: 0.898, gainJitter: 0.1, pitchJitter: 0.04, licence: 'CC0-collection', dur: 0.39, peakDb: -3.5, rmsDb: -16.7 },
  { id: 'thud-step-01', role: 'thud', trim: 0.877, gainJitter: 0.1, pitchJitter: 0.04, licence: 'CC0', dur: 0.15, peakDb: -3.3, rmsDb: -24.5 },
  { id: 'thud-step-02', role: 'thud', trim: 0.877, gainJitter: 0.1, pitchJitter: 0.04, licence: 'CC0', dur: 0.16, peakDb: -3.3, rmsDb: -29.3 },
  { id: 'bird-partridge-01', role: 'birdChirp', tag: 'partridge', trim: 0.09, gainJitter: 0.2, pitchJitter: 0.06, licence: 'CC0', dur: 0.39, peakDb: -3.5, rmsDb: -17.8 },
  { id: 'bird-partridge-02', role: 'birdChirp', tag: 'partridge', trim: 0.092, gainJitter: 0.2, pitchJitter: 0.06, licence: 'CC0', dur: 0.43, peakDb: -3.7, rmsDb: -16.5 },
  { id: 'bird-partridge-03', role: 'birdChirp', tag: 'partridge', trim: 0.088, gainJitter: 0.2, pitchJitter: 0.06, licence: 'CC0', dur: 0.38, peakDb: -3.3, rmsDb: -17.0 },
  { id: 'bird-partridge-04', role: 'birdChirp', tag: 'partridge', trim: 0.089, gainJitter: 0.2, pitchJitter: 0.06, licence: 'CC0', dur: 0.44, peakDb: -3.4, rmsDb: -16.6 },
  { id: 'bird-partridge-06', role: 'birdChirp', tag: 'partridge', trim: 0.09, gainJitter: 0.2, pitchJitter: 0.06, licence: 'CC0', dur: 0.47, peakDb: -3.5, rmsDb: -18.8 },
  { id: 'bird-gull-01', role: 'birdChirp', tag: 'gull', trim: 0.161, gainJitter: 0.2, pitchJitter: 0.06, licence: 'CC0', dur: 0.57, peakDb: -8.6, rmsDb: -21.9 },
  { id: 'bird-night-01', role: 'birdChirp', tag: 'night', trim: 0.06, gainJitter: 0.2, pitchJitter: 0.06, licence: 'CC0', dur: 0.83, peakDb: -3.1, rmsDb: -7.8 },
  { id: 'bed-birds-01', role: 'bed', trim: 3.077, loop: true, rate: 32000, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 27.18, peakDb: -9.0, rmsDb: -31.7 },
  { id: 'bell-ding-01', role: 'bell', trim: 0.299, gainJitter: 0.1, pitchJitter: 0.02, licence: 'CC0', dur: 1.36, peakDb: -3.5, rmsDb: -24.1 },
  { id: 'bell-church-01', role: 'churchBell', trim: 0.19, gainJitter: 0.1, pitchJitter: 0.02, licence: 'PD', dur: 0.43, peakDb: -4.0, rmsDb: -12.0 },
  { id: 'bell-cow-01', role: 'cowbell', trim: 0.109, gainJitter: 0.1, pitchJitter: 0.03, licence: 'PD', dur: 3.0, peakDb: -5.2, rmsDb: -28.7 },
  { id: 'bell-cow-02', role: 'cowbell', trim: 0.105, gainJitter: 0.1, pitchJitter: 0.03, licence: 'PD', dur: 0.54, peakDb: -4.9, rmsDb: -27.0 },
  { id: 'bed-cowbells-01', role: 'bed', trim: 2.153, loop: true, rate: 32000, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 25.24, peakDb: -6.2, rmsDb: -28.6 },
  { id: 'bed-crossing-01', role: 'bed', trim: 1.987, loop: true, rate: 32000, gainJitter: 0, pitchJitter: 0, licence: 'CC0-freesound', dur: 32.33, peakDb: -5.7, rmsDb: -27.9 },
  { id: 'bed-crossing-02', role: 'bed', trim: 2.056, loop: true, rate: 32000, gainJitter: 0, pitchJitter: 0, licence: 'CC0-freesound', dur: 15.95, peakDb: -18.4, rmsDb: -28.2 },
  { id: 'bell-sleigh-01', role: 'sleighBell', trim: 0.078, gainJitter: 0.1, pitchJitter: 0.02, licence: 'CC0', dur: 3.0, peakDb: -3.9, rmsDb: -27.4 },
  { id: 'bell-sleigh-02', role: 'sleighBell', trim: 0.076, gainJitter: 0.1, pitchJitter: 0.02, licence: 'CC0', dur: 0.9, peakDb: -3.6, rmsDb: -23.3 },
  { id: 'bed-morning-01', role: 'bed', trim: 2.08, loop: true, rate: 32000, gainJitter: 0, pitchJitter: 0, licence: 'CC0-collection', dur: 26.49, peakDb: -10.4, rmsDb: -28.3 },
  { id: 'bed-brook-01', role: 'bed', trim: 1.897, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'PD', dur: 14.39, peakDb: -9.5, rmsDb: -27.5 },
  { id: 'bed-brook-02', role: 'bed', trim: 2.444, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'PD', dur: 27.5, peakDb: -4.7, rmsDb: -29.7 },
  { id: 'bed-campfire-01', role: 'bed', trim: 2.806, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 27.76, peakDb: -7.0, rmsDb: -30.9 },
  { id: 'bed-crickets-01', role: 'bed', trim: 3.374, loop: true, rate: 32000, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 10.45, peakDb: -16.8, rmsDb: -32.5 },
  { id: 'bed-crowd-01', role: 'bed', trim: 1.73, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 23.88, peakDb: -16.0, rmsDb: -26.7 },
  { id: 'leaves-rustle-01', role: 'rustle', trim: 0.251, gainJitter: 0.2, pitchJitter: 0.05, licence: 'CC0', dur: 1.53, peakDb: -6.4, rmsDb: -29.9 },
  { id: 'leaves-rustle-02', role: 'rustle', trim: 0.168, gainJitter: 0.2, pitchJitter: 0.05, licence: 'CC0', dur: 0.85, peakDb: -2.9, rmsDb: -25.8 },
  { id: 'leaves-rustle-03', role: 'rustle', trim: 0.197, gainJitter: 0.2, pitchJitter: 0.05, licence: 'CC0', dur: 2.2, peakDb: -4.3, rmsDb: -28.5 },
  { id: 'leaves-rustle-08', role: 'rustle', trim: 0.201, gainJitter: 0.2, pitchJitter: 0.05, licence: 'CC0', dur: 1.84, peakDb: -4.5, rmsDb: -30.0 },
  { id: 'leaves-rustle-09', role: 'rustle', trim: 0.206, gainJitter: 0.2, pitchJitter: 0.05, licence: 'CC0', dur: 0.62, peakDb: -4.7, rmsDb: -29.8 },
  { id: 'leaves-rustle-17', role: 'rustle', trim: 0.211, gainJitter: 0.2, pitchJitter: 0.05, licence: 'CC0', dur: 0.71, peakDb: -4.9, rmsDb: -27.4 },
  { id: 'leaves-rustle-18', role: 'rustle', trim: 0.209, gainJitter: 0.2, pitchJitter: 0.05, licence: 'CC0', dur: 0.74, peakDb: -4.8, rmsDb: -26.3 },
  { id: 'lap-wave-01', role: 'lap', trim: 0.18, gainJitter: 0.1, pitchJitter: 0.02, licence: 'CC0', dur: 1.42, peakDb: -5.1, rmsDb: -31.5 },
  { id: 'bed-rain-01', role: 'bed', trim: 2.649, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 23.49, peakDb: -13.0, rmsDb: -30.4 },
  { id: 'bed-rain-02', role: 'bed', trim: 2.711, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 29.49, peakDb: -10.8, rmsDb: -30.6 },
  { id: 'bed-rain-03', role: 'bed', trim: 2.203, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 27.49, peakDb: -10.9, rmsDb: -28.8 },
  { id: 'bed-river-01', role: 'bed', trim: 2.104, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 26.49, peakDb: -13.4, rmsDb: -28.4 },
  { id: 'bed-river-02', role: 'bed', trim: 2.104, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 26.49, peakDb: -14.0, rmsDb: -28.4 },
  { id: 'bed-rapids-01', role: 'bed', trim: 5.409, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 26.5, peakDb: -4.0, rmsDb: -36.6 },
  { id: 'creak-tree-01', role: 'creak', trim: 0.074, gainJitter: 0.1, pitchJitter: 0.02, licence: 'CC0', dur: 6.21, peakDb: -3.4, rmsDb: -34.1 },
  { id: 'bed-drips-01', role: 'bed', trim: 5.93, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 16.6, peakDb: -4.7, rmsDb: -37.4 },
  { id: 'bed-wind-01', role: 'bed', trim: 1.156, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 30.5, peakDb: -6.9, rmsDb: -23.2 },
  { id: 'bed-wind-02', role: 'bed', trim: 1.143, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 26.49, peakDb: -7.7, rmsDb: -23.1 },
  { id: 'bed-wind-gust-01', role: 'bed', trim: 1.691, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 4.95, peakDb: -13.2, rmsDb: -26.5 },
  { id: 'bed-wind-storm-01', role: 'bed', trim: 2.203, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 26.49, peakDb: -6.4, rmsDb: -28.8 },
  { id: 'avalanche-01', role: 'avalanche', trim: 1.047, rate: 22050, gainJitter: 0.1, pitchJitter: 0.02, licence: 'CC0-freesound', dur: 6.11, peakDb: -3.5, rmsDb: -32.4 },
  { id: 'avalanche-02', role: 'avalanche', trim: 1.641, rate: 22050, gainJitter: 0.1, pitchJitter: 0.02, licence: 'CC0', dur: 2.33, peakDb: -7.4, rmsDb: -31.1 },
  { id: 'avalanche-03', role: 'avalanche', trim: 1.047, rate: 22050, gainJitter: 0.1, pitchJitter: 0.02, licence: 'CC0-collection', dur: 2.92, peakDb: -3.5, rmsDb: -17.5 },
  { id: 'mach-chairlift-seg1', role: 'bed', trim: 1.671, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0-freesound', dur: 27.5, peakDb: -12.6, rmsDb: -26.4 },
  { id: 'mach-chairlift-seg2', role: 'bed', trim: 1.875, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0-freesound', dur: 28.49, peakDb: -10.3, rmsDb: -27.4 },
  { id: 'mach-chairlift-squeak-01', role: 'clank', trim: 0.198, gainJitter: 0.1, pitchJitter: 0.02, licence: 'CC0-freesound', dur: 3.0, peakDb: -2.4, rmsDb: -26.3 },
  { id: 'mach-chairlift-squeak-02', role: 'clank', trim: 0.577, gainJitter: 0.1, pitchJitter: 0.02, licence: 'CC0-freesound', dur: 3.4, peakDb: -11.7, rmsDb: -32.9 },
  { id: 'mach-skilift-01', role: 'bed', trim: 3.259, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0-freesound', dur: 34.82, peakDb: -5.6, rmsDb: -32.2 },
  { id: 'mach-lifthum-01', role: 'bed', trim: 0.773, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 4.42, peakDb: -10.6, rmsDb: -19.7 },
  { id: 'mach-lifthum-02', role: 'bed', trim: 1.652, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 2.4, peakDb: -13.1, rmsDb: -26.3 },
  { id: 'mach-heli-01', role: 'bed', trim: 1.143, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 21.02, peakDb: -3.8, rmsDb: -23.1 },
  { id: 'mach-snowcat-01', role: 'bed', trim: 1.439, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0', dur: 18.2, peakDb: -13.2, rmsDb: -25.1 },
  { id: 'mach-cannon-01', role: 'bed', trim: 1.17, loop: true, rate: 22050, gainJitter: 0, pitchJitter: 0, licence: 'CC0-freesound', dur: 27.5, peakDb: -9.8, rmsDb: -23.3 },
  { id: 'thunder-01', role: 'thunder', trim: 0.681, rate: 22050, gainJitter: 0.1, pitchJitter: 0.02, licence: 'PD', dur: 30.0, peakDb: -3.6, rmsDb: -21.2 },
  { id: 'thunder-02', role: 'thunder', trim: 0.673, rate: 22050, gainJitter: 0.1, pitchJitter: 0.02, licence: 'CC0', dur: 30.0, peakDb: -3.5, rmsDb: -24.5 },
] as const;

export const SAMPLE_BY_ID: ReadonlyMap<string, SampleDef> = new Map(SAMPLE_DEFS.map((s) => [s.id, s]));
export const sampleUrl = (id: string): string => `${SAMPLES.dir}${id}.mp3`;
/** Decoded size in bytes (mono float32) at the rate the file is decoded at. */
export const sampleBytes = (s: SampleDef, ctxRate = 48000): number => Math.ceil(s.dur * (s.rate ?? ctxRate)) * 4;

/** Pools by role (built once). Order = the table order. */
export const POOLS: Readonly<Record<ShotRole, readonly SampleDef[]>> = Object.fromEntries(SHOT_ROLES.map((r) => [r, SAMPLE_DEFS.filter((s) => s.role === r)])) as unknown as Record<ShotRole, readonly SampleDef[]>;

/** Gates: how loud a bed slot wants to be, 0..1, from the ambience mix and state (pure: src/audio/sampleMix.ts). */
export const GATE_IDS = ['windLight', 'windStorm', 'windGust', 'rainLight', 'rainStorm', 'crickets', 'crowd', 'lift', 'liftHum', 'stream', 'rapids', 'snowcat', 'heli', 'campfire', 'birds', 'morning', 'cowbells', 'drips', 'cannon', 'crossing'] as const;
export type GateId = (typeof GATE_IDS)[number];

export interface BedSlot {
  id: string;
  /** Sample id (a `bed` role file). */
  sample: string;
  gate: GateId;
  /** Synth layer this slot replaces (coverage fades the synth layer out); absent = an extra bed with no synth twin. */
  layer?: LayerId;
  /** Linear gain at gate = 1: the layer's ceiling (AMB.layerMax) for slots that have a layer, otherwise this number. */
  ceil?: number;
  /** Share of the ceiling (slots of one layer sum to about 1). */
  weight: number;
}

/** Bed slots (the loops). Several slots of one layer play at unrelated lengths so the sum does not repeat audibly. */
export const BED_SLOTS: readonly BedSlot[] = [
  { id: 'wind-a', sample: 'bed-wind-01', gate: 'windLight', layer: 'wind', weight: 0.7 },
  { id: 'wind-b', sample: 'bed-wind-02', gate: 'windLight', layer: 'wind', weight: 0.5 },
  { id: 'wind-gust', sample: 'bed-wind-gust-01', gate: 'windGust', layer: 'wind', weight: 0.25 },
  { id: 'wind-storm', sample: 'bed-wind-storm-01', gate: 'windStorm', layer: 'wind', weight: 1 },
  { id: 'rain-a', sample: 'bed-rain-01', gate: 'rainLight', layer: 'rain', weight: 0.7 },
  { id: 'rain-b', sample: 'bed-rain-03', gate: 'rainLight', layer: 'rain', weight: 0.5 },
  { id: 'rain-storm', sample: 'bed-rain-02', gate: 'rainStorm', layer: 'rain', weight: 1 },
  { id: 'crickets', sample: 'bed-crickets-01', gate: 'crickets', layer: 'crickets', weight: 1 },
  { id: 'crowd', sample: 'bed-crowd-01', gate: 'crowd', layer: 'crowd', weight: 0.9 },
  { id: 'lift-a', sample: 'mach-chairlift-seg1', gate: 'lift', layer: 'lift', weight: 0.6 },
  { id: 'lift-b', sample: 'mach-chairlift-seg2', gate: 'lift', layer: 'lift', weight: 0.5 },
  { id: 'lift-ski', sample: 'mach-skilift-01', gate: 'lift', layer: 'lift', weight: 0.4 },
  { id: 'lift-hum', sample: 'mach-lifthum-01', gate: 'liftHum', layer: 'lift', weight: 0.25 },
  { id: 'lift-hum-b', sample: 'mach-lifthum-02', gate: 'liftHum', layer: 'lift', weight: 0.2 },
  { id: 'brook-a', sample: 'bed-brook-01', gate: 'stream', layer: 'stream', weight: 0.7 },
  { id: 'brook-b', sample: 'bed-brook-02', gate: 'stream', layer: 'stream', weight: 0.5 },
  { id: 'river-a', sample: 'bed-river-01', gate: 'stream', layer: 'stream', weight: 0.4 },
  { id: 'rapids-a', sample: 'bed-rapids-01', gate: 'rapids', layer: 'rapids', weight: 1 },
  { id: 'river-b', sample: 'bed-river-02', gate: 'rapids', layer: 'rapids', weight: 0.6 },
  { id: 'snowcat', sample: 'mach-snowcat-01', gate: 'snowcat', layer: 'snowcat', weight: 1 },
  { id: 'heli', sample: 'mach-heli-01', gate: 'heli', layer: 'heli', weight: 1 },
  { id: 'campfire', sample: 'bed-campfire-01', gate: 'campfire', layer: 'campfire', weight: 1 },
  { id: 'cannon', sample: 'mach-cannon-01', gate: 'cannon', layer: 'cannon', weight: 1 },
  // Extra beds with no synth twin (nature, very quiet; the explicit ceilings are well under the lowest layer ceilings).
  { id: 'birds', sample: 'bed-birds-01', gate: 'birds', ceil: 0.05, weight: 1 },
  { id: 'morning', sample: 'bed-morning-01', gate: 'morning', ceil: 0.035, weight: 1 },
  { id: 'cowbells', sample: 'bed-cowbells-01', gate: 'cowbells', ceil: 0.05, weight: 1 },
  { id: 'drips', sample: 'bed-drips-01', gate: 'drips', ceil: 0.05, weight: 1 },
  // The level crossing: a looping bell that sounds while the barrier is down (fed by Sfx 'crossingBell' calls, the one-shot synth ding-ding is the fallback).
  { id: 'crossing-a', sample: 'bed-crossing-01', gate: 'crossing', ceil: 0.07, weight: 1 },
];

/** Share of a synth layer that is KEPT when its samples fully cover it (0 = the synth layer is silent, the recording replaces it; the layers whose samples are one-shots keep part of the bed). */
export const SYNTH_KEEP: Readonly<Partial<Record<LayerId, number>>> = { wind: 0, rain: 0, crickets: 0, crowd: 0.25, lift: 0, stream: 0, rapids: 0, snowcat: 0, heli: 0, campfire: 0, cannon: 0 };
/** Extra one-shot samples (rustle / lap / sleighBell) take over part of these synth beds once their pool is ready. */
export const SYNTH_SHRINK_WITH_SHOTS: Readonly<Partial<Record<LayerId, { role: ShotRole; keep: number }>>> = { leaves: { role: 'rustle', keep: 0.4 }, water: { role: 'lap', keep: 0.6 }, sleigh: { role: 'sleighBell', keep: 0.4 } };

/** Rates (per second at intensity 1) of the extra one-shot rolls in Ambience.update. `nightBird` 0.06 -> 0.03 (owner "faint honk" report 2026-11-06: the night call is a loud-ish clip). */
export const SAMPLE_RATES = { rustle: 0.45, lap: 0.35, sleighBell: 0.6, thunderStorm: 1 / 75, nightBird: 0.03 } as const;

/**
 * Roles whose RECORDINGS are not played (the synthesised recipe of the same name plays instead; the files stay in the repo and in `SAMPLE_DEFS`, nothing is fetched for them).
 * `churchBell` (owner report "a beep / honk happens very often", 2026-11-06): the only recording is a 0.43 s, dense clip (rms -12 dB) that struck every game hour (6 s at 1x) near ANY building;
 * measured 27-36 strikes per real minute at speed 3 (`npm run audio:census`). The soft synth sine bell (what 0.5.x played) is back. Remove the id here to bring the clip back.
 */
export const SAMPLE_RETIRED: readonly ShotRole[] = ['churchBell'];
/** Minimum seconds between two SAMPLE plays of a role (a play inside the gap is dropped, never replaced by the synth): the chairlift squeak is a 3 s clip, it must not sound every few seconds. */
export const SAMPLE_MIN_GAP: Readonly<Partial<Record<ShotRole, number>>> = { clank: 12 };
