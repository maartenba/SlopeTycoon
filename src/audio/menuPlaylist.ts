/** Pure helpers of the title-screen music (docs/audio.md "Menu music"): playlist order, crossfade envelope, loudness trim. No audio, no DOM. */

/** Next track index: never the previous one (when there are >= 2), uniform among the others. `rand` in [0,1). Start (prev < 0): any track. */
export function nextTrackIndex(prev: number, count: number, rand: () => number): number {
  if (count <= 0) return -1;
  if (count === 1) return 0;
  if (prev < 0 || prev >= count) return Math.min(count - 1, Math.floor(rand() * count));
  const k = Math.min(count - 2, Math.floor(rand() * (count - 1)));
  return k >= prev ? k + 1 : k;
}

/** Equal-power fade gain at progress p (0..1): `in` rises 0 -> 1, `out` falls 1 -> 0; in^2 + out^2 = 1 for a click-free crossfade. */
export function fadeIn(p: number): number { return Math.sin(Math.min(1, Math.max(0, p)) * Math.PI / 2); }
export function fadeOut(p: number): number { return Math.cos(Math.min(1, Math.max(0, p)) * Math.PI / 2); }

/** Gain trim that moves a track measured at `lufs` to `target` LUFS, never above `maxGain` (no clipping surprises). */
export function trimFor(lufs: number, target: number, maxGain = 1): number { return Math.min(maxGain, 10 ** ((target - lufs) / 20)); }

/** When (audio-clock s) the next track must start so the crossfade ends exactly at the track end. */
export function nextStartAt(startedAt: number, duration: number, crossfade: number): number { return startedAt + Math.max(0, duration - Math.min(crossfade, duration / 2)); }
