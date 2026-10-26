import type { GameState } from '../../core/GameState';
import type { GameBus } from '../../core/events';
import { BUILDINGS } from '../../config/buildings';
import { DAYS_PER_YEAR, EXPLORE, GUEST_CAP, LIFT_PATIENCE_TICKS } from '../../config/balance';
import { hourOfDay } from '../Clock';
import { dayGuestLeaveHour } from '../Daylight';
import { apresEnd, eveningStart, isApres, sleepHour } from '../Evening';
import { Exploration } from './Exploration';
import { Excursions, EXC } from './Excursion';
import type { LiftData } from '../Lift';
import type { SimSystem } from '../Systems';
import type { GuestAttractionPort } from './AttractionPort';
import { Act, Decider, FOOD, type Intent, REST } from './Decision';
import { eventReason, GState, GuestStore, GuestType, Leave } from './Guest';
import { Mode } from './Guest';
import type { GuestWorld, WorldBuilding } from './GuestWorld';
import { LiftQueues, type RideKind } from './LiftQueue';
import { type Goal, type Movement, NavMovement } from './Movement';
import { NavGraph, NavMode, navFromWalkNet, skiModeFor, isSkiMode } from './NavGraph';
import { tickNeeds, type NeedEnv } from './Needs';
import { ReviewDirector, type PlaceText } from './Reviews';
import { injuryRisk, recordRun } from './Skill';
import { createSpawnerSystem, Spawner } from './Spawner';
import { SpatialHash } from './SpatialHash';
import { Layer } from '../../world/Networks';
import type { SafetyGuestPort } from '../ops/Incidents';
import { Families, buildingKidsProvider, type KidsAreaProvider } from './Families';

const WEATHER_PENALTY: Record<string, number> = { storm: 0.15, rain: 0.06, heavySnow: 0.02 };
/** Ticks an activity may run before the guest gives up on it (never softlock). */
const ACT_TIMEOUT = 700;

/** Multi-day trek of one guest: hut booked (day 0 planned, 1 walking up, 2 sleeping in the hut, 3 walking down). */
interface Trek { hut: number; day: 0 | 1 | 2 | 3; arriveDay: number; route: number[] }

const goalOf = (b: WorldBuilding): Goal => ({ x: b.x, y: b.y, rect: { x: b.x, y: b.y, w: b.w, h: b.h }, key: `b${b.id}` });

/**
 * Owns the guest store, spatial hash, spawner, navigation, lift queues and the decision loop. Guests choose a goal by utility
 * (Decider), path over the combined graph (NavMovement) in the mode that fits the activity (walk / ski / hike / bike), queue for and
 * ride lifts (LiftQueues), ski down matching pistes, and level up from completed runs.
 */
export class GuestSim {
  readonly store: GuestStore;
  readonly hash: SpatialHash;
  readonly spawner: Spawner;
  readonly queues: LiftQueues;
  readonly decider: Decider;
  /** Skier exploration: lift memory, via-tile choice, per-tile runs today (sim/guests/Exploration.ts). */
  readonly exploration: Exploration;
  readonly families: Families;
  /** Compressed-time hiking/biking excursions (sim/guests/Excursion.ts). */
  readonly exc: Excursions;
  private chk: Array<Int32Array | null>;
  /** Trekkers by guest id (saved with the guests) and ids that already trekked. */
  readonly trek = new Map<number, Trek>();
  private trekDone = new Set<number>();
  trekStats = { started: 0, nights: 0, completed: 0 };
  private absDay = 0;
  movement: Movement;
  /** Attraction runtime (Task 23). Wire with `setAttractions`. */
  attractions?: GuestAttractionPort;
  private nm: NavMovement | null;
  private navG: NavGraph | null = null;
  private legacyNet: unknown = null;
  private byId = new Map<number, WorldBuilding>();
  private env: NeedEnv = { crowd: 0, weatherPenalty: 0, pisteQuality: 0.5, queueMinutes: 0 };
  /** Ops hook (Task 25): piste quality liking 0..1 for (tile, skill) or null when the tile has none; injury scale likewise. */
  pisteQualityAt: ((tile: number, skill: number) => { like: number; injury: number } | null) | null = null;
  /** Ops hook (Task 25): ski-speed multiplier for a piste tile. */
  pisteSpeedFactor: ((tile: number) => number) | null = null;
  /** Safety hook (Task 26): called when a run ends in injury; returns true when the incident system took the guest over (frozen as Injured). */
  injuryHook: ((guestId: number, x: number, y: number, f: { over: number; offPiste: boolean; quality: number }) => boolean) | null = null;
  private tick = 0;
  /** Guest reviews (M5.1): own RNG, never touches the sim RNG or the saved state. `reviewPlace` names the spot (Names.describeLocation). */
  readonly reviews = new ReviewDirector();
  reviewPlace: ((x: number, y: number) => PlaceText | null) | null = null;
  private maxQueue = new Map<number, number>();
  private hour = 12;
  private rng!: GameState['rng'];
  private bus?: Pick<GameBus, 'emit'>;
  /** Run counters for tests / diagnostics. */
  /** Difficulty: multipliers on queue patience and injury risk. */
  patienceMult = 1; injuryMult = 1;
  runsCompleted = 0; injuries = 0; balks = 0;

