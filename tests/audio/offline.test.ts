import { describe, expect, it } from 'vitest';
import { TRACK_IDS, type TrackId } from '../../src/audio/musicThemes';
import type { MusicInput } from '../../src/audio/musicState';
import { RECIPES } from '../../src/audio/Sfx';
import { playNote } from '../../src/audio/instruments';
import { NoiseBank } from '../../src/audio/synth';
import { OfflineBackend, clickScore, maxStepDb, spectrum, statsOf, tonalProminence, windowedDb } from './offlineBackend';
import { AMB_BASE, AMB_CASES, renderAudio } from './renderHarness';

/**
 * Offline renders through the software Web Audio renderer (tests/audio/offlineBackend.ts): the REAL Music / Ambience / Sfx / engine code, rendered to samples.
 * These check objective properties (headroom, DC, clicks, loudness, spectrum, tonal whistles). They cannot tell whether it sounds nice (nobody listened): see docs/audio.md.
 */
const SR = 24000, T0 = 8;
const MAX_JUMP = 0.25; // absolute sample-to-sample step sanity bound (smooth 1 kHz tones at peak 0.5 step ~0.13)
const MUSIC_CLICK = 25, BED_CLICK = 12; // clickScore: music / beds score 5-14 here, a 0.05 step in a 0.2 tone scores 55

const CTX: Record<TrackId, Partial<MusicInput>> = {
  morningSnow: { season: 'winter', hour: 8 }, alpineNoon: { season: 'winter', hour: 13 }, apres: { season: 'winter', hour: 19 }, starlight: { season: 'winter', hour: 23 },
  summerMeadow: { season: 'summer', hour: 12 }, autumnGold: { season: 'autumn', hour: 15 }, blizzard: { weather: 'storm', hour: 12 }, title: { menu: true }, festival: { season: 'summer', hour: 14, festival: true, busy: 1 },
};

describe('music tracks, rendered (music 100 %, master 100 % = worst case)', () => {
  for (const id of TRACK_IDS) {
    it(`${id}: headroom, no DC, no clicks, soft spectrum, steady loudness, stereo`, async () => {
      const r = await renderAudio({ seconds: 42, sampleRate: SR, seed: 21, settings: { musicStyle: id, music: 1, master: 1 }, music: CTX[id], ambience: null });
      expect(r.music.currentTrack).toBe(id);
      const from = SR * T0, l = r.l.subarray(from), rr = r.r.subarray(from), s = statsOf(l);
      expect(Math.max(s.peak, statsOf(rr).peak)).toBeLessThan(0.9);
      expect(Math.abs(s.dc)).toBeLessThan(1e-3);
      expect(s.maxJump).toBeLessThan(MAX_JUMP); expect(clickScore(l)).toBeLessThan(MUSIC_CLICK);
      expect(s.rmsDb).toBeGreaterThan(-42); expect(s.rmsDb).toBeLessThan(-14);
      const sp = spectrum(l, SR);
      expect(sp.centroid).toBeGreaterThan(80); expect(sp.centroid).toBeLessThan(1500);
      expect(sp.above(4000)).toBeLessThan(0.01); expect(sp.above(8000)).toBeLessThan(0.001);
      const db = windowedDb(l, SR, 4); // loudness range over the steady part
      expect(Math.max(...db) - Math.min(...db)).toBeLessThan(15);
      let side = 0, mid = 0; for (let i = 0; i < l.length; i++) { side += (l[i]! - rr[i]!) ** 2; mid += (l[i]! + rr[i]!) ** 2; }
      expect(Math.sqrt(side / mid), 'stereo width').toBeGreaterThan(0.05);
      expect(r.backend.peakNodes).toBeLessThan(500); // CPU budget: nodes in the graph
      expect(r.music.activeVoices).toBeLessThanOrEqual(14);
    }, 60000);
  }
  it('is deterministic per seed (bit-identical render) and differs across seeds', async () => {
    const a = await renderAudio({ seconds: 12, sampleRate: 16000, seed: 4, settings: { musicStyle: 'apres' }, ambience: null });
    const b = await renderAudio({ seconds: 12, sampleRate: 16000, seed: 4, settings: { musicStyle: 'apres' }, ambience: null });
    const c = await renderAudio({ seconds: 12, sampleRate: 16000, seed: 5, settings: { musicStyle: 'apres' }, ambience: null });
    expect(Buffer.from(a.l.buffer).equals(Buffer.from(b.l.buffer))).toBe(true);
    expect(Buffer.from(a.l.buffer).equals(Buffer.from(c.l.buffer))).toBe(false);
  }, 60000);
  it('Next / crossfade between tracks has no click and no loudness jump; defaults leave plenty of headroom', async () => {
    const r = await renderAudio({ seconds: 70, sampleRate: SR, seed: 8, settings: { music: 1, master: 1 }, music: { season: 'summer', hour: 14 }, ambience: null, skipAt: [25, 45] });
    expect(r.music.stats.crossfades).toBe(2);
    const x = r.l.subarray(SR * 6), s = statsOf(x);
    expect(s.maxJump).toBeLessThan(MAX_JUMP); expect(clickScore(x)).toBeLessThan(MUSIC_CLICK); expect(s.peak).toBeLessThan(0.9);
    const db = windowedDb(x, SR, 1); let worst = 0; for (let i = 1; i < db.length; i++) worst = Math.max(worst, Math.abs(db[i]! - db[i - 1]!));
    expect(worst).toBeLessThan(9);
    const d = await renderAudio({ seconds: 30, sampleRate: SR, seed: 8, music: { season: 'summer', hour: 14 }, ambience: null });
    expect(statsOf(d.l).peak).toBeLessThan(0.3); // real defaults (music .5, master .7): quiet (about -15 dBFS peak)
  }, 120000);
  it('pause fade-out and resume are click-free', async () => {
    const r = await renderAudio({ seconds: 26, sampleRate: SR, seed: 3, settings: { musicStyle: 'morningSnow', music: 1, master: 1 }, music: { hour: 8 }, ambience: null, onStep: (t, h) => { h.music.setInputs({ speed: t >= 10 && t < 18 ? 0 : 1 }); } });
    const mid = windowedDb(r.l.subarray(SR * 13, SR * 17), SR, 1); expect(Math.max(...mid)).toBeLessThan(-70); // really silent while paused
    expect(windowedDb(r.l.subarray(SR * 22), SR, 1)[0]!).toBeGreaterThan(-50); // and back after resume
    expect(statsOf(r.l).maxJump).toBeLessThan(MAX_JUMP); expect(clickScore(r.l)).toBeLessThan(MUSIC_CLICK);
  }, 60000);
});

