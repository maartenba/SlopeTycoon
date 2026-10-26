// Dev analysis: dead-end road spurs of a demo town (after pruneRoads). Env: TOWN (default luxury) SEED (22) SIZE (128) DUMP=1 prints the network map.
import { createSim } from '../../src/game/createSim';
import { buildTown, townSimOptions, type TownId } from '../../src/game/demoTowns';
import { NetKind } from '../../src/world/Networks';
import type { MapSize } from '../../src/core/GameState';

const id = (process.env.TOWN ?? 'luxury') as TownId, seed = Number(process.env.SEED ?? 22), size = Number(process.env.SIZE ?? 128) as MapSize;
const sim = createSim({ ...townSimOptions(id, size), seed, now: () => 0 });
buildTown(sim, id, seed);
const net = sim.networks, n = net.size;
const road = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n && net.kind[y * n + x] === NetKind.Road;
const arms = (x: number, y: number): number => (road(x + 1, y) ? 1 : 0) + (road(x - 1, y) ? 1 : 0) + (road(x, y + 1) ? 1 : 0) + (road(x, y - 1) ? 1 : 0);
const e = net.roadEntry;
const ends: Array<[number, number]> = [];
let tiles = 0;
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (road(x, y)) { tiles++; if (arms(x, y) === 1 && !(e && e.x === x && e.y === y)) ends.push([x, y]); }
console.log(JSON.stringify({ town: id, seed, size, roadTiles: tiles, deadEnds: ends }));
if (process.env.DUMP) {
  const bl = new Set<number>();
  for (const b of sim.buildings.all()) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) bl.add(y * n + x);
  for (let y = 0; y < n; y++) {
    let r = '';
    for (let x = 0; x < n; x++) { const k = net.kind[y * n + x]; r += bl.has(y * n + x) ? 'B' : k === 2 ? '#' : k === 1 ? '.' : k === 3 ? '=' : ' '; }
    if (r.trim()) console.log(String(y).padStart(3) + ' ' + r);
  }
}
