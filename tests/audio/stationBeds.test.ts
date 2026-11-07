import { afterEach, describe, expect, it } from 'vitest';
import { AMB, Ambience, ambienceMix, bedExtras, type AmbienceState } from '../../src/audio/Ambience';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { SamplePlayer } from '../../src/audio/SamplePlayer';
import { Sfx } from '../../src/audio/Sfx';
import { gateLevels, slotTargets } from '../../src/audio/sampleMix';
import { WorldProbe, type ProbeDeps } from '../../src/audio/worldProbe';
import { BED_SLOTS, POOLS, SAMPLES, SAMPLE_BY_ID, SAMPLE_DEFS, SHOT_ROLES, sampleBytes } from '../../src/config/audioSamples';
import { Grid } from '../../src/world/Grid';
import { MemStorage } from './fakeBackend';
import { SampleBackend } from './sampleBackend';

/** Batch 2 beds: per-kind lift beds, queue / bar crowd, the cannon near beds (random pick per activation), the decoded-memory worst case. */
const base: AmbienceState = { season: 'winter', weather: 'clear', hour: 12, zoom: 8, altitude: 0.2, wind: 0.1, water: 0, crowd: 0, lifts: 0, buildings: 0, cows: 0, snowcat: 0, heli: 0 };
const cfg = SAMPLES as unknown as { enabled: boolean; memoryCapMB: number };
const saved = { ...SAMPLES };
afterEach(() => { Object.assign(cfg, saved); });
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
async function rig(o: { beds?: boolean; rng?: () => number } = {}) {
  const fb = new SampleBackend(), settings = new AudioSettings(new MemStorage()), engine = new AudioEngine({ factory: () => fb, settings });
  const fetched: string[] = [];
  const sp = new SamplePlayer(engine, { fetchBytes: async (u) => { fetched.push(u); return new ArrayBuffer(1000); }, beds: () => o.beds ?? true, ...(o.rng ? { rng: o.rng } : {}) });
  const sfx = new Sfx(engine); sfx.samples = sp;
  await engine.onGesture();
  return { fb, engine, sp, sfx, amb: new Ambience(engine, sfx, () => 0.5), fetched };
}
const drive = async (r: Awaited<ReturnType<typeof rig>>, s: AmbienceState, n = 3): Promise<void> => { for (let i = 0; i < n; i++) { const mix = ambienceMix(s); r.sp.updateBeds(mix, s, AMB.layerMax, AMB.fadeTc, bedExtras(s, mix)); await flush(); r.fb.t += 0.5; } };

describe('per-kind lift beds', () => {
  it('each kind has its own slots on its own gate, no synth twin, ceiling = the lift layer ceiling', () => {
    for (const [gate, ids] of [['gondola', ['gondola-a', 'gondola-b', 'gondola-c']], ['cableCar', ['cablecar']], ['funicular', ['funicular']]] as const) {
      const sl = BED_SLOTS.filter((s) => s.gate === gate); expect(sl.map((s) => s.id)).toEqual(ids);
      for (const s of sl) { expect(s.layer).toBeUndefined(); expect(s.ceil).toBe(AMB.layerMax.lift); }
    }
  });
  it('a gondola bed sounds only near a running gondola; kinds do not leak into each other; chairlift beds step back by half there', () => {
    const near = { ...base, gondola: 1, lifts: 0.8 }, m = ambienceMix(near), ex = bedExtras(near, m), g = gateLevels(m, near, 0, ex);
    expect(g.gondola).toBeGreaterThan(0.5); expect(g.cableCar).toBe(0); expect(g.funicular).toBe(0);
    const plain = { ...base, lifts: 0.8 }, gp = gateLevels(ambienceMix(plain), plain, 0, bedExtras(plain, ambienceMix(plain)));
    expect(gp.gondola).toBe(0); expect(g.lift).toBeCloseTo(m.lift * 0.5, 6); expect(gp.lift).toBeCloseTo(ambienceMix(plain).lift, 6);
    const far = { ...near, zoom: 80 }, gf = bedExtras(far, ambienceMix(far)); expect(gf.gondola!).toBeLessThan(ex.gondola! * 0.4); // zoomed out: the lift layer's shaping
    const night = { ...near, hour: 2 }; expect(bedExtras(night, ambienceMix(night)).gondola!).toBeLessThan(ex.gondola!);
  });
  it('the quiet gondola loops are raised to the same rms as the other lift beds (trim x ceiling)', () => {
    for (const id of ['bed-gondola-01', 'bed-gondola-02', 'bed-gondola-03', 'bed-cable-car-01', 'bed-funicular-01']) {
      const d = SAMPLE_BY_ID.get(id)!; expect(d.trim * 10 ** (d.rmsDb / 20)).toBeCloseTo(SAMPLES_RMS, 2);
      expect(d.trim * 10 ** (d.peakDb / 20) * AMB.layerMax.lift, id).toBeLessThan(1); // never clips at the ceiling
    }
  });
  it('slots start once decoded, and never on the Low tier', async () => {
    const r = await rig(); await drive(r, { ...base, cablecar: 1, lifts: 0.8 }, 4);
    expect(r.sp.activeBeds).toContain('cablecar'); expect(r.sp.activeBeds).not.toContain('gondola-a');
    const low = await rig({ beds: false }); await drive(low, { ...base, funicular: 1, lifts: 0.8 }, 3);
    expect(low.sp.activeBeds).toEqual([]); expect(low.fetched.length).toBe(0);
  });
});
const SAMPLES_RMS = 0.08;

