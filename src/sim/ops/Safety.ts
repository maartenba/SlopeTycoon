import type { GameBus, SeasonId } from '../../core/events';
import type { Coverage, CoverageBuilding } from '../Coverage';
import { Avalanche, type AvalancheDeps } from './Avalanche';
import { Heli } from './Heli';
import { Incidents, type SafetyGuestPort } from './Incidents';
import { Patrol } from './Patrol';
import { Wildlife } from './Wildlife';

export interface SafetyOptions {
  size: 64 | 128 | 256;
  seed: number;
  guests: SafetyGuestPort;
  coverage: Coverage;
  buildings: () => Iterable<CoverageBuilding>;
  bus?: Pick<GameBus, 'emit'>;
  spend?: (category: 'rescue', amount: number) => void;
  news?: (msg: string) => void;
  where?: (x: number, y: number) => string;
  isPiste?: (x: number, y: number) => boolean;
  forest: Uint8Array;
  blocked: (i: number) => boolean;
  season: () => SeasonId;
  /** Called every tick (e.g. to expire temporary piste closures). */
  onTick?: (tick: number) => void;
  avalanche: Omit<AvalancheDeps, 'size' | 'coverage' | 'incidents' | 'guests' | 'bus' | 'news' | 'seed'>;
}

export interface SafetyTime { tick: number; hour: number; tickInHour: number; day: number }

/** Operations safety bundle (Task 26): incident queue + patrol + helicopter + avalanches + wildlife; stepped from the ops system. */
export class Safety {
  readonly incidents: Incidents;
  readonly patrol: Patrol;
  readonly heli: Heli;
  readonly avalanche: Avalanche;
  readonly wildlife: Wildlife;
  private covVersion = -1;
  private wildDay = -1;

  constructor(readonly o: SafetyOptions) {
    this.incidents = new Incidents({ guests: o.guests, coverage: o.coverage, buildings: o.buildings, bus: o.bus, spend: o.spend, news: o.news, where: o.where, seed: o.seed });
    this.patrol = new Patrol({ coverage: o.coverage, incidents: this.incidents, isPiste: o.isPiste, spend: o.spend });
    this.heli = new Heli({ coverage: o.coverage, incidents: this.incidents, mapSize: o.size, spend: o.spend });
    this.incidents.patrol = this.patrol; this.incidents.heli = this.heli;
    this.avalanche = new Avalanche({ ...o.avalanche, size: o.size, coverage: o.coverage, incidents: this.incidents, guests: o.guests, bus: o.bus, news: o.news, seed: o.seed });
    this.wildlife = new Wildlife({ size: o.size, forest: o.forest, blocked: o.blocked, coverage: o.coverage, guests: o.guests, incidents: this.incidents, season: o.season, bus: o.bus, news: o.news, spend: o.spend, where: o.where, seed: o.seed });
  }

  /** Force responders to re-read the buildings (after placing/removing a hub). */
  resync(): void { this.patrol.sync(); this.heli.sync(); this.covVersion = this.o.coverage.version; }

  update(t: SafetyTime): void {
    if (this.covVersion !== this.o.coverage.version) this.resync();
    if (this.wildDay !== t.day) { this.wildDay = t.day; this.wildlife.refresh(); this.wildlife.daily(t.day); }
    this.o.onTick?.(t.tick);
    this.incidents.update(t.tick);
    this.avalanche.update(t.tick, t.hour, t.tickInHour, t.day);
    this.wildlife.update(t.tick);
    this.patrol.update(t.tick);
    this.heli.update(t.tick);
  }

  hash(): string { return `${this.incidents.hash()}${this.avalanche.hash()}${this.wildlife.hash()}`; }

  serialize(): unknown { return { inc: this.incidents.serialize(), ava: this.avalanche.serialize(), wild: this.wildlife.serialize(), patrol: this.patrol.serialize(), heli: this.heli.serialize() }; }
  load(d: unknown): void {
    const s = d as { inc?: unknown; ava?: unknown; wild?: unknown; patrol?: unknown; heli?: unknown } | undefined;
    if (!s) return;
    this.incidents.load(s.inc); this.avalanche.load(s.ava); this.wildlife.load(s.wild); this.patrol.load(s.patrol); this.heli.load(s.heli);
    this.covVersion = -1; this.wildDay = -1; // forces the daily refresh, which rebuilds the derived remote-forest map
  }
}
