/**
 * Scenario calibration (docs/scenarios.md): runs the scripted bot (with the scenario's policy) on each shipped scenario and prints the
 * objective values every 15 game days plus the result. Usage: `npx vite-node scripts/analysis/scenarioCalibrate.ts [id ...] [--days=N]`.
 */
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { SCENARIOS, scenarioSimOptions } from '../../src/config/scenarios';
import { deadlineDays } from '../../src/sim/scenario/ScenarioDef';

const args = process.argv.slice(2);
const daysArg = args.find((a) => a.startsWith('--days='));
const ids = args.filter((a) => !a.startsWith('--'));
for (const def of SCENARIOS.filter((s) => !ids.length || ids.includes(s.id))) {
  const t0 = Date.now();
  if (process.env.SEED) def.seed = Number(process.env.SEED); // try another seed without editing the JSON
  if (args.includes('--probe')) { // never finishes: objective values keep updating (threshold calibration)
    def.objectives.push({ id: 'never', title: 'never', fact: 'lifetimeGuests', op: '>=', target: 1e12, weight: 1, mandatory: true });
    def.deadline = { days: 9999 };
  }
  const sim = createSim({ ...scenarioSimOptions(def), now: () => 0 });
  const bot = new Bot(sim);
  const total = daysArg ? Number(daysArg.slice(7)) : Math.min(deadlineDays(def.deadline), 1080);
  console.log(`\n== ${def.name} (${def.mapSize}, seed ${def.seed}, ${def.preset}) deadline ${deadlineDays(def.deadline)} d, bot setup failures: ${JSON.stringify(bot.report?.failures ?? [])}`);
  let day = 0;
  const full = args.includes('--full'); // keep playing after the scenario ended (calibration of thresholds)
  while (day < total && (full || sim.scenario!.active)) {
    runBot(sim, bot, 15);
    day += 15;
    const v = sim.scenario!.view();
    const st = sim.safety.incidents.stats();
    console.log(`d${String(day).padStart(3)} $${Math.round(sim.game.money)} ${sim.rating.stars}★ guests=${sim.goals.facts.lifetime} best=${sim.goals.facts.bestDay} lvl=${sim.progression.level} debt=${Math.round(sim.loans.totalDebt())} net/mo=${Math.round(sim.economy.lastReport()?.net ?? 0)} inc=${st.created}/${st.hospitalised}/${st.severe} bld=${sim.buildings.size} | ` + v.objectives.map((o) => `${o.id}=${o.valueText}${o.met ? '✓' : o.failed ? '✗' : ''}`).join(' '));
  }
  const f = sim.scenario!.finished;
  console.log(`RESULT ${f ? `${f.result} ${f.medal} score ${f.score} day ${f.days} (${f.reason})` : 'running'}  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
}
