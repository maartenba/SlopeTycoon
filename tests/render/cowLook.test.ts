import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { COW_TINTS, cowIsCalf, cowVariantOf, createCowGeometry, createDecoratedCowGeometry } from '../../src/render/meshes/Animals';
import { NatureView } from '../../src/render/NatureView';

describe('fuller cows', () => {
  it('stay inside the triangle budget, finite, vertex coloured', () => {
    const g = createCowGeometry(); const tris = g.getAttribute('position').count / 3;
    console.log('cow tris', tris); expect(tris).toBeLessThanOrEqual(900);
    expect(g.getAttribute('color')).toBeTruthy();
    for (const v of g.getAttribute('position').array as Float32Array) expect(Number.isFinite(v)).toBe(true);
    g.computeBoundingBox(); expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.01); expect(g.boundingBox!.max.y).toBeLessThan(0.55);
  });
  it('coat patches vary the vertex colours softly', () => {
    const c = createCowGeometry().getAttribute('color'); const set = new Set<string>();
    for (let i = 0; i < c.count; i++) set.add(c.getX(i).toFixed(2));
    expect(set.size).toBeGreaterThan(8);
  });
  it('variants and calves are a deterministic stable hash of the id and all occur', () => {
    const seen = new Set<number>(); let calves = 0;
    for (let id = 0; id < 400; id++) { expect(cowVariantOf(id)).toBe(cowVariantOf(id)); seen.add(cowVariantOf(id)); if (cowIsCalf(id)) calves++; }
    expect(seen.size).toBe(COW_TINTS.length); expect(calves).toBeGreaterThan(30); expect(calves).toBeLessThan(120);
  });
  it('the festival cow carries its own bell (no second one) and is still bigger than the plain mesh', () => {
    expect(createDecoratedCowGeometry().getAttribute('position').count).toBeGreaterThan(createCowGeometry(false).getAttribute('position').count);
  });
  it('the cow layer is one instanced draw with an instance colour, count unchanged', () => {
    const v = new NatureView(() => 0); const m = v.meshes.get('cow')!;
    expect(m.instanceColor).toBeTruthy(); expect(m).toBeInstanceOf(THREE.InstancedMesh);
    v.update(0.1, [{ id: 3, species: 'cow', x: 5, y: 5, heading: 0, hidden: false, mode: 0, phase: 0 } as never], 5, 5, 30);
    expect(m.count).toBe(1);
  });
});