describe('instruments are warm and harmonic (the old FM bells are gone)', () => {
  const note = (inst: Parameters<typeof playNote>[1], midi: number, dur = 1.5): Float32Array => {
    const ob = new OfflineBackend(32000), nb = new NoiseBank(ob as never), out = ob.createGain(); out.connect(ob.destination);
    playNote({ b: ob as never, noise: nb, dest: out as never, reverb: null }, inst, midi, 0.1, dur, 1);
    ob.process(dur + 3); return ob.capture().l;
  };
  it('every tonal partial of the pitched instruments sits on an integer multiple of the fundamental (<= 1.5 % off)', () => {
    const midi = 69, f0 = 440, sr = 32000, size = 16384;
    for (const inst of ['harp', 'epiano', 'pluck', 'guitar', 'flute', 'pad', 'strings', 'sub'] as const) {
      const x = note(inst, midi), sp = spectrum(x, sr, size), n = sp.bins.length;
      let top = 0; for (let k = 2; k < n; k++) top = Math.max(top, sp.bins[k]!);
      for (let k = 3; k < n - 1; k++) {
        const hz = (k * sr) / size;
        if (!(sp.bins[k]! > sp.bins[k - 1]! && sp.bins[k]! > sp.bins[k + 1]!) || sp.bins[k]! < top * 1e-3 /* -30 dB */ || hz < 200) continue;
        const ratio = hz / f0, off = Math.abs(ratio - Math.round(ratio)) / Math.round(ratio);
        expect(off, `${inst} partial at ${hz.toFixed(0)} Hz (x${ratio.toFixed(2)})`).toBeLessThan(0.015);
      }
    }
  });
  it('notes decay smoothly: attack >= 5 ms, no energy above 6 kHz, peak below 0.4 each', () => {
    for (const inst of ['harp', 'epiano', 'pluck', 'guitar', 'flute', 'pad', 'strings', 'sub', 'brush', 'shaker'] as const) {
      const x = note(inst, 72), s = statsOf(x);
      expect(s.peak, inst).toBeLessThan(0.4);
      expect(spectrum(x, 32000).above(6000), inst).toBeLessThan(inst === 'shaker' ? 0.2 : 0.02); // the shaker is a noise burst, low-passed at 6.5 kHz
      expect(s.maxJump, inst).toBeLessThan(0.08);
    }
  });
});

