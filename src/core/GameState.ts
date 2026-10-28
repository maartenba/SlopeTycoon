import { IdGenerator } from './ids';
import { Rng } from './Rng';
import { START_DAY_OF_YEAR } from '../config/balance';

export type MapSize = 64 | 128 | 256;

export interface GameDate {
  year: number;
  /** 0-based day of year */
  day: number;
  /** Minute of day, 0..1439 */
  minute: number;
  tick: number;
}

/** Placeholder; real Grid arrives in a later task. */
export interface GridRef {
  size: number;
}

export interface GameState {
  seed: number;
  mapSize: MapSize;
  date: GameDate;
  money: number;
  grid: GridRef | null;
  entities: {
    guests: Map<number, unknown>;
    staff: Map<number, unknown>;
    buildings: Map<number, unknown>;
    lifts: Map<number, unknown>;
  };
  ids: IdGenerator;
  rng: Rng;
}

/** Starting funds: enough for a lodge-adjacent build-out, a couple of lifts and some terraforming. */
export const STARTING_MONEY = 150000;

export function createGameState(seed: number, mapSize: MapSize = 128, money = STARTING_MONEY): GameState {
  return {
    seed,
    mapSize,
    date: { year: 1, day: START_DAY_OF_YEAR, minute: 8 * 60, tick: 0 },
    money,
    grid: null,
    entities: { guests: new Map(), staff: new Map(), buildings: new Map(), lifts: new Map() },
    ids: new IdGenerator(),
    rng: new Rng(seed),
  };
}
