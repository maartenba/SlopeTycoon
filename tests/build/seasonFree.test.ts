import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { LIFTS, type LiftKind } from '../../src/config/lifts';
import { Layer, NetKind } from '../../src/world/Networks';
import { createSim } from '../../src/game/createSim';
import { validatePlacement } from '../../src/sim/PlaceBuilding';
import { validateLift, type LiftEnv } from '../../src/sim/Lift';
import { planDecor, planPond, planRocks, planFill } from '../../src/sim/landscape/Landscape';
import { pondRectAround } from '../../src/sim/landscape/Landscape';
import { trailSeasonNote, networkInfo, NETWORK_ITEMS } from '../../src/ui/buildInfo';

const SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const;
const mkSim = (s: (typeof SEASONS)[number]) => createSim({ size: 64, seed: 61, now: () => 0, startSeason: s, mode: 'sandbox' });
const SEASONY = /season|snow|summer|winter|spring|autumn/i;

/** Every construction check of every tool, as a plain signature string, so seasons can be compared. */
function signature(sim: ReturnType<typeof mkSim>): { sig: string[]; reasons: string[] } {
  const sig: string[] = [], reasons: string[] = [];
  const env = { ...sim.env };
  const spots: Array<[number, number]> = [];
  for (let y = 6; y < 58; y += 7) for (let x = 6; x < 58; x += 7) spots.push([x, y]);
  for (const type of Object.keys(BUILDINGS)) for (const [x, y] of spots) {
    const r = validatePlacement(env, type, x, y, 0);
    sig.push(`b:${type}:${x},${y}:${r.ok}:${r.reasons.join('|')}`);
    reasons.push(...r.reasons, ...r.warnings);
  }
  for (const layer of [Layer.Ski, Layer.Mtb, Layer.Hike]) for (let y = 0; y < 64; y += 3) for (let x = 0; x < 64; x += 3) {
    const c = sim.networks.canPaint(x, y, layer);
    sig.push(`n:${layer}:${x},${y}:${c.ok}:${c.reason ?? ''}`);
    if (c.reason) reasons.push(c.reason);
  }
  const lenv: LiftEnv = { grid: sim.grid, lifts: sim.lifts, economy: sim.economy, props: sim.props, buildings: sim.buildings, access: sim.networks.access, gate: sim.gate };
  for (const kind of Object.keys(LIFTS) as LiftKind[]) for (const [x, y] of spots) {
    const c = validateLift(lenv, kind, { x, y }, { x: x + 6, y: y - 10 < 1 ? 1 : y - 10 }, { autoFlatten: true, clearLane: true });
    sig.push(`l:${kind}:${x},${y}:${c.ok}:${c.reasons.join('|')}`);
    reasons.push(...c.reasons, ...c.warnings);
  }
  const lsEnv = sim.landscapeEnv();
  for (const [x, y] of spots) {
    const pond = planPond(lsEnv, pondRectAround(x, y, 5));
    sig.push(`p:${x},${y}:${pond.ok}:${pond.ok ? '' : pond.reason}`);
    if (!pond.ok) reasons.push(pond.reason ?? '');
    for (const k of ['bench', 'lamp', 'flowerBed', 'hedge', 'fence', 'wall', 'fountain'] as const) {
      const d = planDecor(lsEnv, x, y, k);
      sig.push(`d:${k}:${x},${y}:${d.ok}:${d.ok ? '' : d.reason}`);
      if (!d.ok) reasons.push(d.reason ?? '');
    }
    sig.push(`r:${x},${y}:${planRocks(lsEnv, x, y, 3, 0).rocks.length}`);
    const f = planFill(lsEnv, sim.landscape, x, y);
    sig.push(`f:${x},${y}:${f.ok}`);
  }
  // The summer construction discount legitimately moves affordability: compare on rules, not on the funds line.
  const strip = (x: string): string => x.replace(/\|?Not enough funds \(\$[\d,]+\)/g, '');
  return { sig: sig.map(strip).map((x) => x.replace(/:false:$/, ':true:')), reasons };
}

describe('construction is season-free', () => {
  const winter = signature(mkSim('winter'));
  it.each(SEASONS)('%s: every tool validates exactly like winter and names no season', (s) => {
    const r = signature(mkSim(s));
    expect(r.sig.map((x, i) => (x !== winter.sig[i] ? x + '  <>  ' + winter.sig[i] : '')).filter(Boolean).slice(0, 8)).toEqual([]);
    expect(r.reasons.filter((x) => SEASONY.test(x))).toEqual([]);
  });

  it.each(SEASONS)('%s: paths, roads, rail and all three piste layers can be painted and erased', (s) => {
    const sim = mkSim(s);
    const row = Array.from({ length: 8 }, (_, i) => ({ x: 20 + i, y: 10 }));
    for (const layer of [Layer.Ski, Layer.Mtb, Layer.Hike]) {
      const n = sim.networks.paint(layer, row, 1).painted;
      expect(n).toBeGreaterThan(0);
      expect(n).toBe(sim.networks.layers.filter((v, i) => (v & layer) !== 0 && i >= 0).length);
      expect(sim.networks.unpaint(layer, 20, 10)).toBe(true);
    }
    const built = (sm: ReturnType<typeof mkSim>) => [NetKind.Path, NetKind.Road, NetKind.Rail].map((k) => JSON.stringify(sm.networks.build(k, 30, 30)));
    expect(built(sim)).toEqual(built(mkSim('winter')));
  });

  it.each(SEASONS)('%s: a snow-free piste does not break the sim (days run, grooming, ops, guests)', (s) => {
    const sim = mkSim(s);
    const row = Array.from({ length: 20 }, (_, i) => ({ x: 20, y: 10 + i }));
    sim.networks.paint(Layer.Ski, row, 0);
    expect(() => sim.tick(2400)).not.toThrow();
    expect(Number.isFinite(sim.economy.money)).toBe(true);
    expect(Number.isFinite(sim.rating.stars)).toBe(true);
  });

  it('the Pistes drawer note is a hint, never a prohibition', () => {
    for (const s of ['winter', 'summer'] as const) {
      const n = trailSeasonNote(s) ?? '';
      expect(n).not.toMatch(/not usable|cannot|can't|blocked|disabled/i);
    }
    for (const it of NETWORK_ITEMS) for (const s of ['winter', 'summer'] as const) {
      expect(networkInfo(it, 10, s).rules.join(' ')).not.toMatch(/not usable|only in|cannot be built/i);
    }
  });
});
