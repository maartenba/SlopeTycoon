import { describe, expect, it } from 'vitest';
import { makeResort } from '../game/harness';
import { buildWaterData } from '../../src/render/Water';
import { landscapeDecorItems, LandscapeDecorView } from '../../src/render/LandscapeDecor';
import { decorCircles } from '../../src/render/view/WalkMode';
import { DECOR, DECOR_IDS } from '../../src/config/landscape';
import { applyDecor, applyPond, planDecor, planPond, pondRectAround } from '../../src/sim/landscape/Landscape';
import { surfaceHeight } from '../../src/world/Props';
import { budget } from '../perfMode';

const mk = () => { const { sim } = makeResort(64, 61); sim.tick(2); sim.progression.unlockAll = true; return sim; };

describe('landscape rendering data', () => {
  it('a dug pond appears in the water mesh data next to the natural lakes (same builder), and disappears when filled', () => {
    const sim = mk(), env = sim.landscapeEnv();
    const before = buildWaterData(sim.grid, sim.terrainInfo.lakes, sim.terrainInfo.streams).vertexCount;
    let plan = null as ReturnType<typeof planPond> | null;
    for (let y = 8; y < 56 && !plan; y++) for (let x = 8; x < 56 && !plan; x++) { const p = planPond(env, pondRectAround(x, y, 5)); if (p.ok) plan = p; }
    applyPond(env, sim.landscape, plan!);
    const after = buildWaterData(sim.grid, [...sim.terrainInfo.lakes, ...sim.landscape.ponds], sim.terrainInfo.streams);
    expect(after.vertexCount - before).toBe(plan!.tileIdx.length * 6);
    // every pond vertex sits on the flat surface (level * HEIGHT_UNIT + lift)
    const ys = new Set<number>(), only = buildWaterData(sim.grid, sim.landscape.ponds, []);
    for (let i = 1; i < only.positions.length; i += 3) ys.add(Math.round(only.positions[i]! * 1000));
    expect(ys.size).toBe(1);
  });

  it('decor items: solid pieces get walk-mode collision, flat ones (flower bed, picket fence) do not', () => {
    const sim = mk(), env = sim.landscapeEnv();
    const items = new Map<string, number[][]>();
    for (const kind of DECOR_IDS) {
      for (let y = 10, done = false; y < 54 && !done; y++) for (let x = 10; x < 54 && !done; x++) {
        if (!planDecor(env, x, y, kind).ok) continue;
        const rec = { kind, x, y, rot: 0 as const };
        items.set(kind, decorCircles(landscapeDecorItems([rec]))); done = true;
      }
    }
    for (const kind of DECOR_IDS) expect(items.get(kind)!.length > 0, kind).toBe(DECOR[kind].solid);
  });

  it('the decor view rebuilds only when the landscape version moves and keeps a stable items array otherwise', () => {
    const sim = mk(), view = new LandscapeDecorView(sim.landscape, (x, z) => surfaceHeight(sim.grid, x, z));
    expect(view.sync()).toBe(true); expect(view.sync()).toBe(false);
    const empty = view.items;
    for (let y = 10, n = 0; y < 54 && n < 5; y++) for (let x = 10; x < 54 && n < 5; x++) if (planDecor(sim.landscapeEnv(), x, y, 'lamp').ok) { applyDecor(sim.landscape, x, y, 'lamp', 0); n++; }
    expect(view.sync()).toBe(true);
    expect(view.items).not.toBe(empty); expect(view.items).toHaveLength(5);
    const same = view.items; view.sync();
    expect(view.items).toBe(same);
    expect(view.group.children.length).toBe(3); // wood, plants, glass = 3 draw calls
  });

  it('[perf] pond preview, dig and a 300-piece decor rebuild stay cheap', () => {
    const sim = mk(), env = sim.landscapeEnv();
    const best = (n: number, f: () => void): number => { let m = Infinity; for (let i = 0; i < n; i++) { const t = performance.now(); f(); m = Math.min(m, performance.now() - t); } return m; };
    const prev = best(8, () => { planPond(env, pondRectAround(30, 30, 11)); });
    expect(prev).toBeLessThan(budget(8));
    const view = new LandscapeDecorView(sim.landscape, (x, z) => surfaceHeight(sim.grid, x, z));
    let n = 0;
    for (let y = 6; y < 58 && n < 300; y++) for (let x = 6; x < 58 && n < 300; x++) if (planDecor(env, x, y, n % 2 ? 'hedge' : 'bench').ok) { applyDecor(sim.landscape, x, y, n % 2 ? 'hedge' : 'bench', 0); n++; }
    const rebuild = best(5, () => { view.invalidate(); view.sync(); });
    expect(rebuild).toBeLessThan(budget(60));
  });
});
