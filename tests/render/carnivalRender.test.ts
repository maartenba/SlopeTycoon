/** M7.4 Carnival render side (docs/festivals.md "Carnival"): parade hours, masked figure, nothing on water / buildings, costumed guests, quiet brass layer. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { placeDressing, propCount, type DressingWorld } from '../../src/render/festival/placeDressing';
import { FestivalDressing, FESTIVAL_DRAW_CALLS } from '../../src/render/festival/FestivalDressing';
import { Procession, processionActive } from '../../src/render/festival/Procession';
import { createCostumeFigureGeometry } from '../../src/render/meshes/Animals';
import { appearanceOf, costumeLook, HairStyle } from '../../src/render/guestAppearance';
import { costumed } from '../../src/sim/events/Costume';
import { CARNIVAL } from '../../src/config/festivals';
import { AMB, LAYER_IDS, ambienceMix, type AmbienceState } from '../../src/audio/Ambience';

function synth(over: Partial<DressingWorld> = {}): DressingWorld {
  const N = 40;
  return {
    size: N, kind: (i) => ((i / N) | 0) === 20 && i % N >= 5 && i % N <= 35 ? 2 : 0,
    isWater: (i) => { const x = i % N, y = (i / N) | 0; return x >= 22 && x <= 26 && y >= 22 && y <= 26; },
    isBuilding: (i) => { const x = i % N, y = (i / N) | 0; return x >= 14 && x <= 16 && y >= 21 && y <= 23; },
    station: { x: 12.5, y: 20.5 }, village: { x: 20, y: 20 }, lodge: { x: 18, y: 18 }, ...over,
  };
}

describe('Carnival dressing', () => {
  it('a parade of masked revellers on the street, banners and streamers; nothing on water or buildings', () => {
    const w = synth(), l = placeDressing(w, 'carnival', 3)!;
    expect(l.figures).toBeGreaterThanOrEqual(6); expect(l.loop.length).toBeGreaterThan(5); expect(l.banners.length).toBeGreaterThanOrEqual(1);
    expect(propCount(l)).toBeGreaterThan(20);
    const bad = (x: number, z: number): boolean => { const i = Math.floor(z) * 40 + Math.floor(x); return w.isWater(i) || w.isBuilding(i); };
    for (const s of l.stalls) expect(bad(s.x, s.z)).toBe(false);
    for (const p of l.loop) expect(w.isWater(Math.floor(p.y) * 40 + Math.floor(p.x))).toBe(false);
  });
  it('the Carnival parade walks 10:00 - 16:00 (the others 09:00 - 17:00); the masked figure is one small merged mesh', () => {
    expect(processionActive(10, 'costume')).toBe(true); expect(processionActive(9.5, 'costume')).toBe(false); expect(processionActive(16, 'costume')).toBe(false); expect(processionActive(15.9, 'costume')).toBe(true);
    expect(processionActive(9.5, 'cow')).toBe(true); expect(processionActive(9.5)).toBe(true);
    expect(CARNIVAL.paradeFrom).toBe(10); expect(CARNIVAL.paradeTo).toBe(16);
    const g = createCostumeFigureGeometry();
    expect((g.index ? g.index.count : g.attributes.position!.count) / 3).toBeLessThan(2500);
    const p = new Procession(() => 0); p.set('costume', [{ x: 5, y: 20 }, { x: 30, y: 20 }], 12, 1);
    p.update(0.1, 9); expect(p.drawn).toBe(0); p.update(0.1, 12); expect(p.drawn).toBe(12);
  });
  it('a running Carnival stays within the festival draw-call budget and leaves no props', () => {
    const d = new FestivalDressing(() => 0, () => synth(), 11);
    d.setEvents([{ id: 'carnival', start: 10 }]); d.update(0.1, 12);
    let n = 0; d.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && o.visible && (m.geometry.getAttribute('position')?.count ?? 0) > 0 && !((m as THREE.InstancedMesh).isInstancedMesh && (m as THREE.InstancedMesh).count === 0)) n++; });
    expect(n).toBeLessThanOrEqual(FESTIVAL_DRAW_CALLS);
    d.setEvents([]); d.update(0.1, 12); expect(d.propCount()).toBe(0);
  });
});

describe('costumed guests', () => {
  it('a costumed guest wears a festive jacket and a wide-brim hat; the same id always looks the same; others are untouched', () => {
    const a = appearanceOf(42, 0, true), b = { ...appearanceOf(42, 0, true) };
    costumeLook(a, 42);
    expect(a.hairStyle).toBe(HairStyle.SunHat); expect([9, 10, 1, 2, 5]).toContain(a.top);
    expect(costumeLook({ ...b }, 42)).toEqual(a);
    const plain = appearanceOf(43, 0, true); expect(plain.hairStyle).toBe(appearanceOf(43, 0, true).hairStyle);
    let n = 0; for (let id = 1; id < 500; id++) if (costumed(id)) n++;
    expect(n).toBeGreaterThan(40); expect(n).toBeLessThan(150);
  });
});

describe('carnival ambience (quiet)', () => {
  const base: AmbienceState = { season: 'winter', hour: 12, zoom: 5, wet: 0, wind: 0.2, crowd: 0, lifts: 0, water: 0, snowcat: 0, heli: 0, buildings: 0, cows: 0, night: 0 } as never;
  it('a layer exists, is below every other bed but the sleigh bells, is silent far away, at night and with no parade', () => {
    expect(LAYER_IDS).toContain('carnival');
    expect(AMB.layerMax.carnival).toBeLessThan(0.04); expect(AMB.layerMax.carnival).toBeGreaterThan(AMB.layerMax.sleigh);
    const on = ambienceMix({ ...base, carnival: 1 } as never).carnival, off = ambienceMix(base).carnival;
    expect(on).toBeGreaterThan(0); expect(off).toBe(0);
    expect(ambienceMix({ ...base, carnival: 1, hour: 22 } as never).carnival).toBe(0);
    expect(ambienceMix({ ...base, carnival: 1, zoom: 400 } as never).carnival).toBeLessThan(on);
  });
});
