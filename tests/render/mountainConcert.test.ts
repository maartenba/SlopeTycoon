import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeResort } from '../game/harness';
import { placeDressing, propCount, stagePoint, STAGE, type DressingWorld } from '../../src/render/festival/placeDressing';
import { dressingWorldOf } from '../../src/render/festival/dressingWorld';
import { FestivalDressing, FESTIVAL_DRAW_CALLS } from '../../src/render/festival/FestivalDressing';
import { Fireworks } from '../../src/render/fx/Fireworks';
import { Particles } from '../../src/render/fx/Particles';
import { FESTIVAL_BY_ID } from '../../src/config/festivals';
import { OccFlag } from '../../src/world/Occupancy';

/** Task 41: Mountain Concert set dressing (docs/festivals.md "Mountain Concert"). */
const N = 48;
/** Open 48x48 ground, a road along y=10, a lake, a building; the anchors are passed per test. */
function synth(over: Partial<DressingWorld> = {}): DressingWorld {
  return {
    size: N, kind: (i) => ((i / N) | 0) === 10 && i % N >= 3 && i % N <= 44 ? 2 : 0,
    isWater: (i) => { const x = i % N, y = (i / N) | 0; return x >= 30 && x <= 34 && y >= 28 && y <= 32; },
    isBuilding: (i) => { const x = i % N, y = (i / N) | 0; return x >= 20 && x <= 22 && y >= 24 && y <= 26; },
    station: null, village: null, lodge: null,
    ...over,
  };
}
const ground = (): number => 0;
const ids = ['mountainConcertSummer', 'mountainConcertWinter'] as const;

describe('placeDressing: concert stage anchors', () => {
  it('scores mid-station plaza > viewpoint > gondola top > base station / village / lodge', () => {
    const mid = { x: 12.5, y: 30.5 }, view = { x: 20.5, y: 40.5 }, top = { x: 40.5, y: 38.5 }, village = { x: 10.5, y: 20.5 };
    for (const id of ids) {
      expect(placeDressing(synth({ liftTops: [top] }), id, 1)!.source).toBe('liftTop');
      expect(placeDressing(synth({ viewpoints: [view] }), id, 1)!.source).toBe('viewpoint');
      expect(placeDressing(synth({ midStations: [mid] }), id, 1)!.source).toBe('midStation');
      expect(placeDressing(synth({ liftTops: [top], viewpoints: [view] }), id, 1)!.source).toBe('viewpoint');
      expect(placeDressing(synth({ liftTops: [top], viewpoints: [view], midStations: [mid] }), id, 1)!.source).toBe('midStation');
      expect(placeDressing(synth({ village }), id, 1)!.source).toBe('village');
      expect(placeDressing(synth({ station: { x: 8.5, y: 8.5 }, village }), id, 1)!.source).toBe('station');
      expect(placeDressing(synth({ lodge: { x: 14.5, y: 16.5 } }), id, 1)!.source).toBe('lodge');
    }
  });

  it('the stage stands within reach of its anchor, on free tiles: no water, building, road or tile already taken; the crowd lies in front', () => {
    const top = { x: 24.5, y: 26.5 }; // right beside the building and the lake
    const w = synth({ liftTops: [top] });
    const l = placeDressing(w, 'mountainConcertSummer', 3)!, st = l.stage!;
    expect(st).toBeTruthy(); expect(l.source).toBe('liftTop');
    expect(Math.hypot(st.x - top.x, st.z - top.y)).toBeLessThanOrEqual(STAGE.radius + 0.01);
    expect(l.tiles.length).toBe(STAGE.width * (STAGE.stageDepth + STAGE.crowdDepth));
    for (const i of l.tiles) { expect(w.isWater(i)).toBe(false); expect(w.isBuilding(i)).toBe(false); expect(w.kind(i)).toBe(0); }
    // crowd members stand in the crowd half (local z 1..4)
    for (const c of st.crowd) {
      const dx = c.x - st.x, dz = c.z - st.z, v = dx * Math.sin(st.ry) + dz * Math.cos(st.ry);
      expect(v).toBeGreaterThan(0.9); expect(v).toBeLessThan(4.1);
    }
    expect(st.crowd.length).toBeGreaterThanOrEqual(12);
    // a second concert never overlaps the first
    const taken = new Set(l.tiles), l2 = placeDressing(w, 'mountainConcertWinter', 3, taken)!;
    for (const i of l2.tiles) expect(taken.has(i)).toBe(false);
    // stagePoint matches the yaw convention (+z front)
    const p = stagePoint(10, 10, Math.PI / 2, 0, 2); expect(p.x).toBeCloseTo(12); expect(p.y).toBeCloseTo(10);
  });

  it('is deterministic; null when no anchor has a free site; no network / building / water props of the normal kind', () => {
    const a = placeDressing(synth({ liftTops: [{ x: 24.5, y: 26.5 }] }), 'mountainConcertWinter', 9), b = placeDressing(synth({ liftTops: [{ x: 24.5, y: 26.5 }] }), 'mountainConcertWinter', 9);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(placeDressing(synth(), 'mountainConcertWinter', 1)).toBeNull(); // no anchors
    expect(placeDressing(synth({ liftTops: [{ x: 24.5, y: 26.5 }], isBuilding: () => true }), 'mountainConcertSummer', 1)).toBeNull(); // nowhere to stand
    expect(placeDressing(synth({ liftTops: [{ x: 24.5, y: 26.5 }], steep: () => true }), 'mountainConcertSummer', 1)).toBeNull(); // too steep
    const l = a!; expect(l.chain.length + l.poles.length + l.stalls.length).toBe(0);
    expect(propCount(l)).toBe(1 + l.stage!.crowd.length);
  });
});

