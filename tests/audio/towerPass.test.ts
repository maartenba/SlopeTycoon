import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { SamplePlayer } from '../../src/audio/SamplePlayer';
import { Sfx } from '../../src/audio/Sfx';
import { TowerClanker, TowerPassDetector, type TowerLift } from '../../src/audio/towerPass';
import { TOWER_CLANK, POOLS } from '../../src/config/audioSamples';
import { CALL, VisitorCalls } from '../../src/audio/visitorCall';
import { MemStorage } from './fakeBackend';
import { SampleBackend } from './sampleBackend';

/** A straight lift along +x at z = 10 with towers every 10 tiles and carriers moving on a strand 0.3 off the line. */
const lift = (id: number, carriers: () => Array<{ x: number; z: number }>, towers = [10, 20, 30].map((x) => ({ x, z: 10 }))): TowerLift => ({ id, towers, carriers });
const cam = { x: 20, z: 10 };

describe('tower pass detection (pure)', () => {
  it('a carrier crossing a tower triggers exactly one pass; no double trigger while it stays in the zone', () => {
    const d = new TowerPassDetector(); let x = 17; const l = lift(1, () => [{ x, z: 10.3 }]);
    d.step([l], cam, 8); // primes (first tick after zooming in)
    const hits: number[] = [];
    for (let t = 0; t < 30; t++) { x += 0.5; hits.push(d.step([l], cam, 8).length); }
    expect(hits.reduce((a, b) => a + b, 0)).toBe(2); // tower at 20 (x = 20) and at 30 (x = 30 is outside reach 18? cam 20, tower 30 = 10 tiles: inside) -> 2 towers crossed on 17..32
  });
  it('a carrier standing still inside the zone fires once, then nothing; leaving and re-entering fires again', () => {
    const d = new TowerPassDetector(); let x = 15; const l = lift(1, () => [{ x, z: 10.3 }], [{ x: 20, z: 10 }]);
    d.step([l], cam, 8); x = 19.5; expect(d.step([l], cam, 8).length).toBe(1);
    for (let i = 0; i < 5; i++) expect(d.step([l], cam, 8).length).toBe(0);
    x = 25; d.step([l], cam, 8); x = 20; expect(d.step([l], cam, 8).length).toBe(1);
  });
  it('near-camera gate: towers beyond the reach, and any zoomed-out view, never trigger (and nothing is tracked)', () => {
    const d = new TowerPassDetector(); let x = 90; const l = lift(1, () => [{ x, z: 10.3 }], [{ x: 100, z: 10 }]);
    d.step([l], cam, 8); x = 99.6; expect(d.step([l], cam, 8)).toEqual([]); // 80 tiles away
    const far = new TowerPassDetector(); let y = 17; const l2 = lift(2, () => [{ x: y, z: 10.3 }], [{ x: 20, z: 10 }]);
    far.step([l2], cam, 80); y = 19.8; expect(far.step([l2], cam, 80)).toEqual([]); expect(far.tracked).toBe(0);
    expect(TOWER_CLANK.reach).toBeLessThan(26);
  });
  it('coming back into zoom does not fire for carriers already at a tower (primed), only for new arrivals', () => {
    const d = new TowerPassDetector(); let x = 20; const l = lift(1, () => [{ x, z: 10.3 }], [{ x: 20, z: 10 }]);
    expect(d.step([l], cam, 8)).toEqual([]); // already there when the view arrives
    expect(d.step([l], cam, 8)).toEqual([]);
    d.step([l], cam, 80); x = 17; d.step([l], cam, 8); x = 20; expect(d.step([l], cam, 8).length).toBe(1);
  });
  it('only the nearest maxLifts lifts are looked at (carriers() of the others is never called)', () => {
    const d = new TowerPassDetector(); const called: number[] = [];
    const lifts = [1, 2, 3, 4, 5].map((i) => lift(i, () => { called.push(i); return []; }, [{ x: 20 + i, z: 10 }]));
    d.step(lifts, cam, 8); expect(called.sort()).toEqual([1, 2, 3]);
  });
  it('level falls with distance and with zoom', () => {
    const mk = (tx: number, zoom: number): number => { const d = new TowerPassDetector(); let x = tx - 3; const l = lift(1, () => [{ x, z: 10.3 }], [{ x: tx, z: 10 }]); d.step([l], cam, zoom); x = tx; return d.step([l], cam, zoom)[0]?.level ?? 0; };
    expect(mk(21, 8)).toBeGreaterThan(mk(30, 8)); expect(mk(21, 8)).toBeGreaterThan(mk(21, 22));
  });
});

