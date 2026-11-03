/* M8 baseline (docs/graphics-audit.md): triangles per model category, pure geometry (no WebGL, deterministic). vite-node scripts/shots/m8-baseline.ts [--json] */
import * as THREE from 'three';
import { BUILDINGS } from '../../src/config/buildings';
import { LIFT_KIND_IDS } from '../../src/config/lifts';
import { buildParts } from '../../src/render/meshes';
import { buildCarrierGeometry } from '../../src/render/meshes/lifts';
import { buildStationParts } from '../../src/render/meshes/lifts/Station';
import { buildTowerGeometry } from '../../src/render/meshes/lifts/Tower';
import { buildAllGearGeometries, buildGearGeometry, visibleTriangles } from '../../src/render/meshes/Figures';
import * as A from '../../src/render/meshes/Animals';
import { buildBus, buildCar, buildPlane, buildTrain } from '../../src/render/meshes/VehicleModels';
import { createSnowcatGeometry } from '../../src/render/meshes/Snowcat';
import { rockGeometry } from '../../src/render/props/Rocks';
import * as T from '../../src/render/props/Trees';

const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const out: Record<string, Record<string, number>> = {};
const put = (cat: string, k: string, v: number): void => { (out[cat] ??= {})[k] = Math.round(v); };
for (const d of Object.values(BUILDINGS)) {
  const p = buildParts(d.id, d.w, d.h) as unknown as Record<string, THREE.BufferGeometry | undefined>;
  let t = 0; for (const v of Object.values(p)) if (v && (v as THREE.BufferGeometry).getAttribute) t += tris(v as THREE.BufferGeometry);
  put('buildings', d.id, t);
}
for (const k of LIFT_KIND_IDS) {
  put('lift-station', k, tris(buildStationParts(k, false).geometry) + tris(buildStationParts(k, true).geometry));
  put('lift-carrier', k, tris(buildCarrierGeometry(k)));
  put('lift-carrier-near', k, tris(buildCarrierGeometry(k, true)));
  put('lift-tower3', k, tris(buildTowerGeometry(3, k)));
}
const species: Array<[string, (f: boolean) => THREE.BufferGeometry]> = [['conifer', T.conifer], ['deciduous', T.deciduous], ['pine', T.pine], ['larch', T.larch], ['birch', T.birch], ['oak', T.oak], ['shrub', T.shrub], ['snag', T.snag]];
for (const [n, f] of species) { put('trees-full', n, tris(f(true))); put('trees-low', n, tris(f(false))); }
put('rocks', 'rock', tris(rockGeometry()));
for (let g = 0; g < buildAllGearGeometries().length; g++) { const geo = buildGearGeometry(g); put('guest-gear-visible-max', String(g), Math.max(...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((s) => visibleTriangles(geo, s, true)))); put('guest-gear-near-all', String(g), tris(buildGearGeometry(g, true))); }
for (const n of ['Cow', 'Sheep', 'Goat', 'Deer', 'Ibex', 'Chamois', 'Marmot', 'Fox', 'Eagle', 'Bear', 'Wolf', 'Rabbit', 'Donkey']) { const f = (A as unknown as Record<string, () => THREE.BufferGeometry>)[`create${n}Geometry`]; if (f) put('animals', n, tris(f())); }
for (const [n, m] of [['hatchback', buildCar(0, 0xc93a32, 0)], ['sedan', buildCar(1, 0xc93a32, 0)], ['suv', buildCar(2, 0xc93a32, 0)], ['van', buildCar(3, 0xc93a32, 0)], ['sports', buildCar(4, 0xc93a32, 0)], ['bus', buildBus(false, 0xe8b93a)], ['minibus', buildBus(true, 0xe8b93a)], ['train', buildTrain()], ['plane', buildPlane()]] as const) put('vehicles', n, tris(m.body) + tris(m.lights) + (m.prop ? tris(m.prop) : 0));
put('vehicles', 'snowcat', tris(createSnowcatGeometry()));
const sum = (o: Record<string, number>): number => Object.values(o).reduce((a, b) => a + b, 0);
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
else for (const [c, o] of Object.entries(out)) { const v = Object.values(o); console.log(`${c.padEnd(26)} n=${String(v.length).padStart(3)} total=${String(sum(o)).padStart(7)} mean=${String(Math.round(sum(o) / v.length)).padStart(6)} max=${Math.max(...v)} (${Object.entries(o).sort((a, b) => b[1] - a[1])[0]![0]}) min=${Math.min(...v)}`); }
