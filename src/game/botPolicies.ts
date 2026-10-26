/**
 * Per-scenario bot policies (M5.3 Task 15): the scripted player of `bot.ts` gets a different opening and a different expansion wish list
 * per scenario concept (family priorities, snowmaking first, summer attractions first, safety first ...). Sim-only; the policies only
 * choose WHAT the bot builds, never bypass a rule. Used by the headless calibration (docs/scenarios.md) and tests/game/scenarioBots.test.ts.
 */
import type { StarterOptions } from './starterResort';

/** [building type, max count at map size 64 / 128 / 256]. */
export type Wish = readonly [string, readonly [number, number, number]];

export interface BotPolicy {
  id: string;
  /** Options of the opening chain (cannon count, lift kinds, ...). */
  starter?: StarterOptions;
  /** Replaces the default expansion wish list (priority order). */
  wishes?: readonly Wish[];
  /** Winter campaigns in order (default budget, families, brand). */
  marketing?: readonly string[];
  /** Paint a hiking and a biking trail along every lift line in the opening. */
  trails?: boolean;
}

const POLICIES: Record<string, BotPolicy> = {
  'first-tracks': { id: 'first-tracks' },
  // families first: kids' ground + playground + family lodging before shops and bars
  'family-valley': {
    id: 'family-valley',
    marketing: ['families', 'budget', 'brand'],
    wishes: [['playground', [1, 2, 2]], ['kidsGround', [1, 2, 3]], ['apartment', [1, 2, 3]], ['chalet', [2, 3, 4]], ['cafe', [1, 2, 3]], ['parking', [1, 2, 2]], ['rental', [1, 1, 2]], ['lodge', [1, 2, 3]], ['shop', [1, 2, 3]], ['liftWorkshop', [1, 1, 1]]],
  },
  // snowmaking first: a big cannon field + reservoir in the opening chain, grooming kept
  'powder-dreams': {
    id: 'powder-dreams',
    starter: { cannons: 10 },
    marketing: ['budget', 'brand', 'families'],
    wishes: [['reservoir', [1, 2, 2]], ['rental', [1, 1, 2]], ['chalet', [2, 3, 4]], ['parking', [1, 2, 2]], ['cafe', [1, 2, 3]], ['lodge', [1, 2, 3]], ['shop', [1, 2, 3]], ['liftWorkshop', [1, 1, 1]]],
  },
  // summer attractions first + trails
  'summer-escape': {
    id: 'summer-escape',
    trails: true,
    wishes: [['alpineFarm', [1, 1, 2]], ['adventurePark', [1, 1, 2]], ['rental', [1, 1, 2]], ['beach', [1, 1, 1]], ['chalet', [2, 3, 4]], ['cafe', [1, 2, 3]], ['parking', [1, 2, 2]], ['lodge', [1, 2, 3]], ['shop', [1, 2, 3]]],
  },
  // big map: more lifts, bigger reserve
  'alpine-giant': {
    id: 'alpine-giant',
    wishes: [['rental', [1, 1, 2]], ['chalet', [2, 3, 5]], ['lodge', [1, 2, 4]], ['parking', [1, 2, 3]], ['apartment', [0, 1, 3]], ['cafe', [1, 2, 3]], ['shop', [1, 2, 3]], ['playground', [1, 1, 1]], ['liftWorkshop', [1, 1, 1]], ['adventurePark', [1, 1, 2]], ['beach', [0, 1, 1]]],
  },
  // safety first: rangers + extra first-aid + warning signs before comfort
  'safe-slopes': {
    id: 'safe-slopes',
    wishes: [['rangerStation', [1, 1, 2]], ['firstAid', [2, 3, 4]], ['rental', [1, 1, 2]], ['chalet', [2, 3, 4]], ['parking', [1, 2, 2]], ['cafe', [1, 2, 3]], ['lodge', [1, 2, 3]], ['liftWorkshop', [1, 1, 1]], ['shop', [1, 2, 3]]],
  },
};

export const policyFor = (id: string): BotPolicy | null => POLICIES[id] ?? null;