  constructor(readonly world: GuestWorld, mapSize: 64 | 128 | 256, bus?: Pick<GameBus, 'emit'>) {
    this.bus = bus;
    this.store = new GuestStore(GUEST_CAP[mapSize]);
    this.hash = new SpatialHash(world.mapSize, this.store.capacity);
    this.nm = new NavMovement(() => this.graph(), this.store.capacity);
    this.movement = this.nm;
    this.queues = new LiftQueues(this.store, () => this.graph()?.world.lifts() ?? []);
    this.decider = new Decider(() => this.graph());
    this.decider.waitTicks = (id, d) => this.queues.waitTicks(id, d);
    this.exploration = new Exploration(() => this.graph(), mapSize);
    this.decider.novelty = (slot, liftId) => this.exploration.noveltyPenalty(this.store, slot, liftId);
    this.chk = new Array<Int32Array | null>(this.store.capacity).fill(null);
    this.exc = new Excursions(this.store, {
      graph: () => this.graph(),
      groundAt: (x, y) => world.groundAt(x, y),
      moveSlot: (slot, x, y, z) => this.moveSlot(slot, x, y, z),
      hour: () => this.hour,
      leaveHour: () => this.decider.leaveHour,
      avoid: (t) => this.decider.avoidTile(t),
      reachedGoal: (slot, kind) => { const s = this.store; this.attractions?.trail(slot, kind === 1 ? 'bike' : 'hike', this.tick); s.visits[slot] = Math.min(255, s.visits[slot]! + 1); },
      foodNear: (x, y) => { for (const b of this.byId.values()) if (FOOD.has(b.type) && b.type !== 'baseLodge' && (b.x + b.w / 2 - x) ** 2 + (b.y + b.h / 2 - y) ** 2 <= 36) return true; return false; },
      lunch: (slot) => { const s = this.store; s.hunger[slot] = 0.05; s.budget[slot] = s.budget[slot]! - 12; this.world.onSpend?.(12, 'food'); },
      finished: (slot, ok, isTrek) => this.excFinished(slot, ok, isTrek),
    });
    this.spawner = new Spawner(world, this.store, this.hash, bus);
    const provider = buildingKidsProvider(() => world.buildings(), () => world.isSnowy?.() ?? true, (id) => world.isBuildingOpen?.(id) ?? true);
    this.families = new Families(this.store, {
      startLeaving: (slot, reason) => this.startLeaving(slot, reason),
      despawn: (slot) => this.despawn(slot),
      place: (slot, x, y) => { const s = this.store; this.exc.drop(slot); s.px[slot] = s.x[slot]!; s.py[slot] = s.y[slot]!; s.pz[slot] = s.z[slot]!; this.moveSlot(slot, x, y, world.groundAt(x, y)); if (s.state[slot] !== GState.Leaving) { s.state[slot] = GState.Idle; s.act[slot] = Act.None; s.timer[slot] = 5; } },
      onSpend: (a, w) => world.onSpend?.(a, w),
      direct: (slot, kind, id) => {
        const s = this.store;
        if (s.state[slot] === GState.Riding || s.state[slot] === GState.Leaving) return;
        if (s.state[slot] === GState.Walking && s.act[slot] === Act.ToBuilding && s.target[slot] === id) return;
        this.queues.cancel(slot);
        this.start(slot, { kind, building: this.byId.get(id), score: 9 });
      },
    }, provider, bus, (c, a) => world.onEarn?.(c, a));
    this.decider.skillCap = (slot) => this.families.skillCap(slot);
    this.decider.canTrek = (id) => !this.trek.has(id) && !this.trekDone.has(id);
  }

  /** Save load: forget navigation / decision caches so they are rebuilt from the restored world (identically in every run). */
  resetRuntime(): void {
    this.nm?.resetAll(); this.navG = null; this.legacyNet = null; this.byId.clear(); this.decider.reset(); this.exploration.reset();
  }

  /** Replace the kids-venue source (Task 23's attraction registry). */
  setKidsProvider(p: KidsAreaProvider): void { this.families.provider = p; }

  /** The navigation graph (built lazily once the world can provide it). */
  graph(): NavGraph | null {
    const nw = this.world.nav?.() ?? null;
    if (nw) {
      if (!this.navG || this.navG.world !== nw) this.attach(new NavGraph(nw));
      return this.navG;
    }
    const wn = this.world.walkNet();
    if (!wn) return null;
    if (!this.navG || this.legacyNet !== wn) { this.legacyNet = wn; this.attach(new NavGraph(navFromWalkNet(wn))); }
    return this.navG;
  }

  private attach(g: NavGraph): void {
    this.navG = g;
    g.waitTicks = (id, d) => this.queues.waitTicks(id, d);
    g.qualityFactor = this.pisteSpeedFactor ? (t) => this.pisteSpeedFactor!(t) : null;
  }

  setAttractions(p: GuestAttractionPort | undefined): void { this.attractions = p; this.decider.port = p; }

  systems(): SimSystem[] { return [createSpawnerSystem(this.spawner), this.guestsSystem()]; }

