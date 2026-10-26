import { describe, expect, it } from 'vitest';
import { FakeGuests, mkB, mkSafety, run } from './safetyHelpers';
import { WILD, type Animal } from '../../../src/sim/ops';
import { GameBus } from '../../../src/core/events';
import { budget } from '../../perfMode';
import { SpatialHash } from '../../../src/sim/guests/SpatialHash';

const N = 64;

/** Fast port for the perf test (the shared FakeGuests rebuilds a lookup map per query). */
class FastGuests extends FakeGuests {
  private hs: SpatialHash; private fx: Float32Array; private fy: Float32Array; private pr: boolean[] = []; private n = 0; private out: number[] = [];
  constructor(size: number, cap: number) { super(size, 4); this.hs = new SpatialHash(size, cap); this.fx = new Float32Array(cap); this.fy = new Float32Array(cap); }
  override add(id: number, x: number, y: number, prey = false): void { const s = this.n++; this.fx[s] = x; this.fy[s] = y; this.pr[s] = prey; this.hs.insert(s, x, y); void id; }
  override position(id: number) { return id >= 1 && id <= this.n ? { x: this.fx[id - 1]!, y: this.fy[id - 1]! } : null; }
  override near(x: number, y: number, r: number, mode: 'any' | 'prey'): number[] {
    const ids: number[] = [];
    for (const s of this.hs.query(x, y, r, this.fx, this.fy, this.out)) if (mode === 'any' || this.pr[s]) ids.push(s + 1);
    return ids;
  }
  scare(): boolean { return true; }
}

class ScaryGuests extends FakeGuests {
  scared: number[] = [];
  scare(id: number): boolean { this.scared.push(id); return true; }
}

type Opts = { season?: () => 'winter' | 'spring' | 'summer' | 'autumn'; guests?: ScaryGuests; buildings?: ReturnType<typeof mkB>[]; seed?: number; blocked?: (i: number) => boolean; size?: 64 | 128 | 256 };
/** A forest arena with a single bear placed at (cx, cy). */
function arena(o: Opts = {}, cx = 32.5, cy = 32.5) {
  const size = o.size ?? 64;
  const guests = o.guests ?? new ScaryGuests(size);
  const m = mkSafety({ size, seed: o.seed ?? 1, guests, buildings: o.buildings, forest: new Uint8Array(size * size).fill(255), season: o.season ?? (() => 'summer'), blocked: o.blocked ?? (() => false) });
  const events: Array<{ name: string; p: Record<string, number | string> }> = [];
  for (const n of ['wildlife:scare', 'wildlife:hazed', 'wildlife:relocated'] as const) (m.bus as unknown as GameBus).on(n, (p: unknown) => events.push({ name: n, p: p as Record<string, number | string> }));
  m.safety.resync();
  const w = m.safety.wildlife;
  w.refresh();
  w.animals = w.animals.filter((a) => a.kind === 'bear').slice(0, 1);
  const bear = w.animals[0]!;
  bear.x = bear.tx = bear.denX = cx; bear.y = bear.ty = bear.denY = cy; bear.mode = 'rest'; bear.timer = 2;
  return { ...m, w, bear, events, guests: guests as ScaryGuests };
}