describe('FestivalDressing: the concert stage (instanced, view only)', () => {
  const mk = (w: () => DressingWorld = () => synth({ liftTops: [{ x: 24.5, y: 26.5 }] })): FestivalDressing => new FestivalDressing(ground, w, 11);
  const callers = (d: FestivalDressing): number => {
    let n = 0;
    d.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && o.visible && (m.geometry.getAttribute('position')?.count ?? 0) > 0 && !((m as THREE.InstancedMesh).isInstancedMesh && (m as THREE.InstancedMesh).count === 0)) n++; });
    return n;
  };

  it.each(ids)('%s: <= budget + 3 draw calls, the banner carries the name, no point lights, ZERO props after the event', (id) => {
    const d = mk();
    expect(d.propCount()).toBe(0); expect(callers(d)).toBe(0);
    expect(d.setEvents([{ id, start: 10 }])).toBe(true);
    d.update(0.1, 21);
    expect(d.propCount()).toBeGreaterThan(12);
    expect(callers(d)).toBeLessThanOrEqual(3 + 3);
    expect(callers(d)).toBeLessThanOrEqual(FESTIVAL_DRAW_CALLS);
    expect(d.labels).toContain(FESTIVAL_BY_ID[id].name);
    expect(d.banners.visible).toBe(true); expect(d.lights.visible).toBe(true);
    let pointLights = 0; d.group.traverse((o) => { if ((o as THREE.Light).isLight) pointLights++; });
    expect(pointLights).toBe(0);
    d.setEvents([]); d.update(0.1, 21);
    expect(d.propCount()).toBe(0); expect(callers(d)).toBe(0);
    expect(d.solid.geometry.getAttribute('position')).toBeUndefined(); expect(d.lights.geometry.getAttribute('position')).toBeUndefined(); expect(d.lights.visible).toBe(false);
  });

  it('the lights are additive, translucent and depth-write free; they brighten at night and stand still with reduced motion', () => {
    const d = mk(); d.setEvents([{ id: 'mountainConcertSummer', start: 1 }]);
    const mat = d.lights.material as THREE.MeshBasicMaterial;
    expect(mat.blending).toBe(THREE.AdditiveBlending); expect(mat.transparent).toBe(true); expect(mat.depthWrite).toBe(false);
    d.setLight(0, false); const day = mat.opacity; d.setLight(1, false); const night = mat.opacity;
    expect(night).toBeGreaterThan(day * 3); expect(night).toBeLessThanOrEqual(0.7);
    const u = (d as unknown as { lightU: { uMotion: { value: number }; uTime: { value: number } } }).lightU;
    expect(u.uMotion.value).toBe(1);
    d.update(1, 21); const t1 = u.uTime.value; d.update(1, 21); expect(u.uTime.value).toBeGreaterThan(t1);
    d.setLight(1, true); expect(u.uMotion.value).toBe(0);
    // every cone vertex carries a pivot + sway attribute, glows have sway 0
    const g = d.lights.geometry; for (const a of ['aBase', 'aAxis', 'aPhase', 'aSway']) expect(g.getAttribute(a), a).toBeTruthy();
  });

  it('edition looks: summer = bunting + flags (pennants), winter = a snow roof and heater / lamp glows (more light vertices)', () => {
    const tri = (id: (typeof ids)[number]): { solid: number; lights: number } => { const d = mk(); d.setEvents([{ id, start: 1 }]); return { solid: d.solid.geometry.getAttribute('position').count, lights: d.lights.geometry.getAttribute('position').count }; };
    const s = tri('mountainConcertSummer'), w = tri('mountainConcertWinter');
    expect(s.solid).toBeGreaterThan(1000); expect(w.solid).toBeGreaterThan(1000);
    expect(w.lights).toBeGreaterThan(s.lights); // + lamp bulbs and heaters
    expect(s.solid).not.toBe(w.solid);
  });

  it('alongside other festivals: still within the budget, same set does not rebuild', () => {
    const d = mk(() => synth({ liftTops: [{ x: 24.5, y: 26.5 }], station: { x: 8.5, y: 10.5 }, village: { x: 12.5, y: 10.5 } }));
    d.setEvents([{ id: 'musicFestival', start: 1 }, { id: 'mountainConcertSummer', start: 3 }]);
    d.update(0.1, 12);
    expect(callers(d)).toBeLessThanOrEqual(FESTIVAL_DRAW_CALLS);
    expect(d.layouts.map((l) => l.festival).sort()).toEqual(['mountainConcertSummer', 'musicFestival']);
    expect(d.setEvents([{ id: 'mountainConcertSummer', start: 3 }, { id: 'musicFestival', start: 1 }])).toBe(false);
  });

  it('a real sim: the adapter finds gondola tops, viewpoints and mid-stations; the dressing is view only (occupancy untouched)', () => {
    const { sim } = makeResort(64, 61, { startDay: 100 });
    sim.lifts.all()[0]!.kind = 'gondola6';
    const w = dressingWorldOf(sim), top = sim.lifts.all()[0]!.top;
    expect(w.liftTops).toEqual([{ x: top.x + 0.5, y: top.y + 0.5 }]);
    expect(w.viewpoints).toEqual([]); expect(w.midStations).toEqual([]);
    const before = Uint8Array.from(sim.grid.occupancy.flags), ver = sim.networks.version;
    const d = new FestivalDressing(ground, () => dressingWorldOf(sim), 5);
    d.setEvents([{ id: 'mountainConcertWinter', start: 1 }], 'k');
    expect(d.layouts.length).toBe(1); expect(d.layouts[0]!.stage).toBeTruthy();
    expect(Uint8Array.from(sim.grid.occupancy.flags)).toEqual(before); expect(sim.networks.version).toBe(ver);
    for (const i of d.layouts[0]!.tiles) expect((sim.grid.occupancy.flags[i]! & (OccFlag.Building | OccFlag.Lift)) === 0).toBe(true);
    d.setEvents([]); expect(d.propCount()).toBe(0);
  });
});

describe('fireworks: the summer concert keeps it to one modest shell, the winter edition has none', () => {
  it('config + a one-shell show', () => {
    expect(FESTIVAL_BY_ID.mountainConcertSummer.fireworks).toBe('finale'); expect(FESTIVAL_BY_ID.mountainConcertSummer.shells).toBe(1);
    expect(FESTIVAL_BY_ID.mountainConcertWinter.fireworks).toBe('none');
    const p = new Particles(256), f = new Fireworks(p), frame = { show: 'mountainConcertSummer@1:75', hour: 21, dark: 1, allowed: true, origin: { x: 5, y: 0, z: 5 }, shells: FESTIVAL_BY_ID.mountainConcertSummer.shells };
    for (let i = 0; i < 600; i++) f.update(0.1, frame);
    expect(f.shells).toBe(1);
    const g = new Fireworks(new Particles(256));
    for (let i = 0; i < 100; i++) g.update(0.1, { ...frame, allowed: false });
    expect(g.shells).toBe(0); // Feedback Off / reduced motion: nothing
  });
});
