import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeResort } from '../game/harness';
import { placeDressing, propCount, blackPisteLine, DRESSING, type DressingWorld } from '../../src/render/festival/placeDressing';
import { dressingWorldOf } from '../../src/render/festival/dressingWorld';
import { FestivalDressing, FESTIVAL_DRAW_CALLS } from '../../src/render/festival/FestivalDressing';
import { Procession, loopPose, loopLength, processionActive } from '../../src/render/festival/Procession';
import { Fireworks, fireworksAllowed, showMayStart } from '../../src/render/fx/Fireworks';
import { Particles } from '../../src/render/fx/Particles';
import { feedbackPolicy } from '../../src/render/fx/feedbackPolicy';
import { createDecoratedCowGeometry, createCowGeometry } from '../../src/render/meshes/Animals';
import { FESTIVALS, FESTIVAL_BY_ID } from '../../src/config/festivals';
import { isWaterType } from '../../src/world/Grid';

/** Synthetic world: a 40x40 map, a straight road along y=20 (x 5..35), a lake, a building. */
function synth(over: Partial<DressingWorld> = {}): DressingWorld {
  const N = 40;
  return {
    size: N, kind: (i) => ((i / N) | 0) === 20 && i % N >= 5 && i % N <= 35 ? 2 : 0,
    isWater: (i) => { const x = i % N, y = (i / N) | 0; return x >= 22 && x <= 26 && y >= 22 && y <= 26; },
    isBuilding: (i) => { const x = i % N, y = (i / N) | 0; return x >= 14 && x <= 16 && y >= 21 && y <= 23; },
    station: { x: 12.5, y: 20.5 }, village: { x: 20, y: 20 }, lodge: { x: 18, y: 18 },
    ...over,
  };
}
const ground = (): number => 0;

describe('placeDressing (pure)', () => {
  it('is deterministic: same world / festival / seed -> identical layout', () => {
    const a = placeDressing(synth(), 'christmasMarket', 7), b = placeDressing(synth(), 'christmasMarket', 7);
    expect(a).not.toBeNull();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(placeDressing(synth(), 'christmasMarket', 8))).not.toBe(JSON.stringify(a));
  });

  it('anchors within N tiles of the base station and strings bunting along the road', () => {
    const l = placeDressing(synth(), 'christmasMarket', 1)!;
    expect(l.source).toBe('station');
    expect(l.chain.length).toBeGreaterThanOrEqual(3);
    const near = Math.min(...l.chain.map((c) => Math.hypot(c.x + 0.5 - 12.5, c.y + 0.5 - 20.5)));
    expect(near).toBeLessThanOrEqual(DRESSING.anchorRadius);
    expect(l.chain.every((c) => c.y === 20)).toBe(true);
    expect(l.strings.length).toBeGreaterThan(0);
    const def = FESTIVAL_BY_ID.christmasMarket.dressing!;
    expect(l.chain.length).toBeLessThanOrEqual(def.bunting[1]);
    expect(l.stalls.length).toBeGreaterThanOrEqual(def.stalls[0]);
    expect(l.stalls.length).toBeLessThanOrEqual(def.stalls[1]);
    expect(l.banners.length).toBeGreaterThanOrEqual(1);
    expect(l.poles.filter((p) => p.flag >= 0).length).toBeGreaterThanOrEqual(def.flags[0] - 1);
  });

  it('places nothing on water or buildings (poles, stalls, banners, stands)', () => {
    const w = synth();
    for (const f of FESTIVALS.filter((d) => d.dressing)) {
      const l = placeDressing(w, f.id, 3);
      if (!l) continue;
      const pts = [...l.poles, ...l.stalls, ...l.banners, ...(l.grandstand ? [l.grandstand] : []), ...(l.finish ? [l.finish] : [])];
      for (const p of pts) { const i = Math.floor(p.z) * w.size + Math.floor(p.x); expect(w.isWater(i) || w.isBuilding(i)).toBe(false); }
    }
  });

  it('falls back to the village, then the lodge, when the station has no road nearby; none at all -> null', () => {
    const far = placeDressing(synth({ station: { x: 3, y: 3 } }), 'carnival', 2)!;
    expect(far.source).toBe('village');
    const lodgeOnly = placeDressing(synth({ station: null, village: null }), 'carnival', 2)!;
    expect(lodgeOnly.source).toBe('lodge');
    expect(placeDressing(synth({ station: null, village: null, lodge: null }), 'carnival', 2)).toBeNull();
    expect(placeDressing(synth(), 'critic', 2)).toBeNull(); // no dressing spec
  });

  it('no road near: a plaza row of free ground carries the bunting', () => {
    const l = placeDressing(synth({ kind: () => 0 }), 'musicFestival', 4)!;
    expect(l.chain.length).toBeGreaterThanOrEqual(3);
  });

  it('later festivals avoid the tiles an earlier one took', () => {
    const a = placeDressing(synth(), 'christmasMarket', 1)!, taken = new Set(a.tiles);
    const b = placeDressing(synth(), 'carnival', 1, taken)!;
    for (const s of b.stalls) expect(taken.has(Math.floor(s.z) * 40 + Math.floor(s.x))).toBe(false);
  });

  it('World Cup: grandstand + finish at the foot of the black piste, racers on its line', () => {
    const isBlack = (i: number): boolean => i % 40 === 30 && ((i / 40) | 0) >= 5 && ((i / 40) | 0) <= 15;
    const line = blackPisteLine(isBlack, (i) => 100 - ((i / 40) | 0), 40);
    expect(line.length).toBe(11);
    expect(line[0]!.y).toBe(5); expect(line.at(-1)!.y).toBe(15);
    const l = placeDressing(synth({ finish: line.at(-1)!, racerLine: line }), 'worldCup', 5)!;
    expect(l.finish).not.toBeNull(); expect(l.grandstand).not.toBeNull();
    expect(l.loop.length).toBe(line.length); expect(l.figures).toBeGreaterThan(0);
  });
});

