import { describe, expect, it } from 'vitest';
import { FakeGuests, mkB, mkSafety, run } from './safetyHelpers';
import { Sev, WILD } from '../../../src/sim/ops';

const N = 64;
const PREY: Array<[number, number]> = [[16, 16], [48, 16], [16, 48], [48, 48], [32, 32], [10, 32], [54, 32]];

function arena(seed: number, mode: 'none' | 'signs' | 'patrol', season: 'winter' | 'summer' = 'winter') {
  const guests = new FakeGuests(N);
  PREY.forEach(([x, y], k) => guests.add(k + 1, x, y, true));
  const blds = [];
  if (mode === 'signs') for (const [x, y] of PREY) blds.push(mkB('warningSign', x, y));
  if (mode === 'patrol') for (const [x, y] of PREY) blds.push(mkB('patrolHub', x - 1, y - 1));
  const m = mkSafety({ seed, guests, buildings: blds, forest: new Uint8Array(N * N).fill(255), season: () => season, blocked: () => false });
  m.safety.resync();
  m.safety.wildlife.refresh();
  return m;
}
/** Move every animal next to a prey so encounters are exercised often. */
function lure(m: ReturnType<typeof arena>): void {
  m.safety.wildlife.animals.forEach((a, k) => { const [x, y] = PREY[k % PREY.length]!; a.x = a.tx = x + 3; a.y = a.ty = y; });
}

describe('wildlife', () => {
  it('spawns bears and wolves in remote forest only; count scales with map size and forest area', () => {
    const m = arena(1, 'none');
    const w = m.safety.wildlife;
    expect(w.animals.some((a) => a.kind === 'bear')).toBe(true);
    expect(w.animals.some((a) => a.kind === 'wolf')).toBe(true);
    for (const a of w.animals) expect(w.remote[(a.y | 0) * N + (a.x | 0)]).toBe(1);
    expect(w.animals.length).toBeLessThanOrEqual(WILD.maxEach[64]! + WILD.maxBears[64]!);
    expect(w.animals.filter((a) => a.kind === 'bear').length).toBeGreaterThanOrEqual(WILD.minBears[64]!);
    const none = mkSafety({ forest: new Uint8Array(N * N) }); none.safety.wildlife.refresh();
    expect(none.safety.wildlife.animals.length).toBe(0);
    const big = mkSafety({ size: 256, forest: new Uint8Array(256 * 256).fill(255) }); big.safety.wildlife.refresh();
    expect(big.safety.wildlife.animals.length).toBeGreaterThan(w.animals.length);
  });

  it('keeps away from buildings (remote requires distance from blocked tiles)', () => {
    const g = new FakeGuests(N);
    const m = mkSafety({ guests: g, forest: new Uint8Array(N * N).fill(255), blocked: (i) => (i % N) < 40 });
    m.safety.wildlife.refresh();
    for (const a of m.safety.wildlife.animals) expect(a.x).toBeGreaterThanOrEqual(40 + WILD.remoteDist);
  });

  it('bears hibernate in winter; they stalk and attack off-piste prey in summer (incident + typed event)', () => {
    const w = arena(2, 'none', 'winter'); lure(w);
    run(w.safety, 400);
    expect(w.safety.wildlife.attacks + w.safety.wildlife.deterred).toBeGreaterThan(0); // wolves are active
    const bears = w.safety.wildlife.animals.filter((a) => a.kind === 'bear');
    expect(bears.every((b) => b.asleep)).toBe(true);
    const s = arena(2, 'none', 'summer'); lure(s);
    run(s.safety, 600);
    expect(s.safety.wildlife.attacks).toBeGreaterThan(0);
    expect(s.events.some((e) => e.name === 'incident:wildlife' && (e.p as { outcome: string }).outcome === 'attack')).toBe(true);
    expect(s.safety.incidents.stats().created).toBeGreaterThan(0);
    expect(s.news.some((n) => /attack/.test(n))).toBe(true);
  });

  it('Warning Signs and patrol coverage reduce attacks (A/B over fixed seeds)', () => {
    const count = (mode: 'none' | 'signs' | 'patrol'): number => {
      // attack SHARE of encounters (rescued guests walk back into the same bear in this static arena, so raw counts are confounded)
      let a = 0, d = 0;
      for (let seed = 1; seed <= 10; seed++) { const m = arena(seed, mode, 'summer'); lure(m); run(m.safety, 500); a += m.safety.wildlife.attacks; d += m.safety.wildlife.deterred; }
      return a / Math.max(1, a + d);
    };
    const none = count('none'), signs = count('signs'), patrol = count('patrol');
    console.log(`wildlife attacks over 10 seeds: none ${none}, signs ${signs}, patrol ${patrol}`);
    expect(none).toBeGreaterThan(0);
    expect(signs).toBeLessThan(none);
    expect(patrol).toBeLessThan(none);
  });

  it('is deterministic', () => {
    const go = (): string => { const m = arena(3, 'none', 'summer'); lure(m); run(m.safety, 300); return m.safety.wildlife.hash(); };
    expect(go()).toBe(go());
    void Sev;
  });
});
