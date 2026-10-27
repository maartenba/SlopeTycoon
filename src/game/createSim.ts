import { Grid, TileType } from '../world/Grid';
import { generateTerrain, type TerrainResult } from '../world/TerrainGen';
import { generateProps, PropStore } from '../world/Props';
import { Layer as NetLayer, Networks } from '../world/Networks';
import { Weather, SnowCover, createWeatherSystem } from '../sim/Weather';
import { Safety } from '../sim/ops/Safety';
import { createOps, Reservoirs, SNOWMAKING, qualityPreference, qualityInjuryScale, qualitySpeedFactor, type Ops } from '../sim/ops';
import { TileConditions } from '../sim/TileConditions';
import { OpenStatus } from '../sim/OpenStatus';
import { constructionMultiplierAt, worldScaleFor } from '../sim/Season';
import { seasonOf, hourOfDay, jumpTo, seasonStartDay, monthIndex } from '../sim/Clock';
import { nightWarp } from '../core/pacing';
import { sunTimes } from '../sim/Daylight';
import { Energy } from '../sim/Energy';
import { BUILDINGS } from '../config/buildings';
import { CLOSED_BUILDING_UPKEEP_SHARE, HEIGHT_UNIT, OFFSEASON_RELIEF, oldDays } from '../config/balance';
import { LIFTS } from '../config/lifts';
import { Buildings } from '../sim/Buildings';
import { Names } from '../sim/Names';
import { pisteReport, type PisteReport } from '../sim/PisteStats';
import { RunIndex } from '../sim/Runs';
import { RunSettings, type GroomMode } from '../sim/RunSettings';
import type { Run, RunNetwork } from '../world/Runs';
import { Economy } from '../sim/Economy';
import { Pricing } from '../sim/Pricing';
import { Loans, type CreditContext } from '../sim/Loans';
import { Ticketing } from '../sim/Ticketing';
import { Finance } from '../sim/Finance';
import { LiftOps, liftOpenForBusiness } from '../sim/ops/LiftOps';
import type { SimSystem } from '../sim/Systems';
import { OccFlag } from '../world/Occupancy';
import { LiftStore, liftClearanceViolations } from '../sim/Lift';
import { STAFF_WAGE_PER_DAY, type LedgerCategory } from '../config/prices';
import { placeBuilding, type PlacementEnv } from '../sim/PlaceBuilding';
import { createGameState, type GameState, type MapSize } from '../core/GameState';
import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { EventLog } from '../core/EventLog';
import { TickLoop } from '../core/TickLoop';
import { createDefaultRegistry, registerGuestSystems, type SystemRegistry } from '../sim/Systems';
import { GuestSim } from '../sim/guests/GuestSim';
import { AttractionSystem } from '../sim/attractions/AttractionSystem';
import type { GuestWorld } from '../sim/guests/GuestWorld';
import type { NavWorld } from '../sim/guests/NavGraph';
import { routeOnKind } from '../sim/guests/Arrivals';
import { Rating, createRatingSystem } from '../sim/Rating';
import { LeaverTracker, gatherRatingInput } from '../sim/RatingInputs';
import { Coverage, type NetworkProvider } from '../sim/Coverage';
import { networkProviderFrom } from '../build/NetworkAdapter';
import { heightAt } from '../render/Picking';
import { Nature } from '../sim/nature/Nature';
import { Marketing } from '../sim/Marketing';
import { EVENING_VENUES, FOOD } from '../sim/guests/Decision';
import { accepts as elasticAccepts, affordShare, demandMultiplier, mixVolume } from '../sim/Elasticity';
import { TYPE_MIX, offSeasonNoLiftFactor } from '../sim/guests/Spawner';
import { POWDER, SHOCK, PRICE_KEY_INFO, MARKUP, VIP_LODGING_MIN, type DayClass, type ScheduleProfile } from '../config/marketing';
import { PRICE_TABLE } from '../config/prices';
import { Staff } from '../sim/staff/Staff';
import { StaffUpgrades } from '../sim/staff/Upgrades';
import { EventCalendar } from '../sim/events/EventCalendar';
import { Stories } from '../sim/guests/Stories';
import { STAFF } from '../config/staff';
import { SKI_SCHOOL } from '../sim/attractions/SkiSchool';
import { lockedReason } from '../config/unlocks';
import { applySave, type SaveModules } from './saveState';
import { Goals, type GoalWorld } from '../sim/goals/Goals';
import { Achievements } from '../sim/meta/Achievements';
import { Progression } from '../sim/progression/Progression';
import type { UnlockGate } from '../config/unlocks';
import { PROFIT_WINDOW_MONTHS, type GameMode } from '../config/progression';
import { Advisor } from '../sim/advisor/Advisor';
import { SessionMeta } from '../sim/SessionMeta';
import { StatsHistory } from '../sim/meta/StatsHistory';
import { YearReports } from '../sim/meta/YearReport';
import { GuestType } from '../sim/guests/Guest';
import { GAME_MINUTES_PER_TICK } from '../config/balance';
import { Q } from '../sim/ops/PisteQuality';
import { WEATHER_CODES } from '../sim/meta/StatsHistory';
import { Layer as StatLayer } from '../world/Networks';
import { DEFAULT_CONFIG, difficultyDef, normalizeConfig, startingMoney, walkingRadius, type GameConfig } from './difficulty';
import { buildStarterResort } from './starterResort';
import { Sustainability, sustainHint } from '../sim/meta/Sustainability';
import { Rivals } from '../sim/meta/Rivals';
import { SUSTAIN } from '../config/rivals';
import { TREE_KINDS } from '../world/Props';
import { ScenarioRunner, type ScenarioWorld } from '../sim/scenario/ScenarioRunner';
import { getScenario } from '../config/scenarios';
import { GUEST_TYPE_NAMES } from '../sim/guests/Guest';
import { DAYS_PER_YEAR } from '../config/balance';
import { Landscape, type LandscapeEnv } from '../sim/landscape/Landscape';
import { Layer } from '../world/Networks';
import { key as unlockKey, isGated } from '../config/unlocks';
import type { TerrainPresetId } from '../world/TerrainPresets';
import type { DifficultyId } from '../config/balance';

export interface SimHooks {
  /** News/toast sink (UI). */
  toast?(text: string, kind?: 'info' | 'error' | 'warn', category?: string): void;
  /** Called after the daily weather/open-status evaluation. */
  onDay?(): void;
}

export interface SimOptions {
  size: MapSize;
  seed: number;
  hooks?: SimHooks;
  /** Automatic events of the Events calendar (Almabtrieb, New Year, critic visits, powder days). The game turns them on; headless sims / tests default to off. Booked festivals always work. */
  autoEvents?: boolean;
  /** Rival market share scales arrivals (default true). The guided tutorial passes false: exactly neutral. Scenarios are always neutral. */
  rivalMarket?: boolean;
  /** Story guests (named guests with one wish; sim/guests/Stories.ts). The game turns them on; headless sims / tests default to off. */
  stories?: boolean;
  /** Starting money override (tests). */
  money?: number;
  /** Place the free starting Base Lodge (default true). */
  lodge?: boolean;
  /** Day of year to start on (default: the game's start day, early winter). */
  startDay?: number;
  /** Season to start the game in (default winter = the game's start day); same settle as `jumpToDay`. */
  startSeason?: 'winter' | 'spring' | 'summer' | 'autumn';
  /** New Game options (Task 35). All optional: omitted = Balanced terrain, Normal difficulty, empty map, default radius. */
  preset?: TerrainPresetId;
  difficulty?: DifficultyId;
  /** Walking radius override (tiles). */
  radius?: number | null;
  /** Start with the Starter loan already taken. */
  startLoan?: boolean;
  /** Pre-built starter resort (sandbox; a free gift: the books start clean). */
  starterResort?: boolean;
  /** Hints preference stored in the save / config. */
  hints?: boolean;
  /** Game mode (default Career for new games; a save without the progression module loads as Sandbox). Headless tests that build a whole resort use 'sandbox'. */
  mode?: GameMode;
  /** Id of a shipped scenario (src/config/scenarios): rules, objectives and the runner come from its definition. */
  scenario?: string;
  /** Do not arm the achievement trackers yet (the page arms them once the local profile has loaded). Default: armed at the end of createSim. */
  deferAchievements?: boolean;
  /** Token of this game for unlock records (default derived from the seed). */
  gameId?: string;
  /** Profiler clock override. */
  now?: () => number;
  /**
   * Rebuild from a loaded save (Task 33): skips the starting lodge / road stubs / snow seeding / fauna population and restores every module
   * from the save instead. `size` and `seed` must match the save (terrain is re-derived from the seed for lakes / streams / forest density).
   */
  fromSave?: SaveModules;
}

/** Expected registry order after createSim (guarded by tests/game/createSim.test.ts). */
/** Ledger categories the hospitality training lifts (Task 20): food, drinks, shop. */
const HOSPITALITY_CATS: ReadonlySet<string> = new Set(['restaurants', 'bars', 'shops']);

export const EXPECTED_SYSTEM_IDS = ['clock', 'season', 'weather', 'spawner', 'guests', 'attractions', 'ops', 'economy', 'rating'] as const;

/** Terrain surface height at a tile position (world units). */
export const groundHeight = (grid: Grid, x: number, y: number): number => heightAt(grid, x, y);

/**
 * Sim-side composition of the whole game (no three / DOM). main.ts calls this and only adds renderer / UI / view wiring.
 * System ordering and adapters are identical to the previous inline wiring.
 */
