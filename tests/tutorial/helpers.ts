import { createSim, type Sim } from '../../src/game/createSim';
import { TutorialEngine, TutorialStore, type TutorialHost } from '../../src/tutorial/TutorialEngine';
import { STEPS } from '../../src/tutorial/steps';
import { TUTORIAL_SCENARIO } from '../../src/tutorial/scenario';

export const memStorage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};

export function tutorialSim(size: 64 | 128 | 256 = 64, seed: number = TUTORIAL_SCENARIO.seed): Sim {
  return createSim({ size, seed, startSeason: 'winter', money: TUTORIAL_SCENARIO.money });
}

export function makeEngine(sim: Sim, o: { store?: TutorialStore; funding?: boolean; host?: TutorialHost } = {}): TutorialEngine {
  return new TutorialEngine({ sim, steps: STEPS, store: o.store, fundingTopUp: o.funding ?? true, host: { fastForward: (n) => sim.tick(n), ...o.host } });
}

export interface BotReport { done: string[]; failed: string[]; iterations: number }

/** Plays the tutorial by pressing 'Got it' / 'Do it for me' on every step, letting the sim run in between. */
export function runDoItBot(sim: Sim, eng: TutorialEngine, o: { ticksPerStep?: number; maxIter?: number; until?: string } = {}): BotReport {
  const rep: BotReport = { done: [], failed: [], iterations: 0 };
  for (let i = 0; i < (o.maxIter ?? 120) && eng.status === 'active'; i++) {
    rep.iterations++;
    const s = eng.current!;
    if (o.until && s.id === o.until) break;
    if (s.ack) { eng.next(); rep.done.push(s.id); }
    else {
      const r = eng.doItForMe();
      if (r.ok) rep.done.push(s.id); else { rep.failed.push(`${s.id}:${r.reason}`); eng.skip(); }
    }
    sim.tick(o.ticksPerStep ?? 120);
    eng.evaluate();
  }
  return rep;
}