describe('queue crowd', () => {
  it('only near a busy lift base or the village: the same crowd far from both is the old crowd bed alone', () => {
    const busy = { ...base, crowd: 80, lifts: 0.9 }, quiet = { ...base, crowd: 80 };
    expect(bedExtras(busy, ambienceMix(busy)).crowdQueue!).toBeGreaterThan(0.3);
    expect(bedExtras(quiet, ambienceMix(quiet)).crowdQueue).toBe(0);
    const v = { ...base, crowd: 80, buildings: 0.9 }; expect(bedExtras(v, ambienceMix(v)).crowdQueue!).toBeGreaterThan(0.3);
    const none = { ...base, lifts: 0.9 }; expect(bedExtras(none, ambienceMix(none)).crowdQueue).toBe(0); // a lift but nobody there
  });
  it('both queue loops + the old crowd bed share the crowd layer (the synth murmur keeps its share)', () => {
    expect(BED_SLOTS.filter((s) => s.layer === 'crowd').map((s) => s.id)).toEqual(['crowd', 'crowd-queue-a', 'crowd-queue-b']);
  });
});

describe('bar crowd', () => {
  it('replaces the synth murmur (apres layer, keep 0) near an OPEN bar only; the ceiling is the low murmur ceiling', () => {
    expect(BED_SLOTS.filter((s) => s.gate === 'barCrowd').map((s) => s.sample).sort()).toEqual(['bed-bar-crowd-01', 'bed-bar-crowd-02', 'bed-bar-crowd-03']);
    for (const s of BED_SLOTS.filter((x) => x.gate === 'barCrowd')) expect(s.layer).toBe('apres');
    expect(AMB.layerMax.apres).toBeLessThanOrEqual(0.05);
    const open = { ...base, apres: 0.8, zoom: 10 }, closed = { ...base, apres: 0, zoom: 10 };
    expect(bedExtras(open, ambienceMix(open)).barCrowd!).toBeGreaterThan(0.3); expect(bedExtras(closed, ambienceMix(closed)).barCrowd).toBe(0);
    const far = { ...open, zoom: 70 }; expect(bedExtras(far, ambienceMix(far)).barCrowd).toBe(0); // the zoom window of the bar music
  });
});