describe('FestivalDressing (instanced, view only)', () => {
  const mk = (): FestivalDressing => new FestivalDressing(ground, () => synth(), 11);
  const callers = (d: FestivalDressing): number => {
    let n = 0;
    d.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && o.visible && (m.geometry.getAttribute('position')?.count ?? 0) > 0 && !((m as THREE.InstancedMesh).isInstancedMesh && (m as THREE.InstancedMesh).count === 0)) n++; });
    return n;
  };

  it('dresses a running festival with <= 3 draw calls and leaves ZERO props after it ends', () => {
    const d = mk();
    expect(d.propCount()).toBe(0); expect(callers(d)).toBe(0);
    expect(d.setEvents([{ id: 'carnival', start: 10 }])).toBe(true);
    expect(d.propCount()).toBeGreaterThan(20);
    d.update(0.1, 12);
    expect(callers(d)).toBeGreaterThan(1);
    expect(callers(d)).toBeLessThanOrEqual(FESTIVAL_DRAW_CALLS);
    expect(d.labels).toContain('Winter Carnival');
    d.setEvents([]);
    d.update(0.1, 12);
    expect(d.propCount()).toBe(0);
    expect(callers(d)).toBe(0);
    expect(d.solid.geometry.getAttribute('position')).toBeUndefined();
  });

  it('several festivals at once still use <= 3 draw calls; same set does not rebuild', () => {
    const d = mk();
    d.setEvents([{ id: 'christmasMarket', start: 1 }, { id: 'carnival', start: 3 }]);
    d.update(0.1, 12);
    expect(callers(d)).toBeLessThanOrEqual(FESTIVAL_DRAW_CALLS);
    expect(d.setEvents([{ id: 'carnival', start: 3 }, { id: 'christmasMarket', start: 1 }])).toBe(false);
  });

  it('the procession walks in daytime only (cows for Almabtrieb)', () => {
    const d = mk();
    d.setEvents([{ id: 'almabtrieb', start: 0 }]);
    d.update(0.1, 12); expect(d.procession.drawn).toBeGreaterThanOrEqual(6);
    d.update(0.1, 22); expect(d.procession.drawn).toBe(0);
    expect(processionActive(12)).toBe(true); expect(processionActive(3)).toBe(false);
  });

  it('World Cup dresses a grandstand, finish banner and racers', () => {
    const isBlack = (i: number): boolean => i % 40 === 30 && ((i / 40) | 0) >= 5 && ((i / 40) | 0) <= 15;
    const line = blackPisteLine(isBlack, (i) => 100 - ((i / 40) | 0), 40);
    const d = new FestivalDressing(ground, () => synth({ finish: line.at(-1)!, racerLine: line }), 3);
    d.setEvents([{ id: 'worldCup', start: 0 }]);
    d.update(0.1, 12);
    expect(d.labels).toContain('FINISH');
    expect(d.layouts[0]!.grandstand).not.toBeNull();
    expect(d.procession.drawn).toBeGreaterThan(0);
  });
});

