/**
 * Injuries per guest type (M6.4 STOP, docs/guest-types.md "School classes and safety"): bot resort, N days, counts arrivals and
 * `incident:injury` per guest type. Usage: `npx vite-node scripts/analysis/incidentsByType.ts [days] [size] [seeds comma]`.
 */
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { typeKey } from '../../src/sim/guests/Guest';

const days = Number(process.argv[2] ?? 360), size = Number(process.argv[3] ?? 64) as 64 | 128 | 256;
const seeds = (process.argv[4] ?? '21,5,7').split(',').map(Number);
const arr: Record<string, number> = {}, inj: Record<string, number> = {};
for (const seed of seeds) {
  const sim = createSim({ size, seed, now: () => 0 });
  const kind = new Map<number, string>();
  sim.bus.on('guest:arrived', ({ id }) => { const s = sim.guestSim.store.slotOf(id); if (s < 0) return; const k = String(typeKey(sim.guestSim.store.type[s]!)); kind.set(id, k); arr[k] = (arr[k] ?? 0) + 1; });
  sim.bus.on('incident:injury', ({ guestId }) => { const k = kind.get(guestId) ?? '?'; inj[k] = (inj[k] ?? 0) + 1; });
  runBot(sim, new Bot(sim, {}), days);
}
const rows = Object.keys(arr).sort().map((k) => `${k.padEnd(10)} guests ${String(arr[k]).padStart(6)}  injuries ${String(inj[k] ?? 0).padStart(4)}  per 1000: ${(1000 * (inj[k] ?? 0) / arr[k]!).toFixed(1)}`);
console.log(`seeds ${seeds.join(',')} size ${size} days ${days}\n${rows.join('\n')}`);