  guestsSystem(): SimSystem {
    return {
      id: 'guests',
      update: (state, tick) => this.update(state, tick),
      serialize: () => ({ ...this.store.serialize(), ring: this.queues.serializeRings(), exc: this.exc.serialize(), trek: [...this.trek].sort((a, b) => a[0] - b[0]).map(([id, t]) => [id, t.hut, t.day, t.arriveDay, t.route]), trekDone: [...this.trekDone].sort((a, b) => a - b) }),
      load: (d) => {
        this.store.load(d as ReturnType<GuestStore['serialize']>); this.hash.clear(); this.rebuildHash(); this.queues.clear();
        this.queues.loadRings((d as { ring?: Array<[number, number[]]> }).ring);
        const s = this.store;
        this.exc.load((d as { exc?: ReturnType<Excursions['serialize']> }).exc); this.chk.fill(null);
        this.trek.clear(); this.trekDone = new Set((d as { trekDone?: number[] }).trekDone ?? []);
        for (const r of (d as { trek?: Array<[number, number, 0 | 1 | 2 | 3, number, number[]]> }).trek ?? []) this.trek.set(r[0], { hut: r[1], day: r[2], arriveDay: r[3], route: r[4] });
        for (let i = 0; i < s.limit; i++) {
          if (!s.alive[i]) continue;
          if (s.act[i] === Act.Excursion && !this.exc.has(i)) { s.state[i] = GState.Idle; s.act[i] = Act.None; s.timer[i] = 5; }
          if (s.state[i] === GState.Queueing || s.state[i] === GState.Riding) { s.state[i] = GState.Idle; s.timer[i] = 5; s.act[i] = Act.None; }
        }
      },
    };
  }

  /** Safety port (Task 26): the incident system sees guests by id; frozen guests are Injured until released. */
  safetyPort(): SafetyGuestPort {
    const s = this.store;
    const out: number[] = [];
    return {
      position: (id) => { const i = s.slotOf(id); return i < 0 ? null : { x: s.x[i]!, y: s.y[i]! }; },
      near: (x, y, r, mode) => {
        const ids: number[] = [];
        for (const i of this.hash.query(x, y, r, s.x, s.y, out)) {
          if (!s.alive[i]) continue;
          const st = s.state[i]!;
          if (mode === 'prey') { if (st === GState.Injured || (s.moveMode[i] !== NavMode.SkiOff && s.moveMode[i] !== NavMode.Hike) || s.act[i] === Act.None) continue; }
          else if (st === GState.Riding || st === GState.Queueing || st === GState.Sleeping) continue;
          ids.push(s.id[i]!);
        }
        return ids;
      },
      freeze: (id) => {
        const i = s.slotOf(id);
        if (i < 0 || s.state[i] === GState.Injured || s.state[i] === GState.Riding) return false;
        this.queues.cancel(i); this.nm?.reset(i); this.exc.drop(i);
        s.state[i] = GState.Injured; s.act[i] = Act.None; s.target[i] = 0;
        return true;
      },
      release: (id, how, severe) => {
        const i = s.slotOf(id);
        if (i < 0 || s.state[i] !== GState.Injured) return;
        s.happiness[i] = Math.max(0, s.happiness[i]! - (severe ? 0.4 : 0.1));
        if (how === 'return') { s.state[i] = GState.Idle; s.timer[i] = 10; s.act[i] = Act.None; return; }
        s.leaveReason[i] = Leave.Injured;
        if (how === 'leave') { this.startLeaving(i, Leave.Injured); return; }
        this.despawn(i);
      },
      scare: (id, _fx, _fy, leave) => {
        const i = s.slotOf(id);
        if (i < 0 || !s.alive[i]) return false;
        const st = s.state[i]!;
        if (st !== GState.Walking && st !== GState.Idle) return false;
        s.happiness[i] = Math.max(0, s.happiness[i]! - 0.12);
        if (leave && s.happiness[i]! < 0.7) { this.queues.cancel(i); this.nm?.reset(i); this.startLeaving(i, Leave.Bored); return true; }
        if (this.exc.has(i)) { this.exc.turnBack(i); return true; }
        this.abort(i, 12 + (s.id[i]! % 20)); // cut the activity short, pick something else (the Decider steers away from the field)
        return true;
      },
      hurtNear: (x, y, r, amount) => {
        for (const i of this.hash.query(x, y, r, s.x, s.y, out)) if (s.alive[i] && s.state[i] !== GState.Injured) s.happiness[i] = Math.max(0, s.happiness[i]! - amount);
      },
    };
  }

  private rebuildHash(): void {
    const s = this.store;
    for (let i = 0; i < s.limit; i++) if (s.alive[i]) this.hash.insert(i, s.x[i]!, s.y[i]!);
  }

  private refreshTargets(): void {
    this.byId.clear();
    const list: WorldBuilding[] = [];
    for (const b of this.world.buildings()) { this.byId.set(b.id, b); list.push(b); }
    this.decider.refresh(list);
  }

  /** Movement mode that fits where the guest currently stands. */
  private contextMode(i: number): number {
    const g = this.graph(), s = this.store;
    if (!g) return NavMode.Walk;
    const n = g.size, x = Math.floor(s.x[i]!), y = Math.floor(s.y[i]!);
    if (x < 0 || y < 0 || x >= n || y >= n) return NavMode.Walk;
    const t = y * n + x;
    if (g.isStation(t)) return skiModeFor(s.skill[i]!);
    const k = g.world.kind[t]!;
    if (k === 1 || k === 2) return NavMode.Walk;
    const l = g.layersAt(t);
    if ((l & Layer.Ski) !== 0) return skiModeFor(s.skill[i]!);
    if ((l & Layer.Mtb) !== 0) return NavMode.Bike;
    if ((l & Layer.Hike) !== 0) return NavMode.Hike;
    return NavMode.Walk;
  }

  private startLeaving(i: number, reason: number): void {
    const s = this.store;
    this.queues.cancel(i); this.exc.drop(i); this.trekCleanup(i);
    s.moveMode[i] = this.contextMode(i);
    s.state[i] = GState.Leaving; s.leaveReason[i] = reason; s.target[i] = 0; s.timer[i] = 0; s.act[i] = Act.None;
    this.nm?.reset(i);
  }

