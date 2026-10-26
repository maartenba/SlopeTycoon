import { describe, expect, it } from 'vitest';
import { collectProtectedChunks } from '@/render/ProtectedChunks';

describe('collectProtectedChunks', () => {
  it('marks chunks of network tiles, building corners and lift line samples', () => {
    const size = 128, kind = new Uint8Array(size * size), layers = new Uint8Array(size * size);
    kind[5 * size + 5] = 1; // chunk 0
    layers[70 * size + 100] = 1; // chunk (3,2) with 32-tile chunks
    const s = collectProtectedChunks({ size, netKind: kind, netLayers: layers, buildings: [{ x: 30, y: 2, w: 4, h: 3 }], lifts: [{ bottom: { x: 1, y: 120 }, top: { x: 120, y: 120 } }] });
    const cpr = 4;
    expect(s.has(0)).toBe(true);
    expect(s.has(2 * cpr + 3)).toBe(true);
    expect(s.has(0 * cpr + 1)).toBe(true); // building straddles chunks 0 and 1
    for (let cx = 0; cx < cpr; cx++) expect(s.has(3 * cpr + cx)).toBe(true); // lift line along the bottom row
    expect(s.has(1 * cpr + 1)).toBe(false);
  });
});
