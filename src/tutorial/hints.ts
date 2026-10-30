import type { Sim } from '../game/createSim';
import type { GameEventName, GameEvents } from '../core/events';
import { DAYS_PER_YEAR } from '../config/balance';
import { Q } from '../sim/ops/PisteQuality';
import { GuestType } from '../sim/guests/Guest';
import { BUILDINGS } from '../config/buildings';
import { Queries } from './queries';
import { TutorialStore } from './TutorialEngine';
import { hintKey, t } from './strings';

export type HintTier = 'important' | 'info';
export interface HintFacts { sim: Sim; q: Queries }

export interface HintDef<E extends GameEventName = GameEventName> {
  id: string;
  tier: HintTier;
  /** The event that makes this hint worth checking. */
  on: E;
  /** Read-only condition on world state / the event payload. */
  when(f: HintFacts, e: GameEvents[E]): boolean;
}

const def = <E extends GameEventName>(d: HintDef<E>): HintDef => d as unknown as HintDef;
const QUEUE_LIMIT = 25;
const ICY_TILES = 6;

/** One-shot contextual hints. Order = priority when several are waiting. Independent of the tutorial. */
export const HINTS: HintDef[] = [
  def({ id: 'bankruptcy', tier: 'important', on: 'finance:bankruptcyWarning', when: () => true }),
  def({ id: 'debt', tier: 'important', on: 'finance:debtWarning', when: () => true }),
  def({ id: 'avalanche', tier: 'important', on: 'incident:avalanche', when: () => true }),
  def({ id: 'injury', tier: 'important', on: 'incident:injury', when: (f) => f.q.activeCount('patrolHub') === 0 }),
  def({ id: 'storm', tier: 'important', on: 'weather:changed', when: (_f, e) => e.kind === 'storm' }),
  def({ id: 'liftBreakdown', tier: 'important', on: 'lift:broken', when: () => true }),
  def({ id: 'lowRating', tier: 'important', on: 'rating:changed', when: (_f, e) => e.stars <= 2 && e.stars < e.previous }),
  def({ id: 'noRental', tier: 'info', on: 'guest:arrived', when: (f) => !f.q.has('rental') }),
  def({
    id: 'noSchool', tier: 'info', on: 'guest:arrived',
    when: (f, e) => { const sl = f.sim.guestSim.store.slotOf(e.id); return sl >= 0 && f.sim.guestSim.store.type[sl] === GuestType.Family && !f.q.has('skiSchoolHQ'); },
  }),
  def({
    id: 'queue', tier: 'info', on: 'time:hour',
    when: (f) => f.sim.lifts.all().some((l) => l.open && f.sim.guestSim.queues.queueLength(l.id, 0) >= QUEUE_LIMIT),
  }),
  def({
    id: 'icy', tier: 'info', on: 'day:changed',
    when: (f) => {
      const net = f.sim.networks, q = f.sim.ops.quality;
      let n = 0;
      for (let i = 0; i < net.layers.length && n < ICY_TILES; i++) if ((net.layers[i]! & 1) && q.at(i) === Q.Icy) n++;
      return n >= ICY_TILES;
    },
  }),
  def({ id: 'wildlife', tier: 'info', on: 'incident:wildlife', when: () => true }),
  def({ id: 'season.autumn', tier: 'info', on: 'season:changed', when: (_f, e) => e.season === 'autumn' }),
  def({ id: 'season.winter', tier: 'info', on: 'season:changed', when: (_f, e) => e.season === 'winter' }),
  def({ id: 'season.spring', tier: 'info', on: 'season:changed', when: (_f, e) => e.season === 'spring' }),
  def({ id: 'season.summer', tier: 'info', on: 'season:changed', when: (_f, e) => e.season === 'summer' }),
  // The first viewpoint / treehouse: Photo mode has a spot for it now (docs/viewpoints.md)
  def({ id: 'view.photo', tier: 'info', on: 'building:placed', when: (_f, e) => !!BUILDINGS[e.type]?.viewpoint }),
  def({ id: 'summer.farm', tier: 'info', on: 'season:changed', when: (f, e) => e.season === 'summer' && !f.q.has('alpineFarm') }),
];

export interface HintDelivery { id: string; text: string; tier: HintTier }
export interface HintOpts {
  sim: Sim;
  store: TutorialStore;
  /** Show the hint (assistant bubble or toast). */
  deliver(h: HintDelivery): void;
  hints?: HintDef[];
  /** Minimum in-game days between two hints (default 2). */
  minGapDays?: number;
}

/**
 * Delivers each hint at most once (dismissed set persisted in the tutorial store), at most one per `minGapDays` in-game days;
 * waiting hints queue (important first) and are released on the next `day:changed`. Disabled via the Hints setting.
 */
export class HintEngine {
  private readonly hints: HintDef[];
  private pending: HintDef[] = [];
  private lastDay = -Infinity;
  private unsubs: Array<() => void> = [];
  private readonly q: Queries;
  private readonly gap: number;

  constructor(private readonly o: HintOpts) {
    this.hints = o.hints ?? HINTS;
    this.q = new Queries(o.sim);
    this.gap = o.minGapDays ?? 2;
  }

  get enabled(): boolean { return this.o.store.state.hintsEnabled; }
  setEnabled(on: boolean): void { this.o.store.state.hintsEnabled = on; if (!on) this.pending = []; this.o.store.save(); }
  /** Hint ids already shown. */
  get seen(): readonly string[] { return this.o.store.state.hints; }
  resetSeen(): void { this.o.store.state.hints = []; this.pending = []; this.o.store.save(); }

  start(): void {
    if (this.unsubs.length) return;
    const bus = this.o.sim.bus;
    const events = [...new Set(this.hints.map((h) => h.on))];
    for (const ev of events) {
      this.unsubs.push(bus.on(ev, ((p: unknown) => this.onEvent(ev, p)) as never));
    }
    this.unsubs.push(bus.on('day:changed', () => this.flush()));
  }
  stop(): void { for (const u of this.unsubs) u(); this.unsubs = []; }

  private today(): number { const d = this.o.sim.game.date; return d.year * DAYS_PER_YEAR + d.day; }

  private onEvent(ev: GameEventName, p: unknown): void {
    if (!this.enabled) return;
    const seen = this.o.store.state.hints;
    for (const h of this.hints) {
      if (h.on !== ev || seen.includes(h.id) || this.pending.includes(h)) continue;
      let hit = false;
      try { hit = h.when({ sim: this.o.sim, q: this.q }, p as never); } catch { hit = false; }
      if (!hit) continue;
      this.pending.push(h);
    }
    this.flush();
  }

  /** Release the best waiting hint if the quiet period has passed. */
  flush(): void {
    if (!this.enabled || !this.pending.length) return;
    const today = this.today();
    if (today - this.lastDay < this.gap) return;
    const order = (h: HintDef): number => (h.tier === 'important' ? 0 : 1);
    this.pending.sort((a, b) => order(a) - order(b) || this.hints.indexOf(a) - this.hints.indexOf(b));
    const h = this.pending.shift()!;
    if (this.o.store.state.hints.includes(h.id)) return;
    this.o.store.state.hints.push(h.id);
    this.o.store.save();
    this.lastDay = today;
    this.o.deliver({ id: h.id, text: t(hintKey(h.id)), tier: h.tier });
  }
}
