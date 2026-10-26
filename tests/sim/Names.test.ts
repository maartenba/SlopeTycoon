import { describe, expect, it } from 'vitest';
import { Names, altitudeZone, compassOf, type NameSources } from '../../src/sim/Names';
import { formatEvent } from '../../src/ui/newsFormat';

const N = 64;
function sources(): NameSources {
  const pisteTiles = [] as number[];
  for (let y = 10; y < 20; y++) pisteTiles.push(y * N + 30);
  const piste = { tiles: pisteTiles, difficulty: 2 };
  return {
    size: N,
    pisteAt: (x, y) => (x === 30 && y >= 10 && y < 20 ? piste : null),
    lifts: () => [{ id: 7, kindName: 'Chairlift', tiles: [25 * N + 40, 26 * N + 40] }],
    buildings: () => [{ id: 3, typeName: 'Mountain Hut', x: 50, y: 50, w: 2, h: 2 }],
    altFrac: (_x, y) => 1 - y / N,
  };
}

describe('Names', () => {
  it('auto-names pistes by difficulty and keeps the name when the piste grows', () => {
    const src = sources();
    const n = new Names(src);
    const p = src.pisteAt(30, 12)!;
    expect(n.pisteName(p)).toBe('Blue Run 1');
    expect(n.pisteName({ tiles: [...p.tiles, 20 * N + 30], difficulty: 2 })).toBe('Blue Run 1');
    expect(n.pisteName({ tiles: [60 * N + 5], difficulty: 3 })).toBe('Red Run 1');
    expect(n.pisteName({ tiles: [61 * N + 9], difficulty: 2 })).toBe('Blue Run 2');
  });
  it('describes the nearest named thing within R tiles, else compass + altitude zone', () => {
    const n = new Names(sources());
    expect(n.describeLocation(30, 12).on).toBe('on Blue Run 1');
    expect(n.describeLocation(32, 12).near).toBe('near Blue Run 1');
    expect(n.describeLocation(41, 25).name).toBe('Chairlift 1');
    const hut = n.describeLocation(52, 52);
    expect(hut.kind).toBe('building'); expect(hut.name).toBe('Mountain Hut 1'); expect(hut.near).toBe('near Mountain Hut 1');
    const area = n.describeLocation(5, 5);
    expect(area.kind).toBe('area'); expect(area.name).toBe('the north-western summit ridge'); expect(area.on).toMatch(/^in the /);
    expect(area.name).not.toMatch(/\d+, \d+/);
  });
  it('renames lifts and buildings', () => {
    const n = new Names(sources());
    n.rename('lift', 7, 'Sunrise Express');
    expect(n.liftName(7)).toBe('Sunrise Express');
    expect(n.describeLocation(41, 25).name).toBe('Sunrise Express');
    n.rename('lift', 7, '');
    expect(n.liftName(7)).toBe('Chairlift 1');
  });
  it('helpers', () => {
    expect(altitudeZone(0.05)).toBe('valley floor'); expect(altitudeZone(0.75)).toBe('upper bowl');
    expect(compassOf(32, 32, 64)).toBe(''); expect(compassOf(32, 2, 64)).toBe('northern'); expect(compassOf(62, 32, 64)).toBe('eastern');
  });
  it('avalanche / wildlife / closure messages use names, never coordinates', () => {
    const n = new Names(sources());
    const where = (x: number, y: number) => { const p = n.describeLocation(x, y); return { name: p.name, on: p.on, near: p.near }; };
    expect(formatEvent('incident:avalanche', { x: 30, y: 12, severity: 1, buried: 2 }, { where })!.text).toBe('Avalanche on Blue Run 1 – 2 skiers trapped in the snow');
    expect(formatEvent('incident:wildlife', { x: 5, y: 5, kind: 'bear', outcome: 'sighting' }, { where })!.text).toBe('Bear spotted near the north-western summit ridge');
    expect(formatEvent('incident:created', { id: 1, kind: 'injury', severity: 2, x: 52, y: 52, guestId: 1 }, { where })!.text).toBe('Critical incident: guest injured at Mountain Hut 1');
    for (const t of [formatEvent('incident:avalanche', { x: 30, y: 12, severity: 1 }, { where })!.text]) expect(t).not.toMatch(/\(\d/);
  });
});