  private despawn(i: number): void {
    const id = this.store.id[i]!, reason = eventReason(this.store.leaveReason[i]!);
    this.queues.cancel(i); this.exc.drop(i); this.trekCleanup(i);
    const rv = this.reviews.enabled ? this.reviewFor(i, id, reason) : null;
    this.maxQueue.delete(id);
    this.hash.remove(i);
    this.store.remove(i);
    this.bus?.emit('guest:left', { id, reason });
    if (rv) this.bus?.emit('guest:review', rv);
  }

  private reviewFor(i: number, id: number, reason: ReturnType<typeof eventReason>) {
    const s = this.store, x = s.x[i]!, y = s.y[i]!;
    const q = this.pisteQualityAt && s.runs[i]! > 0 ? this.pisteQualityAt(((y | 0) * this.world.mapSize) + (x | 0), s.skill[i]!) : null;
    return this.reviews.consider({
      id, day: this.absDay, reason, happiness: s.happiness[i]!, hunger: s.hunger[i]!, fatigue: s.fatigue[i]!, budget: s.budget[i]!, runs: s.runs[i]!,
      queueMin: this.maxQueue.get(id) ?? 0, crowd: this.hash.countAt(x, y), weatherPenalty: this.env.weatherPenalty, pisteLike: q ? q.like : null, x, y,
    }, this.reviewPlace?.(x, y) ?? null);
  }

  private exitGoal(i: number): Goal | null {
    const mode = this.store.mode[i]!;
    if (mode === Mode.Road) {
      const e = this.world.roadEntry();
      return e ? { x: e.x, y: e.y, key: 'exit-road' } : null;
    }
    const type = mode === Mode.Rail ? 'trainStation' : 'altiport';
    for (const b of this.byId.values()) if (b.type === type) return goalOf(b);
    return null;
  }

  private liftData(id: number): LiftData | undefined { return this.graph()?.world.lifts().find((l) => l.id === id); }

  private moveSlot(slot: number, x: number, y: number, z: number): void {
    const s = this.store;
    s.x[slot] = x; s.y[slot] = y; s.z[slot] = z;
    this.hash.move(slot, x, y);
  }

  private patienceOf(i: number): number {
    const s = this.store;
    const t = s.type[i] === GuestType.VIP ? 0.7 : s.type[i] === GuestType.Budget ? 1.3 : 1;
    return LIFT_PATIENCE_TICKS * this.patienceMult * t * (0.6 + 0.8 * s.happiness[i]!);
  }

  private rideKind(i: number): RideKind {
    const m = this.store.moveMode[i]!;
    return isSkiMode(m) ? 'ski' : m === NavMode.Bike ? 'bike' : 'foot';
  }

  private queueCallbacks = {
    done: (slot: number, liftId: number, dir: 0 | 1): void => {
      const s = this.store, l = this.liftData(liftId);
      if (!l || s.state[slot] !== GState.Riding) return;
      const p = dir === 0 ? l.top : l.bottom;
      s.px[slot] = s.x[slot]!; s.py[slot] = s.y[slot]!; s.pz[slot] = s.z[slot]!;
      this.moveSlot(slot, p.x + 0.5, p.y + 0.5, p.ground);
      s.state[slot] = GState.Walking; s.actTick[slot] = this.tick;
      if (s.rideRun[slot]) {
        s.act[slot] = Act.SkiDown; s.runMax[slot] = 0; s.rideRun[slot] = 0;
        this.exploration.remember(s, slot, liftId); // skiers only: pick the line for this run
        if (dir === 0 && isSkiMode(s.moveMode[slot]!)) s.via[slot] = this.exploration.pickVia(s, slot, l, this.rng);
      }
      this.nm?.reset(slot);
    },
    released: (slot: number, _liftId: number, reason: 'closed' | 'impatient'): void => {
      const s = this.store;
      if (s.state[slot] !== GState.Queueing && s.state[slot] !== GState.Riding) return;
      s.state[slot] = GState.Idle; s.timer[slot] = 4; s.act[slot] = Act.None; s.rideRun[slot] = 0;
      if (reason === 'impatient') { s.happiness[slot] = Math.max(0, s.happiness[slot]! - 0.08); this.balks++; }
      this.nm?.reset(slot);
    },
    moved: (slot: number, x: number, y: number, z: number): void => {
      const s = this.store;
      s.px[slot] = s.x[slot]!; s.py[slot] = s.y[slot]!; s.pz[slot] = s.z[slot]!;
      this.moveSlot(slot, x, y, z);
    },
    boarded: (liftId: number, slot: number): void => {
      this.store.state[slot] = GState.Riding;
      this.world.onLiftRide?.(liftId, this.store.id[slot]!, this.rideKind(slot) !== 'ski');
    },
  };

