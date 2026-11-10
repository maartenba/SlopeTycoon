/* eslint-disable @typescript-eslint/no-explicit-any */
/** Scan the jump plane's flight against every building of a saved promo town: `npx vite-node scripts/promo/planeScan.ts [town]` (default summer). Prints frames inside a roof (z <= roof top + 0.2 within the footprint + plane half-span). */
import { readFileSync } from 'node:fs';
import { decodeSave } from '../../src/persist/Serializer';
import { BUILDING_HEIGHT } from '../../src/config/buildingHeights';
import { planePose, choosePlanePlan, SKY_CYCLE, type SkyObstacle } from '../../src/render/SkyActivity';

export function oldPose(u: number, cx: number, cy: number, ax: number) { // the pre-fix path (kept for the before count)
  const len = 3, R = 5, TAU = Math.PI * 2, J = 0.55; let x: number, y: number, z: number;
  if (u < 0.12) { const t = u / 0.12; x = cx + Math.cos(ax) * (-len + 2 * len * t); y = cy + Math.sin(ax) * (-len + 2 * len * t); z = t > 0.7 ? (t - 0.7) * 1.2 : 0.02; return { x, y, z }; }
  if (u < 0.88) { const t = (u - 0.12) / 0.76, ang = ax + t * TAU * 1.6; x = cx + Math.cos(ang) * R + Math.cos(ax) * len; y = cy + Math.sin(ang) * R + Math.sin(ax) * len; const k = (J - 0.12) / 0.76, climb = Math.min(1, t / k), down = Math.max(0, (t - k) / (1 - k)); z = 0.35 + 5.15 * climb * (1 - 0.8 * down); return { x, y, z }; }
  const t = (u - 0.88) / 0.12; x = cx + Math.cos(ax) * (len * 2 - 5.5 * t - 0.5); y = cy + Math.sin(ax) * (len * 2 - 5.5 * t - 0.5); z = 0.35 * (1 - t) + 0.02; return { x, y, z };
}
const town = process.argv[2] ?? 'summer';
const env = (await decodeSave(new Uint8Array(readFileSync(`.weave/promo/towns/${town}.slope`)))).envelope;
const bl: any[] = (env.modules as any).buildings.data.items;
const strip = bl.find((b) => b.type === 'grassStrip');
const obst: SkyObstacle[] = bl.filter((b) => !['grassStrip', 'landingField', 'launchRamp'].includes(b.type)).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, top: BUILDING_HEIGHT[b.type] ?? 2.5 }));
const cx = strip.x + strip.w / 2, cy = strip.y + strip.h / 2, ax = strip.w >= strip.h ? 0 : Math.PI / 2;
console.log('strip', strip.x, strip.y, strip.w, strip.h, 'near buildings:', obst.filter((o) => Math.hypot(o.x - cx, o.y - cy) < 16).map((o) => `${o.x},${o.y} ${o.w}x${o.h} top ${o.top}`).join(' | '));
const N = 2000, hit = (x: number, y: number, z: number, m: number) => obst.filter((o) => x > o.x - m && x < o.x + o.w + m && y > o.y - m && y < o.y + o.h + m && z < o.top + 0.2);
const scan = (f: (u: number) => { x: number; y: number; z: number }) => { let n = 0, first = -1; const types = new Set<string>(); for (let i = 0; i < N; i++) { const u = i / N, p = f(u), h = hit(p.x, p.y, p.z, 0.5); if (h.length) { n++; if (first < 0) first = u; h.forEach((o) => types.add(`${o.x},${o.y}:${o.top}`)); } } return `${n}/${N} frames inside a roof (first u=${first < 0 ? '-' : first.toFixed(3)}) ${[...types].join(' ')}`; };
console.log('OLD', scan((u) => oldPose(u, cx, cy, ax)));
const plan = choosePlanePlan(cx, cy, ax, obst);
console.log('NEW plan', JSON.stringify(plan), 'nominal', scan((u) => planePose(u, cx, cy, ax, undefined, plan)), '| default plan nominal', scan((u) => planePose(u, cx, cy, ax)), '| with floor', scan((u) => planePose(u, cx, cy, ax, undefined, plan, obst)));
void SKY_CYCLE;
import { planeMargin } from '../../src/render/SkyActivity';
console.log('margins', ([{ dir: 1, turn: 1 }, { dir: -1, turn: 1 }, { dir: 1, turn: -1 }, { dir: -1, turn: -1 }] as const).map((p) => `${p.dir}/${p.turn}: ${planeMargin(p, cx, cy, ax, obst).toFixed(2)}`).join('  '));
// the s08a-plane shot (promo/scenes.json: cue u 0.06, rate 4 = 6.4 ticks / s, 30 fps, 4 s): the plane's phase per film frame, checked with the SAME test as above
{
  const fr = (f: (u: number) => { x: number; y: number; z: number }) => { let n = 0; for (let i = 0; i < 120; i++) { const p = f(0.06 + (i * 6.4 / 30) / SKY_CYCLE); if (hit(p.x, p.y, p.z, 0.5).length) n++; } return n; };
  console.log(`s08a shot (120 frames): OLD ${fr((u) => oldPose(u, cx, cy, ax))} frames in a roof, NEW ${fr((u) => planePose(u, cx, cy, ax, undefined, plan))} (nominal, no floor)`);
}