describe('procession helpers', () => {
  it('loopPose walks a polyline (open and closed) and wraps', () => {
    const loop = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
    expect(loopLength(loop, false)).toBe(4); expect(loopLength(loop, true)).toBe(8);
    expect(loopPose(loop, 2, false).x).toBeCloseTo(2);
    expect(loopPose(loop, 6, true).x).toBeCloseTo(2); // coming back
    expect(loopPose(loop, 10, false).x).toBeCloseTo(2); // wraps
    expect(loopPose([], 1, true).x).toBe(0);
  });
  it('the decorated cow has more geometry than the plain cow (headdress + bell)', () => {
    expect(createDecoratedCowGeometry().getAttribute('position').count).toBeGreaterThan(createCowGeometry().getAttribute('position').count);
    const p = new Procession(ground); p.set('cow', [{ x: 0, y: 0 }, { x: 5, y: 0 }], 8); p.update(0.1, 12); expect(p.drawn).toBe(8);
    p.set(null, [], 0); p.update(0.1, 12); expect(p.drawn).toBe(0);
  });
});

describe('fireworks (restrained)', () => {
  const frame = { show: 'newYear@1:179', hour: 21, dark: 1, allowed: true, origin: { x: 5, y: 0, z: 5 } };
  it('is suppressed when Feedback intensity is Off (and with reduced motion); allowed in Subtle / Lively', () => {
    expect(fireworksAllowed(feedbackPolicy('off'), false)).toBe(false);
    expect(fireworksAllowed(feedbackPolicy('subtle'), false)).toBe(true);
    expect(fireworksAllowed(feedbackPolicy('lively'), false)).toBe(true);
    expect(fireworksAllowed(feedbackPolicy('subtle'), true)).toBe(false);
    const p = new Particles(256), f = new Fireworks(p);
    for (let i = 0; i < 400; i++) f.update(0.1, { ...frame, allowed: false });
    expect(f.shells).toBe(0); expect(p.count).toBe(0);
  });
  it('only at night (dark) and in the evening; one short modest show per day', () => {
    expect(showMayStart(21, 1)).toBe(true); expect(showMayStart(12, 0)).toBe(false); expect(showMayStart(21, 0.1)).toBe(false);
    const p = new Particles(256), f = new Fireworks(p);
    for (let i = 0; i < 200; i++) f.update(0.1, { ...frame, hour: 12, dark: 0 });
    expect(f.shells).toBe(0);
    let peak = 0;
    for (let i = 0; i < 600; i++) { f.update(0.1, frame); peak = Math.max(peak, p.count); }
    expect(f.shells).toBe(5); // short: a handful of shells, then no repeat the same day
    expect(peak).toBeLessThanOrEqual(120);
    expect(f.active).toBe(false);
  });
  it('no show when none is scheduled', () => {
    const f = new Fireworks(new Particles(64));
    for (let i = 0; i < 100; i++) f.update(0.1, { ...frame, show: null });
    expect(f.shells).toBe(0);
  });
});

describe('dressing a real starter resort (headless sim)', () => {
  it('lays out props near the base lift station on roads, never on water / buildings, and never touches Occupancy', () => {
    const { sim } = makeResort(64, 61, { startDay: 167 });
    const flagsBefore = sim.grid.occupancy.flags.slice(), nav = sim.navWorld.terrainVersion;
    const w = dressingWorldOf(sim);
    expect(w.station).not.toBeNull();
    for (const id of ['christmasMarket', 'carnival', 'almabtrieb'] as const) {
      const l = placeDressing(w, id, 5);
      expect(l, id).not.toBeNull();
      expect(propCount(l)).toBeGreaterThan(8);
      const first = l!.chain[0]!;
      expect(Math.hypot(first.x - w.station!.x, first.y - w.station!.y)).toBeLessThanOrEqual(DRESSING.anchorRadius + 6);
      for (const p of [...l!.poles, ...l!.stalls]) { const i = Math.floor(p.z) * w.size + Math.floor(p.x); expect(isWaterType(sim.grid.tileType[i]!) || (sim.grid.occupancy.flags[i] ?? 0) !== 0).toBe(false); }
    }
    expect(Array.from(sim.grid.occupancy.flags)).toEqual(Array.from(flagsBefore));
    expect(sim.navWorld.terrainVersion).toBe(nav);
  });
});
