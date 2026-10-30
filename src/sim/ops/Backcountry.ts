import type { GameBus } from '../../core/events';
import { DANGER, dangerText } from './Avalanche';

/**
 * Backcountry routes (Phase 6 Task 32, docs/backcountry.md). A route = one 8-connected component of the paintable `Layer.Backcountry` tiles.
 * Its danger (1..5) is derived from the avalanche instability of its tiles (`Avalanche.dangerScore` + fixed thresholds), recomputed once per sim
 * hour and whenever the Networks version moves (the components are cached per version: nothing is scanned per tick). A route CLOSES at danger >=
 * `threshold` (default 4, reason 'Avalanche danger 4': nobody is routed onto it); the player may override that per route or for all routes (the UI
 * asks to confirm). Burials stay injuries (Incidents: nobody is ever removed).
 *
 * Pure sim: no three / DOM. Users: Ski tourers (the guest-type lane calls `pickRoute` / `routes()` / `isOpen` / `dangerOf`) and, as a small share,
 * advanced skiers / boarders in off-piste mode on OPEN routes at danger <= `DANGER.offPisteMax` (NavGraph reads `offPisteMask`).
 */
export interface BackcountryRoute {
  /** Lowest tile index of the component: stable while the route is unchanged. */
  id: number;
  name: string;
  tiles: number[];
  /** Highest / lowest tile (index): where a skier starts / ends. */
  top: number; bottom: number;
  /** 1..5 (the displayed level). */
  danger: number;
  score: number;
  open: boolean;
  /** Why it is closed ('Avalanche danger 4', 'Not connected...', 'Closed: no snow'); undefined when open. */
  closedReason?: string;
  /** Player forces it open despite the danger. */
  override: boolean;
  /** Touches a lift top / hut / piste / trail / path. */
  attached: boolean;
  /** Share (0..1) of its tiles inside a Ski Patrol cover area. */
  covered: number;
  snowy: boolean;
}

export interface BackcountryDeps {
  size: number;
  networks: {
    readonly version: number;
    backcountryComponents(): Array<{ tiles: number[]; top: { x: number; y: number }; bottom: { x: number; y: number } }>;
    attachedToNetwork(tiles: readonly number[]): boolean;
  };
  avalanche: { dangerScore(tiles: ReadonlyArray<number>): number; levelOfScore(score: number): number };
  /** Patrol cover map (>0 = covered). */
  patrol: () => ArrayLike<number>;
  /** Snow on the ground at the tile (skiable). */
  snowy: (i: number) => boolean;
  /** Closed-route tiles for the navigation mask / OpenStatus. Called only when the set changes. */
  onClosedChange?: (tiles: Set<number>) => void;
  bus?: Pick<GameBus, 'emit'>;
}

interface Saved { global?: boolean; threshold?: number; overrides?: number[]; closed?: number[]; levels?: Array<[number, number]> }

export class Backcountry {
  /** Danger level at which routes close (default 4). */
  threshold: number = DANGER.closeAt;
  /** 'Open at danger 4+' for every route. */
  globalOverride = false;
  /** Navigation mask: 1 on tiles of an OPEN route whose danger is <= DANGER.offPisteMax (off-piste skiers may use them). Stable array identity. */
  readonly offPisteMask: Uint8Array;
  /** Bumped when anything displayed changes (levels, open states, routes): render / UI caches key on it. */
  stamp = 0;
  private list: BackcountryRoute[] = [];
  private byId = new Map<number, BackcountryRoute>();
  private byTile = new Map<number, BackcountryRoute>();
  private overrides = new Set<number>();
  private closedByDanger = new Set<number>();
  private ver = -1;
  private hourKey = -1;
  private closedSig = '';

  constructor(private d: BackcountryDeps) { this.offPisteMask = new Uint8Array(d.size * d.size); }

  // ---------- API (docs/backcountry.md) ----------

