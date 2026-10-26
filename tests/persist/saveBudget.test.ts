import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { buildStarterResort } from '../../src/game/starterResort';
import { GUEST_CAP } from '../../src/config/balance';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { stateHash } from '../../src/game/saveState';
import { budget } from '../perfMode';

const BYTES: Record<number, number> = { 64: 0.5 * 1048576, 128: 1048576, 256: 3 * 1048576 };

/** Event-loop lag probe: the largest gap between two macrotasks while `fn` runs = the longest UI freeze. */
async function withLag<T>(fn: () => Promise<T>): Promise<{ value: T; maxGapMs: number }> {
  let last = performance.now(), max = 0, stop = false;
  const loop = (): void => { if (stop) return; const n = performance.now(); max = Math.max(max, n - last); last = n; setTimeout(loop, 0); };
  setTimeout(loop, 0);
  const value = await fn();
  stop = true;
  return { value, maxGapMs: max };
}

describe('save size & speed budgets (starter resort + guests at cap)', () => {
  for (const size of [64, 128, 256] as const) {
    it(`[perf] size ${size}: compressed save < ${BYTES[size]! / 1048576} MB, save and load < 2 s, no event-loop freeze > 200 ms`, async () => {
      const sim = createSim({ size, seed: 1337, startDay: 335, now: () => 0 });
      buildStarterResort(sim);
      const cap = GUEST_CAP[size];
      for (let i = 0; i < 400 && sim.guestSim.store.count < cap * 0.9; i++) {
        if (sim.game.date.minute / 60 >= 7.5 && sim.game.date.minute / 60 <= 16.5) sim.guestSim.spawner.benchFill(sim.game, cap, 300);
        sim.tick(1);
      }
      const guests = sim.guestSim.store.count;
      expect(guests).toBeGreaterThan(cap * 0.5);
      const meta = makeMeta(sim, 'budget');

      const saved = await withLag(() => encodeSave(sim, meta));
      const { bytes, stats } = saved.value;
      const t1 = performance.now();
      const dec = await withLag(async () => {
        const d = await decodeSave(bytes);
        return createSim({ size, seed: 1337, now: () => 0, fromSave: d.envelope.modules });
      });
      const loadMs = performance.now() - t1;
      const raw = await encodeSave(sim, meta, { compress: false, yieldBetween: false });
      const top = Object.entries(stats.perModuleChars).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${(v / 1024).toFixed(0)}K`).join(', ');
      console.log(`[saves] size ${size}: ${guests} guests, ${sim.props.count()} props | gzip ${(bytes.length / 1024).toFixed(0)} KB (plain ${(raw.bytes.length / 1024).toFixed(0)} KB) | save ${stats.ms.toFixed(0)} ms (max event-loop gap ${saved.maxGapMs.toFixed(0)} ms) | load ${loadMs.toFixed(0)} ms (max gap ${dec.maxGapMs.toFixed(0)} ms) | biggest raw modules: ${top}`);
      expect(stats.compressed).toBe(true);
      expect(bytes.length).toBeLessThan(BYTES[size]!);
      expect(stats.ms).toBeLessThan(budget(2000));
      expect(loadMs).toBeLessThan(budget(2000));
      expect(saved.maxGapMs).toBeLessThan(budget(200));
      expect(dec.maxGapMs).toBeLessThan(budget(200));
      // the loaded sim really is the saved one (only documented demotions differ)
      const a = stateHash(sim).parts, b = stateHash(dec.value).parts;
      expect(Object.keys(a).filter((k) => a[k] !== b[k] && !['sys.guests', 'sys.attractions', 'networks'].includes(k))).toEqual([]);
    }, 120_000);
  }
});
