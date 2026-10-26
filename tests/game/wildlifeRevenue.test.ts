import { describe, expect, it } from 'vitest';
import { makeResort, run } from './harness';
import type { Sim } from '../../src/game/createSim';
import { Layer } from '../../src/world/Networks';
import { planTrail, paintPiste, planPathTo, buildNetwork } from '../../src/tutorial/suggest';
import { seasonStartDay } from '../../src/sim/Clock';
import { placeBuilding } from '../../src/sim/PlaceBuilding';
import { createSim } from '../../src/game/createSim';
import { applySave, stateHash } from '../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';

export type Mode = 'none' | 'bear' | 'bear+rangers';

/** Summer starter resort with a hiking + MTB trail; optionally one bear in a den right beside the trail, optionally a Ranger Station. */
export function wildlifeScenario(seed: number, mode: Mode, size: 64 | 128 = 64) {
  const { sim } = makeResort(size, seed, { startDay: seasonStartDay('summer') + 12 });
  const trail = planTrail(sim);
  if (!trail) throw new Error('no trail plan');
  paintPiste(sim, trail.stroke, null, Layer.Hike);
  paintPiste(sim, trail.stroke, null, Layer.Mtb);
  const w = sim.safety.wildlife;
  const mid = trail.stroke[Math.floor(trail.stroke.length / 2)]!;
  // Ranger Station beside the trail in EVERY arm (identical layout / guest flows); only its effect is switched.
  let placed = false;
  for (let r = 3; r < 20 && !placed; r++) for (let dy = -r; dy <= r && !placed; dy++) for (let dx = -r; dx <= r && !placed; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const out = placeBuilding(sim.env, sim.props, 'rangerStation', mid.x + dx, mid.y + dy, 0, true, false);
    if (out.ok && out.building) {
      const b = out.building;
      const link = planPathTo(sim, { x: b.x, y: b.y, w: b.w, h: b.h });
      if (link && link.length) buildNetwork(sim, 1, link);
      sim.refreshCoverage(b, true); sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true);
      placed = true;
    }
  }
  if (!placed) throw new Error('no ranger site');
  w.rangersEnabled = mode === 'bear+rangers';
  w.refresh();
  if (mode === 'none') { w.enabled = false; w.refresh(); } else {
    const keep = w.animals.find((a) => a.kind === 'bear')!;
    w.animals = [keep];
    // den beside the middle of the trail: nearest free tile >= 4 tiles from it
    let best: { x: number; y: number } | null = null, bd = 1e9;
    for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
      const x = mid.x + dx + 0.5, y = mid.y + dy + 0.5, d = Math.hypot(dx, dy);
      if (d < 4 || !w.free(x, y)) continue;
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (!best) throw new Error('no den site');
    keep.x = keep.tx = keep.denX = best.x; keep.y = keep.ty = keep.denY = best.y; keep.mode = 'rest'; keep.timer = 5; keep.cub = false;
  }
  return { sim, trail };
}

const income = (sim: Sim): number => Object.values(sim.economy.ledger).reduce((x: number, v) => x + (v as number), 0);
export function measure(sim: Sim, days: number) {
  const a = sim.attractions.trails;
  const u0 = a.hiking.uses + a.mtb.uses, r0 = a.hiking.revenue + a.mtb.revenue, m0 = income(sim);
  let arrivals = 0;
  const off = sim.bus.on('guest:arrived', () => { arrivals++; });
  run(sim, { days });
  off();
  return { uses: a.hiking.uses + a.mtb.uses - u0, revenue: a.hiking.revenue + a.mtb.revenue - r0, income: Math.round(income(sim) - m0), arrivals, scares: sim.safety.wildlife.scares, prevented: sim.safety.wildlife.prevented, level: sim.safety.wildlife.scareLevel() };
}

