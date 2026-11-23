import { createSim, type Sim } from '../../../src/game/createSim';
import { placeBuilding } from '../../../src/sim/PlaceBuilding';
import { Layer } from '../../../src/world/Networks';
import { hourOfDay, weekdayOf } from '../../../src/sim/Clock';
import { LIFTS } from '../../../src/config/lifts';
import type { Run } from '../../../src/world/Runs';

export const mkWinter = (seed = 61): Sim => {
  const s = createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', startSeason: 'winter', now: () => 0 } as never);
  s.tick(240 * 3 + 20);
  s.game.money = 5_000_000;
  s.progression.unlockAll = true;
  return s;
};
/** The run with the biggest drop. */
export const mainRun = (s: Sim): Run => [...s.runIndex.runs()].sort((a, b) => b.dropM - a.dropM)[0]!;
/** Repaint every tile of a run with a stored difficulty (0 green .. 3 black): the run reads 1..4. */
export function paintRun(s: Sim, run: Run, stored: number): void {
  const n = s.size;
  s.networks.paint(Layer.Ski, run.tiles.map((t) => ({ x: t % n, y: (t / n) | 0 })), stored);
}
/** Place a hut within `reach` tiles of a centre-line tile, trying a ring of offsets. Returns its id (or null). */
export function putHutNear(s: Sim, type: 'startHut' | 'timingHut', tile: number, reach = 2): number | null {
  const n = s.size, tx = tile % n, ty = (tile / n) | 0;
  for (let r = 1; r <= reach + 1; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const o = s.progression.withBypass(() => placeBuilding(s.env, s.props, type, tx + dx, ty + dy, 0, true, false));
    if (o.ok) { s.buildings.reevaluate(); s.refreshCoverage(undefined, true); return o.building!.id; }
  }
  return null;
}
export interface Fixture { s: Sim; run: Run; id: number }
/** A red (or black) course run with both huts, not yet marked. */
export function courseFixture(stored = 2, seed = 61): Fixture {
  const s = mkWinter(seed);
  const id = prepareCourse(s, stored);
  return { s, run: mainRun(s), id };
}
/** Repaint the main run, place both huts (not yet marked). Returns the persistent run id. */
export function prepareCourse(s: Sim, stored = 2): number {
  const run = mainRun(s);
  paintRun(s, run, stored);
  const r2 = mainRun(s);
  const first = (type: 'startHut' | 'timingHut', tiles: number[]): number | null => { for (const t of tiles) { const id = putHutNear(s, type, t); if (id !== null) return id; } return null; };
  const p = r2.poly, a = first('startHut', [p[1]!, p[0]!, p[2]!]), b = first('timingHut', [p[p.length - 2]!, p[p.length - 1]!, p[p.length - 3]!]);
  if (a === null || b === null) throw new Error('huts could not be placed');
  s.tick(1);
  return s.names.pisteId(mainRun(s));
}

export const absDay = (s: Sim): number => s.game.date.year * 180 + s.game.date.day;
const hourNow = (s: Sim): number => hourOfDay(s.game.date);
/** Tick until the sim clock reads `day` at `hour` (never past). */
export function advanceTo(s: Sim, day: number, hour: number): void {
  for (let g = 0; g < 240 * 30 && (absDay(s) < day || (absDay(s) === day && hourNow(s) < hour)); g++) s.tick(1);
}
/** First Saturday at least `ahead` days from now (weekday 5). */
export const nextSaturday = (s: Sim, ahead = 2): number => { let d = absDay(s) + ahead; while (weekdayOf({ year: 0, day: d }) !== 5) d++; return d; };
export function raceFixture(stored = 2, seed = 61): { s: Sim; id: number } {
  const f = courseFixture(stored, seed); f.s.setRunCourse(f.id, true); f.s.guestSim.spawner.rateMult = 4; f.s.tick(1);
  return { s: f.s, id: f.id };
}


// ---- 0.8.2: summer downhill (MTB) course fixtures ----
export const mkSummer = (seed = 5): Sim => {
  const s = createSim({ size: 64, seed, starterResort: true, mode: 'sandbox', startSeason: 'summer', now: () => 0 } as never);
  s.tick(240 * 3 + 20);
  s.game.money = 5_000_000;
  s.progression.unlockAll = true;
  return s;
};
/** Paint a MTB trail along the centre line of the biggest-drop ski run (a stored difficulty 0..3), place both huts beside its ends. Returns the trail's course id. */
export function prepareDownhill(s: Sim, stored = 2, full = false): { id: number; tiles: number[] } {
  const n = s.size, ski = mainRun(s), top0 = s.lifts.all().find((l) => LIFTS[l.kind]?.carriesBikes)?.top;
  const altOf = (t: number): number => { const c = s.grid.getCorners(t % n, (t / n) | 0); return ((c[0]! + c[1]! + c[2]! + c[3]!) / 4) * 0.5; };
  const from = top0 && !full ? Math.max(0, ski.poly.findIndex((t) => altOf(t) <= top0.ground - 0.2)) : 0; // a trail is ridden downhill: it starts at or below the lift's top
  const line = ski.poly.slice(from).map((t) => ({ x: t % n, y: (t / n) | 0 }));
  // a connector from the top station of the first bike lift to the start of the line, so the trail starts where the lift lets riders off (a trail must be connected to a lift)
  const top = s.lifts.all().find((l) => LIFTS[l.kind]?.carriesBikes)?.top, a0 = line[0]!;
  const conn: Array<{ x: number; y: number }> = [];
  if (top) { let x = top.x, y = top.y; while ((x !== a0.x || y !== a0.y) && conn.length < 12) { x += Math.sign(a0.x - x); y += Math.sign(a0.y - y); conn.push({ x, y }); } conn.pop(); }
  s.networks.paint(Layer.Mtb, [...conn, ...line], stored);
  s.tick(1);
  const trail = [...s.mtbRunIndex.runs()].sort((a, b) => b.dropM - a.dropM)[0]!;
  const p = trail.poly;
  const first = (type: 'startHut' | 'timingHut', tiles: number[]): number | null => { for (const t of tiles) { const id = putHutNear(s, type, t); if (id !== null) return id; } return null; };
  const a = first('startHut', [p[1]!, p[0]!, p[2]!]), b = first('timingHut', [p[p.length - 2]!, p[p.length - 1]!, p[p.length - 3]!]);
  if (a === null || b === null) throw new Error('huts could not be placed');
  s.tick(1);
  const t2 = [...s.mtbRunIndex.runs()].sort((x, y) => y.dropM - x.dropM)[0]!;
  return { id: s.race.idOf(t2), tiles: t2.tiles };
}