describe('clanker: throttle and variety', () => {
  const pass = [{ liftId: 1, tower: 0, x: 22, z: 10, level: 0.8 }];
  const listener = { x: 20, z: 10, yaw: 0 };
  it('at most one clank per globalGap seconds anywhere, and a failed chance roll costs nothing', () => {
    const c = new TowerClanker(() => 0.01); // always passes the chance roll
    expect(c.pick(pass, listener, 100)).not.toBeNull();
    expect(c.pick(pass, listener, 100 + TOWER_CLANK.globalGap - 0.1)).toBeNull();
    expect(c.pick(pass, listener, 100 + TOWER_CLANK.globalGap + 0.1)).not.toBeNull();
    const n = new TowerClanker(() => 0.99); expect(n.pick(pass, listener, 5)).toBeNull(); expect(n.pick([], listener, 6)).toBeNull();
  });
  it('the whole 2.8 s passage is rare (about 1 in 8) and panned to the tower', () => {
    let q = 12345; const c = new TowerClanker(() => { q = (q * 16807) % 2147483647; return q / 2147483647; });
    let short = 0, whole = 0; for (let t = 0; t < 4000; t++) { const p = c.pick(pass, listener, t * 10); if (p) p.tag === 'pass' ? whole++ : short++; }
    expect(whole / (whole + short)).toBeGreaterThan(0.06); expect(whole / (whole + short)).toBeLessThan(0.2);
    expect(c.pick(pass, listener, 1e6)!.pan).toBeGreaterThanOrEqual(0); // tower is to the +x side of a yaw-0 listener
  });
  it('even a busy chairlift (a pass every second) never exceeds 12 clanks a minute; with the chance roll about 5', () => {
    let s = 7; const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const c = new TowerClanker(rnd); let n = 0; for (let t = 0; t < 600; t += 0.1) if (Math.abs((t % 1)) < 0.05 && c.pick(pass, listener, t)) n++;
    expect(n / 10).toBeLessThanOrEqual(12); expect(n / 10).toBeGreaterThan(2);
  });
});

describe('samples: tower clank pool and the visitor call', () => {
  async function rig() {
    const fb = new SampleBackend(), engine = new AudioEngine({ factory: () => fb, settings: new AudioSettings(new MemStorage()) });
    const sp = new SamplePlayer(engine, { fetchBytes: async () => new ArrayBuffer(1000), rng: () => 0.3 }); const sfx = new Sfx(engine); sfx.samples = sp; await engine.onGesture();
    return { fb, sp, sfx, engine };
  }
  const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
  it('towerClank: synth until decoded, then the short clanks or (tag pass) the 2.8 s passage', async () => {
    const r = await rig();
    expect(r.sfx.play('towerClank', { tag: 'short' })).toBe(true); expect(r.sp.stats.shots).toBe(0); expect(r.sp.stats.fallbacks).toBe(1);
    await flush(); r.fb.t += 2;
    expect(r.sfx.play('towerClank', { tag: 'short' })).toBe(true); expect(r.sp.lastFile).toMatch(/^mach-tower-clank-0[1-4]$/);
    r.fb.t += 2; expect(r.sfx.play('towerClank', { tag: 'pass' })).toBe(true); expect(r.sp.lastFile).toBe('mach-tower-pass-01');
    expect(POOLS.towerClank.length).toBe(5);
  });
  it('rare-visitor call: the recordings play (rotating, never twice in a row) once decoded, the synth call before; scheduling unchanged', async () => {
    const r = await rig(); const played: Array<string | null> = [];
    const vc = new VisitorCalls((o) => { const ok = r.sfx.play('distantCall', o); played.push(r.sp.lastFile); return ok; }, () => r.engine.now());
    vc.sighting(0.2); expect(r.sp.stats.shots).toBe(0); await flush(); // first call: synth (the pool was queued by it)
    const files: string[] = [];
    for (let i = 0; i < 6; i++) { r.fb.t += CALL.showMeGapSec + 6; vc.showMe(0); files.push(r.sp.lastFile!); await flush(); }
    expect(files.filter((f) => f?.startsWith('creature-call-')).length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < files.length; i++) if (files[i]!.startsWith('creature-call-') && files[i - 1]!.startsWith('creature-call-')) expect(files[i]).not.toBe(files[i - 1]);
    expect(new Set(files).size).toBeGreaterThan(1);
  });
});