describe('bear threat vs revenue (summer starter resort, hiking + MTB trail next to a bear den)', () => {
  const SEEDS = [1, 2, 3, 4];
  const arm = (mode: Mode) => {
    const tot = { uses: 0, income: 0, scares: 0, prevented: 0, arrivals: 0 };
    for (const seed of SEEDS) {
      const { sim } = wildlifeScenario(seed, mode);
      const m = measure(sim, 20);
      tot.uses += m.uses; tot.income += m.income; tot.scares += m.scares; tot.prevented += m.prevented; tot.arrivals += m.arrivals;
    }
    return tot;
  };

  it('a bear beside the trail cuts hiking/MTB use by a bounded share; rangers mostly mitigate it', () => {
    const none = arm('none'), bear = arm('bear'), rng = arm('bear+rangers');
    const pct = (a: number, b: number): string => `${Math.round((100 * (a - b)) / b)}%`;
    console.log(`4 seeds x 20 days. trail uses: none ${none.uses}, bear ${bear.uses} (${pct(bear.uses, none.uses)}), bear+rangers ${rng.uses} (${pct(rng.uses, none.uses)}); income: none ${none.income}, bear ${bear.income} (${pct(bear.income, none.income)}), bear+rangers ${rng.income} (${pct(rng.income, none.income)}); scares bear ${bear.scares} / rangers ${rng.scares}, prevented ${rng.prevented}`);
    expect(bear.uses / none.uses).toBeLessThan(0.95); // measurable ...
    expect(bear.uses / none.uses).toBeGreaterThan(0.6); // ... but bounded (hiking-related usage -8..-40 %)
    expect(bear.income).toBeLessThan(none.income); // total revenue drops (noisy per seed, so only the 4-seed sum is asserted)
    expect(bear.income / none.income).toBeGreaterThan(0.75);
    expect(rng.uses / none.uses).toBeGreaterThan(0.84); // rangers: usage back within ~15 % of the no-bear baseline (was 10 % before excursions: an excursion also turns back inside the threat field)
    expect(rng.uses).toBeGreaterThan(bear.uses * 1.05);
    expect(rng.prevented).toBeGreaterThan(0);
    expect(rng.arrivals / none.arrivals).toBeGreaterThan(0.95);
  }, 600_000);

  it('is deterministic for a fixed seed', () => {
    const go = (): string => { const { sim } = wildlifeScenario(2, 'bear+rangers'); measure(sim, 3); return sim.safety.wildlife.hash(); };
    expect(go()).toBe(go());
  }, 120_000);

  it('summer scare news is aggregated (<= 1 per bear per few days) and relocations are typed events', () => {
    const { sim } = wildlifeScenario(4, 'bear+rangers');
    const seen: string[] = [];
    for (const n of ['wildlife:scare', 'wildlife:hazed', 'wildlife:relocated'] as const) sim.bus.on(n, () => { seen.push(n); });
    run(sim, { days: 20 });
    expect(seen.filter((n) => n === 'wildlife:scare').length).toBeLessThanOrEqual(8);
    expect(sim.safety.wildlife.hazes + sim.safety.wildlife.relocations).toBeGreaterThan(0);
    expect(seen.filter((n) => n === 'wildlife:hazed').length).toBe(sim.safety.wildlife.hazes);
  }, 120_000);
});

describe('full-sim save/load with bear + ranger state', () => {
  it('bear territory / den / relocation cooldown / hibernation and ranger staff + bins survive a save and continue identically', async () => {
    const { sim } = wildlifeScenario(3, 'bear+rangers');
    const w = sim.safety.wildlife;
    const st = [...sim.buildings.all()].find((b) => b.type === 'rangerStation')!;
    w.setStaff(st.id, 3); w.setBins(st.id, true);
    run(sim, { days: 4 });
    w.animals[0]!.relocCd = 777; w.animals[0]!.hazeLog = 2;
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'test'), { compress: true, yieldBetween: false });
    const { envelope } = await decodeSave(bytes, { yieldBetween: false });
    const restored = createSim({ size: envelope.mapSize, seed: envelope.seed, now: () => 0, fromSave: structuredClone(envelope.modules) });
    applySave(sim, structuredClone(envelope.modules)); // control: same save applied in place (documented demotions)
    const rw = restored.safety.wildlife;
    expect(rw.animals.map((a) => [a.denX, a.denY, a.relocCd, a.hazeLog, a.terr, a.cub])).toEqual(w.animals.map((a) => [a.denX, a.denY, a.relocCd, a.hazeLog, a.terr, a.cub]));
    expect(rw.staffOf(st.id)).toBe(3); expect(rw.binsOf(st.id)).toBe(true);
    for (let d = 0; d < 2 * 240; d += 40) {
      sim.ops.quality.attachTraffic(); sim.tick(40); restored.ops.quality.attachTraffic(); restored.tick(40); // PisteTraffic.sink is process-wide
      const x = stateHash(sim).parts, y = stateHash(restored).parts;
      expect(Object.keys(x).filter((k) => x[k] !== y[k]), `after ${d + 40} ticks`).toEqual([]);
    }
  }, 180_000);

  it('bears hibernate in deep winter (hidden, no threat) and wake in spring on a full sim', () => {
    const { sim } = makeResort(64, 2, { startDay: seasonStartDay('winter') + 30 });
    const w = sim.safety.wildlife; w.refresh();
    run(sim, { days: 1 });
    const bears = w.animals.filter((a) => a.kind === 'bear');
    expect(bears.length).toBeGreaterThan(0);
    expect(bears.every((b) => b.asleep)).toBe(true);
    expect(Math.max(...w.threat)).toBe(0);
    sim.game.date.day = seasonStartDay('spring') + 20; // fast-forward the calendar
    run(sim, { days: 1 });
    expect(w.animals.filter((a) => a.kind === 'bear').some((b) => !b.asleep)).toBe(true);
  }, 120_000);
});
