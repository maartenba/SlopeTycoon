import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { Bot, runBot } from '../../src/game/bot';
import { policyFor } from '../../src/game/botPolicies';
import { SCENARIOS, getScenario, scenarioSimOptions } from '../../src/config/scenarios';
import { deadlineDays } from '../../src/sim/scenario/ScenarioDef';
import { MEDAL_RANK } from '../../src/sim/scenario/ScenarioRunner';
import { scanProblems } from './harness';

/**
 * Scenario bots (M5.3 Task 15, docs/scenarios.md): the scripted bot with each scenario's policy.
 *  - fast smoke (every `npm test`): every scenario runs 30 in-game days headless without errors / NaNs and the runner stays consistent;
 *  - acceptance (every `npm test`, ~10 s): the bot reaches at least BRONZE on First Tracks and Family Valley within their deadlines and cannot get GOLD there;
 *  - full sweep (BALANCE=1): the bot's result on every scenario (the other four may be human-hard; the table is in docs/scenarios.md).
 */
const FULL = !!process.env.BALANCE;
const play = (id: string, days: number): ReturnType<typeof createSim> => {
  const def = getScenario(id)!;
  const sim = createSim({ ...scenarioSimOptions(def), now: () => 0 });
  const bot = new Bot(sim);
  expect(bot.report?.failures ?? [], `${id}: opening chain`).toEqual([]);
  let d = 0;
  while (d < days && sim.scenario!.active) { runBot(sim, bot, 15); d += 15; }
  return sim;
};

describe('scenario bots: 30-day smoke for all six', () => {
  for (const s of SCENARIOS) {
    it(`${s.id}: 30 days without errors; the clock and the objectives move`, () => {
      expect(policyFor(s.id), 'policy').toBeTruthy();
      const sim = createSim({ ...scenarioSimOptions(s), now: () => 0 });
      const bot = new Bot(sim);
      const errors: unknown[] = [];
      try { runBot(sim, bot, 30); } catch (e) { errors.push(e); }
      expect(errors).toEqual([]);
      expect(scanProblems(sim)).toEqual([]);
      const v = sim.scenario!.view();
      // a bot that meets every objective early ends the scenario early (Safe Slopes after the Snowboarder / Ski tourer types: day 25): the clock then stops at the finish
      if (v.finished) expect(v.elapsed).toBeLessThanOrEqual(31); else { expect(v.elapsed).toBeGreaterThanOrEqual(29); expect(v.elapsed).toBeLessThanOrEqual(31); }
      expect(v.total).toBe(deadlineDays(s.deadline));
      expect(v.objectives.length).toBe(s.objectives.length);
      expect(Number.isFinite(v.score)).toBe(true);
      expect(v.finished === null || v.finished.result === 'won' || v.finished.result === 'lost').toBe(true);
    }, 120_000);
  }
});

describe('scenario bots: acceptance', () => {
  for (const id of ['first-tracks', 'family-valley']) {
    it(`${id}: the bot reaches at least BRONZE within the deadline, but not GOLD`, () => {
      const sim = play(id, deadlineDays(getScenario(id)!.deadline) + 15);
      const f = sim.scenario!.finished;
      expect(f, 'finished').not.toBeNull();
      expect(f!.result).toBe('won');
      expect(MEDAL_RANK[f!.medal]).toBeGreaterThanOrEqual(MEDAL_RANK.bronze);
      expect(MEDAL_RANK[f!.medal], 'gold needs clever play, not the bot').toBeLessThan(MEDAL_RANK.gold);
    }, 300_000);
  }
});

describe.skipIf(!FULL)('scenario bots: full sweep (BALANCE=1)', () => {
  for (const s of SCENARIOS) {
    it(`${s.id}: bot result (printed)`, () => {
      const sim = play(s.id, deadlineDays(s.deadline) + 15);
      const f = sim.scenario!.finished;
      console.log(`[scenario] ${s.id}: ${f ? `${f.result} ${f.medal} score ${f.score} day ${f.days} (${f.reason})` : 'running'}`);
      expect(f).not.toBeNull();
      expect(MEDAL_RANK[f!.medal] < MEDAL_RANK.gold || s.stars >= 1).toBe(true);
    }, 900_000);
  }
});