  update(state: GameState, tick: number): void {
    const s = this.store, rng = state.rng, w = this.world;
    this.tick = tick; this.rng = rng;
    const g = this.graph();
    g?.update(tick);
    this.movement.beginTick?.(tick);
    const mv = this.movement;
    if (this.byId.size === 0 || tick % 20 === 0) this.refreshTargets();
    this.exploration.beginTick(state.date.day);
    this.queues.update(tick, this.queueCallbacks);
    const hour = hourOfDay(state.date);
    this.hour = hour;
    this.families.update(tick, hour, state.date.year * DAYS_PER_YEAR + state.date.day);
    const absDay = state.date.year * DAYS_PER_YEAR + state.date.day;
    this.absDay = absDay;
    const night = hour >= sleepHour(state.date.day) || hour < 6.5; // overnight guests are active in the evening (dinner, drinks) until bedtime
    const leaveHour = dayGuestLeaveHour(state.date.day); // day guests head home before sunset
    const env = this.env;
    env.weatherPenalty = WEATHER_PENALTY[w.weather().kind] ?? 0;
    this.decider.day = state.date.day; this.decider.eveningStart = eveningStart(state.date.day);
    const venuesOpen = this.decider.food.length + this.decider.bars.length > 0;
    this.decider.leaveHour = leaveHour; this.decider.stormy = w.weather().kind === 'storm';

    for (let i = 0; i < s.limit; i++) {
      if (!s.alive[i]) continue;
      s.wpN[i] = 0; // render waypoints of the previous tick are stale
      if (s.state[i] === GState.Injured) { s.px[i] = s.x[i]!; s.py[i] = s.y[i]!; s.pz[i] = s.z[i]!; continue; } // frozen until the incident system releases them
      if (this.families.controls(i)) continue; // kids / followers are driven by the family system
      if (s.act[i] !== Act.Excursion && this.exc.map.size > 0 && this.exc.map.has(i)) this.exc.drop(i); // something else took the guest over
      let st = s.state[i]!;
      if (st !== GState.Riding && st !== GState.Queueing) { s.px[i] = s.x[i]!; s.py[i] = s.y[i]!; s.pz[i] = s.z[i]!; }
      env.crowd = this.hash.countAt(s.x[i]!, s.y[i]!);
      env.queueMinutes = st === GState.Queueing ? (tick - s.actTick[i]!) * 0.25 : 0;
      if (st === GState.Queueing && this.reviews.enabled && env.queueMinutes > (this.maxQueue.get(s.id[i]!) ?? 0)) this.maxQueue.set(s.id[i]!, env.queueMinutes);
      env.pisteQuality = 0.5;
      if (this.pisteQualityAt && s.act[i] === Act.SkiDown) { const q = this.pisteQualityAt(((s.y[i]! | 0) * this.world.mapSize) + (s.x[i]! | 0), s.skill[i]!); if (q) env.pisteQuality = q.like; }
      const leave = tickNeeds(s, i, env);
      if (leave && st !== GState.Riding) { this.startLeaving(i, leave); }
      st = s.state[i]!;
      if (st !== GState.Leaving && st !== GState.Riding) {
        const tr = this.trek.size ? this.trek.get(s.id[i]!) : undefined;
        if (tr && tr.day === 2) {
          if (st !== GState.Sleeping) { s.state[i] = GState.Sleeping; s.act[i] = Act.None; }
          if (absDay > tr.arriveDay && hour >= 6.5) this.trekWake(i, tr);
          continue;
        }
        if (!s.overnight[i] && hour >= leaveHour && this.exc.has(i) && hour < leaveHour + 2) { if (this.exc.map.get(i)!.e < this.exc.map.get(i)!.tOut) this.exc.turnBack(i); }
        else if (!s.overnight[i] && hour >= leaveHour) {
          // après-ski share of day guests stays for a drink until ~19:00-20:00 (winter) when a venue is serving
          if (!(venuesOpen && hour < apresEnd(s.id[i]!, state.date.day) && isApres(s.id[i]!, s.type[i]!, state.date.day))) { this.startLeaving(i, Leave.Closing); st = GState.Leaving; }
        }
        else if (s.overnight[i]) {
          if (absDay >= s.leaveDay[i]! && hour >= 9 && !night) { this.startLeaving(i, Leave.Satisfied); st = GState.Leaving; }
          else if (night && st !== GState.Sleeping && st !== GState.Using) { this.queues.cancel(i); s.state[i] = st = GState.Sleeping; s.act[i] = Act.None; }
          else if (!night && st === GState.Sleeping) { s.state[i] = st = GState.Idle; s.timer[i] = 0; }
        }
      }
      if (hour < 12 && s.eve[i]) s.eve[i] = 0;
      if (st === GState.Sleeping || st === GState.Riding || st === GState.Queueing || st === GState.Using) continue;

      if (st === GState.Leaving) {
        const goal = this.exitGoal(i);
        const res = goal ? mv.moveTo(s, i, goal) : 'arrived';
        if (res === 'moving') { this.after(i); continue; }
        if (res === 'lift') { this.requestRide(i, false); continue; }
        if (res === 'pending') { s.timer[i]!++; if (s.timer[i]! < 300) continue; }
        this.despawn(i);
        continue;
      }
      if (st === GState.Walking) { this.walk(i, rng); continue; }
      // Idle
      if (--s.timer[i]! > 0) continue;
      this.decide(i, rng);
    }
    this.families.sync();
  }

  /** Hikers and bikers do not linger after a stop (the excursion model makes a trail goal worth the day). */
  private eager(i: number): boolean { const p = this.store.pref[i]; return this.decider.useGoals && (p === 1 || p === 2) && this.decider.hikeTiles.length > 0; }

  private after(i: number): void {
    const s = this.store;
    s.z[i] = this.world.groundAt(s.x[i]!, s.y[i]!);
    this.hash.move(i, s.x[i]!, s.y[i]!);
  }

  private abort(i: number, wait = 15): void {
    const s = this.store;
    s.state[i] = GState.Idle; s.timer[i] = wait; s.act[i] = Act.None; s.target[i] = 0; s.rideRun[i] = 0;
    this.exc.drop(i);
    { const tk = this.trek.get(s.id[i]!); if (tk && tk.day === 0) this.trek.delete(s.id[i]!); }
    this.nm?.reset(i);
  }

