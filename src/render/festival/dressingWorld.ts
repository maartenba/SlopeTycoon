import type { Sim } from '../../game/createSim';
import { OccFlag } from '../../world/Occupancy';
import { isWaterType } from '../../world/Grid';
import { blackPisteLine, type DressingWorld } from './placeDressing';

/** Read-only snapshot adapter: what `placeDressing` needs from a running sim (base lift station, village, lodge, network, water, occupancy, black piste). */
export function dressingWorldOf(sim: Sim): DressingWorld {
  const { grid, networks } = sim, N = grid.size;
  const lodge = sim.buildings.all().find((b) => b.type === 'baseLodge'), va = sim.terrainInfo.villageAnchor;
  let base: { x: number; y: number } | null = null, lowest = Infinity;
  for (const l of sim.lifts.all()) if (l.bottom.ground < lowest) { lowest = l.bottom.ground; base = { x: l.bottom.x + 0.5, y: l.bottom.y + 0.5 }; }
  const black = (i: number): boolean => ((networks.layers[i] ?? 0) & 1) !== 0 && (networks.kind[i] ?? 0) === 0 && networks.difficulty[i] === 3;
  const alt = (i: number): number => grid.getCorner(i % N, (i / N) | 0);
  const racerLine = sim.events.active().some((e) => e.id === 'worldCup') ? blackPisteLine(black, alt, N) : [];
  return {
    size: N, kind: (i) => networks.kind[i] ?? 0, isWater: (i) => isWaterType(grid.tileType[i]!), isBuilding: (i) => ((grid.occupancy.flags[i] ?? 0) & (OccFlag.Building | OccFlag.Lift)) !== 0, // roads / paths / pistes also set flags: those tiles are exactly where the dressing goes
    steep: (i) => { const x = i % N, y = (i / N) | 0; return Math.abs(grid.getCorner(x, y) - grid.getCorner(Math.min(N - 1, x + 1), Math.min(N - 1, y + 1))) > 1.2; },
    station: base, village: { x: va.x, y: va.y }, lodge: lodge ? { x: lodge.x + lodge.w / 2, y: lodge.y + lodge.h / 2 } : null,
    finish: racerLine.length ? racerLine[racerLine.length - 1]! : null, racerLine,
  };
}
