import { describe, expect, it } from 'vitest';
import { AMB, Ambience, LAYER_IDS, ambienceMix, type AmbienceState } from '../../src/audio/Ambience';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { Sfx } from '../../src/audio/Sfx';
import { APRES_PROGRESSIONS, apresBeat, apresCutoff } from '../../src/audio/Apres';
import { apresBarLevel, apresBarOpen, apresDuck, apresLevel, apresProximity, natureGain, pondLevel, streamLevels, zoomWindow } from '../../src/audio/proximity';
import { WorldProbe, type ProbeDeps } from '../../src/audio/worldProbe';
import { PROX } from '../../src/config/audioProximity';
import { Grid, TileType } from '../../src/world/Grid';
import { FakeBackend } from './fakeBackend';
import { clickScore, statsOf } from './offlineBackend';
import { AMB_BASE, renderAudio } from './renderHarness';

const base: AmbienceState = { season: 'summer', weather: 'clear', hour: 9, zoom: 8, altitude: 0.2, wind: 0.1, water: 0, crowd: 0, lifts: 0, buildings: 0, cows: 0, snowcat: 0, heli: 0 };
const mix = (o: Partial<AmbienceState>) => ambienceMix({ ...base, ...o });

describe('zoom window + nature gain', () => {
  it('smooth, monotonic, 1 near / 0 far', () => {
    expect(zoomWindow(5, 38, 14)).toBe(1); expect(zoomWindow(60, 38, 14)).toBe(0);
    let last = 1;
    for (let z = 5; z <= 60; z += 1) { const v = zoomWindow(z, 38, 14); expect(v).toBeLessThanOrEqual(last + 1e-12); expect(last - v).toBeLessThan(0.12); last = v; } // no zipper steps
  });
  it('nature: quiet in general, full only zoomed in; birds reduced at the default view versus before', () => {
    expect(natureGain(1)).toBe(1);
    expect(natureGain(0)).toBeCloseTo(PROX.nature.far, 6);
    const close = (z: number): number => Math.min(1, Math.max(0, (AMB.farZoom - z) / (AMB.farZoom - AMB.closeZoom)));
    const before = (z: number): number => 0.4 + 0.6 * close(z); // the old bird curve
    expect(natureGain(close(36))).toBeLessThan(before(36) * 0.6); // default view: noticeably quieter
    expect(natureGain(close(6))).toBeGreaterThanOrEqual(before(6)); // zoomed in: not quieter
    let last = -1; for (let c = 0; c <= 1; c += 0.05) { const v = natureGain(c); expect(v).toBeGreaterThan(last); last = v; }
  });
  it('birds / crickets / insects / cowbells / leaves scale with zoom in the mix', () => {
    const lo = mix({ zoom: 60, cows: 6, hour: 7 }), mid = mix({ zoom: 36, cows: 6, hour: 7 }), hi = mix({ zoom: 8, cows: 6, hour: 7 });
    expect(hi.birds).toBeGreaterThan(mid.birds * 2); expect(mid.birds).toBeGreaterThan(lo.birds);
    expect(hi.cowbells).toBeGreaterThan(mid.cowbells);
    expect(mix({ zoom: 8, hour: 21 }).crickets).toBeGreaterThan(mix({ zoom: 36, hour: 21 }).crickets * 2);
    expect(mix({ season: 'autumn', zoom: 8, wind: 0.5 }).leaves).toBeGreaterThan(mix({ season: 'autumn', zoom: 36, wind: 0.5 }).leaves * 2);
  });
});

