import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Particles, softDiscPixels } from '../../src/render/fx/Particles';

/** Phase 6 visual check: dust / snow puffs and confetti are soft discs, never flat untextured squares. */
describe('particle sprite', () => {
  it('the sprite is opaque in the middle and fully transparent in the corners and at the rim', () => {
    const n = 32, px = softDiscPixels(n), a = (x: number, y: number): number => px[(y * n + x) * 4 + 3]!;
    expect(a(15, 15)).toBe(255); expect(a(16, 16)).toBe(255);
    for (const [x, y] of [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]] as const) expect(a(x, y)).toBe(0);
    expect(a(0, 15)).toBeLessThan(10); expect(a(15, 0)).toBeLessThan(10);
    expect(a(2, 15)).toBeLessThan(a(8, 15)); // soft falloff towards the edge
    for (let i = 0; i < n * n; i++) expect(px[i * 4]).toBe(255); // white: instance colours tint it
  });
  it('the particle material carries the sprite as its map (alpha comes from the texture)', () => {
    const p = new Particles(8);
    const m = p.mesh.material as THREE.MeshBasicMaterial;
    expect(m.map).toBeTruthy();
    expect(m.transparent).toBe(true);
    p.dispose();
  });
});