export function createSim(opts: SimOptions) {
  const { size, seed } = opts;
  const hooks = opts.hooks ?? {};
  const toast = (t: string, k: 'info' | 'error' | 'warn' = 'info', category?: string): void => hooks.toast?.(t, k, category);

  // Resolve the new-game config: a save's own 'config' module wins (so terrain + difficulty come back identical); legacy options fill the rest.
  const savedCfg = opts.fromSave?.config?.data as Partial<GameConfig> | undefined;
  const cfg: GameConfig = normalizeConfig({
    ...DEFAULT_CONFIG, startSeason: opts.startSeason ?? 'winter', preset: opts.preset, difficulty: opts.difficulty, money: null,
    radius: opts.radius ?? null, startLoan: opts.startLoan ?? false, starterResort: opts.starterResort ?? false, hints: opts.hints ?? true, mode: opts.mode, scenario: opts.scenario ?? null,
    ...(savedCfg ?? {}), size, seed,
  });
  if (opts.fromSave && savedCfg?.mode === undefined) cfg.mode = 'sandbox'; // saves from before M5.3 have no mode: everything stays unlocked
  const diff = difficultyDef(cfg.difficulty);
  const sdef = cfg.scenario ? getScenario(cfg.scenario) ?? null : null;
  const mods = sdef?.modifiers ?? {};
  const genStart = performance.now();
  const grid = new Grid(size);
  const terrainInfo: TerrainResult = generateTerrain(grid, seed, cfg.preset);
  const props: PropStore = opts.fromSave ? new PropStore(grid) : generateProps(grid, terrainInfo.forestDensity, seed);
  const genMs = performance.now() - genStart;

  const game: GameState = createGameState(seed, size, opts.money ?? startingMoney(cfg));
  if (opts.startDay !== undefined) game.date.day = opts.startDay;
  else if (opts.startSeason && opts.startSeason !== 'winter') game.date.day = seasonStartDay(opts.startSeason) + oldDays(20);
  const bus = new EventBus<GameEvents>();
  const eventLog = new EventLog(bus);
  const registry: SystemRegistry = createDefaultRegistry(bus, opts.now);
  let natureRef: Nature | null = null; // set below; ticked after the registry (nature is cosmetic + small bonuses)
  const loop = new TickLoop({ bus, onTick: (tick) => { registry.update(game, tick); natureRef?.update(tick); }, visibility: opts.now ? null : undefined, warp: () => nightWarp(hourOfDay(game.date), sunTimes(game.date.day)) });

  let simTick = 0;
  const pricing = new Pricing();
  const economy = new Economy(game, (money, delta, info) => bus.emit('money:changed', { money, delta, reason: info.reason, category: info.category }));
  economy.setSeasonHook(() => constructionMultiplierAt(game.date) * (mods.costMultipliers?.construction ?? 1)); // summer = 50 % construction discount
  const buildings = new Buildings(grid.occupancy);
  buildings.bus = bus;
  buildings.streamAt = (x, y) => x >= 0 && y >= 0 && x < size && y < size && grid.tileType[grid.tileIndex(x, y)] === TileType.Stream;
  buildings.lakeTiles = terrainInfo.lakes.flatMap((l) => l.tileIdx.map((i) => ({ x: i % size, y: Math.floor(i / size) })));
  buildings.core = null;
  buildings.walkingRadius = walkingRadius(cfg);
  // Career unlock gate (M5.3): answers once `progression` exists below; Sandbox / tutorial / builders open it.
  let progressionRef: Progression | null = null;
  const gate: UnlockGate = { locked: (k, id) => progressionRef?.locked(k, id) ?? null };
  const env: PlacementEnv = { grid, buildings, economy, props, gate };

  const coverage = new Coverage(size);
  const refreshCoverage = (b?: { x: number; y: number; w: number; h: number; type: string }, statusChanged = false): void => {
    coverage.refresh(buildings.all(), b && !statusChanged ? coverage.affectedRect(b) : undefined);
  };

  // Starting Base Lodge at the village anchor (resort core).
  let lodgeTouched: number[] = [];
  if (opts.lodge !== false && !opts.fromSave) {
    const a = terrainInfo.villageAnchor;
    const def = BUILDINGS.baseLodge!;
    let placed = false;
    for (let r = 0; r <= 12 && !placed; r++) {
      for (let dy = -r; dy <= r && !placed; dy++) for (let dx = -r; dx <= r && !placed; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const out = placeBuilding(env, props, 'baseLodge', a.x - Math.floor(def.w / 2) + dx, a.y - Math.floor(def.h / 2) + dy, 0, true, true);
        if (out.ok) { placed = true; lodgeTouched = out.touchedChunks; refreshCoverage(out.building, out.changed.length > 0); }
      }
    }
    if (!placed) console.warn('Could not place starting Base Lodge');
  }

  // Paths, roads, rail + starter road/rail stub.
  const networks = new Networks(grid, buildings);
  buildings.setNetwork({ pathDistance: networks.pathDistance, roadConnected: networks.roadConnected, access: networks.access });
  if (!opts.fromSave) networks.placeInitialStubs(terrainInfo.roadEntry, terrainInfo.railEntry, terrainInfo.villageAnchor, buildings.all().find((b) => b.type === 'baseLodge'));
  buildings.reevaluate();
  refreshCoverage(undefined, true);
  const networkProvider: NetworkProvider = networkProviderFrom(networks);
  const lifts = new LiftStore(grid.occupancy);
  buildings.liftClearance = (c) => liftClearanceViolations(grid, lifts, c);

  // ---- Landscaping (Landscape drawer): player ponds, boulders, garden decor. Ponds count as lake tiles (beach / boat rental / wildlife). ----
  const naturalLakeTiles = buildings.lakeTiles;
  const landscape = new Landscape(grid);
  landscape.onChange(() => { buildings.lakeTiles = naturalLakeTiles.concat(landscape.pondTiles().map((i) => ({ x: i % size, y: Math.floor(i / size) }))); buildings.reevaluate(); });
  const landscapeEnv = (): LandscapeEnv => ({
    grid, props, seed, gate,
    netAt: (i) => (networks.layers[i] ?? 0) | (networks.kind[i] ?? 0),
    isPiste: (i) => ((networks.layers[i] ?? 0) & Layer.Ski) !== 0,
    liftClearanceViolations: (c) => liftClearanceViolations(grid, lifts, c),
    waterDependent: (tiles) => {
      const set = new Set(tiles);
      for (const b of buildings.all()) {
        if (b.type !== 'beach' && b.type !== 'boatRental') continue;
        for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) if (set.has(y * size + x)) return BUILDINGS[b.type]?.name ?? b.type;
      }
      return null;
    },
    multiplier: () => economy.constructionMultiplier(),
  });

  // ---- Sim-driven season (weather + per-tile snow, altitude-dependent snowline) ----
  const worldScale = worldScaleFor(size);
  const weather = new Weather(seed, worldScale, game.date);
  const cond = new TileConditions(grid);
  const reservoirs = new Reservoirs();
  const state = { opsOn: false }; // once ops runs hourly snowmaking, Weather's daily snowmaking hook is disabled
  const snow = new SnowCover(grid, cond, weather, { snowmaking: () => (state.opsOn ? null : coverage.map('snowmaking')), water: reservoirs });
  if (mods.snowMultiplier !== undefined) snow.snowfallMult = mods.snowMultiplier;
  if (mods.weatherHarsh !== undefined) weather.harsh = mods.weatherHarsh;
  if (!opts.fromSave) snow.seed(game.date);
  // A "piste" for names / inspector / goals / advisor is a RUN (world/Runs.ts): a stretch between junctions / lift stations / ends, not the whole 8-connected blob.
  const runIndex = new RunIndex({
    networks, terrainVersion: () => grid.terrainVersion,
    alt: (i) => { const c = grid.getCorners(i % size, (i / size) | 0); return ((c[0] + c[1] + c[2] + c[3]) / 4) * HEIGHT_UNIT; },
    stations: () => { const out: Array<{ x: number; y: number }> = []; for (const l of lifts.all()) { out.push({ x: l.bottom.x + 1, y: l.bottom.y + 1 }, { x: l.top.x + 1, y: l.top.y + 1 }); } return out; },
  });
  type PisteEntryInfo = Run & { difficulty: number };
  let pisteIdx: { net: RunNetwork | null; map: Map<number, PisteEntryInfo>; list: PisteEntryInfo[] } = { net: null, map: new Map(), list: [] };
  const pisteIndex = (): typeof pisteIdx => {
    const net = runIndex.network();
    if (pisteIdx.net !== net) {
      const map = new Map<number, PisteEntryInfo>(), list: PisteEntryInfo[] = net.runs;
      for (const r of net.runs) for (const t of r.tiles) map.set(t, r);
      for (const nd of net.nodes) { const r = net.runs[nd.runsOut[0] ?? nd.runsIn[0] ?? -1]; if (r) for (const t of nd.tiles) map.set(t, r); }
      pisteIdx = { net, map, list };
      runSettings.prune(new Set(list.map((r) => names.pisteId(r))));
    }
    return pisteIdx;
  };
  const names = new Names({
    size,
    pisteAt: (x, y) => {
      const i = y * size + x;
      if (((networks.layers[i] ?? 0) & NetLayer.Ski) === 0) return null;
      return pisteIndex().map.get(i) ?? null;
    },
    pistes: () => pisteIndex().list,
    pisteVersion: () => { pisteIndex(); return runIndex.rebuilds; },
    onSplit: (parentId, childId) => { runSettings.setClosed(childId, runSettings.isClosed(parentId)); runSettings.setGroomMode(childId, runSettings.groomMode(parentId)); },
    lifts: () => lifts.all().map((l) => ({ id: l.id, kindName: LIFTS[l.kind]?.name ?? l.kind, tiles: l.tiles })),
    buildings: () => buildings.all().map((b) => ({ id: b.id, typeName: BUILDINGS[b.type]?.name ?? b.type, x: b.x, y: b.y, w: b.w, h: b.h })),
    altFrac: (x, y) => (cond.altitude(x, y) - worldScale.baseWorld) / worldScale.reliefWorld,
  });
  const runSettings = new RunSettings();
  const openStatus = new OpenStatus({
    grid, cond, weather, bus, networks: () => networks, lifts: () => lifts.all(), buildings: () => buildings.all(),
    // pistes are evaluated PER RUN (docs/runs.md): ids are the persistent Names ids, so manual closes survive edits
    runs: () => pisteIndex().list, runId: (r) => names.pisteId(r as Run), runClosed: (id) => runSettings.isClosed(id),
    runNodes: () => runIndex.network().nodes.map((n) => ({ tiles: n.tiles, runs: [...n.runsOut, ...n.runsIn] })),
  });
  const weatherSystem = createWeatherSystem(weather, snow, { bus, onDay: () => { openStatus.evaluate(); hooks.onDay?.(); } });
  registry.replace(weatherSystem);
  openStatus.evaluate();

  // ---- Guests: navigation view = live arrays of Networks / Grid / TileConditions + the lift store ----
  const navWorld: NavWorld = {
    size, kind: networks.kind, layers: networks.layers, difficulty: networks.difficulty, occ: grid.occupancy.flags, tileType: grid.tileType,
    skiOpen: cond.skiOpen, hikeOk: cond.hikeOk, snow: grid.snowDepth, closed: openStatus.closedMask, bridge: networks.bridge,
    networkVersion: () => networks.version,
    terrainVersion: () => grid.terrainVersion,
    tileAlt: (x, y) => cond.altitude(x, y),
    isBikeable: (x, y) => cond.isBikeable(x, y),
    lifts: () => lifts.all(),
    consumeFlips: () => { const a = cond.takeFlips(), b = openStatus.takeClosureFlips(); return a && b ? [...a, ...b] : a ?? b; },
  };
  let ticketing: Ticketing | null = null;
  const guestWorld: GuestWorld = {
    mapSize: size,
    nav: () => navWorld,
    buildings: () => buildings.all(),
    roadEntry: () => networks.roadEntry ?? null,
    railEntry: () => networks.railEntry ?? null,
    isRoadServed: (id) => networks.isRoadServed(id),
    isRailServed: (id) => networks.isRailServed(id),
    networkVersion: () => networks.version,
    route: (k, from, to) => routeOnKind(networks.kind, size, k === 'road' ? 2 : 3, from, to),
    walkNet: () => networks,
    groundAt: (x, y) => groundHeight(grid, x, y),
    stats: () => {
      let openLifts = 0, openPisteTiles = 0, attractions = 0;
      const cats = new Set<string>();
      for (const l of lifts.all()) if (liftOpenForBusiness(l)) openLifts++;
      for (const p of openStatus.pisteStatuses()) if (p.open) openPisteTiles += p.openTiles;
      for (const b of buildings.all()) {
        const c = BUILDINGS[b.type]?.category;
        if (!b.active) continue;
        if (c === 'recreation' || c === 'kids' || c === 'water') attractions++;
        if (c === 'services' || c === 'core' || c === 'lodging') cats.add(b.type);
      }
      return { openLifts, openPisteTiles, attractions, amenityVariety: cats.size };
    },
    weather: () => ({ kind: weather.current.kind, intensity: weather.current.intensity }),
    onEarn: (c, a) => economy.earn(c as LedgerCategory, a),
    onLiftRide: (_liftId, id, foot) => ticketing?.onBoard(id, foot),
    canRide: (id, foot) => ticketing?.canRide(id, foot) ?? true,
    ticketAtEntrance: () => ticketing?.ticketAtEntrance() ?? true,
    dayTicketPrice: () => pricing.effective('dayPass'),
    onArrival: (id, paid) => ticketing?.onArrival(id, paid),
    isSnowy: () => openStatus.pisteStatuses().some((p) => p.open),
    isBuildingOpen: (id) => openStatus.buildingStatus(id)?.open ?? true,
  };
  const guestSim = new GuestSim(guestWorld, size, bus);
  guestSim.spawner.rateMult = diff.spawn; guestSim.patienceMult = diff.patience; guestSim.injuryMult = diff.incidents * (mods.eventBias?.incidents ?? 1);
  if (mods.guestMix) guestSim.spawner.mixBias = GUEST_TYPE_NAMES.map((n) => mods.guestMix?.[n] ?? 1);
  registerGuestSystems(registry, guestSim);

  // ---- Operations AI: piste quality, nightly grooming, hourly snowmaking ----
  const ops: Ops = createOps({
    grid, cond, weather, snow, coverage, net: networks, buildings: () => buildings.all(), bus, reservoirs,
    onCost: (c, a) => { economy.spend(c === 'energy' ? 'snowmaking' : c === 'wages' ? 'staff' : 'upkeep', a); },
  });
  registry.replace(ops.system);
  state.opsOn = true;
  const pq = ops.quality;
  guestSim.pisteQualityAt = (tile, skill) => { const q = pq.at(tile); return q ? { like: 0.5 + 0.5 * qualityPreference(skill, q), injury: qualityInjuryScale(skill, q) } : null; };
  guestSim.pisteSpeedFactor = (tile) => qualitySpeedFactor(pq.at(tile));
  guestSim.exploration.usage = (tile) => (pq.traffic[tile] ?? 0) + (pq.trafficDay[tile] ?? 0);
  const skillScore = [0, 0, 0, 0]; let scoreVersion = -1;
  guestSim.decider.pisteQualityScore = (skill) => {
    if (scoreVersion !== pq.version) { scoreVersion = pq.version; for (let k = 0; k < 4; k++) skillScore[k] = pq.averagePreference(k); }
    return skillScore[Math.max(0, Math.min(3, skill | 0))]!;
  };
  // Human names for places (pistes/lifts/buildings/areas) used by news messages; see sim/Names.ts.
  const safety: Safety = new Safety({
    size, seed, guests: guestSim.safetyPort(), coverage, buildings: () => buildings.all(), bus,
    spend: (c, a) => { economy.spend(c, a); },
    // News text comes from ui/newsFormat via bus events (with names); the sim-side hook stays silent to avoid duplicate toasts.
    news: () => {},
    where: (x, y) => names.describeLocation(x, y).name,
    isPiste: (x, y) => ((networks.layers[(y | 0) * size + (x | 0)] ?? 0) & NetLayer.Ski) !== 0,
    forest: terrainInfo.forestDensity,
    blocked: (i) => grid.occupancy.flags[i] !== 0 || (networks.layers[i] ?? 0) !== 0,
    season: () => seasonOf(game.date),
    onTick: (t) => openStatus.tickClosures(t),
    avalanche: {
      grid, weather, altitude: (x, y) => cond.altitude(x, y), addSnow: (i, d) => snow.addSnow(i, d),
      isPiste: (i) => ((networks.layers[i] ?? 0) & NetLayer.Ski) !== 0, isGroomed: (i) => pq.at(i) === 2,
      forestProtection: (i) => natureRef?.cover.protection[i] ?? 0,
      isWater: (i) => grid.snowDepth[i] === undefined || (grid.occupancy.flags[i]! & 32) !== 0,
      closeTiles: (tiles, reason, ticks) => openStatus.closeTiles(tiles, reason, safety.incidents.nowTick ?? 0, ticks),
    },
  });
  ops.attachSafety(safety);

  // ---- Per-run operations (docs/runs.md): grooming orders, traffic history, last-groomed day ----
  const absDayNow = (): number => game.date.year * DAYS_PER_YEAR + game.date.day;
  let orderCache: { net: RunNetwork; ver: number; arr: Uint8Array } | null = null;
  ops.grooming.tileOrder = (i) => {
    const net = runIndex.network();
    if (!orderCache || orderCache.net !== net || orderCache.ver !== runSettings.version) {
      const arr = new Uint8Array(size * size);
      for (const r of net.runs) {
        const m = runSettings.groomMode(names.pisteId(r));
        if (m !== 'auto') for (const t of r.tiles) arr[t] = m === 'first' ? 1 : 2;
      }
      orderCache = { net, ver: runSettings.version, arr };
    }
    return orderCache.arr[i] as 0 | 1 | 2;
  };
  // Run-aware via choice (phase 3): per run crowd cached per sim hour
  const crowdCache = new Map<number, { stamp: number; net: RunNetwork; v: number }>();
  guestSim.exploration.runChoice = (t, skill) => {
    const net = runIndex.network(), r = net.runAt(t);
    if (!r) return null;
    const stamp = absDayNow() * 24 + Math.floor(game.date.minute / 60);
    let c = crowdCache.get(r.index);
    if (!c || c.stamp !== stamp || c.net !== net) {
      let sum = 0; const pts = r.poly.length ? r.poly : r.tiles;
      for (const q of pts) sum += (pq.traffic[q] ?? 0) + (pq.trafficDay[q] ?? 0);
      c = { stamp, net, v: Math.log1p(sum / Math.max(1, pts.length)) };
      crowdCache.set(r.index, c);
    }
    const ql = guestSim.pisteQualityAt?.(t, skill);
    const st = openStatus.pisteAt(t % size, (t / size) | 0);
    return { diff: r.difficulty, crowd: c.v, like: ql ? ql.like : 0.5, open: st ? st.open : true };
  };
  pq.onGroom = (i) => { const r = runIndex.runOfTile(i); if (r) runSettings.noteGroomed(names.pisteId(r), absDayNow()); };
  const runPasses = (r: Run): number => { let m = 0; for (const t of r.poly.length ? r.poly : r.tiles) { const v = (pq.trafficDay[t] ?? 0) + (pq.traffic[t] ?? 0); if (v > m) m = v; } return m; };
  pq.onDayRollover = () => {
    const ids: number[] = [];
    for (const r of runIndex.runs()) { const id = names.pisteId(r); ids.push(id); runSettings.notePasses(id, runPasses(r)); }
    runSettings.rollDay(ids);
  };
  if (mods.eventBias?.avalanche !== undefined) safety.avalanche.gainMult = mods.eventBias.avalanche;
  if (mods.bearsMax !== undefined) safety.wildlife.bearsOverride = mods.bearsMax;
  guestSim.injuryHook = (id, x, y, f) => !!safety.incidents.onGuestInjured(id, x, y, f);
  guestSim.decider.offPisteScale = () => {
    const k = weather.current.kind;
    return (coverage.sources('warning').length ? 0.5 : 1) * (k === 'storm' || k === 'heavySnow' ? 0.5 : 1);
  };
  guestSim.decider.hikePenalty = (t) => (coverage.map('warning')[t]! > 0 ? 0.3 : 0);
  guestSim.decider.avoidTile = (t) => safety.wildlife.avoidance(t);

  // ---- Attractions & commercial buildings ----
  const SOLID = OccFlag.Building | OccFlag.Lift | OccFlag.Water;
  const exitCache = new Map<number, { v: number; b: object; pt: { x: number; y: number } | null }>();
  /** Walkable tile just outside a footprint (path/road preferred, else any non-solid edge tile), nearest to the centre. */
  const exitFor = (b: { id: number; x: number; y: number; w: number; h: number }): { x: number; y: number } | null => {
    const hit = exitCache.get(b.id);
    if (hit && hit.v === networks.version && hit.b === b) return hit.pt;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    let best: { i: number; d: number } | null = null, bestAny: { i: number; d: number } | null = null;
    const consider = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const i = y * size + x;
      if (grid.occupancy.flags[i]! & SOLID) return;
      const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
      const k = networks.kind[i]!;
      if ((k === 1 || k === 2) && (!best || d < best.d || (d === best.d && i < best.i))) best = { i, d };
      if (!bestAny || d < bestAny.d || (d === bestAny.d && i < bestAny.i)) bestAny = { i, d };
    };
    for (let x = b.x; x < b.x + b.w; x++) { consider(x, b.y - 1); consider(x, b.y + b.h); }
    for (let y = b.y; y < b.y + b.h; y++) { consider(b.x - 1, y); consider(b.x + b.w, y); }
    const pick = (best ?? bestAny) as { i: number } | null;
    const pt = pick ? { x: (pick.i % size) + 0.5, y: Math.floor(pick.i / size) + 0.5 } : null;
    exitCache.set(b.id, { v: networks.version, b, pt });
    return pt;
  };
  const attractions = new AttractionSystem({
    exitFor,
    buildings: () => buildings.all(),
    store: guestSim.store,
    hash: guestSim.hash,
    status: (id) => openStatus.buildingStatus(id),
    earn: (c0, a0) => { const c = c0, a = HOSPITALITY_CATS.has(c) ? a0 * staffUpgrades.mod('hospitalitySpend') : a0; economy.earn(c, a); const fb = c === 'restaurants' ? natureRef?.farmBonus() ?? 0 : 0; if (fb > 0) economy.earn(c, Math.round(a * fb * 100) / 100); }, // Alpine Farm dairy bonus; hospitality training (Task 20)
    bus,
    groundAt: (x, y) => groundHeight(grid, x, y),
    lakeFrozen: (b) => weather.temperatureAt(cond.altitude(b.x + (b.w >> 1), b.y + (b.h >> 1))) <= 0,
    // Pricing menus (Task 32): list price per building type, markup x seasonal multiplier, nightly rates, elasticity.
    basePrice: (type) => (type in PRICE_TABLE ? pricing.get(type) : undefined),
    priceScale: (type) => pricing.multiplierFor(type),
    nightRate: (type) => pricing.effective(`night:${type}`),
    willBuy: (gt, gid, type, price, salt) => {
      const ratio = type.startsWith('night:') ? price / pricing.fairOf(type) : (price * pricing.multiplierFor(type)) / pricing.fairOf(type);
      return elasticAccepts(gt, ratio, gid, salt, diff.priceSens);
    },
  });
  registry.replace(attractions.asSystem());
  guestSim.setAttractions(attractions);

  // ---- Nature: wild fauna, farm livestock, forest cover/growth (cosmetic + scenery/avalanche/restaurant hooks) ----
  const nature = new Nature({
    size, grid, props, forest: terrainInfo.forestDensity,
    blocked: (i) => grid.occupancy.flags[i] !== 0 || (networks.layers[i] ?? 0) !== 0 || (networks.kind[i] ?? 0) !== 0,
    solid: (i) => grid.occupancy.flags[i] !== 0 || (networks.kind[i] ?? 0) !== 0,
    farms: () => buildings.all().filter((b) => b.type === 'alpineFarm').map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, active: b.active })),
    forEachGuest: (cb) => { const st = guestSim.store; for (let i = 0; i < st.limit; i++) if (st.alive[i]) cb(st.x[i]!, st.y[i]!, st.id[i]!); },
    bump: (id, amount) => { const st = guestSim.store, sl = st.slotOf(id); if (sl >= 0) st.happiness[sl] = Math.min(1, st.happiness[sl]! + amount); },
    predators: () => safety.wildlife.animals,
    date: () => game.date,
    season: () => seasonOf(game.date),
    news: (m) => toast(m, 'info', 'building'),
    seed,
  });
  if (!opts.fromSave) nature.init();
  natureRef = nature;
  bus.on('building:placed', () => nature.farmsChanged());
  bus.on('building:removed', () => nature.farmsChanged());

  // ---- Resort rating: daily aggregate of sim stats; drives guest arrivals ----
  const leavers = new LeaverTracker(); leavers.attach(bus);
  // ---- Energy grid + green buildings (item F, docs/energy.md): generators feed `energy`; the daily cost settlement takes the capped offset off the lift energy line ----
  let heightRange: { lo: number; hi: number } | null = null;
  const energy = new Energy({
    buildings: () => buildings.all(),
    exposure: (b) => {
      if (!heightRange) { let lo = Infinity, hi = -Infinity; for (let vy = 0; vy <= size; vy++) for (let vx = 0; vx <= size; vx++) { const c = grid.getCorner(vx, vy); if (c < lo) lo = c; if (c > hi) hi = c; } heightRange = { lo, hi }; }
      const cs = grid.getCorners(b.x + (b.w >> 1), b.y + (b.h >> 1)), m = (cs[0] + cs[1] + cs[2] + cs[3]) / 4;
      return Math.min(1, Math.max(0, (m - heightRange.lo) / Math.max(1, heightRange.hi - heightRange.lo)));
    },
    snowDepth: (x, y) => grid.snowDepth[grid.tileIndex(x, y)] ?? 0,
    weather: () => weather.current, day: () => game.date.day, season: () => seasonOf(game.date),
    felled: () => props.treesFelled, planted: () => props.treesPlanted,
  });
  bus.on('time:hour', (e) => { if (e) energy.hour(e.hour); });
  // Sustainability facet (Task 23): energy per guest, trees felled vs planted, wildlife-habitat overlap (reduced by the rangers upgrade). Read-only measurements.
  let habitatTiles: Int32Array | null = null; // forest-habitat tiles of the ORIGINAL terrain (static), built lazily
  const treeSet = new Set<number>(TREE_KINDS);
  const sustain = new Sustainability({
    energyToday: () => { const e = economy.dayBuckets().expense; return (e.energy ?? 0) + (e.snowmaking ?? 0); },
    trees: () => { let live = 0; const byKind = props.countByKind(); for (const k of treeSet) live += byKind[k] ?? 0; return { felled: props.treesFelled, planted: props.treesPlanted + Math.floor(energy.nurseryCredit), live }; },
    habitat: () => {
      if (!habitatTiles) {
        const fd = terrainInfo.forestDensity, list: number[] = [];
        for (let i = 0; i < fd.length; i++) if (fd[i]! >= SUSTAIN.habitat.forestMin && grid.snowDepth[i] !== undefined && (grid.occupancy.flags[i]! & 32) === 0) list.push(i);
        habitatTiles = Int32Array.from(list);
      }
      let built = 0;
      for (let k = 0; k < habitatTiles.length; k++) { const i = habitatTiles[k]!; if ((networks.layers[i] ?? 0) !== 0 || (networks.kind[i] ?? 0) !== 0 || grid.occupancy.flags[i] !== 0) built++; }
      return habitatTiles.length ? built / habitatTiles.length : 0;
    },
    protection: () => staffUpgrades.wildlifeProtection(),
    bonus: () => energy.recyclingBonus(),
  });
  bus.on('guest:arrived', () => sustain.noteArrival());
  bus.on('time:hour', (e) => { if (e?.hour === 12) sustain.noteNoon(guestSim.store.count); });
  economy.onDayClosed(() => sustain.closeDay());
  const rating: Rating = new Rating({
    bus,
    inputs: () => ({ ...gatherRatingInput({
      guests: () => {
        const st = guestSim.store, mix = [0, 0, 0, 0]; let n = 0, h = 0, nb = 0;
        for (let i = 0; i < st.limit; i++) if (st.alive[i]) { n++; h += st.happiness[i]!; mix[st.skill[i]!]!++; nb += guestSim.hash.countAt(st.x[i]!, st.y[i]!); }
        return { count: n, avgHappiness: n ? h / n : 0.5, skillMix: mix, avgNeighbours: n ? nb / n : 0, overnight: st.overnightCount };
      },
      leavers: () => leavers.share,
      incidents: () => { const x = safety.incidents.stats(); return { penalty: x.penalty, open: x.open, unresolved: x.unresolved, meanResponseTicks: x.meanResponseTicks, severe: x.severe, wildlife: safety.wildlife.scareLevel() }; },
      buildings: () => buildings.all(),
      lifts: () => lifts.all().map((l) => ({ id: l.id, kind: l.kind, open: liftOpenForBusiness(l), name: `${LIFTS[l.kind]?.name ?? l.kind} ${l.id}` })),
      waitTicks: (id) => guestSim.queues.waitTicks(id, 0),
      forEachOpenPisteTile: (cb) => {
        for (let i = 0; i < networks.layers.length; i++) {
          if (!(networks.layers[i]! & NetLayer.Ski) || networks.kind[i] !== 0) continue;
          const x = i % size, y = (i / size) | 0;
          if (!cond.isSkiable(x, y) || openStatus.isTileClosed(i) || !openStatus.pisteAt(x, y)?.open) continue;
          cb(networks.difficulty[i]!, ops.quality.at(i) ?? 0);
        }
      },
      season: () => seasonOf(game.date),
      trailOpen: () => openStatus.trailOpenFraction(),
      qualityLike: (skill, q) => 0.5 + 0.5 * qualityPreference(skill, q),
      debt: () => finance.debtSeverity(),
      value: () => pricing.valueScore(),
    }), scenery: (() => { const sc = nature.scenery(), pen = energy.sceneryPenalty(); return pen > 0 ? Math.max(0, sc - pen) : sc; })(), sustainability: ((): { score: number; hint: string } => { const p = sustain.measure(); return { score: p.score, hint: sustainHint(p) }; })() }),
  });
  registry.replace(createRatingSystem(rating));
  // Rivals + market share (Task 23): scales arrivals by a small bounded factor (exactly 1 in the grace period, in scenarios / the tutorial).
  const rivals = new Rivals({
    seed, today: () => game.date.year * DAYS_PER_YEAR + game.date.day,
    stars: () => rating.stars, priceRatio: () => pricing.ratioOf('dayPass'), sustainability: () => sustain.last()?.score ?? null,
    affectsArrivals: () => !sdef && opts.rivalMarket !== false,
    news: (title, id) => bus.emit('milestone', { id, title, major: false }),
  });
  bus.on('day:changed', () => rivals.newDay());
  let eventsRef: EventCalendar | null = null; // Events calendar (festival / critic / powder arrival effects), built further down
  guestSim.spawner.setAttractiveness((st) => rating.attractiveness(st.openLifts, seasonOf(game.date) === 'winter' ? undefined : offSeasonNoLiftFactor(st)) * safety.wildlife.arrivalFactor() * (eventsRef?.arrivalMult() ?? 1) * rivals.arrivalMult());
  pricing.bind({
    date: () => game.date,
    powder: () => (weather.current.kind === 'snow' || weather.current.kind === 'heavySnow') && weather.current.intensity >= POWDER.minIntensity,
    stars: () => rating.stars,
  });
  const hasActive = (types: readonly string[]): boolean => buildings.all().some((b) => b.active && types.includes(b.type));
  const marketing = new Marketing({
    economy, bus, date: () => game.date, gate,
    ctx: {
      season: () => seasonOf(game.date), stars: () => rating.stars,
      has: (f) => (f === 'kids' ? hasActive(['skiSchoolHQ', 'kidsGround', 'playground', 'magicCarpet']) : f === 'altiport' ? hasActive(['altiport']) : f === 'luxury' ? hasActive(['chalet', 'apartment']) : hasActive(['adventurePark', 'boatRental', 'beach', 'rental'])),
      met: (id) => {
        switch (id) {
          case 'skiSchool': return hasActive(['skiSchoolHQ']);
          case 'kidsArea': return hasActive(['kidsGround', 'playground', 'magicCarpet']);
          case 'openLift': return lifts.all().some((l) => liftOpenForBusiness(l));
          case 'piste': return openStatus.pisteStatuses().some((p) => p.open);
          case 'parking': return hasActive(['parking']);
          case 'dining': return hasActive([...EVENING_VENUES]);
          case 'vipAccess': return hasActive(['altiport']) || buildings.all().filter((b) => b.active && (b.type === 'chalet' || b.type === 'apartment')).length >= VIP_LODGING_MIN;
          case 'rating': return rating.stars >= 3;
          case 'summerSeason': return seasonOf(game.date) === 'summer';
          case 'summerAttraction': return hasActive(['adventurePark']) || guestSim.decider.mtbTiles.length > 0;
          case 'summerAccess': return guestSim.decider.hikeTiles.length > 0 || lifts.all().some((l) => liftOpenForBusiness(l) && LIFTS[l.kind]?.carriesBikes);
          case 'rental': return hasActive(['rental']);
        }
      },
      dayPassRatio: () => pricing.ratioOf('dayPass'),
      spendPerGuest: () => pricing.effective('dayPass') + 40,
    },
  });
  bus.on('guest:arrived', (e) => { const sl = guestSim.store.slotOf(e.id); if (sl >= 0) marketing.recordArrival(guestSim.store.type[sl]!); });
  bus.on('day:changed', () => { pricing.newDay(); marketing.update(); });
  guestSim.spawner.marketingFn = () => marketing.effect();
  guestSim.spawner.pricingDemand = {
    volume: (mix) => mixVolume(mix, pricing.ratioOf('dayPass'), diff.priceSens) * pricing.dayDemand() * (1 - SHOCK.volumePenalty * pricing.shock),
    typeWeight: (k) => demandMultiplier(k, pricing.ratioOf('dayPass'), diff.priceSens),
  };
  /** Menu write API: keeps the live attraction instances in sync with the central price table. */
  const syncPrice = (key: string): void => { for (const a of attractions.all()) if (a.b.type === key) a.setPrice(pricing.get(key)); };
  const priceApi = {
    set: (key: string, v: number): void => { pricing.set(key, v); syncPrice(key); },
    setFree: (key: string, on: boolean): void => { pricing.setFree(key, on); syncPrice(key); },
    reset: (key: string): void => { pricing.reset(key); syncPrice(key); },
    resetAll: (): void => { pricing.resetAll(); for (const i of PRICE_KEY_INFO) syncPrice(i.key); },
    /** Preset: scale every price (markups use MARKUP.restaurants tiers). */
    preset: (factor: number): void => {
      const keys = PRICE_KEY_INFO.map((i) => i.key).filter((k) => k !== 'seasonPass' && !k.startsWith('markup:'));
      pricing.applyPreset(factor, keys); pricing.set('seasonPass', pricing.defaultOf('seasonPass') * factor);
      pricing.set('markup:restaurants', factor < 1 ? MARKUP.restaurants.cheap : factor > 1 ? MARKUP.restaurants.premium : MARKUP.restaurants.standard);
      pricing.set('markup:shops', MARKUP.default * factor);
      for (const i of PRICE_KEY_INFO) syncPrice(i.key);
    },
    setSchedule: (profile: ScheduleProfile, cls: DayClass, m: number): void => pricing.setSchedule(profile, cls, m),
    setPowder: (on: boolean): void => { pricing.powderSurcharge = on; },
    /** Revenue to date of one price key (attraction stats); null = not tracked. */
    revenue: (key: string): number | null => { let r = 0, n = 0; for (const a of attractions.all()) if (a.b.type === key || `night:${a.b.type}` === key) { r += a.stats.revenue; n++; } return n ? r : null; },
    /** Inspector: one attraction's price edit applies to its type everywhere (single source of truth). */
    setForBuilding: (id: number, v: number): void => { const a = attractions.get(id); if (!a) return; priceApi.set(a.b.type, v); },
  };

  // ---- Finance: pricing, loans, lift passes, daily costs, monthly close, bankruptcy ----
  const loans = new Loans(economy, bus);
  loans.rateMult = diff.loanRate;
  if (mods.noLoans) loans.disabled = true;
  const guestBudget = (id: number): number => { const sl = guestSim.store.slotOf(id); return sl < 0 ? 0 : guestSim.store.budget[sl]!; };
  ticketing = new Ticketing({
    economy, pricing,
    hasTicketOffice: () => buildings.all().some((b) => b.type === 'ticketOffice' && b.active),
    date: () => game.date,
    budgetOf: guestBudget,
    adjustBudget: (id, delta) => { const sl = guestSim.store.slotOf(id); if (sl >= 0) guestSim.store.budget[sl] = guestSim.store.budget[sl]! + delta; },
    seasonDemand: () => Math.round(guestSim.spawner.status().attractiveness * 60 * mixVolume(TYPE_MIX.winter, pricing.ratioOf('seasonPass'))),
    affordShare: (id) => { const sl = guestSim.store.slotOf(id); return sl < 0 ? 1 : affordShare(guestSim.store.type[sl]!); },
  });
  const resortValue = (): number => {
    let v = 0;
    for (const b of buildings.all()) v += BUILDINGS[b.type]?.cost ?? 0;
    for (const l of lifts.all()) v += l.cost;
    return v;
  };
  const avgHappiness = (): number => {
    const st = guestSim.store; let n = 0, sum = 0;
    for (let i = 0; i < st.limit; i++) if (st.alive[i]) { n++; sum += st.happiness[i]!; }
    return n ? sum / n : 0;
  };
  const creditCtx = (): CreditContext => {
    const rs = economy.reports();
    return { resortValue: resortValue(), rating: rating.stars, annualRevenue: rs.slice(-12).reduce((a, r) => a + r.incomeTotal, 0), monthlyNet: rs.length ? rs[rs.length - 1]!.net : 0 };
  };
  // ---- Staff (Task 19, AUTO by default = pre-staff behaviour) + six staff upgrades (Task 20): hooks into the systems below ----
  const staff = new Staff({
    wageScale: () => diff.wages * (mods.costMultipliers?.wages ?? 1),
    needs: () => ({
      instructors: buildings.all().reduce((a, b) => a + (b.type === 'skiSchoolHQ' && b.active ? guestSim.families.schools.get(b.id)?.instructors ?? SKI_SCHOOL.defaultInstructors : 0), 0),
      patrol: safety.patrol.staffNeed(),
      groomers: ops.grooming.fleetNeed(),
      liftOps: lifts.all().reduce((a, l) => a + (STAFF.liftCrew[LIFTS[l.kind]?.family ?? 'chair'] ?? 1), 0),
    }),
  });
  const staffUpgrades = new StaffUpgrades({
    funds: () => game.money,
    pay: (a) => { economy.spend('staff', a); return true; },
    gate: (lvl) => (progression.open || progression.level >= lvl ? null : lockedReason(lvl)),
    onDone: (def) => bus.emit('milestone', { id: `staff:${def.id}`, title: `Training complete: ${def.name}`, major: false }),
  });
  bus.on('day:changed', () => { staff.newDay(); staffUpgrades.newDay(); });

  // ---- Events calendar (Task 21): booked festivals + automatic Almabtrieb / New Year / critic / powder day. Neutral (x1) when nothing is on ----
  const absDay = (): number => game.date.year * DAYS_PER_YEAR + game.date.day;
  let blackCache = { day: -1, v: false };
  const events = new EventCalendar({
    today: absDay, funds: () => game.money, pay: (a) => { economy.spend('marketing', a); return true; }, refund: (a) => { economy.refund(a, 'marketing'); },
    stars: () => rating.stars,
    gate: (lvl) => (progression.open || progression.level >= lvl ? null : lockedReason(lvl)),
    hasLodge: () => buildings.all().some((b) => b.type === 'baseLodge'),
    hasBlackPiste: () => {
      if (blackCache.day === absDay()) return blackCache.v;
      let v = false; const lay = networks.layers, kd = networks.kind, df = networks.difficulty;
      for (let i = 0; i < lay.length; i++) if ((lay[i]! & NetLayer.Ski) && kd[i] === 0 && df[i] === 3) { v = true; break; }
      blackCache = { day: absDay(), v };
      return v;
    },
    powder: () => (weather.current.kind === 'snow' || weather.current.kind === 'heavySnow') && weather.current.intensity >= POWDER.minIntensity,
    hasHerd: () => nature.livestock.animals.length > 0,
    critic: () => { const x = safety.incidents.stats(); return { stars: rating.stars, happiness: avgHappiness(), openShare: openStatus.pisteStatuses().length ? openStatus.pisteStatuses().filter((p) => p.open).length / openStatus.pisteStatuses().length : 0, incidents: x.penalty > 0 ? 1 : 0 }; },
    cheer: (amt) => { const st = guestSim.store; for (let i = 0; i < st.limit; i++) if (st.alive[i]) st.happiness[i] = Math.min(1, st.happiness[i]! + amt); },
    news: (m) => toast(m, 'info', 'building'),
    seed, auto: opts.autoEvents === true,
  });
  eventsRef = events;
  // Story guests (M5.4 Task 22): observer module polled at the end of every guest tick; own RNG; off unless `stories: true`.
  const storyCache = { day: -1, black: false, trail: false };
  const storyHas = (need: 'black' | 'meal' | 'apres' | 'school' | 'trail'): boolean => {
    if (need === 'meal') return buildings.all().some((b) => b.active && FOOD.has(b.type));
    if (need === 'apres') return buildings.all().some((b) => b.active && b.type === 'apresBar');
    if (need === 'school') return buildings.all().some((b) => b.active && b.type === 'skiSchoolHQ');
    if (storyCache.day !== absDay()) {
      storyCache.day = absDay(); storyCache.black = false; storyCache.trail = guestSim.decider.hikeTiles.length > 0;
      const lay = networks.layers, kd = networks.kind, df = networks.difficulty;
      for (let i = 0; i < lay.length; i++) if ((lay[i]! & NetLayer.Ski) && kd[i] === 0 && df[i] === 3) { storyCache.black = true; break; }
    }
    return need === 'black' ? storyCache.black : storyCache.trail;
  };
  const stories = new Stories({
    store: guestSim.store, bus, seed, today: absDay, has: storyHas,
    buildingType: (id) => buildings.get(id)?.type ?? null,
    isKid: (slot) => guestSim.families.isKid(slot),
    tip: (amount) => economy.earn('other', amount),
  });
  stories.enabled = opts.stories === true;
  guestSim.afterUpdate = (tick) => { if (stories.enabled) stories.update(tick); };
  bus.on('guest:arrived', (e) => stories.onArrived(e.id));
  bus.on('lesson:started', (e) => stories.onLesson(e.kids));
  bus.on('guest:left', (e) => stories.onLeft(e.id));
  bus.on('day:changed', () => events.newDay());
  bus.on('time:hour', () => events.newHour());
  guestSim.families.capacityFactor = () => staff.fill('instructors') * staffUpgrades.mod('instructorCapacity');
  guestSim.queues.crewFactor = () => staff.fill('liftOps');
  safety.patrol.speedFactor = () => staff.fill('patrol') * staffUpgrades.mod('patrolSpeed');
  safety.wildlife.scareMod = () => staffUpgrades.mod('wildlifeScare');
  ops.grooming.crewLimit = () => staff.groomerLimit();
  ops.grooming.capacityMod = () => staffUpgrades.mod('groomCapacity');
  ops.grooming.fuelMod = () => staffUpgrades.mod('groomFuel');
  // ---- Lift operations: schedules, energy, wear, inspections, breakdowns, stranded guests (ticked by the economy system) ----
  const liftOps = new LiftOps({
    lifts: () => lifts.all(), bus, seed,
    weather: () => ({ kind: weather.current.kind, intensity: weather.current.intensity }),
    temperature: (l) => weather.temperatureAt(cond.altitude(l.top.x, l.top.y)),
    hasWorkshop: () => buildings.all().some((b) => b.type === 'liftWorkshop' && b.active),
    queues: { ridersOn: (id) => guestSim.queues.ridersOn(id), queueLength: (id) => guestSim.queues.queueLength(id, 0) },
    incidents: safety.incidents,
    spend: (a) => { economy.spend('maintenance', a); },
    breakdownFactor: () => staff.breakdownFactor() * staffUpgrades.mod('liftBreakdown'),
    repairFactor: () => staffUpgrades.mod('liftRepairTime'),
    // planned service: lift-mechanics training and crew morale (careful crew < 1 < sloppy crew) shorten it and cut the bill; untouched = exactly 1
    today: () => game.date.year * DAYS_PER_YEAR + game.date.day,
    serviceFactor: () => { const m = 0.6 + 0.4 * staff.breakdownFactor(); return { time: staffUpgrades.mod('liftRepairTime') * m, cost: (0.5 + 0.5 * staffUpgrades.mod('liftBreakdown')) * m }; },
  });
  /** Off-season relief bookkeeping (derived, not saved): consecutive idle days per venue + dollars saved this game session. */
  const closedDays = new Map<number, { sig: number; idle: number }>();
  const relief = { furlough: 0, mothball: 0 };
  const finance = new Finance({
    economy, loans, ticketing, bus, startupGraceDays: 14, autoBankruptcyDays: diff.foreclosureDays, autoBankruptcyFloor: diff.foreclosureFloor,
    costs: () => {
      let b = 0, l = 0, st = 0;
      const offSeason = seasonOf(game.date) !== 'winter';
      for (const x of buildings.all()) {
        const def = BUILDINGS[x.type], full = (def?.upkeep ?? 0) * diff.upkeep * (mods.costMultipliers?.upkeep ?? 1);
        let share = x.active && openStatus.buildingStatus(x.id)?.open === false ? CLOSED_BUILDING_UPKEEP_SHARE : 1;
        if (offSeason && def?.season === 'winter' && OFFSEASON_RELIEF.winterOnlyUpkeepShare < share) { relief.mothball += full * (share - OFFSEASON_RELIEF.winterOnlyUpkeepShare); share = OFFSEASON_RELIEF.winterOnlyUpkeepShare; }
        if (x.type === 'snowCannon' && ops.snowmaking.isMothballed(x.id) && SNOWMAKING.mothballUpkeepShare < share) { relief.mothball += full * (share - SNOWMAKING.mothballUpkeepShare); share = SNOWMAKING.mothballUpkeepShare; } // switched off by the player: 15 % upkeep
        b += full * share;
      }
      const lo = liftOps.settleDay(); // closed lifts only cost base maintenance; running lifts cost energy
      l = lo.upkeep * diff.upkeep * (mods.costMultipliers?.upkeep ?? 1);
      const seen = new Set<number>();
      for (const a of attractions.all()) {
        const wage = a.staff * STAFF_WAGE_PER_DAY * diff.wages * (mods.costMultipliers?.wages ?? 1), id = a.b.id;
        seen.add(id);
        // idle = closed for the season, or open but nobody was served / stayed since yesterday
        const sig = a.stats.served + a.stats.nights, prev = closedDays.get(id);
        const closed = a.b.active && openStatus.buildingStatus(id)?.open === false;
        const days = closed || (prev && prev.sig === sig) ? (prev?.idle ?? 0) + 1 : 0;
        closedDays.set(id, { sig, idle: days });
        if (days >= OFFSEASON_RELIEF.furloughAfterDays && wage > 0) { st += wage * OFFSEASON_RELIEF.furloughWageShare; relief.furlough += wage * (1 - OFFSEASON_RELIEF.furloughWageShare); } else st += wage;
      }
      for (const id of [...closedDays.keys()]) if (!seen.has(id)) closedDays.delete(id);
      // green power: the generators' capped offset comes off the lift energy line (nothing changes without generators)
      const offset = energy.settleDay(lo.energy + (economy.dayBuckets().expense.snowmaking ?? 0), lo.energy);
      return { buildings: b, lifts: l, staff: (st + staff.extraWagesPerDay()) * staff.wageMult() + staffUpgrades.upkeepPerDay(), energy: offset > 0 ? lo.energy - offset : lo.energy };
    },
    guests: () => ({ count: guestSim.store.count, happiness: avgHappiness() }),
    credit: creditCtx,
  });
  const economySystem: SimSystem = {
    id: 'economy',
    update: (s, t) => { if (finance.ended) return; staff.update(t); liftOps.update(s, t); finance.update(s); },
    serialize: () => ({ ...(finance.serialize() as object), liftOps: liftOps.serialize(), marketing: marketing.serialize(), pricing: pricing.serialize(), relief: { ...relief }, idle: [...closedDays] }),
    load: (d) => {
      finance.load(d); const o = d as { liftOps?: unknown; marketing?: unknown; pricing?: Parameters<Pricing['load']>[0]; relief?: typeof relief; idle?: Array<[number, { sig: number; idle: number }]> };
      liftOps.load(o.liftOps); marketing.load(o.marketing); pricing.load(o.pricing);
      relief.furlough = o.relief?.furlough ?? 0; relief.mothball = o.relief?.mothball ?? 0; closedDays.clear(); for (const [id, v] of o.idle ?? []) closedDays.set(id, v); // furlough depends on the idle-day counters: they are part of the save
    },
  };
  registry.replace(economySystem);
  // Bankruptcy ends the game: the clock stops and cannot be restarted (the UI offers a new game or a read-only look).
  bus.on('finance:declaredBankrupt', () => { economy.locked = true; loop.setSpeed(0); });
  bus.on('speed:changed', (e) => { if (finance.ended && e.speed !== 0) loop.setSpeed(0); });
  const ticketingRef = ticketing;
  bus.on('guest:left', (e) => ticketingRef.forget(e.id));

  /**
   * Jump the calendar to `dayOfYear` (forward in time) and instantly settle the per-tile snow, weather, tile conditions, piste quality
   * and open/closed status for that date. Deterministic (depends on seed + date only). Marks every terrain chunk snow-dirty so the
   * renderer's next flush rebuilds the aSnow attributes.
   */
  const jumpToDay = (dayOfYear: number, hour = 8): void => {
    jumpTo(game.date, dayOfYear, hour);
    weather.rollDay(game.date);
    snow.settle(game.date);
    weatherSystem.resync();
    ops.settle(game);
    openStatus.evaluate();
  };
  if (!opts.fromSave && (opts.startDay !== undefined || (opts.startSeason && opts.startSeason !== 'winter'))) {
    snow.settle(game.date); ops.settle(game); openStatus.evaluate();
  }

  /** Inspector report for the piste containing tile (x, y), or null. Names persist via `names` (renamePiste). */
  const pisteEntryAt = (x: number, y: number): PisteEntryInfo | undefined =>
    x < 0 || y < 0 || x >= size || y >= size ? undefined : (((networks.layers[y * size + x] ?? 0) & NetLayer.Ski) ? pisteIndex().map.get(y * size + x) : undefined);
  const renamePisteAt = (x: number, y: number, name: string): boolean => {
    const e = pisteEntryAt(x, y);
    if (e) names.renamePiste(e, name);
    return !!e;
  };
  /** Everything the inspector / Runs list shows about one run. */
  type RunInfo = PisteReport & { tileIdx: number[]; x: number; y: number; closedByPlayer: boolean; groomMode: GroomMode; passesToday: number; passesWeek: number; groomedDaysAgo: number | null; nodeFrom: number; nodeTo: number };
  const reportOf = (e: Run): RunInfo => {
    const r = pisteReport(e, { difficulty: networks.difficulty, quality: ops.quality, status: (c) => openStatus.pisteAt(c.tiles[0]! % size, (c.tiles[0]! / size) | 0), runsAt: (tiles) => guestSim.exploration.runsAt(tiles) });
    const id = names.pisteId(e), t = e.poly[e.poly.length >> 1] ?? e.tiles[0]!, lg = runSettings.lastGroomedDay(id);
    return {
      ...r, id, name: names.pisteName(e), autoName: names.pisteAutoName(e), tileIdx: e.tiles, x: (t % size) + 0.5, y: ((t / size) | 0) + 0.5,
      closedByPlayer: runSettings.isClosed(id), groomMode: runSettings.groomMode(id), passesToday: runPasses(e), passesWeek: runSettings.passesWeek(id) + runPasses(e),
      groomedDaysAgo: lg === undefined ? null : Math.max(0, absDayNow() - lg), nodeFrom: e.from, nodeTo: e.to,
    };
  };
  const pisteReportAt = (x: number, y: number): RunInfo | null => {
    const e = pisteEntryAt(x, y);
    return e ? reportOf(e) : null;
  };
  /** Every run (sorted by tile order of the network): the Runs list panel. */
  const runList = (): RunInfo[] => pisteIndex().list.map(reportOf);
  const runById = (id: number): Run | undefined => pisteIndex().list.find((r) => names.pisteId(r) === id);
  const setRunClosed = (id: number, closed: boolean): boolean => {
    if (!runById(id)) return false;
    if (runSettings.setClosed(id, closed)) { openStatus.evaluate(); }
    return true;
  };
  const setRunGroomMode = (id: number, m: GroomMode): boolean => { if (!runById(id)) return false; runSettings.setGroomMode(id, m); return true; };
  const renameRun = (id: number, name: string): boolean => { const r = runById(id); if (r) names.renamePiste(r, name); return !!r; };

  /** One label anchor per run (mid centre-line tile) for the 'Runs' overlay and the Runs list. */
  const runLabels = (): Array<{ id: number; name: string; x: number; y: number; difficulty: number }> => pisteIndex().list.map((r) => {
    const t = r.poly[r.poly.length >> 1] ?? r.tiles[0]!;
    return { id: names.pisteId(r), name: names.pisteName(r), x: (t % size) + 0.5, y: ((t / size) | 0) + 0.5, difficulty: r.difficulty };
  });

  // ---- Resort goal chain (M5.1): hourly evaluation off the bus, read-only world adapter, grants via the `grant` ledger category ----
  const goalWorld = (): GoalWorld => ({
    buildings: () => buildings.all(),
    lifts: () => lifts.all().map((l) => ({ kind: l.kind, open: liftOpenForBusiness(l), x: l.bottom.x, y: l.bottom.y })),
    // One entry per (connected piste, difficulty 1 green .. 4 black) with that difficulty's tile count: a goal like 'paint a green run' must not depend on which
    // difficulty happens to be the majority of a big connected network (the stored code is 0..3, hence the + 1).
    pistes: () => {
      const out: Array<{ difficulty: number; tiles: number; x: number; y: number }> = [];
      for (const p of pisteIndex().list) {
        if (p.disconnected || p.count < 4) continue;
        const per = [0, 0, 0, 0], first = [-1, -1, -1, -1];
        for (const t of p.tiles) { const d = Math.max(0, Math.min(3, networks.difficulty[t] ?? 0)); per[d]!++; if (first[d]! < 0) first[d] = t; }
        for (let d = 0; d < 4; d++) if (per[d]! > 0) out.push({ difficulty: d + 1, tiles: per[d]!, x: first[d]! % size, y: (first[d]! / size) | 0 });
      }
      return out;
    },
    trailTiles: () => { let n = 0; const a = networks.layers; for (let i = 0; i < a.length; i++) if (a[i]! & (NetLayer.Hike | NetLayer.Mtb)) n++; return n; },
    stars: () => rating.stars, money: () => game.money, debt: () => loans.totalDebt(),
    grant: (amount) => economy.earn('grant', amount),
  });
  const goals = new Goals(goalWorld, bus);
  if (sdef && sdef.unlocks !== 'career') goals.paused = true; // scenarios have their own objectives: no goal-chain grants (facts still count). Career scenarios keep the chain: resort levels need its chapters.

  // ---- Resort level + selective unlocks (M5.3): a pure function of stars / guests / profit / goal chapters, latched, evaluated daily ----
  const progression = new Progression({
    stars: () => rating.stars,
    guests: () => goals.facts.lifetime,
    peakDay: () => goals.facts.bestDay,
    profitMonths: () => goals.facts.profitMonths,
    chapters: () => goals.chapters.filter((c) => goals.chapterDone(c.id)).length,
    annualProfit: () => economy.reports().slice(-PROFIT_WINDOW_MONTHS).reduce((a, r) => a + r.net, 0),
    date: () => ({ year: game.date.year, day: game.date.day }),
  }, bus, cfg.mode);
  progressionRef = progression;
  // Scenario rules on the gate: disabled buildings, and (unlocks: [list]) every gated item that is not listed. Released once the player continues in sandbox.
  let scenarioRef: ScenarioRunner | null = null;
  if (sdef) {
    const list = Array.isArray(sdef.unlocks) ? sdef.unlocks : null;
    progression.extraLock = (kind, id) => {
      if (scenarioRef?.sandbox) return null;
      if (kind === 'building' && sdef.modifiers.disabledBuildings?.includes(id)) return 'Not available in this scenario';
      if (list && isGated(kind, id) && !list.includes(unlockKey(kind, id))) return 'Not available in this scenario';
      return null;
    };
  }

  // ---- Advisor (M5.1): Ranger Rudi's ranked advice; hourly/daily off the bus, read-only ----
  const advisor = new Advisor(bus);
  // Recap data (M5.1): last closed month + cash / stars at its start; saved as 'sessionMeta' (read-only listener, no sim effect)
  const session = new SessionMeta(bus, { money: () => game.money, stars: () => rating.stars, guests: () => economy.lastReport()?.guests ?? 0 });

  // ---- Daily stats + Resort of the Year reports (M5.3): read-only observers; saved as `stats` / `yearReports`. Day end = Economy.closeDay (after upkeep). ----
  const QUALITY_SCORE = [0, 1, 1, 0.6, 0.2, 0.35, 0.3]; // Q.None..Q.Slush surface score
  void Q;
  const stats = new StatsHistory({
    guests: () => ({ count: guestSim.store.count, happiness: avgHappiness() }),
    stars: () => rating.stars,
    cash: () => game.money, sustain: () => sustain.last()?.score ?? 0,
    today: () => game.date.year * 180 + game.date.day,
    day: () => economy.dayBuckets(),
    incidents: () => { const x = safety.incidents.stats(); return { created: x.created, resolved: x.resolved, hospitalised: x.hospitalised }; },
    runs: () => guestSim.runsCompleted,
    attacks: () => safety.wildlife.attacks,
    weather: () => ({ code: Math.max(0, WEATHER_CODES.indexOf(weather.current.kind)), temp: weather.current.valleyT }),
    queueMinutes: () => { const ls = lifts.all(); if (!ls.length) return 0; let t = 0; for (const l of ls) t += guestSim.queues.waitTicks(l.id, 0); return (t / ls.length) * GAME_MINUTES_PER_TICK; },
    isFamily: (id) => { const sl = guestSim.store.slotOf(id); return sl >= 0 && guestSim.store.type[sl] === GuestType.Family; },
    terrain: () => {
      // strided sample (prime step): ~1/7 of the map; piste tiles only
      const lay = networks.layers, n = lay.length, open = cond.skiOpen;
      let tiles = 0, ok = 0, snow = 0, qn = 0, qs = 0;
      for (let i = 0; i < n; i += 7) {
        if (!(lay[i]! & StatLayer.Ski)) continue;
        tiles++; snow += grid.snowDepth[i]!; if (open[i]) ok++;
        const st = ops.quality.at(i); if (st > 0) { qn++; qs += QUALITY_SCORE[st] ?? 0; }
      }
      return { snow: tiles ? snow / tiles : 0, skiable: tiles ? ok / tiles : 0, quality: qn ? qs / qn : 0 };
    },
  });
  stats.attach(bus);
  economy.onDayClosed(() => stats.captureDay());
  let levelHost: { progression?: { level?: number } } | null = null; // set once `sim` exists (Task 14 adds `sim.progression`)
  const yearReports: YearReports = new YearReports(stats, {
    mapSize: size, name: () => 'Your resort',
    level: () => levelHost?.progression?.level ?? null,
    goalsTotal: () => goals.view().completed,
    rivals: (y) => rivals.section(y),
    venues: () => attractions.all().filter((a) => a.stats.revenue > 0).map((a) => ({ id: a.b.id, name: names.buildingName(a.b.id), revenue: a.stats.revenue })),
    ready: (r) => bus.emit('year:report', { year: r.year }),
  });
  yearReports.baselines = rivals; // awards compare against the neighbours (Task 23)

  // ---- Scenario runner (M5.3 Task 15): daily objective evaluation off the bus; read-only world adapter ----
  if (sdef) {
    const tilesOf = (mask: number): number => { let n = 0; const a = networks.layers; for (let i = 0; i < a.length; i++) if (a[i]! & mask) n++; return n; };
    const sw = (): ScenarioWorld => ({
      ...goalWorld(),
      facts: () => goals.facts,
      mtbTiles: () => tilesOf(NetLayer.Mtb), hikeTiles: () => tilesOf(NetLayer.Hike),
      highTrailTiles: () => {
        let n = 0; const a = networks.layers, N = size;
        for (let i = 0; i < a.length; i++) if ((a[i]! & (NetLayer.Hike | NetLayer.Mtb)) && (cond.altitude(i % N, (i / N) | 0) - worldScale.baseWorld) / worldScale.reliefWorld >= 0.66) n++;
        return n;
      },
      happiness: () => (guestSim.store.count ? avgHappiness() : -1),
      familyHappiness: () => { const st = guestSim.store; let n = 0, sum = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i] && st.type[i] === GuestType.Family) { n++; sum += st.happiness[i]!; } return n ? sum / n : -1; },
      annualProfit: () => economy.reports().slice(-12).reduce((a, r) => a + r.net, 0),
      lastMonthNet: () => economy.lastReport()?.net ?? 0,
      incidents: (k) => { const x = safety.incidents.stats(); return k === 'created' ? x.created : k === 'hospitalised' ? x.hospitalised : k === 'severe' ? x.severe : safety.wildlife.attacks; },
      level: () => progression.level,
      openNow: () => lifts.all().some((l) => liftOpenForBusiness(l)) && openStatus.pisteStatuses().some((p) => p.open),
      season: () => seasonOf(game.date),
      isFamily: (id) => { const sl = guestSim.store.slotOf(id); return sl >= 0 && guestSim.store.type[sl] === GuestType.Family; },
      today: () => game.date.year * DAYS_PER_YEAR + game.date.day,
    });
    scenarioRef = new ScenarioRunner(sdef, sw, bus);
  }

  // Achievements (M5.3 Task 16): a pure observer of the bus + read-only daily facts. Armed at the end (starter resorts / loads must not unlock things).
  const achievements = new Achievements(bus, {
    gameId: opts.gameId ?? `g${seed}`,
    runKind: () => (scenarioRef && !scenarioRef.sandbox ? 'scenario' : progression.mode),
    facts: () => {
      const r = yearReports.latest();
      return {
        stars: rating.stars, level: progression.level, guests: guestSim.store.count, money: game.money, festivals: nature.livestock.festivals,
        openLifts: lifts.all().filter((l) => liftOpenForBusiness(l)).length,
        report: r ? { year: r.year, partial: r.partial, profit: r.totals.profit, headline: r.headline.tier, awards: Object.fromEntries(r.awards.map((a) => [a.id, a.tier])) } : null,
      };
    },
  });
  const sim = {
    achievements, rivals, sustain, energy, landscape, landscapeEnv,
    scenario: scenarioRef as ScenarioRunner | null,
    jumpToDay, pisteReportAt, renamePisteAt, runIndex, runLabels, runSettings, runList, setRunClosed, setRunGroomMode, renameRun,
    size, seed, grid, terrainInfo, props, genMs, game, bus, eventLog, registry, loop,
    pricing, priceApi, marketing, economy, buildings, env, coverage, refreshCoverage, networks, networkProvider, lifts,
    weather, cond, reservoirs, snow, openStatus, navWorld, guestWorld, guestSim, ops, safety, attractions,
    staff, staffUpgrades, events, stories, names, nature, leavers, rating, goals, progression, gate, advisor, session, stats, yearReports, loans, ticketing: ticketingRef, finance, liftOps, creditCtx, lodgeTouched, relief, closedDays,
    /** The validated new-game options this game was created with (stored in the save, 'config' module). */
    config: cfg, difficulty: diff,
    /** Run `n` fixed ticks synchronously (tests/bench). */
    tick(n = 1): void { for (let i = 0; i < n; i++) { registry.update(game, ++simTick); natureRef?.update(simTick); } },
    /** Headless tick counter used by `tick()` (saved; the live game uses `loop.ticks`). */
    getSimTick: (): number => simTick,
    setSimTick: (n: number): void => { simTick = n; },
    state,
  };
  levelHost = sim as unknown as typeof levelHost;
  advisor.attach(sim);
  if (opts.fromSave) applySave(sim, opts.fromSave);
  else {
    if (cfg.starterResort) { // sandbox: pre-built resort is free (books reset, cash = the chosen starting cash)
      const cash = game.money;
      buildStarterResort(sim, {
        funds: 5_000_000,
        // a spring / summer / autumn start also gets an Alpine Farm (cows on the pastures); winter starts keep the classic resort (balance unchanged)
        extra: seasonOf(game.date) === 'winter' ? undefined : (kit) => {
          for (let k = 0; k < 4; k++) {
            const b = kit.placeConnected('alpineFarm', kit.lc.x + [-8, 8, 0, -12][k]!, kit.lc.y + [6, 6, 12, -4][k]!, 30, true);
            if (!b) return;
            if (!b.active) { kit.ensureRoad(b); kit.settle(); }
            if (b.active) return;
            buildings.remove(b.id); kit.report.placed['alpineFarm'] = Math.max(0, (kit.report.placed['alpineFarm'] ?? 1) - 1); kit.settle();
          }
        },
      });
      game.money = cash; economy.resetBooks();
      goals.silentSync(); // a pre-built resort is a gift: its goals are ticked off quietly (no grants)
    }
    if (sdef) {
      const spec = sdef.starter;
      if (typeof spec === 'object') { // a custom list of buildings, placed through the real placement APIs (free gift: the books start clean)
        const cash = game.money;
        buildStarterResort(sim, { funds: 5_000_000, lifts: 0, skipCore: true, extra: (kit) => {
          spec.buildings.forEach((type, i) => { kit.placeConnected(type, kit.lc.x + ((i % 3) - 1) * 9, kit.lc.y + 6 + Math.floor(i / 3) * 7, 22); });
        } });
        game.money = cash; economy.resetBooks();
      }
      if (sdef.modifiers.startingDebt) {
        const d = game.date, sd = sdef.modifiers.startingDebt;
        loans.grantStartingDebt(sd.amount, sd.ratePct, sd.termMonths, { year: d.year, month: monthIndex(d) });
        economy.deposit(sd.amount, 'loan');
      }
    }
    if (cfg.startLoan) { const d = game.date; loans.take('starter', creditCtx(), { year: d.year, month: monthIndex(d) }); }
    scenarioRef?.begin(); // a NEW scenario game: its clock starts now (a loaded save restores its own start day)
  }
  if (!opts.deferAchievements) achievements.arm();
  return sim;
}
export type Sim = ReturnType<typeof createSim>;