describe('stream / river water', () => {
  const S = (o: Partial<Parameters<typeof streamLevels>[0]>) => streamLevels({ dist: 1, cls: 1, zoom: 8, ...o });
  it('silent zoomed out, far from water, or frozen; audible zoomed in next to a stream', () => {
    expect(S({ zoom: 60 })).toEqual({ brook: 0, rush: 0 });
    expect(S({ zoom: PROX.stream.zoomFar })).toEqual({ brook: 0, rush: 0 });
    expect(S({ dist: Infinity })).toEqual({ brook: 0, rush: 0 });
    expect(S({ dist: undefined })).toEqual({ brook: 0, rush: 0 });
    expect(S({ dist: PROX.stream.reach })).toEqual({ brook: 0, rush: 0 });
    expect(S({ frozen: true })).toEqual({ brook: 0, rush: 0 });
    expect(S({}).brook).toBeGreaterThan(0.5);
  });
  it('level falls with distance and rises with zoom, smoothly', () => {
    let last = 2; for (let d = 0; d < PROX.stream.reach; d += 0.5) { const v = S({ dist: d }).brook; expect(v).toBeLessThanOrEqual(last); last = v; }
    expect(S({ zoom: 10 }).brook).toBeGreaterThan(S({ zoom: 30 }).brook);
  });
  it('flow class sets loudness / brightness: rapids rush most, calm is the softest and has no rush', () => {
    const calm = S({ cls: 0 }), brisk = S({ cls: 1 }), rap = S({ cls: 2 });
    expect(calm.rush).toBe(0); expect(rap.rush).toBeGreaterThan(brisk.rush); expect(brisk.rush).toBeGreaterThan(0);
    expect(calm.brook).toBeLessThan(brisk.brook);
    expect(S({ cls: 9 }).rush).toBe(rap.rush); // clamped
  });
  it('ponds: very soft lapping only zoomed in; silent under ice', () => {
    expect(pondLevel(1, 8, false)).toBeGreaterThan(0); expect(pondLevel(1, 8, false)).toBeLessThan(0.5);
    expect(pondLevel(1, 60, false)).toBe(0); expect(pondLevel(1, 8, true)).toBe(0); expect(pondLevel(0, 8, false)).toBe(0);
  });
  it('in the mix: stream / rapids layers exist, are capped and follow the winter ice flag', () => {
    expect(LAYER_IDS).toEqual(expect.arrayContaining(['stream', 'rapids', 'apres']));
    const m = mix({ streamDist: 1, streamCls: 2 });
    expect(m.stream).toBeGreaterThan(0.3); expect(m.rapids).toBeGreaterThan(0.6);
    expect(mix({ streamDist: 1, streamCls: 2, iceFrozen: true }).stream).toBe(0);
    expect(mix({ streamDist: 1, zoom: 80 }).stream).toBe(0);
    expect(mix({ season: 'winter', water: 1, iceFrozen: true }).water).toBe(0);
    expect(mix({ season: 'winter', water: 1, iceFrozen: false }).water).toBeGreaterThan(0); // a mild winter spell without ice
    expect(AMB.layerMax.stream).toBeLessThanOrEqual(AMB.layerMax.crowd);
  });
});

