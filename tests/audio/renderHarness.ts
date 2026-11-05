import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings, type AudioSettingsData } from '../../src/audio/AudioSettings';
import { Ambience, type AmbienceState } from '../../src/audio/Ambience';
import { MusicHandoff } from '../../src/audio/musicHold';
import { Sfx } from '../../src/audio/Sfx';
import { OfflineBackend } from './offlineBackend';
import { MemStorage } from './fakeBackend';

export interface Rendered { l: Float32Array; r: Float32Array; sampleRate: number; backend: OfflineBackend; ambience: Ambience; engine: AudioEngine }
export interface RenderOpts { seconds: number; sampleRate?: number; seed?: number; settings?: Partial<AudioSettingsData>; ambience?: Partial<AmbienceState> | null; ambienceOn?: boolean; /** Time-varying ambience patch (e.g. the apres level while the camera walks to a bar and back), applied on top of `ambience`. */ ambienceAt?: (t: number) => Partial<AmbienceState>; /** Called every scheduler step with the audio time, e.g. to change settings mid-render. */ onStep?: (t: number, h: { settings: AudioSettings }) => void }

const AMB_DEFAULT: AmbienceState = { season: 'winter', weather: 'clear', hour: 12, zoom: 20, altitude: 0.5, wind: 0.3, water: 0.5, crowd: 40, lifts: 0.5, buildings: 0.4, cows: 0, snowcat: 0, heli: 0 };

/**
 * Drives the real Ambience / Sfx / AudioEngine (the music is mp3 files: tests/audio/music*.test.ts use a fake media player) against the software renderer for `seconds` of audio time (25 ms scheduler ticks, 100 ms ambience ticks).
 * Output is what comes out of the master chain (buses -> master -> compressor -> destination), at the bus / master settings given (defaults: the real defaults).
 */
export async function renderAudio(o: RenderOpts): Promise<Rendered> {
  const ob = new OfflineBackend(o.sampleRate ?? 24000), settings = new AudioSettings(new MemStorage());
  if (o.settings) settings.set(o.settings);
  const engine = new AudioEngine({ factory: () => ob as never, settings });
  await engine.onGesture();
  const handoff = new MusicHandoff();
  const sfx = new Sfx(engine), amb = new Ambience(engine, sfx, mulb(o.seed ?? 5), handoff);
  const state0 = { ...AMB_DEFAULT, ...(o.ambience ?? {}) };
  const step = 0.025, n = Math.round(o.seconds / step);
  for (let i = 0; i < n; i++) {
    o.onStep?.(i * step, { settings });
    if (o.ambience !== null && o.ambienceOn !== false && i % 4 === 0) amb.update(o.ambienceAt ? { ...state0, ...o.ambienceAt(i * step) } : state0, 0.1);
    ob.process(step);
  }
  const c = ob.capture();
  return { l: c.l, r: c.r, sampleRate: c.sampleRate, backend: ob, ambience: amb, engine };
}
function mulb(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** One state per ambience character (each on top of a calm base wind), used by the analysis script and the offline tests. */
export const AMB_CASES: Record<string, Partial<AmbienceState>> = {
  wind: { wind: 0.5 }, crickets: { season: 'summer', hour: 20, wind: 0 }, insects: { season: 'summer', hour: 12, wind: 0 }, birds: { season: 'summer', hour: 9, wind: 0 },
  crowd: { crowd: 80 }, lift: { lifts: 1 }, water: { water: 1, season: 'spring' }, snowcat: { snowcat: 1, hour: 23 }, rain: { weather: 'rain', season: 'spring' },
  leaves: { season: 'autumn', wind: 0.6 }, heli: { heli: 1 }, concert: { season: 'summer', hour: 20, wind: 0, concert: 1 }, storm: { weather: 'storm', wind: 1, altitude: 0.8 },
};
export const AMB_BASE: AmbienceState = { season: 'winter', weather: 'clear', hour: 12, zoom: 12, altitude: 0.4, wind: 0.3, water: 0, crowd: 0, lifts: 0, buildings: 0, cows: 0, snowcat: 0, heli: 0 };