  private trekCleanup(i: number): void {
    const id = this.store.id[i]!, t = this.trek.get(id);
    if (!t) return;
    if (t.day > 0) this.attractions?.releaseBed?.(id);
    this.trek.delete(id);
  }

  private excFinished(slot: number, ok: boolean, isTrek: boolean): void {
    const s = this.store, id = s.id[slot]!, t = this.trek.get(id);
    if (s.state[slot] !== GState.Walking) return;
    if (isTrek && t && t.day === 1) {
      const hb = this.byId.get(t.hut);
      if (ok && hb && this.attractions?.checkInBed?.(slot, t.hut)) {
        t.day = 2; t.arriveDay = this.absDay; this.trekStats.nights++;
        s.px[slot] = s.x[slot]!; s.py[slot] = s.y[slot]!; s.pz[slot] = s.z[slot]!;
        this.moveSlot(slot, hb.x + hb.w / 2, hb.y + hb.h / 2, this.world.groundAt(hb.x, hb.y));
        s.state[slot] = GState.Sleeping; s.act[slot] = Act.None; s.happiness[slot] = Math.min(1, s.happiness[slot]! + 0.1);
        return;
      }
      this.trekCleanup(slot); // aborted on the way up: the bed is released, the guest carries on as a day guest
    }
    s.state[slot] = GState.Idle; s.act[slot] = Act.None; s.timer[slot] = this.rng.int(5, 15); this.after(slot);
    if (t && t.day === 3 && ok) {
      this.trekStats.completed++; this.trekDone.add(id); this.trek.delete(id);
      s.happiness[slot] = Math.min(1, s.happiness[slot]! + 0.15);
      this.startLeaving(slot, Leave.Satisfied);
    } else if (t && t.day === 3) this.trek.delete(id);
  }

  /** Morning after a night in the hut: walk down the same route (compressed time), then leave. */
  private trekWake(i: number, t: Trek): void {
    const s = this.store, id = s.id[i]!, g = this.graph();
    this.attractions?.releaseBed?.(id);
    s.state[i] = GState.Walking; s.moveMode[i] = NavMode.Hike; s.target[i] = 0;
    const route = Int32Array.from(t.route).reverse();
    if (g && this.exc.begin(i, route, 0, this.world.networkVersion(), g.size, true, false, true)) { t.day = 3; s.actTick[i] = this.tick; s.happiness[i] = Math.min(1, s.happiness[i]! + 0.1); return; }
    this.trek.delete(id); this.trekDone.add(id);
    s.state[i] = GState.Idle; this.startLeaving(i, Leave.Satisfied);
  }

  private goalFor(i: number): Goal | null {
    const s = this.store, g = this.graph();
    switch (s.act[i]) {
      case Act.ToBuilding: { const b = this.byId.get(s.target[i]!); return b ? goalOf(b) : null; }
      case Act.ToLift: {
        const l = this.liftData(s.liftId[i]!);
        return l && g ? { x: l.bottom.x, y: l.bottom.y, rect: g.stationRect(l, 0), inside: true, key: `lb${l.id}` } : null;
      }
      case Act.SkiDown: {
        const l = this.liftData(s.liftId[i]!);
        if (s.via[i]! > 0 && g) { const t = s.via[i]! - 1, n = g.size; return { x: (t % n) + 0.5, y: Math.floor(t / n) + 0.5, key: `v${t}` }; } // exploration: ski via a chosen line
        return l && g ? { x: l.bottom.x, y: l.bottom.y, rect: g.stationRect(l, 0), inside: true, key: `lb${l.id}` } : null;
      }
      case Act.ToTrail: return { x: s.goalX[i]!, y: s.goalY[i]!, key: `t${Math.floor(s.goalX[i]!)}_${Math.floor(s.goalY[i]!)}` };
      default: return null;
    }
  }

  private walk(i: number, rng: GameState['rng']): void {
    const s = this.store;
    if (s.act[i] === Act.None) { this.decide(i, rng); return; }
    if (s.act[i] === Act.Excursion) { this.exc.step(i); return; }
    if (this.tick - s.actTick[i]! > ACT_TIMEOUT) { this.abort(i, 5); return; }
    const goal = this.goalFor(i);
    if (!goal) { this.abort(i); return; }
    const res = this.movement.moveTo(s, i, goal);
    switch (res) {
      case 'moving': this.after(i); if (s.act[i] === Act.ToTrail) this.tryExcursion(i); return;
      case 'pending': return;
      case 'lift': this.requestRide(i, true); return;
      case 'arrived': this.arrived(i, rng); return;
      case 'unreachable':
        if (s.act[i] === Act.SkiDown) {
          if (s.via[i]! > 0) { s.via[i] = 0; this.nm?.reset(i); return; } // the chosen line is not skiable (right now): take the plain route
          // stranded (piste closed under them): first try as a foot passenger (hike mode rides foot lifts down), then go home
          if (isSkiMode(s.moveMode[i]!)) { s.moveMode[i] = NavMode.Hike; this.nm?.reset(i); return; }
          this.startLeaving(i, Leave.Satisfied);
          return;
        }
        if (s.act[i] === Act.ToTrail) this.decider.goals.markBad(Math.floor(s.goalY[i]!) * (this.graph()?.size ?? 1) + Math.floor(s.goalX[i]!));
        this.abort(i, 20);
    }
  }

