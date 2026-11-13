import { describe, expect, it } from 'vitest';
import { AMB, Ambience, LAYER_IDS, ambienceMix, type AmbienceState } from '../../src/audio/Ambience';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { Sfx } from '../../src/audio/Sfx';
import { apresCutoff, barLevelGain } from '../../src/audio/BarMusic';
import { apresBarLevel, apresBarOpen, apresLevel, apresProximity, natureGain, pondLevel, streamLevels, zoomWindow } from '../../src/audio/proximity';
import { WorldProbe, type ProbeDeps } from '../../src/audio/worldProbe';
import { PROX } from '../../src/config/audioProximity';
import { BAR_AUDIO, BAR_PLAYLIST } from '../../src/config/audioMusic';
import { Grid, TileType } from '../../src/world/Grid';
import { FakeBackend, fakeMediaHooks } from './fakeBackend';
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
  it('filtering scales with proximity: far = muffled, near = bright', () => {
    expect(apresCutoff(0)).toBe(PROX.apres.cutoffFar); expect(apresCutoff(1)).toBe(PROX.apres.cutoffNear); expect(apresCutoff(0.5)).toBeGreaterThan(apresCutoff(0.1));
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

const flush = async (): Promise<void> => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
describe('proximity layers on the fake backend', () => {
  async function rig() {
    const fb = new FakeBackend(); const settings = new AudioSettings(null); const engine = new AudioEngine({ factory: () => fb, settings });
    const mb = fakeMediaHooks({ dur: 120 });
    const sfx = new Sfx(engine); const amb = new Ambience(engine, sfx, () => 0.5, undefined, { rand: () => 0.3, player: mb.hooks });
    await engine.onGesture();
    const upd = async (st: Partial<AmbienceState>, n: number): Promise<void> => { for (let i = 0; i < n; i++) { fb.t += 0.1; mb.advance(0.1); amb.update({ ...base, ...st }, 0.1); engine.reap(fb.t); await flush(); } };
    return { fb, engine, amb, settings, mb, upd };
  }
  it('layers build without errors; the bar music starts after the hand-off (not instantly), plays a bar song only near an open bar, and stops when you leave', async () => {
    const { engine, amb, mb, upd } = await rig();
    await upd({ apres: 1, streamDist: 1, streamCls: 2 }, 1);
    expect(amb.layerCount).toBe(LAYER_IDS.length);
    expect(amb.apres.isActive).toBe(false); expect(mb.playing.length).toBe(0); // the game music must fade out first (enter dwell + main fade-out)
    await upd({ apres: 1 }, 100);
    expect(amb.apres.isActive).toBe(true); expect(mb.playing.length).toBe(1); expect(BAR_PLAYLIST).toContain(amb.apres.currentTrack!);
    expect(engine.voiceCount).toBe(0); // the bar music owns its own player (not the shared SFX pool)
    // walked away: the song fades out and the element is paused once the level stays under the exit threshold
    await upd({ apres: 0 }, 10);
    expect(amb.apres.isActive).toBe(true); // a bar song has its minimum airtime (HANDOFF.minApresSec = 10 s): a quick walk-away does not cut it
    await upd({ apres: 0 }, 300);
    expect(amb.apres.isActive).toBe(false); expect(amb.apres.handoff.phase).toBe('main'); expect(mb.playing.length).toBe(0);
  });
  it('closed bar / zoomed out / muted / ambience slider at 0: nothing is fetched or played and the game music is never stopped', async () => {
    const { amb, settings, mb, upd } = await rig();
    for (const st of [{ apres: 0 }, { apres: 1, zoom: 70 }]) await upd(st, 30);
    expect(mb.fetched).toEqual([]); expect(amb.apres.handoff.phase).toBe('main');
    settings.set({ muted: true } as never); await upd({ apres: 1 }, 30);
    expect(mb.fetched).toEqual([]); expect(amb.apres.handoff.phase).toBe('main');
    settings.set({ muted: false, ambience: 0 } as never); await upd({ apres: 1 }, 30);
    expect(mb.fetched).toEqual([]); expect(amb.apres.handoff.phase).toBe('main'); // silent bar: do not pause the game music for it
  });
  it('bar level gain: never silent once the hand-off happened, 1 at the bar; the ambience-bus boost is the documented +5 dB', () => {
    expect(barLevelGain(0)).toBeCloseTo(BAR_AUDIO.minGain, 10); expect(barLevelGain(1)).toBe(1); expect(barLevelGain(0.5)).toBeGreaterThan(barLevelGain(0.1)); expect(barLevelGain(2)).toBe(1);
    expect(20 * Math.log10(BAR_AUDIO.busBoost)).toBeCloseTo(5, 0);
  });
  it('the old music-bus duck is gone: the game music is stopped by the hand-off instead', async () => {
    const { engine, amb } = await rig();
    const bus = engine.busNode('music')! as unknown as { gain: { calls: string[] } };
    const before = bus.gain.calls.length;
    amb.update({ ...base, apres: 1 }, 0.1);
    expect(bus.gain.calls.length).toBe(before);
  });
});

describe('rendered (offline)', () => {
  it('apres murmur + stream beds at full ambience gain (the bar songs are mp3 files: the offline renderer has none): headroom, no DC; quieter far away; muted = silence', async () => {
    const SR = 16000;
    const near = await renderAudio({ seconds: 12, sampleRate: SR, seed: 7, settings: { ambience: 1, master: 1 }, ambience: { ...AMB_BASE, season: 'winter', hour: 17, wind: 0, zoom: 8, apres: 1, streamDist: 1, streamCls: 2 } });
    const x = near.l.subarray(SR * 4), s = statsOf(x);
    expect(s.peak).toBeLessThan(0.9); expect(Math.abs(s.dc)).toBeLessThan(2e-3); expect(clickScore(x)).toBeLessThan(40);
    const far = await renderAudio({ seconds: 8, sampleRate: SR, seed: 7, settings: { ambience: 1, master: 1 }, ambience: { ...AMB_BASE, season: 'winter', hour: 17, wind: 0, zoom: 70, apres: 1, streamDist: 1 } });
    expect(statsOf(far.l.subarray(SR * 4)).rmsDb).toBeLessThan(s.rmsDb - 0.2); // (AMB_BASE carries its own ~-30 dB bed, so the gap is the murmur + brook)
    const m = await renderAudio({ seconds: 8, sampleRate: SR, seed: 7, settings: { ambience: 0 }, ambience: { ...AMB_BASE, apres: 1, streamDist: 1 } });
    expect(statsOf(m.l.subarray(SR * 4)).peak).toBeLessThan(1e-4);
  }, 120000);
});

describe('farm tractor bed (summer farm vehicles, docs/farm-work.md)', () => {
  const base: AmbienceState = { season: 'summer', weather: 'clear', hour: 11, zoom: 10, altitude: 0.3, wind: 0.1, water: 0, crowd: 0, lifts: 0, buildings: 0, cows: 0, snowcat: 0, heli: 0, tractor: 1 };
  it('is audible only close, by day, dry, and very quiet', () => {
    expect(AMB.layerMax.tractor).toBeLessThanOrEqual(0.04);
    const near = ambienceMix(base).tractor, far = ambienceMix({ ...base, zoom: 60 }).tractor, night = ambienceMix({ ...base, hour: 2 }).tractor, rain = ambienceMix({ ...base, weather: 'rain' }).tractor, none = ambienceMix({ ...base, tractor: 0 }).tractor;
    expect(near).toBeGreaterThan(0.5); expect(far).toBe(0); expect(night).toBe(0); expect(rain).toBeLessThan(near * 0.4); expect(ambienceMix({ ...base, weather: "storm" }).tractor).toBe(0); expect(none).toBe(0);
    expect(ambienceMix({ ...base, zoom: 30 }).tractor).toBeLessThan(near);
  });
});