  routes(): ReadonlyArray<BackcountryRoute> { this.sync(); return this.list; }
  openRoutes(): BackcountryRoute[] { return this.routes().filter((r) => r.open); }
  route(id: number): BackcountryRoute | undefined { this.sync(); return this.byId.get(id); }
  routeAt(tile: number): BackcountryRoute | undefined { this.sync(); return this.byTile.get(tile); }
  routeTiles(id: number): ReadonlyArray<number> { return this.route(id)?.tiles ?? []; }
  /** Danger level 1..5 (0 for an unknown route). */
  dangerOf(id: number): number { return this.route(id)?.danger ?? 0; }
  isOpen(id: number): boolean { return this.route(id)?.open ?? false; }
  get count(): number { return this.routes().length; }
  /** Routes the avalanche rules keep closed right now (not overridden). */
  closedForDanger(): BackcountryRoute[] { return this.routes().filter((r) => !r.open && this.closedByDanger.has(r.id) && !this.effectiveOverride(r.id)); }
  /** True while at least one route is open at danger >= threshold because the player overrode the closure. */
  hasRiskyOpen(): boolean { return this.routes().some((r) => r.open && r.danger >= this.threshold); }

  /**
   * Hook for guest behaviour (Ski tourers, docs/guest-types.md): an OPEN route with danger <= `maxDanger` (tourers pass 3: they never go at >= 4 even
   * when it is open), chosen with the caller's own random stream (`rand()` in [0,1)); null when none. Deterministic: candidates are ordered by id.
   */
  pickRoute(rand: () => number, maxDanger = 3): BackcountryRoute | null {
    const c = this.routes().filter((r) => r.open && r.danger <= maxDanger);
    if (!c.length) return null;
    return c[Math.min(c.length - 1, Math.floor(rand() * c.length))]!;
  }

  // ---------- settings ----------

  effectiveOverride(id: number): boolean { return this.globalOverride || this.overrides.has(id); }
  setOverride(id: number, on: boolean): void {
    if (on === this.overrides.has(id)) return;
    if (on) this.overrides.add(id); else this.overrides.delete(id);
    this.recompute(true);
  }
  setGlobalOverride(on: boolean): void { if (on === this.globalOverride) return; this.globalOverride = on; this.recompute(true); }
  setThreshold(level: number): void { const l = Math.max(3, Math.min(5, Math.round(level))); if (l === this.threshold) return; this.threshold = l; this.recompute(true); }

  // ---------- update ----------

  /** Per sim tick (cheap): the danger is recomputed once per sim hour (tick 5 of the hour), the routes when the Networks version moved. */
  update(tick: number): void {
    const key = Math.floor(tick / 10);
    const due = tick % 10 === 5 && key !== this.hourKey;
    if (!due && this.d.networks.version === this.ver) return;
    if (due) this.hourKey = key;
    this.recompute(true);
  }

  /** Recompute routes + danger + open state now (tests call it after changing instability). */
  refresh(): void { this.recompute(true); }

  private sync(): void { if (this.d.networks.version !== this.ver) this.recompute(true); }