  /** Convert a hike/bike path with no lift hop left and >= EXC.minTiles remaining into a compressed-time excursion. */
  private tryExcursion(i: number): void {
    const nm = this.nm, g = this.graph(), s = this.store;
    if (!nm || !g || !this.exc.enabled || (s.moveMode[i] !== NavMode.Hike && s.moveMode[i] !== NavMode.Bike)) return;
    const p = nm.pathOf(i);
    if (!p || this.chk[i] === p.nodes) return;
    this.chk[i] = p.nodes;
    const n = g.size, nodes = p.nodes;
    for (let k = p.index; k + 1 < nodes.length; k++) {
      const a = nodes[k]!, b = nodes[k + 1]!;
      if (Math.abs((a % n) - (b % n)) > 1 || Math.abs(((a / n) | 0) - ((b / n) | 0)) > 1) return; // a lift ride first
    }
    const rest = nodes.slice(p.index);
    if (rest.length < EXC.minTiles) return;
    const bike = s.moveMode[i] === NavMode.Bike;
    const tk = this.trek.get(s.id[i]!), isTrek = !!tk && tk.day === 0;
    const oneWay = isTrek || (bike && g.tileAltitude(rest[rest.length - 1]!) < g.tileAltitude(rest[0]!) - 0.2);
    if (this.exc.begin(i, rest, bike ? 1 : 0, this.world.networkVersion(), n, oneWay, isTrek, isTrek)) {
      if (isTrek) {
        if (!this.attractions?.reserveBed?.(s.id[i]!, tk!.hut)) { this.exc.drop(i); this.trek.delete(s.id[i]!); this.abort(i, 12); return; }
        tk!.day = 1; tk!.route = Array.from(rest); this.trekStats.started++;
      } this.nm?.reset(i); this.chk[i] = null; s.actTick[i] = this.tick; } else { const k = `noFit@${Math.floor(this.hour)}`; this.exc.why[k] = (this.exc.why[k] ?? 0) + 1; this.abort(i, 12); }
  }

  /** The path's next edge is a lift ride: join its queue (balk / closed lift -> forget the plan). */
  private requestRide(i: number, rideLinks: boolean): void {
    const s = this.store, nm = this.nm;
    const tag = nm ? nm.liftTag[i]! : -1;
    if (tag < 0) { this.abort(i); return; }
    const liftId = tag >> 1, dir = (tag & 1) as 0 | 1;
    if (this.world.canRide && !this.world.canRide(s.id[i]!, this.rideKind(i) !== 'ski')) { this.abort(i, 30); return; } // no pass / can't afford one
    const res = this.queues.join(liftId, dir, i, this.rideKind(i), this.tick, this.patienceOf(i));
    if (res === 'ok') {
      s.state[i] = GState.Queueing; s.liftId[i] = liftId; s.rideRun[i] = 0;
      const l = this.liftData(liftId);
      if (l) this.moveSlot(i, (dir === 0 ? l.bottom.x : l.top.x) + 0.5, (dir === 0 ? l.bottom.y : l.top.y) + 0.5, this.world.groundAt(l.bottom.x, l.bottom.y));
      return;
    }
    if (res === 'balk') { this.balks++; s.happiness[i] = Math.max(0, s.happiness[i]! - 0.02); }
    if (s.state[i] === GState.Leaving && !rideLinks) { s.timer[i]!++; return; }
    this.abort(i, 10);
  }

  private arrived(i: number, rng: GameState['rng']): void {
    const s = this.store;
    switch (s.act[i]) {
      case Act.ToBuilding: {
        const b = this.byId.get(s.target[i]!);
        const res = b && this.attractions ? this.attractions.arrive(i, b, this.tick) : 'unhandled';
        if (res === 'using') return;
        if (b && res === 'unhandled') this.visit(i, b);
        s.state[i] = GState.Idle; s.timer[i] = this.eager(i) ? rng.int(3, 10) : rng.int(EXPLORE.visitPause[0], EXPLORE.visitPause[1]); s.act[i] = Act.None; s.target[i] = 0;
        return;
      }
      case Act.ToLift: {
        if (this.world.canRide && !this.world.canRide(s.id[i]!, this.rideKind(i) !== 'ski')) { this.abort(i, 30); return; }
        const res = this.queues.join(s.liftId[i]!, 0, i, this.rideKind(i), this.tick, this.patienceOf(i));
        if (res === 'ok') { s.state[i] = GState.Queueing; s.rideRun[i] = 1; s.act[i] = Act.Queue; const l = this.liftData(s.liftId[i]!); if (l) this.moveSlot(i, l.bottom.x + 0.5, l.bottom.y + 0.5, this.world.groundAt(l.bottom.x, l.bottom.y)); return; }
        if (res === 'balk') { this.balks++; s.happiness[i] = Math.max(0, s.happiness[i]! - 0.02); }
        this.abort(i, 8);
        return;
      }
      case Act.SkiDown:
        if (s.via[i]! > 0) { this.exploration.recordVia(s.via[i]! - 1); s.via[i] = -s.via[i]!; this.nm?.reset(i); return; } // via reached: carry on to the bottom
        this.finishRun(i, rng); return;
      case Act.ToTrail: {
        const pend = this.exc.pending.get(i);
        if (pend !== undefined) { const n = this.graph()?.size ?? 1; this.exc.pending.delete(i); s.goalX[i] = (pend % n) + 0.5; s.goalY[i] = Math.floor(pend / n) + 0.5; s.actTick[i] = this.tick; this.exc.liftFirst++; this.nm?.reset(i); return; }
        { const tk = this.trek.get(s.id[i]!); if (tk && tk.day === 0) this.trek.delete(s.id[i]!); }
        this.attractions?.trail(i, s.moveMode[i] === NavMode.Bike ? 'bike' : 'hike', this.tick);
        s.visits[i] = Math.min(255, s.visits[i]! + 1);
        s.state[i] = GState.Idle; s.timer[i] = rng.int(20, 50); s.act[i] = Act.None;
        return;
      }
      default: this.abort(i, 10);
    }
  }

