/* Browser entry for `npm run audio:crosscheck`: renders the real Music / Ambience code with the browser's OWN OfflineAudioContext. */
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { Music } from '../../src/audio/Music';
import { Ambience, type AmbienceState } from '../../src/audio/Ambience';
import { Sfx } from '../../src/audio/Sfx';
import { wrapContext, type AudioBackend } from '../../src/audio/backend';
import type { MusicInput } from '../../src/audio/musicState';
import type { MusicStyle } from '../../src/audio/musicThemes';

interface Job { seconds: number; sr: number; style?: MusicStyle; music?: Partial<MusicInput>; ambience?: AmbienceState | null; seed: number; volume: number }
(window as unknown as { run: (j: Job) => Promise<{ l: string; r: string }> }).run = async (j) => {
  const ctx = new OfflineAudioContext(2, Math.round(j.seconds * j.sr), j.sr);
  const real = wrapContext(ctx as unknown as AudioContext);
  const b: AudioBackend = Object.create(real, { state: { get: () => 'running' }, resume: { value: async () => undefined }, suspend: { value: async () => undefined }, now: { value: () => ctx.currentTime } });
  const settings = new AudioSettings(null); settings.set({ musicStyle: j.style ?? 'auto', music: j.volume, ambience: j.volume, master: 1 });
  const engine = new AudioEngine({ factory: () => b, settings }); await engine.onGesture();
  const music = new Music(engine, { seed: j.seed }), sfx = new Sfx(engine);
  let a = j.seed >>> 0; const rng = (): number => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const amb = new Ambience(engine, sfx, rng);
  if (j.music) music.setInputs(j.music);
  const step = 0.025; let k = 0;
  const tickOnce = (): void => { if (j.ambience === null || j.ambience === undefined) music.tick(); else { if (k % 4 === 0) amb.update(j.ambience, 0.1); } k++; };
  tickOnce();
  const sched = (n: number): void => { const t = Math.ceil((n * step) * j.sr / 128) * 128 / j.sr; if (t >= j.seconds) return; void ctx.suspend(t).then(() => { tickOnce(); sched(n + 1); void ctx.resume(); }); };
  sched(1);
  const buf = await ctx.startRendering();
  const enc = (x: Float32Array): string => { let s = ''; const u = new Uint8Array(x.buffer, x.byteOffset, x.byteLength); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  return { l: enc(buf.getChannelData(0)), r: enc(buf.getChannelData(1)) };
};