describe('snow cannon near beds', () => {
  it('close: the near recordings take over from the old bed; far: the old bed stays', () => {
    const closeS = { ...base, cannon: 1, zoom: 8 }, farS = { ...base, cannon: 0.45, zoom: 70 };
    const gc = gateLevels(ambienceMix(closeS), closeS), gf = gateLevels(ambienceMix(farS), farS);
    expect(gc.cannonNear).toBeGreaterThan(gc.cannon * 3); expect(gf.cannon).toBeGreaterThan(gf.cannonNear);
    expect(gc.cannon + gc.cannonNear).toBeCloseTo(ambienceMix(closeS).cannon, 6);
  });
  it('one of the three near beds plays per activation (random pick, re-rolled after a pause); the others stay silent', async () => {
    let k = 0; const seq = [0.0, 0.5, 0.99]; const r = await rig({ rng: () => seq[k++ % 3]! });
    const on = { ...base, cannon: 1, zoom: 8 }, off = { ...base, cannon: 0, zoom: 8 };
    const picks: string[] = [];
    for (let a = 0; a < 3; a++) {
      await drive(r, on, 3);
      const live = r.sp.activeBeds.filter((id) => id.startsWith('cannon-near')); picks.push(...live.filter((id) => !picks.includes(id) || true));
      for (let i = 0; i < 60; i++) { r.fb.t += 0.2; const m = ambienceMix(off); r.sp.updateBeds(m, off, AMB.layerMax, AMB.fadeTc, bedExtras(off, m)); }
    }
    expect(new Set(picks).size).toBeGreaterThan(1);
    await drive(r, on, 3); expect(r.sp.activeBeds.filter((id) => id.startsWith('cannon-near')).length).toBe(1);
  });
  it('slotTargets skips unpicked group members from the coverage too', () => {
    const g = gateLevels(ambienceMix({ ...base, cannon: 1, zoom: 8 }), base);
    const a = slotTargets(g, AMB.layerMax, () => 1, (id) => id === 'mach-snow-cannon-02' || id === 'mach-cannon-01', BED_SLOTS, (id) => id !== 'cannon-near-a' && id.startsWith('cannon-near'));
    expect(a.coverage.cannon).toBeGreaterThan(0.99); expect(a.gains['cannon-near-b']).toBe(0);
  });
});

describe('world probe: per-kind station proximity', () => {
  it('reports the nearest station of each running kind (only those kinds)', () => {
    const grid = new Grid(64);
    const deps: ProbeDeps = { grid, guests: { count: () => 0 }, lifts: () => [], buildings: () => [], cows: () => [], cats: () => [], helis: () => [], heightAt: () => 0, maxHeight: 1,
      stationSources: () => [{ x: 10, y: 10, family: 'gondola' }, { x: 40, y: 10, family: 'gondola' }, { x: 50, y: 50, family: 'funicular' }],
      env: () => ({ season: 'winter', weather: 'clear', hour: 12, wind: 0 }) };
    const o = new WorldProbe(deps).sample({ x: 12, z: 10, yaw: 0 }, 20);
    expect(o.gondola!).toBeGreaterThan(0.9); expect(o.cablecar).toBe(0); expect(o.funicular).toBe(0);
  });
});

describe('memory with the new beds', () => {
  it('worst realistic scene (a gondola station next to a queue, a bar and a cannon, rain) stays under the 40 MB decoded cap; the whole table is well over it (LRU)', () => {
    const mb = (ids: string[]): number => ids.reduce((a, id) => a + sampleBytes(SAMPLE_BY_ID.get(id)!), 0) / 1048576;
    const scene = ['bed-gondola-01', 'bed-gondola-02', 'bed-gondola-03', 'bed-crowd-queue-01', 'bed-crowd-queue-02', 'bed-crowd-01', 'bed-bar-crowd-01', 'bed-bar-crowd-02', 'bed-bar-crowd-03', 'mach-snow-cannon-02', 'mach-cannon-01', 'mach-chairlift-seg1', 'mach-chairlift-seg2', 'mach-skilift-01', 'bed-wind-01', 'bed-wind-02', 'bed-rain-01', 'bed-rain-03'];
    expect(mb(scene)).toBeLessThan(SAMPLES.memoryCapMB);
    expect(mb(SAMPLE_DEFS.map((s) => s.id))).toBeGreaterThan(SAMPLES.memoryCapMB); // never all at once
  });
  it('every shot role has a pool', () => { for (const r of SHOT_ROLES) expect(POOLS[r].length, r).toBeGreaterThan(0); expect(POOLS.towerClank.filter((s) => s.tag === 'pass').length).toBe(1); expect(POOLS.towerClank.filter((s) => s.tag === 'short').length).toBe(4); expect(POOLS.distantCall.length).toBe(3); });
});
