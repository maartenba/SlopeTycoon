import type { Sim } from '../game/createSim';
import type { PlacedBuilding } from '../sim/Buildings';
import type { LiftData } from '../sim/Lift';
import { liftConnection } from '../sim/Lift';
import { Layer } from '../world/Networks';
import type { SeasonId } from '../core/events';
import { seasonOf } from '../sim/Clock';

export interface Rect { x: number; y: number; w: number; h: number }
export type Pt = { x: number; y: number };

export const rectOf = (b: { x: number; y: number; w: number; h: number }): Rect => ({ x: b.x, y: b.y, w: b.w, h: b.h });
export const centreOf = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The three persistent resort goals (shown until reached). */
export const GOALS = { guests: 200, stars: 4 } as const;

/**
 * Read-only world-state queries used by step predicates and the hint engine. Built on the public sim APIs only
 * (no writes). `flags` are latched UI/event facts ('camera:rotate', 'speed:2', 'game:saved', …) maintained by the engine.
 */
export class Queries {
  constructor(readonly sim: Sim, private readonly flagSet: ReadonlySet<string> = new Set()) {}

  flag(f: string): boolean { return this.flagSet.has(f); }

  // ---- buildings ----
  buildings(type?: string): PlacedBuilding[] { const all = this.sim.buildings.all(); return type ? all.filter((b) => b.type === type) : all; }
  count(type: string): number { return this.buildings(type).length; }
  /** Count of buildings of any of `types` that are active (connected, dependencies met). */
  activeCount(...types: string[]): number { return this.sim.buildings.all().filter((b) => types.includes(b.type) && b.active).length; }
  has(...types: string[]): boolean { return this.sim.buildings.all().some((b) => types.includes(b.type)); }
  first(type: string): PlacedBuilding | undefined { return this.buildings(type)[0]; }
  lodge(): PlacedBuilding | undefined { return this.first('baseLodge'); }
  roadServed(b: Rect): boolean { return this.sim.networks.serves('road', b); }
  pathServed(b: Rect): boolean { return this.sim.networks.serves('path', b); }

  // ---- networks ----
  private countKind(k: number): number { let n = 0; const a = this.sim.networks.kind; for (let i = 0; i < a.length; i++) if (a[i] === k) n++; return n; }
  pathTiles(): number { return this.countKind(1); }
  roadTiles(): number { return this.countKind(2); }
  layerTiles(layer: 1 | 2 | 4): number { let n = 0; const a = this.sim.networks.layers; for (let i = 0; i < a.length; i++) if (a[i]! & layer) n++; return n; }
  skiTiles(): number { return this.layerTiles(Layer.Ski); }
  trailTiles(): number { return this.layerTiles(Layer.Hike) + this.layerTiles(Layer.Mtb); }
  /** Number of ski piste components that are not flagged 'disconnected'. */
  connectedPistes(): number { return this.sim.networks.pisteComponents().filter((c) => !c.disconnected && c.count >= 4).length; }
  /** Parking and the lodge both touch the footpath network (the player linked them by foot). */
  parkingLinkedToLodge(): boolean {
    const l = this.lodge();
    if (!l) return false;
    return this.buildings('parking').some((p) => this.pathServed(rectOf(p)) && this.pathServed(rectOf(l))) && this.pathTiles() >= 1;
  }
  /** Some parking lot (any, anywhere) touches a road connected to the road entry. */
  parkingRoadServed(): boolean { return this.buildings('parking').some((p) => this.roadServed(rectOf(p))); }
  /** The parking lot that still needs its link (the first unserved one), else the first. */
  unservedParking(): PlacedBuilding | undefined { return this.buildings('parking').find((p) => !this.roadServed(rectOf(p))) ?? this.first('parking'); }

  // ---- lifts ----
  lifts(): LiftData[] { return this.sim.lifts.all(); }
  liftCount(): number { return this.sim.lifts.all().length; }
  liftConnected(l: LiftData): boolean { return liftConnection(this.sim.networks.access, l).connected; }
  /** A piste component starts near the top station and ends near the bottom station of `l` (tolerance: brush width). */
  pisteServesLift(l: LiftData, tol = 3): boolean {
    const size = this.sim.size, near = (idx: number, s: Pt): boolean => { const x = idx % size, y = (idx / size) | 0; return x >= s.x - tol && x <= s.x + 1 + tol && y >= s.y - tol && y <= s.y + 1 + tol; };
    return this.sim.networks.pisteComponents().some((c) => c.count >= 4 && !c.disconnected && c.tiles.some((i) => near(i, l.top)) && c.tiles.some((i) => near(i, l.bottom)));
  }
  anyLiftServedByPiste(): boolean { return this.lifts().some((l) => this.pisteServesLift(l)); }
  /** True when some piste carries a custom (player) name. */
  namedPiste(): boolean {
    const d = this.sim.names.serialize();
    return d.custom.some(([k]) => k.startsWith('piste:'));
  }

  // ---- economy / sim ----
  get money(): number { return this.sim.game.money; }
  get speed(): 0 | 1 | 2 | 3 { return this.sim.loop.speed; }
  get season(): SeasonId { return seasonOf(this.sim.game.date); }
  get guests(): number { return this.sim.guestSim.store.count; }
  get stars(): number { return this.sim.rating.stars; }
  get debt(): number { return this.sim.loans.totalDebt(); }
  get activeLoans(): number { return this.sim.loans.active().length; }
  dayPassPrice(): number { return this.sim.pricing.get('dayPass'); }
  dayPassChanged(): boolean { return this.sim.pricing.get('dayPass') !== this.sim.pricing.defaultOf('dayPass'); }
  campaignsStarted(): number { return this.sim.marketing.records().length + this.sim.marketing.running().length; }
  /** Net of the last closed month (null before the first month closed). */
  lastMonthNet(): number | null { const r = this.sim.economy.lastReport(); return r ? r.net : null; }
  gameOver(): boolean { return this.sim.finance.ended; }
  inDebt(): boolean { return this.sim.finance.inDebt; }
  /** Arrivals so far are tracked by the engine as flag 'guests:arrived'; this also counts guests currently in the resort. */
  anyGuests(): boolean { return this.flag('guests:arrived') || this.guests > 0; }

  goals(): { guests: boolean; stars: boolean; profit: boolean } {
    const net = this.lastMonthNet();
    return { guests: this.guests >= GOALS.guests || this.flag('goal:guests'), stars: this.stars >= GOALS.stars || this.flag('goal:stars'), profit: (net !== null && net > 0) || this.flag('goal:profit') };
  }
}
