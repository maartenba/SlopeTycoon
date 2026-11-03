import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { Ambience, type AmbienceState } from '../../src/audio/Ambience';
import { Music } from '../../src/audio/Music';
import { MusicHandoff } from '../../src/audio/musicHold';
import { Sfx } from '../../src/audio/Sfx';
import { HANDOFF } from '../../src/config/audioMusic';
import { FakeBackend, MemStorage } from './fakeBackend';
import { statsOf, windowedDb } from './offlineBackend';
import { renderAudio } from './renderHarness';

const run = (h: MusicHandoff, level: (t: number) => number, seconds: number, dt = 0.1): Array<{ t: number; phase: string }> => {
  const log: Array<{ t: number; phase: string }> = [];
  for (let t = 0; t <= seconds + 1e-9; t += dt) { h.update(level(t), t); log.push({ t, phase: h.phase }); }
  return log;
};

describe('music hand-off state machine (pure)', () => {
  it('walks main -> toApres -> apres -> toMain -> main with the configured fades', () => {
    const h = new MusicHandoff(); const log = run(h, (t) => (t < 10 ? 0.5 : 0), 30);
    const first = (p: string): number => log.find((x) => x.phase === p)!.t;
    expect(first('toApres')).toBeGreaterThanOrEqual(HANDOFF.enterDwell - 1e-9); expect(first('toApres')).toBeLessThan(1);
    expect(first('apres') - first('toApres')).toBeGreaterThanOrEqual(HANDOFF.mainFadeOut - 1e-9); expect(first('apres') - first('toApres')).toBeLessThan(HANDOFF.mainFadeOut + 0.2);
    expect(first('toMain')).toBeGreaterThanOrEqual(10 + HANDOFF.exitDwell - 0.15);
    expect(log.find((x) => x.t > first('toMain') && x.phase === 'main')!.t - first('toMain')).toBeGreaterThanOrEqual(HANDOFF.apresFadeOut - 1e-9);
    expect(h.phase).toBe('main'); expect(h.transitions).toBe(4);
  });
  it('hysteresis: a level hovering between the exit and enter thresholds never flips, and a quick zoom in / out does not start the bar music', () => {
    const h = new MusicHandoff();
    run(h, (t) => (HANDOFF.exitLevel + HANDOFF.enterLevel) / 2 + 0.02 * Math.sin(t * 5), 30); expect(h.transitions).toBe(0);
    const g = new MusicHandoff(); run(g, (t) => (Math.floor(t / 0.3) % 2 === 0 ? 0.6 : 0), 20); expect(g.transitions).toBe(0); // in for 0.3 s, out for 0.3 s: under the enter dwell
    // once in, a dip shorter than the exit dwell (or a level inside the band) keeps the bar music
    const k = new MusicHandoff(); const lg = run(k, (t) => (t > 8 && t < 8 + HANDOFF.exitDwell - 0.5 ? 0 : t > 15 ? 0.08 : 0.6), 40);
    expect(lg.filter((x) => x.phase === 'toMain').length).toBe(0); expect(k.phase).toBe('apres');
  });
  it('minimum dwell: no flip-flop even with a level that alternates every few seconds (at most one hand-off per min time)', () => {
    const h = new MusicHandoff(); const log = run(h, (t) => (Math.floor(t / 2.2) % 2 === 0 ? 0.6 : 0), 120);
    let last = -1e9, count = 0, prev = 'main'; for (const x of log) { if (x.phase !== prev) { if (x.phase === 'toApres' || x.phase === 'toMain') { expect(x.t - last).toBeGreaterThanOrEqual(Math.min(HANDOFF.minMainSec, HANDOFF.minApresSec) + HANDOFF.mainFadeOut - 0.2); last = x.t; count++; } prev = x.phase; } }
    expect(count).toBeLessThan(120 / 4); // far fewer switches than the 54 level flips
  });
  it('NEVER OVERLAP: the game-music envelope times the bar-music envelope is 0 at every instant, for random level walks', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const h = new MusicHandoff(); let x = seed * 0.37, lv = 0;
      for (let t = 0; t < 300; t += 0.05) {
        x = (x * 9301 + 49297) % 233280; if (Math.floor(t * 20) % 40 === 0) lv = (x / 233280) < 0.5 ? 0 : (x / 233280);
        if (Math.abs(t * 10 - Math.round(t * 10)) < 1e-6) h.update(lv, t);
        expect(h.mainEnvelope(t) * h.apresEnvelope(t), `t=${t} ${h.phase}`).toBe(0);
        expect(h.mainEnvelope(t)).toBeGreaterThanOrEqual(0); expect(h.mainEnvelope(t)).toBeLessThanOrEqual(1);
        if (h.mainScheduling) expect(h.apresScheduling).toBe(false);
      }
    }
  });
});

const base: AmbienceState = { season: 'winter', weather: 'clear', hour: 17, zoom: 8, altitude: 0.2, wind: 0, water: 0, crowd: 0, lifts: 0, buildings: 0, cows: 0, snowcat: 0, heli: 0 };
async function rig() {
  const fb = new FakeBackend(), settings = new AudioSettings(new MemStorage()), engine = new AudioEngine({ factory: () => fb, settings });
  await engine.onGesture();
  const handoff = new MusicHandoff(), music = new Music(engine, { seed: 4, handoff }), amb = new Ambience(engine, new Sfx(engine), () => 0.5, 9, handoff);
  music.setInputs({ season: 'winter', hour: 13, weather: 'clear' });
  const step = (sec: number, apres: number): void => { for (let i = 0; i < Math.round(sec / 0.025); i++) { fb.t += 0.025; music.tick(); if (i % 4 === 0) amb.update({ ...base, apres }, 0.1); } };
  return { fb, music, amb, handoff, step };
}

