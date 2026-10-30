import { describe, expect, it } from 'vitest';
import { appearanceOf, CLOTH_NAMES, HairStyle } from '../../src/render/guestAppearance';
import { CORE_TYPE_COUNT, SHIPPED_TYPES } from '../../src/config/guestTypes';

/** Phase 6 visual check: the Mountain biker (lime + helmet) and the Angler (teal + cap) must read in a crowd. */
const share = (type: number, topName: string): number => { let n = 0; const N = 2000; for (let id = 1; id <= N; id++) if (CLOTH_NAMES[appearanceOf(id, type, false).top] === topName) n++; return n / N; };
const T = (id: string): number => CORE_TYPE_COUNT + SHIPPED_TYPES.findIndex((d) => d.id === id);

describe('niche guest looks', () => {
  it('most mountain bikers wear lime and always a helmet; most anglers wear teal and a cap; core types unchanged (~half)', () => {
    expect(share(T('mtb'), 'lime')).toBeGreaterThan(0.8);
    expect(share(T('angler'), 'teal')).toBeGreaterThan(0.75);
    for (let id = 1; id <= 50; id++) { expect(appearanceOf(id, T('mtb'), false).hairStyle).toBe(HairStyle.Helmet); }
    expect(share(0, 'blue')).toBeLessThan(0.55); // core solo keeps its 45 % + random (unchanged)
    expect(share(0, 'blue')).toBeGreaterThan(0.4);
  });
});