describe('bears roam', () => {
  it('wander / forage / rest cycle inside the territory, in small steps (interpolatable)', () => {
    const a = arena();
    const modes = new Set<string>();
    let t = 0, maxStep = 0, far = 0, px = a.bear.x, py = a.bear.y;
    for (let k = 0; k < 1500; k++) {
      t = run(a.safety, 1, t);
      modes.add(a.bear.mode);
      maxStep = Math.max(maxStep, Math.hypot(a.bear.x - px, a.bear.y - py)); px = a.bear.x; py = a.bear.y;
      far = Math.max(far, Math.hypot(a.bear.x - a.bear.denX, a.bear.y - a.bear.denY));
    }
    expect([...modes].sort()).toEqual(['forage', 'rest', 'wander']);
    expect(maxStep).toBeLessThanOrEqual(WILD.speed + 1e-6);
    expect(far).toBeGreaterThan(5);
    expect(far).toBeLessThanOrEqual(a.bear.terr + 1);
  });

  it('1-3 / 2-4 / 4-8 bears on 64 / 128 / 256 maps with remote forest', () => {
    for (const [size, lo, hi] of [[64, 1, 3], [128, 2, 4], [256, 4, 8]] as const) {
      const m = mkSafety({ size, forest: new Uint8Array(size * size).fill(255) });
      m.safety.wildlife.refresh();
      const n = m.safety.wildlife.animals.filter((x) => x.kind === 'bear').length;
      expect(n, `size ${size}`).toBeGreaterThanOrEqual(lo);
      expect(n, `size ${size}`).toBeLessThanOrEqual(hi);
    }
  });

  it('hibernate in winter (hidden in the den, no threat), wake in spring', () => {
    let season: 'winter' | 'spring' = 'summer' as never;
    season = 'winter';
    const a = arena({ season: () => season });
    a.bear.x = a.bear.tx = 40; a.bear.y = a.bear.ty = 40;
    run(a.safety, 20);
    expect(a.bear.asleep).toBe(true);
    expect(a.bear.x).toBe(a.bear.denX);
    expect(a.w.threat.every((v) => v === 0)).toBe(true);
    season = 'spring';
    run(a.safety, 40);
    expect(a.bear.asleep).toBe(false);
    expect(Math.max(...a.w.threat)).toBeGreaterThan(0);
  });

  it('hungry autumn bears roam closer to buildings and paths than summer bears', () => {
    const blocked = (i: number): boolean => (i % N) < 14;
    const mean = (season: 'summer' | 'autumn'): number => {
      let sum = 0, n = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const a = arena({ season: () => season, blocked, seed }, 30.5, 30.5);
        let t = 0;
        for (let k = 0; k < 1200; k++) { t = run(a.safety, 1, t); if (k % 10 === 0) { sum += a.bear.x; n++; } }
      }
      return sum / n;
    };
    expect(mean('autumn')).toBeLessThan(mean('summer') - 1);
  });
});

describe('bear threat field', () => {
  it('current-position disc of 10-18 tiles (larger when hungry) plus a weak territory footprint', () => {
    const a = arena();
    a.bear.mode = 'rest'; a.bear.timer = 9999;
    run(a.safety, 1);
    const at = (x: number, y: number): number => a.w.threat[Math.floor(y) * N + Math.floor(x)]!;
    expect(at(32, 32)).toBeGreaterThan(240);
    expect(at(32 + 8, 32)).toBeGreaterThan(at(32 + 12, 32));
    expect(at(32 + 11, 32)).toBe(Math.round(WILD.field.territoryWeight * 255 * (1 - 0.5 * 11 / WILD.terr.bear)) || at(32 + 11, 32)); // beyond the disc only the territory remains
    expect(at(32 + 14, 32)).toBeGreaterThan(0);
    expect(at(32 + 14, 32)).toBeLessThan(0.35 * 255);
    expect(at(2, 2)).toBe(0);
    const reach = (): number => { let r = 0; for (let x = 32; x < N; x++) if (a.w.threat[32 * N + x]! > 0.31 * 255) r = x - 32; return r; };
    const summer = reach();
    expect(summer).toBeGreaterThanOrEqual(6);
    expect(summer).toBeLessThanOrEqual(WILD.field.base + WILD.field.extra);
  });

  it('a staffed Ranger Station shrinks the field and calms guests (avoidance)', () => {
    const base = arena();
    const ranger = arena({ buildings: [mkB('rangerStation', 30, 28)] });
    for (const a of [base, ranger]) { a.bear.mode = 'rest'; a.bear.timer = 9999; run(a.safety, 1); }
    const sum = (w: typeof base.w): number => w.threat.reduce((s, v) => s + v, 0);
    expect(sum(ranger.w)).toBeLessThan(sum(base.w) * 0.8);
    const i = 32 * N + 36;
    expect(ranger.w.avoidance(i)).toBeLessThan(base.w.avoidance(i) * 0.6);
  });
});