describe('apres bar', () => {
  it('gating: only an active, open, serving bar counts', () => {
    expect(apresBarOpen({ active: true, open: true, serving: true })).toBe(true);
    for (const k of ['active', 'open', 'serving'] as const) expect(apresBarOpen({ active: true, open: true, serving: true, [k]: false })).toBe(false);
  });
  it('proximity: 1 at the bar, 0 at reach, monotonic; several bars add but are capped', () => {
    expect(apresBarLevel(0)).toBe(1); expect(apresBarLevel(PROX.apres.reach)).toBe(0);
    let last = 2; for (let d = 0; d <= PROX.apres.reach; d += 1) { const v = apresBarLevel(d); expect(v).toBeLessThanOrEqual(last); last = v; }
    expect(apresProximity([])).toBe(0);
    expect(apresProximity([10, 10])).toBeGreaterThan(apresProximity([10]));
    expect(apresProximity([0, 0, 0, 0, 0])).toBe(PROX.apres.cap);
  });
  it('zoom: silent at the default view and zoomed out, clear when zoomed in close', () => {
    expect(apresLevel(1, 8)).toBe(1); expect(apresLevel(1, 36)).toBe(0); expect(apresLevel(1, 90)).toBe(0);
    expect(apresLevel(1, 20)).toBeGreaterThan(0.2); expect(apresLevel(0.5, 8)).toBe(0.5);
  });
  it('mix: near + zoomed in audible, far / zoomed out / no bar silent, rain damps it', () => {
    expect(mix({ apres: 1 }).apres).toBeGreaterThan(0.9);
    expect(mix({ apres: 1, zoom: 60 }).apres).toBe(0);
    expect(mix({ apres: 0 }).apres).toBe(0);
    expect(mix({ apres: undefined }).apres).toBe(0);
    expect(mix({ apres: 1, weather: 'rain' }).apres).toBeLessThan(mix({ apres: 1 }).apres);
    for (const v of Object.values(mix({ apres: 5 }))) expect(v).toBeLessThanOrEqual(1);
  });
  it('duck: game music steps back by at most PROX.apres.duck', () => {
    expect(apresDuck(0)).toBe(1); expect(apresDuck(1)).toBeCloseTo(1 - PROX.apres.duck, 6); expect(apresDuck(0.5)).toBeGreaterThan(apresDuck(1));
    expect(PROX.apres.duck).toBeLessThanOrEqual(0.4); // "slightly"
  });
  it('filtering scales with proximity: far = muffled, near = bright', () => {
    expect(apresCutoff(0)).toBe(PROX.apres.cutoffFar); expect(apresCutoff(1)).toBe(PROX.apres.cutoffNear); expect(apresCutoff(0.5)).toBeGreaterThan(apresCutoff(0.1));
  });
  it('the song is seeded: identical on repeat, a polka (oompah bass on beats 0 / 2, chords + clap on 1 / 3), all variants reachable, melody in range', () => {
    const song = (seed?: number) => Array.from({ length: 256 }, (_, i) => apresBeat(i, seed));
    expect(song()).toEqual(song());
    expect(song(1)).not.toEqual(song(2));
    const v = new Set<number>();
    for (const [i, b] of song().entries()) {
      v.add(b.variant);
      if (i % 2 === 0) { expect(b.bass).toBeDefined(); expect(b.stomp).toBe(true); expect(b.chord).toBeUndefined(); }
      else { expect(b.chord!.length).toBeGreaterThanOrEqual(3); expect(b.clap).toBe(true); expect(b.bass).toBeUndefined(); }
      if (b.melody !== undefined) { expect(b.melody).toBeGreaterThan(60); expect(b.melody).toBeLessThan(100); }
    }
    expect(v.size).toBeGreaterThanOrEqual(3); expect(APRES_PROGRESSIONS.length).toBe(4);
  });
  it('the probe: open bars only, 1 at the bar, 0 beyond reach or with no provider', () => {
    const grid = new Grid(64);
    const d = (apresBars?: ProbeDeps['apresBars']): ProbeDeps => ({ grid, guests: { count: () => 0 }, lifts: () => [], buildings: () => [], cows: () => [], cats: () => [], helis: () => [], heightAt: () => 0, maxHeight: 1, env: () => ({ season: 'winter', weather: 'clear', hour: 17, wind: 0 }), apresBars });
    const at = (x: number, z: number, f?: ProbeDeps['apresBars']): number | undefined => new WorldProbe(d(f)).sample({ x, z } as never, 8).apres;
    const bar = (): Array<{ x: number; y: number }> => [{ x: 30, y: 30 }];
    expect(at(30, 30, bar)).toBeCloseTo(1, 1);
    expect(at(30, 40, bar)!).toBeLessThan(at(30, 34, bar)!);
    expect(at(30, 60, bar)).toBe(0); expect(at(30, 30, () => [])).toBe(0); expect(at(30, 30)).toBe(0);
  });
  it('probe: nearest stream tile distance + class, nothing when zoomed out or iced', () => {
    const grid = new Grid(64);
    grid.tileType[grid.tileIndex(30, 34)] = TileType.Stream;
    const mk = (iceFrozen = false): WorldProbe => new WorldProbe({ grid, guests: { count: () => 0 }, lifts: () => [], buildings: () => [], cows: () => [], cats: () => [], helis: () => [], heightAt: () => 0, maxHeight: 1, streamClassAt: () => 2, env: () => ({ season: 'summer', weather: 'clear', hour: 9, wind: 0, iceFrozen }) });
    const near = mk().sample({ x: 30.5, z: 30.5 } as never, 8);
    expect(near.streamDist).toBeCloseTo(4, 1); expect(near.streamCls).toBe(2);
    expect(mk().sample({ x: 30.5, z: 30.5 } as never, 60).streamDist).toBe(Infinity);
    expect(mk(true).sample({ x: 30.5, z: 30.5 } as never, 8).streamDist).toBe(Infinity);
    expect(mk().sample({ x: 10, z: 10 } as never, 8).streamDist).toBe(Infinity);
  });
});

