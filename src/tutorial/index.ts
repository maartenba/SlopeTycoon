import type { Sim } from '../game/createSim';
import { HintEngine, type HintDelivery } from './hints';
import { TutorialEngine, TutorialStore, type TutorialHost } from './TutorialEngine';
import { STEPS } from './steps';

export * from './TutorialEngine';
export * from './scenario';
export { STEPS, STEP_IDS } from './steps';
export { HINTS, HintEngine } from './hints';
export { t, STRINGS } from './strings';

export interface TutorialSetup {
  engine: TutorialEngine;
  hints: HintEngine;
  store: TutorialStore;
}

/**
 * Wires the tutorial engine and the hint engine to a sim. `fundingTopUp` (default on) tops up cash for assisted steps — documented
 * tutorial-only behaviour, the engine only runs in the tutorial scenario / on replay.
 */
export function createTutorial(o: {
  sim: Sim;
  host?: TutorialHost;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  deliver(h: HintDelivery): void;
  pollMs?: number;
  fundingTopUp?: boolean;
}): TutorialSetup {
  const store = new TutorialStore(o.storage ?? null);
  const engine = new TutorialEngine({ sim: o.sim, steps: STEPS, host: o.host, store, fundingTopUp: o.fundingTopUp ?? true, pollMs: o.pollMs ?? 0 });
  const hints = new HintEngine({ sim: o.sim, store, deliver: o.deliver });
  return { engine, hints, store };
}