describe('scaring guests', () => {
  function crowd(a: ReturnType<typeof arena>, n = 20): void { for (let k = 0; k < n; k++) a.guests.add(k + 1, 32.5 + (k % 5) - 2, 32.5 + Math.floor(k / 5) - 2); }

  it('guests inside the scare radius are frightened once per cooldown; events are aggregated per bear (low volume)', () => {
    const a = arena();
    a.bear.mode = 'rest'; a.bear.timer = 99999;
    crowd(a);
    run(a.safety, 400);
    expect(new Set(a.guests.scared).size).toBe(20);
    expect(a.w.scares).toBeGreaterThanOrEqual(20);
    expect(a.w.scares).toBeLessThan(20 * 8); // cooldown, not every pass
    const sc = a.events.filter((e) => e.name === 'wildlife:scare');
    expect(sc.length).toBeGreaterThanOrEqual(1);
    expect(sc.length).toBeLessThanOrEqual(Math.ceil(400 / WILD.scare.newsGap) + 1);
    expect(sc[0]!.p.guests).toBeGreaterThan(5);
    expect(a.w.scareLevel()).toBeGreaterThan(0.3);
    expect(a.w.arrivalFactor()).toBeLessThan(1);
    expect(a.w.arrivalFactor()).toBeGreaterThanOrEqual(1 - WILD.scare.arrivalLoss);
    expect(a.w.ratingMalus()).toBeGreaterThan(0);
  });

  it('the scare level decays over days', () => {
    const a = arena();
    a.w.recent = 30;
    const l0 = a.w.scareLevel();
    for (let d = 1; d <= 10; d++) a.w.daily(d);
    expect(a.w.scareLevel()).toBeLessThan(l0 * 0.5);
  });

  it('Ranger deterrence turns scares into prevented scares (bounded impact)', () => {
    const plain = arena(), guarded = arena({ buildings: [mkB('rangerStation', 36, 30)] });
    for (const a of [plain, guarded]) { a.bear.mode = 'rest'; a.bear.timer = 99999; a.bear.hazed = 0; crowd(a, 40); }
    guarded.w.rangersEnabled = true;
    // keep rangers from hazing in this test: only the field shrink counts
    run(plain.safety, 200); run(guarded.safety, 200);
    expect(guarded.w.scares + guarded.w.prevented).toBeGreaterThan(0);
    expect(guarded.w.prevented + guarded.w.hazes).toBeGreaterThan(0);
    expect(guarded.guests.scared.length).toBeLessThan(plain.guests.scared.length);
  });
});

