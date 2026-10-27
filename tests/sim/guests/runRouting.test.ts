import { describe, expect, it } from 'vitest';
import { Exploration, type RunChoice } from '@/sim/guests/Exploration';
import { GuestStore, GuestType } from '@/sim/guests/Guest';
import { Layer } from '@/world/Networks';

/** Phase 3 of docs/runs.md: at a lift top the guest chooses among RUNS by difficulty fit, crowding, surface, mood; closed runs never. */
const N = 40;
function world() {
  const layers = new Uint8Array(N * N), kind = new Uint8Array(N * N), skiOpen = new Uint8Array(N * N).fill(1);
  for (let y = 4; y < 30; y++) for (const x of [10, 14]) layers[y * N + x] = Layer.Ski; // two parallel runs: x=10 (left) and x=14 (right)
  return {
    size: N, epoch: 1, world: { layers, kind, skiOpen },
    tileAltitude: (t: number) => 100 - ((t / N) | 0),
    stationAnchor: (l: { top: { x: number; y: number }; bottom: { x: number; y: number } }, end: 0 | 1) => { const p = end === 0 ? l.bottom : l.top; return p.y * N + p.x; },
    step: () => 1,
    difficultyAt: () => 2,
  };
}
const lift = { id: 1, top: { x: 12, y: 2 }, bottom: { x: 12, y: 32 } } as never;
const picks = (skill: number, choice: (t: number, s: number) => RunChoice | null, happy = 100, n = 160): { left: number; right: number; none: number } => {
  const cache = world();
  const e = new Exploration(() => cache as never, N);
  e.runChoice = choice;
  const s = new GuestStore(4), i = s.add({ x: 1, y: 1, z: 0, type: GuestType.Solo, skill, budget: 100, group: 0, mode: 0, overnight: false, leaveDay: 0, tick: 0 });
  s.moveMode[i] = 3; s.happiness[i] = happy;
  let k = 1; const rng = { next: () => ((k = (k * 1664525 + 1013904223) >>> 0) / 4294967296) };
  const out = { left: 0, right: 0, none: 0 };
  for (let j = 0; j < n; j++) { s.via[i] = 0; const v = e.pickVia(s, i, lift, rng); if (!v) out.none++; else if ((v - 1) % N === 10) out.left++; else out.right++; }
  return out;
};
const base = (left: Partial<RunChoice>, right: Partial<RunChoice>) => (t: number): RunChoice => ({ diff: 2, crowd: 0, like: 0.5, open: true, ...((t % N) === 10 ? left : right) });

describe('run-aware routing at the lift top', () => {
  it('experts prefer the black run, beginners the green one', () => {
    const f = base({ diff: 4 }, { diff: 1 });
    const expert = picks(3, f), novice = picks(0, f);
    expect(expert.left).toBeGreaterThan(expert.right);
    expect(novice.right).toBeGreaterThan(novice.left);
  });
  it('a closed run is never chosen', () => {
    const r = picks(2, base({ open: false }, {}));
    expect(r.left).toBe(0); expect(r.right).toBeGreaterThan(0);
  });
  it('a crowded run loses guests; a better surface wins them', () => {
    const crowded = picks(2, base({ crowd: 5 }, { crowd: 0 }));
    expect(crowded.right).toBeGreaterThan(crowded.left);
    const icy = picks(2, base({ like: 0.1 }, { like: 0.9 }));
    expect(icy.right).toBeGreaterThan(icy.left);
  });
  it('unhappy guests lean towards the easier run', () => {
    const f = base({ diff: 4 }, { diff: 2 });
    const happy = picks(2, f, 100), grumpy = picks(2, f, 0);
    expect(grumpy.right / (grumpy.left + grumpy.right)).toBeGreaterThan(happy.right / (happy.left + happy.right));
  });
  it('still picks something when every run is open (no stuck guests) and falls back to 0 only when none is', () => {
    expect(picks(2, base({}, {})).none).toBe(0);
    expect(picks(2, () => ({ diff: 2, crowd: 0, like: 0.5, open: false })).none).toBe(160);
  });
  it('deterministic: same inputs, same picks', () => {
    expect(picks(2, base({ diff: 3 }, {}))).toEqual(picks(2, base({ diff: 3 }, {})));
  });
});
