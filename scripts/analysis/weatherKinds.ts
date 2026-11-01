/* M7.0 audit: weather kind distribution per month over two sim years (seed 5, size 128) + how often the atmosphere (special skies, valley fog,
 * frost, rainbow) fires on those days. Render-side hashes only; the sim is read, never changed.
 * Run: npx vite-node scripts/analysis/weatherKinds.ts [seed] [years] */
import { createSim } from '../../src/game/createSim';
import { SIM_MONTHS } from '../../src/sim/calendar';
import { seasonOf } from '../../src/sim/Clock';
import { sunTimes } from '../../src/sim/Daylight';
import { fogDay } from '../../src/render/atmosphere/FogState';
import { isWetKind } from '../../src/render/atmosphere/FogState';
import { specialSky } from '../../src/render/atmosphere/SunFx';
import { frostAmount, rainbowAmount } from '../../src/render/atmosphere/Flavour';
import { dayKeyOf } from '../../src/render/atmosphere/hash';
import type { WeatherKind } from '../../src/core/events';

const seed = Number(process.argv[2] ?? 5), years = Number(process.argv[3] ?? 2);
const sim = createSim({ size: 128, seed, now: () => 0 });
const kinds: WeatherKind[] = ['clear', 'cloudy', 'snow', 'heavySnow', 'rain', 'storm'];
const perMonth: Record<number, Record<string, number>> = {};
const atm = { days: 0, dawn: 0, dusk: 0, fog: 0, inversion: 0, frost: 0, rainbow: 0 };
let prevWet = false;
const seenDay = new Set<number>();
const dayTicks = 240;
void dayTicks;
while (seenDay.size < years * 180) {
  sim.loop.advance(0.5);
  const d = sim.game.date, key = dayKeyOf(d.year, d.day);
  if (seenDay.has(key)) continue; seenDay.add(key);
  const k = sim.weather.current.kind, m = Math.floor(d.day / 15);
  (perMonth[m] ??= {})[k] = ((perMonth[m] ??= {})[k] ?? 0) + 1;
  const c = { seed, dayKey: key, season: seasonOf(d), weather: k, prevWet, valleyT: sim.weather.current.valleyT };
  const sp = specialSky(c), fd = fogDay(c), st = sunTimes(d.day);
  atm.days++; if (sp.dawn > 0) atm.dawn++; if (sp.dusk > 0) atm.dusk++; if (fd.strength > 0) atm.fog++; if (fd.inversion) atm.inversion++;
  let fr = 0, rb = 0; for (let h = st.sunrise - 1; h < st.sunset; h += 0.25) { fr = Math.max(fr, frostAmount(c, h, st.sunrise)); rb = Math.max(rb, rainbowAmount(c, h, st.sunrise, st.sunset)); }
  if (fr > 0.2) atm.frost++; if (rb > 0.2) atm.rainbow++;
  prevWet = isWetKind(k);
}
const pad = (s: string | number, n: number): string => String(s).padStart(n);
console.log(`seed ${seed}, ${years} years, ${atm.days} days\n`);
console.log(`| Month | ${kinds.map((k) => pad(k, 9)).join(' | ')} | days |`);
console.log(`|---|${kinds.map(() => '---:').join('|')}|---:|`);
for (let m = 0; m < 12; m++) { const r = perMonth[m] ?? {}, n = kinds.reduce((a, k) => a + (r[k] ?? 0), 0); console.log(`| ${SIM_MONTHS[m]} | ${kinds.map((k) => pad(n ? Math.round(((r[k] ?? 0) / n) * 100) + '%' : '-', 9)).join(' | ')} | ${n} |`); }
const pc = (n: number): string => `${((n / atm.days) * 100).toFixed(1)}%`;
console.log(`\nspecial dawn ${pc(atm.dawn)}, special dusk ${pc(atm.dusk)}, fog mornings ${pc(atm.fog)} (inversion ${pc(atm.inversion)}), frost days ${pc(atm.frost)}, rainbow days ${pc(atm.rainbow)}`);