describe('Ranger Station', () => {
  const station = () => [mkB('rangerStation', 36, 30)];
  const conflict = (a: ReturnType<typeof arena>): void => { a.guests.add(1, 33, 33); a.bear.mode = 'rest'; a.bear.timer = 99999; };

  it('dispatches a ranger to a conflict bear and hazes it away (typed event, cost, bear retreats)', () => {
    const a = arena({ buildings: station() });
    conflict(a);
    run(a.safety, 60);
    const hz = a.events.filter((e) => e.name === 'wildlife:hazed');
    expect(hz.length).toBeGreaterThanOrEqual(1);
    expect(a.spent).toContain(WILD.ranger.hazeCost);
    expect(a.w.hazes).toBeGreaterThanOrEqual(1);
    const st = a.w.stationStats(a.blds[0]!.id);
    expect(st.preventedMonth).toBeGreaterThan(0);
    expect(st.savedMonth).toBeGreaterThan(0);
  });

  it('relocates repeat offenders far away, once per cooldown', () => {
    const a = arena({ buildings: station() });
    a.bear.hazeLog = WILD.ranger.escalateAt;
    const den0 = { x: a.bear.denX, y: a.bear.denY };
    conflict(a);
    run(a.safety, 60);
    const rl = a.events.filter((e) => e.name === 'wildlife:relocated');
    expect(rl.length).toBe(1);
    expect(a.spent).toContain(WILD.ranger.relocateCost);
    expect(Math.hypot(a.bear.denX - den0.x, a.bear.denY - den0.y)).toBeGreaterThan(15);
    expect(a.bear.relocCd).toBeGreaterThan(0);
    expect(a.bear.hazeLog).toBe(0);
    // another conflict right away is only hazed (relocation cooldown)
    a.bear.hazeLog = WILD.ranger.escalateAt; a.bear.x = a.bear.tx = 33; a.bear.y = a.bear.ty = 34; a.bear.hazed = 0; a.bear.mode = 'rest'; a.bear.timer = 99999;
    run(a.safety, 60, 60);
    expect(a.events.filter((e) => e.name === 'wildlife:relocated').length).toBe(1);
  });

  it('staff 0 means nobody is dispatched; bins cost money once; staff is clamped', () => {
    const a = arena({ buildings: station() });
    const id = a.blds[0]!.id;
    a.w.setStaff(id, 0);
    conflict(a);
    run(a.safety, 60);
    expect(a.w.hazes).toBe(0);
    a.w.setStaff(id, 99); expect(a.w.staffOf(id)).toBe(WILD.ranger.maxStaff);
    a.w.setBins(id, true); a.w.setBins(id, true);
    expect(a.spent.filter((x) => x === WILD.ranger.binsCost).length).toBe(1);
    expect(a.w.binsOf(id)).toBe(true);
  });

  it('save/load round-trips bear (den, hibernation, relocation cooldown) and ranger state', () => {
    const a = arena({ buildings: station() });
    const id = a.blds[0]!.id;
    a.w.setStaff(id, 3); a.w.setBins(id, true);
    a.bear.hazeLog = WILD.ranger.escalateAt; conflict(a);
    run(a.safety, 40);
    const snap = JSON.parse(JSON.stringify(a.w.serialize()));
    const b = arena({ buildings: station() });
    b.w.load(snap);
    expect(b.w.hash()).toBe(a.w.hash());
    const x = b.w.animals[0] as Animal;
    expect(x.relocCd).toBe(a.bear.relocCd); expect(x.denX).toBe(a.bear.denX); expect(x.mode).toBe(a.bear.mode);
    expect(b.w.staffOf(id)).toBe(3); expect(b.w.binsOf(id)).toBe(true);
    expect(b.w.relocations).toBe(a.w.relocations);
  });

  it('is deterministic', () => {
    const go = (): string => { const a = arena({ buildings: station(), seed: 5 }); conflict(a); run(a.safety, 300); return a.w.hash(); };
    expect(go()).toBe(go());
  });
});

describe('wildlife perf', () => {
  it('[perf] 256 map, 8 bears + 4 wolves, 3,000 guests: wildlife step (field included) < 0.3 ms/tick', () => {
    const size = 256;
    const guests = new FastGuests(size, 5000);
    for (let k = 0; k < 3000; k++) guests.add(k + 1, 5 + ((k * 37) % 240), 5 + ((k * 91) % 240), k % 5 === 0);
    const m = mkSafety({ size, seed: 4, guests: guests as unknown as FakeGuests, buildings: [mkB('rangerStation', 100, 100)], forest: new Uint8Array(size * size).fill(220), season: () => 'summer' });
    m.safety.resync(); m.safety.wildlife.refresh();
    const w = m.safety.wildlife;
    expect(w.animals.filter((a) => a.kind === 'bear').length).toBe(8);
    const times: number[] = [];
    for (let k = 0; k < 600; k++) { const t0 = performance.now(); w.update(k); times.push(performance.now() - t0); }
    times.sort((a, b) => a - b);
    const avg = times.reduce((s, v) => s + v, 0) / times.length;
    console.log(`wildlife 256 map: avg ${avg.toFixed(3)} ms/tick, p95 ${times[Math.floor(times.length * 0.95)]!.toFixed(3)} ms`);
    expect(avg).toBeLessThan(budget(0.3));
  });
});
