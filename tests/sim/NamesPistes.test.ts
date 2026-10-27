import { describe, expect, it } from 'vitest';
import { Names, cleanName, MAX_NAME_LENGTH, type NameSources, type PisteInfo } from '../../src/sim/Names';
import { formatEvent } from '../../src/ui/newsFormat';
import { makeResort } from '../game/harness';
import { Layer } from '../../src/world/Networks';

const N = 64;
const col = (x: number, y0: number, y1: number): number[] => { const t: number[] = []; for (let y = y0; y < y1; y++) t.push(y * N + x); return t; };

/** Mutable piste world: tests swap the component list and bump the version like Networks does. */
function world() {
  let comps: PisteInfo[] = [];
  let v = 0;
  const src: NameSources = {
    size: N,
    pisteAt: (x, y) => comps.find((c) => c.tiles.includes(y * N + x)) ?? null,
    pistes: () => comps,
    pisteVersion: () => v,
    lifts: () => [{ id: 7, kindName: 'Chairlift', tiles: [25 * N + 40] }],
    buildings: () => [],
    altFrac: () => 0.5,
  };
  return { src, set(c: PisteInfo[]) { comps = c; v++; } };
}

describe('piste identity + names', () => {
  it('custom piste names persist while the piste grows and appear in describeLocation', () => {
    const w = world(); const n = new Names(w.src);
    w.set([{ tiles: col(30, 10, 20), difficulty: 2 }]);
    n.renamePiste(w.src.pisteAt(30, 12)!, '  The   Eagle ');
    expect(n.pisteName(w.src.pisteAt(30, 12)!)).toBe('The Eagle');
    w.set([{ tiles: col(30, 10, 26), difficulty: 2 }]);
    expect(n.pisteName(w.src.pisteAt(30, 12)!)).toBe('The Eagle');
    expect(n.describeLocation(30, 12).on).toBe('on The Eagle');
    n.renamePiste(w.src.pisteAt(30, 12)!, '');
    expect(n.pisteName(w.src.pisteAt(30, 12)!)).toBe('Blue Run 1');
  });

  it('merge keeps the name of the biggest former piste; the smaller identity is retired', () => {
    const w = world(); const n = new Names(w.src);
    w.set([{ tiles: col(30, 10, 30), difficulty: 2 }, { tiles: col(34, 10, 14), difficulty: 2 }]);
    const big = n.pisteId(w.src.pisteAt(30, 12)!), small = n.pisteId(w.src.pisteAt(34, 12)!);
    n.renamePiste(w.src.pisteAt(30, 12)!, 'Big One'); n.renamePiste(w.src.pisteAt(34, 12)!, 'Small One');
    w.set([{ tiles: [...col(30, 10, 30), ...col(34, 10, 14), ...col(32, 10, 11)], difficulty: 2 }]);
    const m = w.src.pisteAt(34, 12)!;
    expect(n.pisteId(m)).toBe(big);
    expect(n.pisteName(m)).toBe('Big One');
    expect(n.serialize().custom.some(([, v]) => v === 'Small One')).toBe(false);
    expect(small).not.toBe(big);
  });

  it('split keeps the name for the largest part; the other part gets a derived name X (2)', () => {
    const w = world(); const n = new Names(w.src);
    w.set([{ tiles: [...col(30, 10, 30), ...col(31, 10, 16)], difficulty: 3 }]);
    n.renamePiste(w.src.pisteAt(30, 12)!, 'Diablo');
    const id = n.pisteId(w.src.pisteAt(30, 12)!);
    w.set([{ tiles: col(30, 10, 30), difficulty: 3 }, { tiles: col(31, 10, 16), difficulty: 3 }]);
    const a = w.src.pisteAt(30, 12)!, b = w.src.pisteAt(31, 12)!;
    expect(n.pisteName(a)).toBe('Diablo');
    expect(n.pisteId(a)).toBe(id);
    expect(n.pisteName(b)).toBe('Diablo (2)');
    expect(n.pisteId(b)).not.toBe(id);
  });

  it('serialises / loads names (custom, lifts, buildings, piste identities)', () => {
    const w = world(); const a = new Names(w.src);
    w.set([{ tiles: col(30, 10, 20), difficulty: 4 }]);
    a.renamePiste(w.src.pisteAt(30, 12)!, 'Black Diamond');
    a.rename('lift', 7, 'Sunrise Express');
    expect(a.liftName(7)).toBe('Sunrise Express');
    const data = JSON.parse(JSON.stringify(a.serialize()));
    const b = new Names(w.src);
    b.load(data);
    expect(b.pisteName(w.src.pisteAt(30, 12)!)).toBe('Black Diamond');
    expect(b.liftName(7)).toBe('Sunrise Express');
    // identity numbering continues, no id reuse
    w.set([{ tiles: col(30, 10, 20), difficulty: 4 }, { tiles: col(50, 10, 20), difficulty: 4 }]);
    expect(b.pisteName(w.src.pisteAt(50, 12)!)).toBe('Black Run 2');
  });

  it('cleanName clamps and collapses whitespace', () => {
    expect(cleanName('  a   b ')).toBe('a b');
    expect(cleanName('x'.repeat(60)).length).toBe(MAX_NAME_LENGTH);
    expect(cleanName('   ')).toBe('');
  });

  it('news formatter uses custom names', () => {
    const w = world(); const n = new Names(w.src);
    w.set([{ tiles: col(30, 10, 20), difficulty: 2 }]);
    n.renamePiste(w.src.pisteAt(30, 12)!, 'Eagle Run');
    const where = (x: number, y: number) => { const p = n.describeLocation(x, y); return { name: p.name, on: p.on, near: p.near }; };
    expect(formatEvent('incident:avalanche', { x: 30, y: 12, severity: 1, buried: 1 }, { where })!.text).toContain('Eagle Run');
  });
});

describe('createSim piste report + rename', () => {
  it('reports the piste under a tile and renames it through the sim', () => {
    const { sim } = makeResort(64, 5);
    const g = sim.grid, lay = sim.networks.layers;
    let tile = -1;
    for (let i = 0; i < lay.length; i++) if (lay[i]! & Layer.Ski) { tile = i; break; }
    expect(tile).toBeGreaterThanOrEqual(0);
    const x = tile % g.size, y = (tile / g.size) | 0;
    const r = sim.pisteReportAt(x, y)!;
    expect(r.name).toMatch(/Run \d+$/);
    expect(r.lengthM).toBeGreaterThan(0);
    expect(['Green', 'Blue', 'Red', 'Black']).toContain(r.difficultyLabel);
    expect(sim.renamePisteAt(x, y, 'Zig Zag')).toBe(true);
    const r2 = sim.pisteReportAt(x, y)!;
    expect(r2.name).toBe('Zig Zag');
    expect(r2.autoName).toBe(r.autoName);
    expect(r2.id).toBe(r.id);
    expect(sim.pisteReportAt(0, 0)).toBeNull();
  });
});
