import type { Sim } from './createSim';
import type { RecapIssues } from '../ui/recap';
import { liftOpenForBusiness } from '../sim/ops/LiftOps';

/** Cash below this counts as "running low" in the recap. */
export const LOW_CASH = 5000;

/**
 * Unresolved issues for the "Welcome back" recap. The sim is paused on load and the world is restored exactly as saved, so reading
 * them live equals "stored at save time" and also works for old saves without a sessionMeta block. Read-only.
 */
export function sessionIssues(sim: Sim): RecapIssues {
  const lifts = sim.lifts.all();
  return {
    openIncidents: sim.safety.incidents.stats().open,
    closedLifts: lifts.filter((l) => !liftOpenForBusiness(l)).length,
    brokenLifts: lifts.filter((l) => l.opsReason === 'fault').length,
    closedPistes: sim.openStatus.pisteStatuses().filter((p) => !p.open).length,
    lowCash: sim.game.money < LOW_CASH,
  };
}