describe('ambience beds, rendered (ambience 100 % so flaws are not hidden by gain)', () => {
  for (const [name, patch] of Object.entries(AMB_CASES)) {
    it(`${name}: headroom, no DC, no clicks, no whistle / hum line, no bursts`, async () => {
      const r = await renderAudio({ seconds: 24, sampleRate: SR, seed: 7, settings: { ambience: 1, master: 1 }, ambience: { ...AMB_BASE, ...patch }, musicOn: false });
      const x = r.l.subarray(SR * T0), s = statsOf(x), tp = tonalProminence(x, SR);
      expect(s.peak).toBeLessThan(0.9);
      expect(Math.abs(s.dc)).toBeLessThan(1e-3);
      expect(s.maxJump).toBeLessThan(Math.max(MAX_JUMP, 6 * s.rms)); expect(clickScore(x)).toBeLessThan(BED_CLICK);
      expect(tp.db, `tonal line ${tp.hz.toFixed(0)} Hz`).toBeLessThan(7); // the old 4.3 kHz crickets / 38 Hz saw layers measured 13-16 dB here
      expect(maxStepDb(x, SR)).toBeLessThan(12);
      expect(spectrum(x, SR).above(8000)).toBeLessThan(0.01);
      expect(r.backend.peakNodes).toBeLessThan(330);
    }, 60000);
  }
  it('ambience stays QUIET at the default settings (every case below -30 dBFS RMS)', async () => {
    for (const [name, patch] of Object.entries(AMB_CASES)) {
      const r = await renderAudio({ seconds: 14, sampleRate: 16000, seed: 7, ambience: { ...AMB_BASE, ...patch }, musicOn: false });
      expect(statsOf(r.l.subarray(16000 * 6)).rmsDb, name).toBeLessThan(-30);
    }
  }, 120000);
  it('one-shot birds are soft sine chirps: quiet, smooth, no energy above 6 kHz (no FM sidebands)', async () => {
    const ob = new OfflineBackend(32000), { AudioEngine } = await import('../../src/audio/AudioEngine'), { AudioSettings } = await import('../../src/audio/AudioSettings'), { Sfx } = await import('../../src/audio/Sfx');
    const eng = new AudioEngine({ factory: () => ob as never, settings: new AudioSettings(null) }); await eng.onGesture();
    const sfx = new Sfx(eng); for (let i = 0; i < 6; i++) { sfx.play('birdChirp', { pitch: 0.9 + i * 0.07 }); ob.process(0.8); }
    const x = ob.capture().l, s = statsOf(x);
    expect(s.peak).toBeGreaterThan(0.001); expect(s.peak).toBeLessThan(0.1); expect(s.maxJump).toBeLessThan(0.05);
    const sp = spectrum(x, 32000); expect(sp.above(6000)).toBeLessThan(0.02); expect(sp.centroid).toBeGreaterThan(1800); expect(sp.centroid).toBeLessThan(4500);
    expect(RECIPES.birdChirp.maxPerSec).toBeLessThanOrEqual(3);
  }, 60000);
  it('the level crossing bell is quiet and clean at full gain (M6.1: no clipping, no DC, no clicks), repeated like the view does', async () => {
    const ob = new OfflineBackend(32000), { AudioEngine } = await import('../../src/audio/AudioEngine'), { AudioSettings } = await import('../../src/audio/AudioSettings'), { Sfx } = await import('../../src/audio/Sfx');
    const eng = new AudioEngine({ factory: () => ob as never, settings: new AudioSettings(null) }); await eng.onGesture();
    const sfx = new Sfx(eng); for (let i = 0; i < 8; i++) { sfx.play('crossingBell', { gain: 1, pan: i % 2 ? 0.5 : -0.5 }); ob.process(0.4); }
    const x = ob.capture().l, s = statsOf(x);
    expect(s.peak).toBeGreaterThan(0.001); expect(s.peak).toBeLessThan(0.15); expect(s.maxJump).toBeLessThan(0.05);
    expect(Math.abs(x.reduce((a: number, b: number) => a + b, 0) / x.length)).toBeLessThan(1e-3);
  }, 60000);
});