describe('proximity layers on the fake backend', () => {
  async function rig() {
    const fb = new FakeBackend(); const settings = new AudioSettings(null); const engine = new AudioEngine({ factory: () => fb, settings });
    const sfx = new Sfx(engine); const amb = new Ambience(engine, sfx, () => 0.5);
    await engine.onGesture();
    return { fb, engine, amb, settings };
  }
  it('layers build without errors; apres music schedules beats only near an open bar, stays within a node budget, and ducks the music bus', async () => {
    const { fb, engine, amb } = await rig();
    amb.update({ ...base, apres: 1, streamDist: 1, streamCls: 2 }, 0.1);
    expect(amb.layerCount).toBe(LAYER_IDS.length);
    expect(amb.apres.isActive).toBe(true);
    for (let i = 0; i < 100; i++) { fb.t += 0.1; amb.update({ ...base, apres: 1 }, 0.1); engine.reap(fb.t); expect(engine.voiceCount).toBeLessThan(10); }
    const beats = amb.apres.scheduled; expect(beats).toBeGreaterThan(15); // ~ 118 bpm for 10 s = ~19 beats
    expect(beats).toBeLessThan(30);
    // walked away: no new beats, music no longer ducked
    for (let i = 0; i < 20; i++) { fb.t += 0.1; amb.update({ ...base, apres: 0 }, 0.1); engine.reap(fb.t); }
    expect(amb.apres.scheduled).toBe(beats); expect(amb.apres.isActive).toBe(false);
  });
  it('closed bar / zoomed out / muted: nothing is scheduled', async () => {
    const { fb, amb, settings } = await rig();
    for (const st of [{ apres: 0 }, { apres: 1, zoom: 70 }]) { for (let i = 0; i < 20; i++) { fb.t += 0.1; amb.update({ ...base, ...st }, 0.1); } }
    expect(amb.apres.scheduled).toBe(0);
    settings.set({ muted: true } as never);
    for (let i = 0; i < 20; i++) { fb.t += 0.1; amb.update({ ...base, apres: 1 }, 0.1); }
    expect(amb.apres.scheduled).toBe(0);
  });
  it('music duck is eased (setTargetAtTime) and never jumps', async () => {
    const { fb, engine, amb } = await rig();
    const bus = engine.busNode('music')! as unknown as { gain: { calls: string[] } };
    amb.update({ ...base, apres: 1 }, 0.1);
    expect(bus.gain.calls.filter((c) => c === 'target').length).toBeGreaterThan(1);
    expect(bus.gain.calls.includes('set')).toBe(false);
    void fb;
  });
});

describe('rendered (offline)', () => {
  it('apres bar + stream beds at full ambience gain: headroom, no DC; clearly quieter far away; muted = silence', async () => {
    const SR = 16000;
    const near = await renderAudio({ seconds: 12, sampleRate: SR, seed: 7, settings: { ambience: 1, master: 1 }, ambience: { ...AMB_BASE, season: 'winter', hour: 17, wind: 0, zoom: 8, apres: 1, streamDist: 1, streamCls: 2 }, musicOn: false });
    const x = near.l.subarray(SR * 4), s = statsOf(x);
    expect(s.peak).toBeLessThan(0.9); expect(Math.abs(s.dc)).toBeLessThan(2e-3); expect(clickScore(x)).toBeLessThan(40);
    const mid = await renderAudio({ seconds: 12, sampleRate: SR, seed: 7, settings: { ambience: 1, master: 1 }, ambience: { ...AMB_BASE, season: 'winter', hour: 17, wind: 0, zoom: 8, apres: 0.15 }, musicOn: false });
    expect(statsOf(mid.l.subarray(SR * 4)).rmsDb).toBeLessThan(s.rmsDb - 3);
    const far = await renderAudio({ seconds: 8, sampleRate: SR, seed: 7, settings: { ambience: 1, master: 1 }, ambience: { ...AMB_BASE, season: 'winter', hour: 17, wind: 0, zoom: 70, apres: 1, streamDist: 1 }, musicOn: false });
    expect(statsOf(far.l.subarray(SR * 4)).rmsDb).toBeLessThan(s.rmsDb - 8); // (AMB_BASE carries its own ~-30 dB bed, so the gap is the apres music + brook)
    const m = await renderAudio({ seconds: 8, sampleRate: SR, seed: 7, settings: { ambience: 0 }, ambience: { ...AMB_BASE, apres: 1, streamDist: 1 }, musicOn: false });
    expect(statsOf(m.l.subarray(SR * 4)).peak).toBeLessThan(1e-4);
  }, 120000);
});
