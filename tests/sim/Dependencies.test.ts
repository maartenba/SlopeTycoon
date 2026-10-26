import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { canPlace, evaluateStatus, reevaluateAll, onRemove, type BuildingInstance, type DepContext } from '../../src/sim/Dependencies';

let n = 0;
const mk = (type: string, x = 0, y = 0): BuildingInstance => ({ id: ++n, type, x, y, active: true });

describe('dependencies', () => {
  it('locked buildings blocked until prerequisite exists', () => {
    for (const def of Object.values(BUILDINGS)) {
      for (const r of def.requires) {
        const empty: DepContext = { buildings: [], lakeTiles: [{ x: 0, y: 0 }] };
        expect(canPlace(def.id, empty).ok).toBe(false);
        expect(canPlace(def.id, { ...empty, buildings: [mk(r)] }).ok).toBe(true);
      }
    }
  });
  it('water-source rule', () => {
    expect(canPlace('snowCannon', { buildings: [] }).ok).toBe(false);
    expect(canPlace('snowCannon', { buildings: [mk('reservoir')] }).ok).toBe(true);
    expect(canPlace('snowCannon', { buildings: [], lakeTiles: [{ x: 1, y: 1 }] }, { x: 0, y: 0 }).ok).toBe(true);
    expect(canPlace('beach', { buildings: [], lakeTiles: [{ x: 1, y: 1 }] }, { x: 20, y: 20 }).ok).toBe(false);
  });
  it('removing prerequisite disables dependents', () => {
    const hq = mk('skiSchoolHQ'), carpet = mk('magicCarpet');
    const all = [hq, carpet];
    const s: DepContext = { buildings: all };
    reevaluateAll(s);
    expect(carpet.active).toBe(true);
    all.splice(0, 1);
    onRemove(hq, s);
    expect(carpet.active).toBe(false);
    expect(carpet.reason).toBe('Needs Ski School HQ');
  });
  it('station always placeable; shuttle rule', () => {
    const core = mk('baseLodge', 0, 0);
    const near = mk('trainStation', 6, 6);
    const far = mk('trainStation', 7, 6);
    const all = [core, near, far];
    expect(canPlace('trainStation', { buildings: [] }).ok).toBe(true);
    let paths = true;
    const s: DepContext = { buildings: all, roadConnected: () => paths };
    expect(evaluateStatus(near, s).active).toBe(true);
    const st = evaluateStatus(far, s);
    expect(st.active).toBe(false);
    expect(st.reason).toBe('Needs Shuttle Bus Depot');
    all.push(mk('shuttleDepot', 20, 20));
    expect(evaluateStatus(far, s).active).toBe(true);
    paths = false;
    expect(evaluateStatus(far, s).active).toBe(false);
    expect(reevaluateAll(s)).toContain(far.id);
    expect(far.active).toBe(false);
    paths = true;
    expect(reevaluateAll(s)).toContain(far.id);
    expect(far.active).toBe(true);
  });
  it('radius change flips outcome; injectable path distance', () => {
    const core = mk('baseLodge', 0, 0);
    const st = mk('altiport', 7, 6);
    const s: DepContext = { buildings: [core, st] };
    expect(evaluateStatus(st, s).active).toBe(false);
    expect(evaluateStatus(st, { ...s, walkingRadius: 13 }).active).toBe(true);
    expect(evaluateStatus(st, { ...s, pathDistance: () => 5 }).active).toBe(true);
  });
});