  /** Bottom of a run: experience, injury roll (hook for Task 26), then rest a moment. */
  private finishRun(i: number, rng: GameState['rng']): void {
    const s = this.store;
    const diff = s.runMax[i]!, skill = s.skill[i]!;
    recordRun(s, i, diff);
    this.runsCompleted++;
    s.fatigue[i] = Math.min(1, s.fatigue[i]! + 0.02);
    s.state[i] = GState.Idle; s.timer[i] = rng.int(EXPLORE.runPause[0], EXPLORE.runPause[1]); s.act[i] = Act.None;
    const pq = this.pisteQualityAt?.(((s.y[i]! | 0) * this.world.mapSize) + (s.x[i]! | 0), skill);
    const offPiste = s.moveMode[i] === NavMode.SkiOff;
    const w = this.world.weather();
    const vis = w.kind === 'storm' ? 1.5 : w.kind === 'heavySnow' ? 1.3 : 1;
    const crowd = this.hash.countAt(s.x[i]!, s.y[i]!) > 8 ? 1.2 : 1;
    if (rng.chance(injuryRisk(diff, skill, pq ? pq.injury : 0.5) * this.injuryMult * vis * crowd * (offPiste ? 1.8 : 1))) {
      this.injuries++;
      this.bus?.emit('incident:injury', { guestId: s.id[i]!, x: s.x[i]!, y: s.y[i]! });
      s.happiness[i] = Math.max(0, s.happiness[i]! - 0.25);
      if (this.injuryHook?.(s.id[i]!, s.x[i]!, s.y[i]!, { over: diff - skill, offPiste, quality: pq ? pq.injury : 1 })) return;
      if (rng.chance(0.35)) this.startLeaving(i, Leave.Injured);
    }
  }

  private visit(i: number, b: WorldBuilding): void {
    const s = this.store;
    s.visits[i] = Math.min(255, s.visits[i]! + 1);
    if (FOOD.has(b.type) && s.hunger[i]! > 0.25) {
      const cost = 12;
      s.hunger[i] = 0.05; s.budget[i] = s.budget[i]! - cost; this.world.onSpend?.(cost, 'food');
    }
    if (REST.has(b.type) && s.fatigue[i]! > 0.5) s.fatigue[i] = Math.max(0, s.fatigue[i]! - 0.4);
    if (BUILDINGS[b.type]?.id === 'shop' && s.budget[i]! > 40) { s.budget[i] = s.budget[i]! - 15; this.world.onSpend?.(15, 'shop'); }
  }

  private decide(i: number, rng: GameState['rng']): void {
    const s = this.store;
    const ov = this.families.override(i);
    if (ov) { this.start(i, { kind: ov.kind, building: ov.buildingId ? this.byId.get(ov.buildingId) : undefined, score: 9 }); return; }
    if (rng.chance((s.visits[i]! * 0.04 + s.runs[i]! * 0.004) * EXPLORE.leaveScale)) { this.startLeaving(i, Leave.Satisfied); return; }
    const it = this.decider.choose(s, i, rng, this.hour);
    this.start(i, it);
  }

  private start(i: number, it: Intent): void {
    const s = this.store;
    s.actTick[i] = this.tick; s.target[i] = 0; s.rideRun[i] = 0;
    this.exc.drop(i);
    this.nm?.reset(i);
    switch (it.kind) {
      case 'eat': case 'rest': case 'shop': case 'activity': case 'lesson':
        if (it.building && (it.kind === 'eat' || it.kind === 'activity') && this.hour >= this.decider.eveningStart && s.eve[i]! < 255 && (s.overnight[i] || isApres(s.id[i]!, s.type[i]!, this.decider.day))) s.eve[i] = s.eve[i]! + 1;
        if (!it.building) { s.state[i] = GState.Idle; s.timer[i] = 10; return; }
        s.target[i] = it.building.id; s.act[i] = Act.ToBuilding; s.state[i] = GState.Walking; s.moveMode[i] = this.contextMode(i);
        return;
      case 'ski':
        if (!it.lift) { s.state[i] = GState.Idle; s.timer[i] = 10; return; }
        s.liftId[i] = it.lift.lift.id; s.act[i] = Act.ToLift; s.state[i] = GState.Walking;
        s.moveMode[i] = it.offPiste ? NavMode.SkiOff : skiModeFor(s.skill[i]!);
        return;
      case 'hike': case 'bike': {
        const n = this.graph()?.size ?? 1, t = it.tile ?? 0;
        if (it.trek !== undefined && it.kind === 'hike') this.trek.set(s.id[i]!, { hut: it.trek, day: 0, arriveDay: 0, route: [] });
        let gt = t;
        if (it.via !== undefined && it.via >= 0) { this.exc.pending.set(i, t); gt = it.via; } else this.exc.pending.delete(i);
        s.goalX[i] = (gt % n) + 0.5; s.goalY[i] = Math.floor(gt / n) + 0.5;
        s.act[i] = Act.ToTrail; s.state[i] = GState.Walking; s.moveMode[i] = it.kind === 'hike' ? NavMode.Hike : NavMode.Bike;
        return;
      }
      case 'home': this.startLeaving(i, Leave.Satisfied);
    }
  }
}