describe('game music stops near the bar and resumes exactly (fake backend)', () => {
  it('fades out (no new notes once silent), holds its position, resumes the same piece at the start of the chord, never while the bar plays', async () => {
    const { fb, music, amb, handoff, step } = await rig();
    step(20, 0);
    const piece = music.currentPiece!, track = music.currentTrack;
    expect(music.holdValue).toBe(1); const notes0 = music.stats.notes;
    // walk up to the bar: the game music keeps scheduling only during its fade-out
    let overlapSeen = false;
    for (let i = 0; i < 120; i++) { step(0.1, 1); if (handoff.apresScheduling && music.isPlaying) overlapSeen = true; if (handoff.mainScheduling && amb.apres.isActive) overlapSeen = true; }
    expect(overlapSeen).toBe(false);
    expect(handoff.phase).toBe('apres'); expect(music.holdValue).toBe(0); expect(amb.apres.isActive).toBe(true);
    const held = music.stats.notes; expect(held).toBeGreaterThan(notes0); // it did play on during the 0.7 s fade
    step(10, 1); expect(music.stats.notes).toBe(held); // frozen while the bar plays
    expect(amb.apres.scheduled).toBeGreaterThan(100);
    // leave: the bar fades out first, then the game music comes back: same piece, continuing
    step(8, 0);
    expect(handoff.phase).toBe('main'); expect(music.holdValue).toBe(1);
    expect(amb.apres.isActive).toBe(false);
    step(6, 0);
    expect(music.stats.notes).toBeGreaterThan(held); expect(music.currentTrack).toBe(track); expect(music.currentPiece).toBe(piece); expect(music.stats.pieces).toBe(1);
    void fb;
  });
  it('resume rewinds to the start of the current chord group (never forward, never past the start of the piece)', async () => {
    const { music, step, handoff } = await rig();
    step(33, 0);
    const t = (music as unknown as { tracks: Array<{ beat: number; piece: { barsPerChord: number } }> }).tracks[0]!;
    const before = t.beat;
    step(9, 1); expect(handoff.phase).toBe('apres');
    const mid = t.beat; expect(mid).toBeGreaterThanOrEqual(before);
    step(8, 0); expect(handoff.phase).toBe('main');
    const bpc = t.piece.barsPerChord * 4; // beats per chord group
    const resumedAt = t.beat; expect(resumedAt).toBeGreaterThanOrEqual(0);
    expect(Math.floor(mid / 4 / (bpc / 4)) * bpc).toBeLessThanOrEqual(mid);
  });
  it('hold gain is ramped (linear fade-out ~0.7 s, fade-in ~0.9 s), never switched', async () => {
    const { music, step } = await rig();
    step(10, 0);
    const hold = (music as unknown as { hold: { gain: { calls: string[] } } }).hold.gain, c0 = hold.calls.length;
    step(6, 1); const out = hold.calls.slice(c0); expect(out).toContain('lin'); expect(out.filter((c) => c === 'set').length).toBeLessThanOrEqual(3);
    const c1 = hold.calls.length; step(8, 0); expect(hold.calls.slice(c1)).toContain('lin');
  });
});

describe('game music / bar music never overlap in the rendered audio (software Web Audio renderer)', () => {
  it('while the bar plays the game music contributes exactly nothing: the render equals a bar-only render; before and after it is audible again', async () => {
    const SR = 25600, level = (t: number): number => (t >= 14 && t < 36 ? 1 : 0); // 25.6 kHz: one 25 ms scheduler step = exactly five 128-sample blocks, so test time == audio time
    const both = await renderAudio({ seconds: 56, sampleRate: SR, seed: 5, settings: { master: 1, music: 1, ambience: 1 }, music: { season: 'winter', hour: 13 }, ambience: { ...base, wind: 0 }, ambienceAt: (t) => ({ apres: level(t) }) });
    const bar = await renderAudio({ seconds: 56, sampleRate: SR, seed: 5, settings: { master: 1, music: 1, ambience: 1 }, ambience: { ...base, wind: 0 }, ambienceAt: (t) => ({ apres: level(t) }), musicOn: false });
    const win = (r: { l: Float32Array }, a: number, b: number): Float32Array => r.l.subarray(Math.round(a * SR), Math.round(b * SR));
    // steady bar window (after the game music's fade-out, before the bar music's fade-out): identical
    const a = win(both, 17, 33), b = win(bar, 17, 33); let maxDiff = 0; for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i]! - b[i]!));
    expect(maxDiff).toBeLessThan(1e-4); expect(statsOf(a).rmsDb).toBeGreaterThan(-35);
    // before the walk-up the game music is there (difference to the bar-only render), and it is back after the bar music faded out
    const diffDb = (from: number, to: number): number => { const x = win(both, from, to), y = win(bar, from, to), d = new Float32Array(x.length); for (let i = 0; i < d.length; i++) d[i] = x[i]! - y[i]!; return statsOf(d).rmsDb; };
    expect(diffDb(4, 13)).toBeGreaterThan(-45); expect(diffDb(44, 55)).toBeGreaterThan(-45); expect(diffDb(17, 33)).toBeLessThan(-90);
    // no click at the edges, smooth loudness (1 s windows) through both hand-overs
    const db = windowedDb(both.l, SR, 0.5); let worst = 0; for (let i = 1; i < db.length; i++) worst = Math.max(worst, Math.abs(db[i]! - db[i - 1]!)); expect(worst).toBeLessThan(18);
    expect(both.l.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThan(0.95);
  }, 120000);
});
