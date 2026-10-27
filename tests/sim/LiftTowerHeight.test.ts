import { describe, it, expect } from 'vitest';
import { LIFTS, type LiftKind } from '../../src/config/lifts';
import { LIFT_PARAMS, stationAnchor, validateLift } from '../../src/sim/Lift';
import { sampleRoutes } from '../perf/liftSampler';
import { towerThickness } from '../../src/render/meshes/lifts/Tower';
import { TILE_METRES } from '../../src/config/balance';

const KINDS_T: LiftKind[] = ['tbar', 'chair4', 'gondola6', 'cablecar'];
const spanOf = (nodes: Array<{ x: number; z: number }>, i: number): number => Math.hypot(nodes[i + 1]!.x - nodes[i]!.x, nodes[i + 1]!.z - nodes[i]!.z);

describe('lift tower height caps', () => {
  it('hard caps are sane (<= 12 units) and soft < hard for every kind', () => {
    for (const k of Object.keys(LIFT_PARAMS) as LiftKind[]) {
      const p = LIFT_PARAMS[k];
      expect(p.maxTowerHeight).toBeLessThanOrEqual(10);
      if (k !== 'funicular') expect(p.softTowerHeight).toBeLessThan(p.maxTowerHeight);
    }
    expect(LIFT_PARAMS.chair4.maxTowerHeight).toBeLessThanOrEqual(5);
    expect(LIFT_PARAMS.tbar.maxTowerHeight).toBeLessThanOrEqual(3.5);
  });

  it('property: every tower <= kind cap and <= spanRatio x longer adjacent span (forest, lane ON and OFF)', () => {
    let checked = 0, over = 0, denser = 0, valid = 0;
    for (const clearLane of [true, false]) for (const size of [64, 128, 256] as const) for (let seed = 1; seed <= (size === 256 ? 4 : 8); seed++) {
      const s = sampleRoutes(size, seed, 8, true);
      for (const kind of KINDS_T) for (const r of s.routes[kind]) {
        const c = validateLift(s.env, kind, stationAnchor(s.grid, r.bx, r.by), stationAnchor(s.grid, r.tx, r.ty), { skipFunds: true, clearLane });
        if (!c.ok || !c.data) continue;
        valid++;
        const prm = LIFT_PARAMS[kind], ns = c.data.nodes;
        c.data.towers.forEach((t, i) => {
          const h = t.headY - t.groundY;
          expect(h, `${kind} ${size}/${seed} tower ${i}`).toBeLessThanOrEqual(prm.maxTowerHeight + 1e-6);
          const span = Math.max(spanOf(ns, i), spanOf(ns, i + 1));
          expect(h, `${kind} ratio`).toBeLessThanOrEqual(Math.max(prm.minTowerHeight + 0.6, prm.spanRatio * span) + 1e-6);
          checked++;
        });
        const mx = c.data.towers.reduce((m, t) => Math.max(m, t.headY - t.groundY), 0);
        if (mx > prm.softTowerHeight + 1e-6) over++;
        const L = Math.hypot(ns[ns.length - 1]!.x - ns[0]!.x, ns[ns.length - 1]!.z - ns[0]!.z);
        if (c.data.towers.length > Math.max(1, Math.ceil(L / LIFTS[kind].towerSpacing)) - 1) denser++;
      }
    }
    expect(checked).toBeGreaterThan(500);
    // Prefers more towers: a good share of lines got denser spacing than the nominal one, and few stay above the soft height.
    expect(denser / valid, 'share of lines with denser-than-nominal towers').toBeGreaterThan(0.1);
    expect(over / valid, 'share above the soft height').toBeLessThan(0.3);
  }, 300000);

  it('solver prefers more towers: a route that needs a tall tower at nominal spacing gets denser towers and lower heads', () => {
    let found = 0;
    for (let seed = 1; seed <= 20 && found < 3; seed++) {
      const s = sampleRoutes(128, seed, 40, false);
      for (const r of s.routes.chair4) {
        const c = validateLift(s.env, 'chair4', stationAnchor(s.grid, r.bx, r.by), stationAnchor(s.grid, r.tx, r.ty), { skipFunds: true });
        if (!c.ok || !c.data) continue;
        const ns = c.data.nodes, L = Math.hypot(ns[ns.length - 1]!.x - ns[0]!.x, ns[ns.length - 1]!.z - ns[0]!.z);
        const nominal = Math.max(1, Math.ceil(L / LIFTS.chair4.towerSpacing)) - 1;
        if (c.data.towers.length > nominal) {
          found++;
          const mx = c.data.towers.reduce((m, t) => Math.max(m, t.headY - t.groundY), 0);
          expect(mx).toBeLessThanOrEqual(LIFT_PARAMS.chair4.maxTowerHeight + 1e-6);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  }, 120000);

  it('refusal text states the height in metres and the remedies', () => {
    const msgs = new Set<string>();
    for (let seed = 1; seed <= 20 && msgs.size === 0; seed++) {
      const s = sampleRoutes(128, seed, 40, true);
      for (const kind of KINDS_T) for (const r of s.routes[kind]) {
        const c = validateLift(s.env, kind, stationAnchor(s.grid, r.bx, r.by), stationAnchor(s.grid, r.tx, r.ty), { skipFunds: true, clearLane: false });
        for (const x of c.reasons) if (/Towers would need/.test(x)) msgs.add(x);
      }
    }
    expect(msgs.size).toBeGreaterThan(0);
    for (const m of msgs) { expect(m).toMatch(/Towers would need to be \d+ m tall/); expect(m).toMatch(/shorten the span, clear the forest lane or pick another route/); }
    expect(TILE_METRES).toBe(10);
  }, 120000);

  it('is deterministic', () => {
    const s = sampleRoutes(128, 3, 10, true);
    for (const kind of KINDS_T) for (const r of s.routes[kind]) {
      const a = validateLift(s.env, kind, stationAnchor(s.grid, r.bx, r.by), stationAnchor(s.grid, r.tx, r.ty), { skipFunds: true });
      const b = validateLift(s.env, kind, stationAnchor(s.grid, r.bx, r.by), stationAnchor(s.grid, r.tx, r.ty), { skipFunds: true });
      expect(JSON.stringify(b.data?.towers)).toBe(JSON.stringify(a.data?.towers));
      expect(b.reasons).toEqual(a.reasons);
    }
  });

  it('tall tower meshes get thicker (no needles), short ones are unchanged', () => {
    expect(towerThickness(1)).toBe(1);
    expect(towerThickness(2.4)).toBe(1);
    expect(towerThickness(5)).toBeGreaterThan(1.3);
    expect(towerThickness(50)).toBeLessThanOrEqual(1.7);
  });
});
