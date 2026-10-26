import type { WeatherKind } from '../../core/events';
import type { WalkNet } from './Movement';
import type { NavWorld } from './NavGraph';

export interface Pt { x: number; y: number }
export interface Rect extends Pt { w: number; h: number }
export interface WorldBuilding extends Rect { id: number; type: string; active: boolean; reason?: string }

/** Resort-wide numbers feeding the attractiveness stub (Task 27 replaces it with the real rating). */
export interface ResortStats {
  openLifts: number;
  openPisteTiles: number;
  attractions: number;
  /** Distinct amenity types (cafe, shop, rental, lodge...). */
  amenityVariety: number;
}

/** Everything the guest sim needs from the world, injected so sim/ stays independent of rendering and the real world classes. */
export interface GuestWorld {
  mapSize: number;
  buildings(): Iterable<WorldBuilding>;
  roadEntry(): Pt | null;
  railEntry(): Pt | null;
  isRoadServed(buildingId: number): boolean;
  isRailServed(buildingId: number): boolean;
  /** Bumped when roads/paths/rail change (route/field cache key). */
  networkVersion(): number;
  /** Tile route from `from` to the tile(s) adjacent to `to`; [] when none. */
  route(kind: 'road' | 'rail', from: Pt, to: Rect): Pt[];
  walkNet(): WalkNet | null;
  /** Full navigation view (layers, snow state, lifts). Optional: without it guests only walk the footpath/road network. Must return a stable object. */
  nav?(): NavWorld | null;
  groundAt(x: number, y: number): number;
  stats(): ResortStats;
  weather(): { kind: WeatherKind; intensity: number };
  /** Economy stub hook: a guest spent `amount` on `what`. */
  onSpend?(amount: number, what: string): void;
  /** Ledger income hook (e.g. 'lessons'). */
  onEarn?(category: string, amount: number): void;
  /** Family venue conditions (Task 22): snowy variant (ski school/kids ground) vs snow-free (playground); OpenStatus building check. */
  isSnowy?(): boolean;
  isBuildingOpen?(id: number): boolean;
  /** Lift-pass revenue hook (Task 24): a guest boarded lift `liftId`. */
  onLiftRide?(liftId: number, guestId: number, foot?: boolean): void;
  /** Ticketing (Task 24): may this guest board a lift (has a pass or can afford one)? Default yes. */
  canRide?(guestId: number, foot?: boolean): boolean;
  /** Ticketing: is the day ticket sold at the entrance on arrival (true/undefined) or at the lift station (false)? */
  ticketAtEntrance?(): boolean;
  /** Ticketing: current day-ticket price (default: Spawner's price table). */
  dayTicketPrice?(): number;
  /** Ticketing: a guest arrived; `paid` = ticket already deducted from their budget. */
  onArrival?(guestId: number, paid: number): void;
}
