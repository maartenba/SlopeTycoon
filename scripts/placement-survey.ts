/**
 * Placement survey: samples candidate positions for every flat-needing building on generated terrain (auto-flatten ON) and prints the
 * failure-reason histogram + success rate. Usage: npx vite-node scripts/placement-survey.ts [--stride 2] [--sizes 64:61,64:7,128:5]
 */
import { createSim } from '../src/game/createSim';
import { BUILDINGS } from '../src/config/buildings';
import { validatePlacement } from '../src/sim/PlaceBuilding';
import { flattenRect } from '../src/world/Terraform';
import { networkSpreadViolations } from '../src/world/Networks';
import { meanHeight } from '../src/sim/PlacementRules';
import { footprintOf } from '../src/sim/Buildings';
import { OccFlag } from '../src/world/Occupancy';
import { TileType, isWaterType } from '../src/world/Grid';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const stride = Number(arg('stride', '2'));
const maps = arg('sizes', '64:61,64:7,64:23,128:5').split(',').map((s) => s.split(':').map(Number) as [number, number]);
const only = arg('types', '');
const legacy = arg('legacy', '0') === '1';
const starter = arg('starter', '0') === '1';

const types = Object.values(BUILDINGS).filter((d) =>
  d.site.autoFlatten === 'default' && d.site.slopeKind === 'flat' && d.site.onWater === 'never' && !d.maxCount && (!only || only.split(',').includes(d.id))).map((d) => d.id);

const tool = 0; void tool;
const hist = new Map<string, number>();

const bump = (m: Map<string, number>, k: string, n = 1): void => { m.set(k, (m.get(k) ?? 0) + n); };
const perType = new Map<string, { n: number; ok: number }>();
const bySteep = new Map<string, { n: number; ok: number }>();
let total = 0, okTotal = 0, steepTotal = 0, steepOk = 0;
let le15 = 0, le15ok = 0;
let needN = 0, needOk = 0, needWall = 0, needCost = 0, needSteep = 0, needSteepOk = 0;

for (const [size, seed] of maps) {
  const sim = createSim({ size: size as 64 | 128, seed, money: 1e12, starterResort: starter });
  const { grid, env } = sim;
  const occ = grid.occupancy;
  for (const type of types) {
    for (const rot of [0, 1]) {
      const { w, h } = footprintOf(type, rot);
      for (let y = 1; y + h <= size - 1; y += stride) for (let x = 1; x + w <= size - 1; x += stride) {
        // hard blockers independent of the slope rules
        let hard = false, maxSteep = 0;
        for (let j = y; j < y + h && !hard; j++) for (let i = x; i < x + w; i++) {
          const fl = occ.flags[occ.index(i, j)]!, tt = grid.tileType[grid.tileIndex(i, j)]!;
          if (fl & (OccFlag.Building | OccFlag.Lift | OccFlag.Road | OccFlag.Path | OccFlag.Water) || isWaterType(tt) || tt === TileType.Rock) { hard = true; break; }
          maxSteep = Math.max(maxSteep, grid.steepness(i, j));
        }
        if (!hard) { // pad vertices whose neighbouring tiles are water / buildings cannot move
          for (let vy = y; vy <= y + h && !hard; vy++) for (let vx = x; vx <= x + w; vx++) {
            for (let ty = vy - 1; ty <= vy && !hard; ty++) for (let tx = vx - 1; tx <= vx; tx++) {
              if (!grid.inBounds(tx, ty)) continue;
              const fl = occ.flags[occ.index(tx, ty)]!;
              if (fl & (OccFlag.Building | OccFlag.Lift | OccFlag.Water) || isWaterType(grid.tileType[grid.tileIndex(tx, ty)]!)) { hard = true; break; }
            }
          }
        }
        if (hard) continue;
        const chk = validatePlacement(env, type, x, y, rot, !legacy);
        let rs = chk.reasons.filter((r) => !/^Needs [A-Z]|first|Limit|Only|funds/i.test(r));
        if (legacy && rs.length === 1 && rs[0] === 'Too steep') { // the pre-planner behaviour: unbounded BFS ripple around a mean-height pad
          const res = flattenRect(grid, { vx0: x, vy0: y, vx1: x + w, vy1: y + h }, Math.round(meanHeight(grid, x, y, w, h)), {
            commit: false, tolerateOccupancy: OccFlag.Path | OccFlag.Road,
            extraViolations: (ch) => networkSpreadViolations(grid, env.buildings.depContext().access, ch),
            liftClearanceViolations: env.buildings.liftClearance,
          });
          if (res.ok) { rs = []; chk.flattenCost = res.cost; } else rs = [res.reason === 'water' ? 'Cannot flatten next to water' : res.reason === 'occupied' ? 'Cannot flatten next to other buildings' : 'Cannot flatten: lift clearance'];
        }
        total++;
        if (maxSteep <= 1.5) { le15++; if (rs.length === 0) le15ok++; }
        const b = maxSteep < 0.5 ? '<0.5' : maxSteep < 1 ? '0.5-1' : maxSteep < 1.5 ? '1-1.5' : maxSteep < 2 ? '1.5-2' : '>=2';
        if (chk.spread > BUILDINGS[type]!.site.maxSlope) {
          needN++; if (maxSteep <= 1.5) needSteep++;
          if (rs.length === 0) { needOk++; needCost += chk.flattenCost; if (maxSteep <= 1.5) needSteepOk++; if ((chk.flattenPlan?.wallEdges ?? 0) > 0) needWall++; }
        }
        const pt = perType.get(type) ?? { n: 0, ok: 0 }; pt.n++;
        const bs = bySteep.get(b) ?? { n: 0, ok: 0 }; bs.n++;
        if (rs.length === 0) { okTotal++; pt.ok++; bs.ok++; if (maxSteep >= 1) { steepTotal++; steepOk++; } }
        else {
          if (maxSteep >= 1) steepTotal++;
          for (const r of rs) bump(hist, r);
        }
        perType.set(type, pt); bySteep.set(b, bs);
      }
    }
  }
  void sim;
}
const pct = (a: number, b: number): string => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
console.log(`maps ${maps.map((m) => m.join(':')).join(', ')}; stride ${stride}; types ${types.length}: ${types.join(', ')}`);
console.log(`candidates (no hard blocker): ${total}; placeable: ${okTotal} (${pct(okTotal, total)}); steepness >= 1: ${steepOk}/${steepTotal} (${pct(steepOk, steepTotal)})`);
console.log(`max tile steepness <= 1.5: ${le15ok}/${le15} (${pct(le15ok, le15)})`);
console.log(`needing levelling (footprint spread > 1): ${needOk}/${needN} (${pct(needOk, needN)}); of those steepness<=1.5: ${needSteepOk}/${needSteep} (${pct(needSteepOk, needSteep)}); mean cost of the successful ones $${(needCost / Math.max(1, needOk)).toFixed(0)}; with a retaining wall: ${pct(needWall, needOk)}`);
console.log('--- failure reasons (a candidate may list several) ---');
for (const [k, v] of [...hist].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(6)}  ${k}`);
console.log('--- by steepness bucket ---');
for (const [k, v] of bySteep) console.log(`${k.padEnd(8)} ${v.ok}/${v.n} ${pct(v.ok, v.n)}`);
console.log('--- by type ---');
for (const [k, v] of perType) console.log(`${k.padEnd(16)} ${v.ok}/${v.n} ${pct(v.ok, v.n)}`);