  private recompute(announce: boolean): void {
    const N = this.d.size, comps = this.d.networks.backcountryComponents(), patrol = this.d.patrol();
    this.ver = this.d.networks.version;
    const prevOverrides = this.overrides, prevClosed = this.closedByDanger, prevTile = this.byTile;
    const next: BackcountryRoute[] = [];
    const overrides = new Set<number>(), closed = new Set<number>();
    const sorted = comps.map((c) => ({ c, id: c.tiles.reduce((m, t) => (t < m ? t : m), Infinity) })).sort((a, b) => a.id - b.id);
    const reopenBelow = DANGER.thresholds[Math.max(0, this.threshold - 2)]! - 0.05;
    sorted.forEach(({ c, id }, k) => {
      // identity: a route inherits the override / closed state of the old route it overlaps (editing a route keeps its settings)
      let inheritO = prevOverrides.has(id), inheritC = prevClosed.has(id);
      if (!inheritO || !inheritC) for (const t of c.tiles) {
        const o = prevTile.get(t);
        if (!o) continue;
        if (prevOverrides.has(o.id)) inheritO = true;
        if (prevClosed.has(o.id)) inheritC = true;
        if (inheritO && inheritC) break;
      }
      const score = this.d.avalanche.dangerScore(c.tiles), level = this.d.avalanche.levelOfScore(score);
      const dangerClosed = inheritC ? !(level < this.threshold && score < reopenBelow) : level >= this.threshold;
      if (inheritO) overrides.add(id);
      if (dangerClosed) closed.add(id);
      const override = this.globalOverride || inheritO;
      let snow = 0, cov = 0;
      for (const t of c.tiles) { if (this.d.snowy(t)) snow++; if ((patrol[t] ?? 0) > 0) cov++; }
      const snowy = snow * 2 >= c.tiles.length;
      const attached = this.d.networks.attachedToNetwork(c.tiles);
      const open = attached && snowy && (override || !dangerClosed);
      next.push({
        id, name: `Backcountry route ${k + 1}`, tiles: c.tiles, top: c.top.y * N + c.top.x, bottom: c.bottom.y * N + c.bottom.x,
        danger: level, score, open, override: inheritO, attached, covered: cov / Math.max(1, c.tiles.length), snowy,
        closedReason: open ? undefined : !attached ? 'Not connected to a lift, hut, piste or trail' : !snowy ? 'Closed: no snow' : `Avalanche danger ${Math.max(level, this.threshold)}`,
      });
    });
    const was = new Map(this.list.map((r) => [r.id, r]));
    let changed = next.length !== this.list.length;
    for (const r of next) {
      const w = was.get(r.id);
      if (!w || w.danger !== r.danger || w.open !== r.open || w.override !== r.override || w.tiles.length !== r.tiles.length) changed = true;
      if (announce && w && w.open !== r.open) this.d.bus?.emit(r.open ? 'backcountry:opened' : 'backcountry:closed', { id: r.id, danger: r.danger, ...(r.closedReason ? { reason: r.closedReason } : {}) });
    }
    this.list = next; this.overrides = overrides; this.closedByDanger = closed;
    this.byId = new Map(next.map((r) => [r.id, r]));
    this.byTile = new Map();
    for (const r of next) for (const t of r.tiles) this.byTile.set(t, r);
    if (changed) this.stamp++;
    this.applyClosed();
  }

  private applyClosed(): void {
    const set = new Set<number>(), mask = this.offPisteMask;
    mask.fill(0);
    for (const r of this.list) for (const t of r.tiles) {
      if (!r.open) set.add(t);
      else if (r.danger <= DANGER.offPisteMax) mask[t] = 1;
    }
    const sig = [...set].sort((a, b) => a - b).join(',');
    if (sig === this.closedSig) return;
    this.closedSig = sig;
    this.d.onClosedChange?.(set);
  }

  // ---------- save / load ----------

  /** `null` while there is nothing to save (no route, no setting): the module is then left out of stateHash, so old worlds hash unchanged. */
  serialize(): unknown {
    this.sync();
    if (!this.list.length && !this.overrides.size && !this.globalOverride && this.threshold === DANGER.closeAt) return null;
    return {
      ...(this.globalOverride ? { global: true } : {}), ...(this.threshold !== DANGER.closeAt ? { threshold: this.threshold } : {}),
      overrides: [...this.overrides].sort((a, b) => a - b), closed: [...this.closedByDanger].sort((a, b) => a - b),
      levels: this.list.map((r): [number, number] => [r.id, r.danger]),
    } satisfies Saved;
  }
  load(data: unknown): void {
    const s = (data ?? {}) as Saved;
    this.globalOverride = !!s.global; this.threshold = s.threshold ?? DANGER.closeAt;
    this.overrides = new Set(s.overrides ?? []); this.closedByDanger = new Set(s.closed ?? []);
    this.list = []; this.byId.clear(); this.byTile.clear(); this.closedSig = '\u0000'; this.ver = -1; this.hourKey = -1;
    this.recompute(false);
    // keep the saved level where the route still exists (the stored instability is rounded; save / reload must read the same level)
    const lv = new Map(s.levels ?? []);
    for (const r of this.list) { const l = lv.get(r.id); if (l !== undefined) r.danger = l; }
  }
  reset(): void { this.load(undefined); }

  hash(): string {
    let h = 0x811c9dc5;
    const mix = (v: number): void => { h ^= v | 0; h = Math.imul(h, 0x01000193) >>> 0; };
    for (const r of this.routes()) { mix(r.id); mix(r.danger); mix(r.open ? 1 : 0); mix(r.override ? 1 : 0); }
    return h.toString(16).padStart(8, '0');
  }

  /** 'Considerable (3)'. */
  static describe(r: { danger: number }): string { return dangerText(r.danger); }
}
