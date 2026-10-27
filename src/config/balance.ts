import type { ModKey } from './staffUpgrades';
export const CAMERA_PITCH = Math.atan(1 / Math.SQRT2);
export const CAMERA_YAW_OFFSET = Math.PI / 4;
export const CAMERA_MIN_ZOOM = 0.5;
export const CAMERA_PAN_SPEED = 1.2; // viewport-heights per second
export const CAMERA_ROTATE_TWEEN_S = 0.25;
export const CAMERA_ALT_DRAG_RAD_PER_PX = 0.008;

// Terrain rendering
export const HEIGHT_UNIT = 0.5; // world units per half-step
export const SKIRT_BOTTOM = -3; // world y of map-edge cliff skirt bottom
export const TERRAIN_BUILD_BUDGET = 24; // max chunk (re)builds per frame
export const TERRAIN_MACRO_CHUNKS = 4; // far LOD merges 4x4 chunks into one mesh
export const TERRAIN_MACRO_STEP = 4; // far LOD tile stride
export const TERRAIN_MACRO_VIEW_HEIGHT = 100; // use far LOD when visible world height exceeds this
export const SNOWLINE_DEFAULT_FRAC = 0.6; // fraction of relief above valley floor
export const TEXTURE_SEED = 1337;

// Terraforming
export const TERRAFORM_COST_PER_HALF_STEP = 10; // money per corner half-step changed
export const TERRAFORM_BRUSH_MAX = 5;
export const TERRAFORM_DEFAULT_BRUSH = 3;
/** Max height diff between adjacent vertices: 1 gentle (default), 2 steep. */
export const TERRAFORM_DEFAULT_MAX_EDGE_DELTA: 1 | 2 = 1;
/** Half-steps applied at brush centre per click when a falloff brush is used. */
export const TERRAFORM_FALLOFF_PEAK = 2;
export const TERRAFORM_MAX_HEIGHT = 200; // half-steps

// Dependencies
export const WALKING_RADIUS_TILES = 12; // station/altiport path distance to resort core

// Lifts
/**
 * Unit conversion: 1 world unit (= 1 tile) = TILE_METRES metres. Lift speeds in config/lifts.ts are tiles/s
 * (so a 4 tiles/s chairlift is 40 m/s: arcade-scaled), lengths for cost/display are tiles * TILE_METRES.
 * Heights: 1 half-step = HEIGHT_UNIT (0.5) units = 5 m.
 */
export const TILE_METRES = 10;
export const LIFT_STATION_SIZE = 2; // station footprint, tiles (square)
export const LIFT_STATION_HEAD = 1.0; // cable/track height above the station's ground
export const LIFT_MIN_LENGTH = 4; // tiles
export const LIFT_DWELL_S = 20; // reversible lifts: seconds waiting at each terminus
export const LIFT_UPKEEP_PER_METRE_DAY = 0.05;
export const LIFT_MIN_SPEED = 0.25; // lowest speed setting (fraction of nominal)
export const LIFT_ECO_FACTOR = 0.5; // eco mode: speed multiplier while nobody queues

/**
 * Lift gradients & supports (tuned to the terrain scale; 1 tile = 10 m horizontally, 1 half-step = 5 m vertically).
 * Skiable terrain here runs 25-100% gradient (0.5-2 half-steps per tile), so the old 'worst tile' limits were far tighter than real
 * lifts. Rules now (see config/lifts.ts):
 *  - maxGradient = max AVERAGE gradient between the (flattened) station grounds (T-bar 60%, chair 90%, gondola 110%, cable car 150%,
 *    funicular 70%); this is what 'Too steep' means.
 *  - maxLocalGradient = max slope of any single cable/track section between supports (towers/trestles may steepen short sections).
 *  - Stations never fail for slope: they are levelled by default (cost shown); only water/buildings/edge block them.
 *  - Towers: up to 4 (T-bar) / 6 (chair) / 7 (gondola) / 12 (cable car) world units tall (10 m each), placed on local high ground,
 *    spacing tightened automatically (x1 -> x0.3) before a route fails; each tower costs costPerMetre * FACTOR * height^1.5.
 *  - Funicular: straight track kept within [ground - CUT_MAX, ground + TRESTLE_MAX] (cuttings / trestles, may span water and gullies),
 *    trestle volume costs costPerMetre * TRESTLE_FACTOR per metre of track-height.
 */
export const LIFT_TOWER_COST_FACTOR = 4;
export const LIFT_TRESTLE_COST_FACTOR = 0.15;
export const LIFT_FUNI_CUT_MAX = 1.5; // world units (15 m) a funicular may cut into rising ground
export const LIFT_FUNI_TRESTLE_MAX = 4; // world units (40 m) of trestle above ground

// Terrain shaping (ski-friendly slopes). Half-steps; 1 tile = 10 m, 1 half-step = 5 m.
export const TERRAIN_RELIEF_128 = 52; // total relief on a 128 map
export const TERRAIN_RELIEF_EXP = 0.8; // relief ~ (N/128)^exp
export const TERRAIN_TALUS = 0.55; // thermal-erosion max edge slope (half-steps/tile) off cliffs
export const TERRAIN_TALUS_CLIFF = 2; // allowed on cliff bands / summit cone
export const TERRAIN_TERRACE = 1; // terrace blend 0..1 (benches/shoulders)
export const TERRAIN_FREQ_SCALE = 0.8; // <1 = broader features

// Simulation clock
/**
 * Pacing: one in-game day = 240 ticks (6 game minutes each). Speed 1x = 1.6 ticks/s (day = 150 s), 3x = 50 s/day, 10x = 15 s/day.
 * The sim only sees fixed ticks, so determinism does not depend on the speed (guest motion is interpolated by the renderer).
 * Optional "Fast nights" (core/pacing.ts) multiplies the tick rate at night; it changes real seconds per tick only, never the sim.
 */
export const TICKS_PER_DAY = 240;
export const REAL_SECONDS_PER_DAY_1X = 150;
/** Fixed simulation rate at speed 1x (ticks per real second). */
export const TICKS_PER_SECOND = TICKS_PER_DAY / REAL_SECONDS_PER_DAY_1X;
/** Speed index -> multiplier of the tick rate. 0 = paused. Buttons 1x/3x/10x => day = 150 s / 50 s / 15 s (docs/time-flow.md). */
export const SPEED_MULTIPLIERS = [0, 1, 3, 10] as const;
/** Button labels per speed index (index 0 = paused). */
export const SPEED_LABELS = ['Paused', '1x', '3x', '10x'] as const;
/** In-game minutes per tick (MINUTES_PER_DAY / TICKS_PER_DAY). */
export const GAME_MINUTES_PER_TICK = 6;
export const MINUTES_PER_DAY = 24 * 60;
export const DAYS_PER_MONTH = 15;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
/** Calendar compression vs the original 30-day months / 360-day year (docs/time-flow.md): 0.5. Day-keyed curves are authored in 'old days' and scaled by this. */
export const CAL = DAYS_PER_YEAR / 360;
/** Convert a count of original (30-day-month) days to current game days. */
export const oldDays = (d: number): number => d * CAL;
/** Season layout by month: 2 spring, 4 summer, 2 autumn, 4 winter (order matches render/Season.ts SEASON_NAMES). */
export const SEASON_MONTHS = [2, 4, 2, 4] as const;
/** New games start at the beginning of winter = 1 December (sim month 8; the real calendar maps sim day 0 to 1 April, see sim/calendar.ts). */
export const START_DAY_OF_YEAR = 8 * DAYS_PER_MONTH;
/** Max fixed steps run per rendered frame (no spiral of death). */
export const MAX_CATCHUP_STEPS = 8;
/** Per-system frame-time budget (ms) used by the debug profiler. */
export const SYSTEM_BUDGET_MS = 2;

// ---------- Seasons, weather, snow (Task 19) ----------
/** Altitude (m) of the valley floor, so tiles report real-looking heights ('Closed: no snow at 1,450 m'). 1 world unit = TILE_METRES m. */
export const RESORT_BASE_ELEVATION_M = 1200;
/** Construction discount in summer (months per SEASON_MONTHS). */
export const SUMMER_CONSTRUCTION_MULT = 0.5;

/**
 * Snowline over the year as a fraction of the terrain relief above the valley floor (0 = valley floor, 1 = highest summit).
 * Keys are [sim dayOfYear, fraction] authored on the REAL calendar (sim day 0 = 1 April, sim/calendar.ts), one key per mid-month (the first and last key
 * repeat Mar / Apr to close the cycle over day 0 / 179); smoothstep interpolation. Valley temperature = TEMP_PER_RELIEF x fraction, so the mean valley
 * temperature (1,200 m) per month is about: Jan -5.4, Feb -4, Mar -1, Apr 4.5, May 10, Jun 15, Jul 21, Aug 20.5, Sep 17.5, Oct 9, Nov 2.9, Dec -3.5
 * (coldest mid-January, warmest mid-July). Summer is deliberately hotter than the real Alps (valley +20 C): the game guarantees a snow-free summer on the
 * summits (Jun 21 - Sep) for hiking/biking, so the fractions stay > 1 from late June to mid September. Alpine reality mapped onto the relief (snowline ~800 m Jan, 1,200 Mar, 1,700 Apr, 2,800 Jun, high Aug,
 * 2,000 Oct, 1,300 Nov, 900 Dec) gives the fractions Jan -0.34, Mar -0.06 (valley slushy by late March), Apr 0.28, Jun 0.95, Oct 0.55,
 * Nov 0.18, Dec -0.22. Weather adds a modulation (sim/Weather). Table of the whole year: docs/time-flow.md section 10.
 */
export const SNOWLINE_KEYS: ReadonlyArray<readonly [number, number]> = [
  [-8, -0.06], [7, 0.28], [22, 0.7], [37, 0.98], [52, 1.34], [67, 1.3], [82, 1.15], [97, 0.55], [112, 0.18], [127, -0.22], [142, -0.34], [157, -0.25], [172, -0.06], [187, 0.28],
] as const;
/**
 * Calendar alignment knob (docs/time-flow.md "Calendar"): the curve is read `SNOWLINE_LEAD_DAYS` sim days ahead. 0: since the calendar fix the keys
 * above are authored directly in real-calendar sim days (coldest mid-January = sim day 142, warmest mid-July = day 52).
 */
export const SNOWLINE_LEAD_DAYS = 0;
/** Snowline fraction for a (fractional) day of year. */
export function snowlineFraction(dayFloat: number): number {
  const d = (((dayFloat + SNOWLINE_LEAD_DAYS) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  for (let i = 1; i < SNOWLINE_KEYS.length; i++) {
    const [d1, v1] = SNOWLINE_KEYS[i]!;
    if (d <= d1) {
      const [d0, v0] = SNOWLINE_KEYS[i - 1]!;
      const u = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
      const s = u * u * (3 - 2 * u); // smoothstep keeps the curve gentle at keys
      return v0 + (v1 - v0) * s;
    }
  }
  return SNOWLINE_KEYS[SNOWLINE_KEYS.length - 1]![1];
}

/** Temperature: valley temp (°C) = TEMP_PER_RELIEF * snowlineFraction (so 0 °C sits exactly at the snowline); lapse = same per relief. */
export const TEMP_PER_RELIEF = 16;
export const TEMP_DAILY_SWING = 3; // ± °C around the daily mean (peak 15:00)
export const TEMP_ANOMALY_SD = 1.8; // day-to-day warm/cold spell noise
export const TEMP_ANOMALY_DECAY = 0.8; // AR(1) persistence of spells
export const PRECIP_COOLING = 1.5; // °C drop on precipitation days (snowfall lowers the snowline)

/** Snow depth unit = metres. Hysteresis: a tile opens for skiing at >= 30 cm and only closes below 15 cm. */
export const SKI_OPEN_DEPTH = 0.3;
export const SKI_CLOSE_DEPTH = 0.15;
export const MIN_SKI_DEPTH = SKI_OPEN_DEPTH;
/** Snow-free (hike/bike) hysteresis: ok at <= 3 cm, not ok above 10 cm. */
export const SNOWFREE_OK_DEPTH = 0.03;
export const SNOWFREE_BAD_DEPTH = 0.1;
export const SNOW_SLUSH_DEPTH = 0.05;
export const SNOW_MAX_DEPTH = 2;
export const BIKE_MAX_STEEPNESS = 1.5; // half-steps/tile
export const SNOWFALL_M = 0.3; // metres per unit of precipitation intensity per day
export const SNOWFALL_MAX_TEMP = 0.5; // °C at tile altitude below which precipitation falls as snow
export const MELT_M_PER_DEG_DAY = 0.16 / CAL; // x2 with the 180-day year: the seasonal temperature swing now takes half the days, so melt per degree-day doubles
export const RAIN_MELT_M = 0.05;
export const SNOWMAKING_M_PER_DAY = 0.25;
export const SNOWMAKING_MAX_DEPTH = 0.8;
export const SNOWMAKING_MAX_TEMP = -2;
export const SNOWMAKING_WATER_PER_M = 12;
export const RESERVOIR_CAPACITY = 20000;
export const RESERVOIR_REFILL_PER_DAY = 1500;
/** Needs thresholds (°C at the entity's altitude, daily mean). */
export const COLD_NEED_MAX_TEMP = 6;
export const WARM_NEED_MIN_TEMP = 12;
/** A piste needs this many connected skiable tiles to count as open. */
export const PISTE_MIN_OPEN_TILES = 6;
/** Precipitation particles. */
export const PRECIP_PARTICLES = 3500;
export const PRECIP_BOX = [60, 40, 60] as const;

// ---- Guests (Task 20) ----
/** Max simultaneously active guest entities per map size. Over the cap, arrivals are throttled/aggregated (see Spawner). */
export const GUEST_CAP: Record<64 | 128 | 256, number> = { 64: 1000, 128: 2000, 256: 3000 };
export const GUEST_BASE_SPAWN_PER_TICK = 0.15;
/** Bigger maps are bigger resorts with a larger catchment (and a higher cost base: more lifts, cannons, area to maintain). */
export const SIZE_SPAWN_MULT: Record<64 | 128 | 256, number> = { 64: 1, 128: 1.2, 256: 1.65 }; // guests/tick at attractiveness 1.0 in winter
export const GUEST_WALK_SPEED = 0.15 * (150 / 24); // tiles per tick (0.94 = 1.5 tiles/s at 1x)
/** Skier exploration (sim/guests/Exploration.ts, docs/ski-exploration.md). */
export const EXPLORE = {
  /** Lifts remembered per guest (GuestStore.recA/B/C). */
  memory: 3,
  /** Penalty per remembered ride (x1.5 / 1 / 0.5 by recency) and the multiplier by skill 0..3 (experts / intermediates explore most). */
  noveltyWeight: 0.45, skillBoost: [0.6, 1.3, 1.6, 1.6],
  /** Via-tile scoring: crowd (log of today's passes), personal novelty (distance from the previous via), difficulty fit by skill, noise. */
  crowdWeight: 0.5, farWeight: 0.8, farTiles: 8, noise: 1.2, skillDiff: [-0.25, 0, 0.3, 0.45],
  /** Run-aware choice (docs/runs.md, phase 3): whole-run crowding (log mean passes), surface quality of the candidate tile (like 0..1, centred 0.5), mood (unhappy guests lean towards the easier run). */
  runCrowdWeight: 0.35, runQualityWeight: 0.9, moodEase: 0.5,
  /** Candidate pool: corridor around the lift line (>= corridorMin tiles, corridorFrac of its length), pool cap (tiles considered per lift). */
  /** Pause (ticks) after a run before the next decision (was 2-8: with ~6 game-minute ticks that capped a day at ~2 runs). */
  /** Pause (ticks) after visiting a building (was 10-40 = 1-4 game hours standing around). */
  visitPause: [4, 14] as readonly [number, number],
  /** Per-decision leave chance multiplier: pauses got ~2.5x shorter: guests decide ~2.5x as often and their visit count (which also raises the chance) grows ~2.5x as fast, so the same chance per decision would make them leave ~6x sooner. */
  leaveScale: 0.12,
  runPause: [0, 2] as readonly [number, number],
  corridorMin: 10, corridorFrac: 0.4, poolMax: 90,
} as const;
export const GUEST_DUSK_HOUR = 17; // legacy fallback (equinox-ish); the live value follows the sun, see sim/Daylight.ts
/** Seasonal daylight (sim/Daylight.ts): sinusoid by day of year, extremes at sim day 150 (1 Feb) and 60 (1 Aug), see sim/calendar.ts. */
export const DAYLIGHT = {
  /** Authored at sim day 150 / 60 = 1 Feb / 1 Aug on the real calendar (real solstices: sim day 130 / 40 = oldDays(260) / oldDays(80); not applied, it changes the sim, see docs/time-flow.md). */
  winterSolsticeDay: oldDays(260), summerSolsticeDay: oldDays(80),
  /** Mean +- amplitude (hours): sunrise 07:45 winter / 05:15 summer, sunset 16:45 winter / 20:45 summer. */
  sunriseMean: 6.5, sunriseAmp: 1.25, sunsetMean: 18.75, sunsetAmp: 2,
  /** Civil twilight margin (hours) either side of sunrise/sunset. */
  twilight: 0.75,
  /** Guest arrivals: [sunrise + arriveAfter, sunset - arriveBefore], clamped to winter / summer sane windows. */
  arriveAfter: 1, arriveBefore: 2.5, arriveMin: 7.5, arriveMaxWinter: 16.5, arriveMaxSummer: 18, arriveMinWinter: 8,
  /** Day guests head home at sunset - this (hours): winter 0.5, summer 1. Interpolated by daylight length. */
  leaveBeforeWinter: 0.5, leaveBeforeSummer: 1,
  /** Default 'Auto (daylight)' lift hours: [sunrise + liftAfter, sunset - liftBefore]. */
  liftAfter: 0.75, liftBefore: 0.25,
} as const;

/**
 * Evening / après-ski model (docs/balance.md "Evenings"). Hourly demand curves are piecewise-linear key points [hour, demand] (1 = a normal busy hour);
 * the winter and summer curves are blended by `summerness(day)`.
 */
export const EVENING = {
  /** Venues (restaurants, cafés, huts, terraces, bars) take guests from this hour until closeWinter / closeSummer. */
  openHour: 8, closeWinter: 23, closeSummer: 22.5,
  /** Overnight guests go to sleep at this hour (winter .. summer). */
  sleepWinter: 22.5, sleepSummer: 23,
  /** Evening mode (overnight + après guests only) starts here (winter .. summer). */
  startWinter: 16, startSummer: 18.5,
  /** Share (%) of day guests that stay for après-ski: winter base / summer base, x type bias; they leave at apresEnd (19:00-20:00 winter, 21:00-22:00 summer). */
  apresWinter: 28, apresSummer: 12,
  apresTypeBias: [1, 1.25, 0.8, 1.25, 0.7, 1.25] as readonly number[],
  apresEndWinter: 19, apresEndSummer: 21,
  /** Max evening venue visits (dinner, drinks, terrace) per evening: overnight / après guests. */
  maxVisitsOvernight: 2, maxVisitsApres: 1,
  /** Spend premium on venue prices from this hour on ("drinks premium"), and extra staff cost share of venue upkeep for the evening shift. */
  premium: 0.15, premiumFrom: 17, staffCost: 0.15,
  /** Weight of (demand - 1) in venue scores. */
  demandWeight: 0.6,
  dine: {
    winter: [[8, 0.15], [11, 0.5], [12, 0.95], [13.5, 0.95], [14.5, 0.55], [15.5, 0.55], [16, 1.0], [17.5, 1.3], [18.5, 1.6], [21, 1.6], [21.5, 1.0], [22.5, 0.5], [23, 0.2]],
    summer: [[8, 0.15], [11, 0.6], [12, 1.5], [13.5, 1.0], [15, 0.5], [17, 0.6], [18.5, 1.4], [22, 1.4], [22.5, 0.3]],
  } as Record<'winter' | 'summer', ReadonlyArray<readonly [number, number]>>,
  bar: {
    winter: [[8, 0], [12, 0.3], [15, 0.5], [16, 1.2], [17.5, 1.8], [18.5, 1.7], [21, 1.7], [21.5, 1.2], [22.5, 0.6], [23, 0.2]],
    summer: [[8, 0], [12, 0.4], [15, 0.5], [17, 0.8], [18.5, 1.4], [22, 1.5], [22.5, 0.4]],
  } as Record<'winter' | 'summer', ReadonlyArray<readonly [number, number]>>,
} as const;
export const SPATIAL_CELL = 8; // tiles

// ---- Navigation & decisions (Task 21) ----
/** Movement speeds, tiles per tick (arcade-scaled; 1 tick = 6 game minutes but guests live on lift-time: see LIFT_SECONDS_PER_TICK). */
export const NAV_SPEED = { walk: 3.4, hike: 1.9, bike: 3.1, skiBase: 6.25, skiFlat: 1.4 };
/** Walk speed per map size (tiles/tick, 2.5 / 3.4 / 5.0 = 4 / 5.5 / 8 tiles/s at 1x): bigger maps are played at lower zoom, so the same on-screen px/s needs more tiles/s. `NAV_SPEED.walk` is the 128 value. */
export const WALK_SPEED_BY_SIZE: Readonly<Record<number, number>> = { 64: 2.5, 128: 3.4, 256: 5.0 };
/** Multiplier on NAV_SPEED.walk for a map size (1 on 128). Unknown sizes interpolate on log2 between the neighbours. */
export function walkSizeScale(size: number): number {
  const k = Math.log2(Math.max(64, Math.min(256, size)) / 64) / 2; // 0..1 across 64..256
  const w = (k <= 0.5 ? WALK_SPEED_BY_SIZE[64]! + (WALK_SPEED_BY_SIZE[128]! - WALK_SPEED_BY_SIZE[64]!) * (k / 0.5) : WALK_SPEED_BY_SIZE[128]! + (WALK_SPEED_BY_SIZE[256]! - WALK_SPEED_BY_SIZE[128]!) * ((k - 0.5) / 0.5));
  return w / WALK_SPEED_BY_SIZE[128]!;
}
/** Walk speed (tiles/tick) of a map size. */
export const walkSpeedFor = (size: number): number => NAV_SPEED.walk * walkSizeScale(size);
/** Per-tick speed scale applied to animals/wildlife whose speeds were authored for the 24 s day (x6.25 keeps today's on-screen tiles/s at the 150 s day). */
export const ANIMAL_SPEED_K = 150 / 24;
/** Before the exploration work (docs/ski-exploration.md): walk 3, skiBase 2.2, skiFlat 0.5 (a 60 m-drop run took ~30 ticks = 3 game hours; walking 30 tiles took 10). The A/B baseline in scripts/analysis/skiLib.ts. */
export const NAV_SPEED_LEGACY = { walk: 3, skiBase: 2.2, skiFlat: 0.5 } as const;
/** Seconds of lift operation per sim tick (lift throughput and ride times are scaled with this). */
export const LIFT_SECONDS_PER_TICK = 6;
/** Max uncached path queries per tick (time-slicing); excess guests wait ('pending'). */
export const NAV_MAX_QUERIES_PER_TICK = 6;
/** Max path-hierarchy build units per tick (one unit = a cluster's portals or one portal's local Dijkstra, <= ~0.3 ms). */
export const NAV_MAX_BUILDS_PER_TICK = 12;
/** Base queue patience (ticks) before a guest balks / gives up. */
export const LIFT_PATIENCE_TICKS = 45;
/** Probability scale for an injury per run: risk = INJURY_PER_LEVEL * (difficulty - skill)+, plus a tiny base. */
export const INJURY_PER_LEVEL = 0.012;
export const INJURY_BASE = 0.0004;

// ---- Graphics quality (Task 28) ----
export type GraphicsQuality = 'low' | 'med' | 'high';
export const GRAPHICS_QUALITIES: readonly GraphicsQuality[] = ['low', 'med', 'high'];
export interface QualityPreset {
  /** Directional-light shadow maps (UNVERIFIED at runtime: only 'high'). */
  shadows: boolean;
  /** Upper bound for devicePixelRatio. */
  pixelRatioCap: number;
  /** Multiplier on LOD switch distances: visible world height is divided by it (< 1 = cheaper LODs sooner). */
  lodScale: number;
  /** Fraction (0..1) of trees/shrubs that are drawn. */
  treeDensity: number;
  /** Multiplier on precipitation particle density. */
  particles: number;
  /** Multiplier on the zoom height where guests / attraction props switch to impostors / hide. */
  guestFarScale: number;
  /** Ground-level (ride / photo) caps, M5.2: see docs/ground-level.md. */
  ground: GroundQuality;
}
/** Close-up caps of the perspective views. Zero near radius / caps = that near feature is off. */
export interface GroundQuality {
  /** Radius (tiles) of the near LOD for figures and lifts (0 = off). */
  nearTiles: number;
  /** Near (high-poly) tree / rock instances per 16-tile cell (0 = off: the standard meshes are used from the camera outwards). */
  nearTreesPerCell: number;
  nearRocksPerCell: number;
  /** Detailed figures drawn at once (max 40). */
  nearFigures: number;
  /** Multiplier on the fog range (< 1 = fog closer = fewer far trees / terrain). */
  fogRangeScale: number;
  /** Terrain micro-detail texture in perspective views. */
  detailTexture: boolean;
}
export const QUALITY_PRESETS: Record<GraphicsQuality, QualityPreset> = {
  low: { shadows: false, pixelRatioCap: 1, lodScale: 0.7, treeDensity: 0.55, particles: 0.35, guestFarScale: 0.7, ground: { nearTiles: 0, nearTreesPerCell: 0, nearRocksPerCell: 0, nearFigures: 0, fogRangeScale: 0.7, detailTexture: false } },
  med: { shadows: false, pixelRatioCap: 1.5, lodScale: 1, treeDensity: 0.85, particles: 0.7, guestFarScale: 1, ground: { nearTiles: 6, nearTreesPerCell: 70, nearRocksPerCell: 40, nearFigures: 40, fogRangeScale: 1, detailTexture: true } },
  high: { shadows: true, pixelRatioCap: 2, lodScale: 1.25, treeDensity: 1, particles: 1, guestFarScale: 1.25, ground: { nearTiles: 8, nearTreesPerCell: 90, nearRocksPerCell: 50, nearFigures: 40, fogRangeScale: 1.15, detailTexture: true } },
};
/** Sensible default by map size and device pixel ratio: big maps / hi-dpi screens start cheaper. Shadows are never on by default. */
export function defaultQuality(mapSize: number, devicePixelRatio = 1): GraphicsQuality {
  let q = mapSize >= 256 ? 0 : 1; // 256 -> low, 64/128 -> med
  if (devicePixelRatio > 2.5 && q > 0) q--;
  return GRAPHICS_QUALITIES[q]!;
}
/** Effective renderer pixel ratio for a preset (never above the device's). */
export function pixelRatioFor(q: GraphicsQuality, devicePixelRatio: number): number {
  return Math.max(1, Math.min(devicePixelRatio || 1, QUALITY_PRESETS[q].pixelRatioCap));
}

/** Share of its daily upkeep a building pays while it is closed for the season (needs snow / warmth that is not there). */
export const CLOSED_BUILDING_UPKEEP_SHARE = 0.5;
/** Upkeep multiplier for a building reached only by hiking trail / piste edge (no footpath or road): supplies are carried on foot (D-P9). Needs `createSim({ remoteSupply: true })`. docs/trails-access.md */
export const REMOTE_SUPPLY_MULT = 1.25;
/**
 * Off-season relief (docs/balance.md "Gentler summer"): winter-only buildings (snow cannons, ski school, snowcat garage/outpost, après bar...)
 * are mothballed outside winter and pay only this share of their upkeep; staff of a venue that has been closed for `furloughAfterDays`
 * in a row go on seasonal furlough at `furloughWageShare` of the wage.
 */
export const OFFSEASON_RELIEF = { winterOnlyUpkeepShare: 0.25, furloughAfterDays: 3, furloughWageShare: 0.5 } as const;

// ---- Difficulty & new-game options (Task 35; docs/balance.md) ----
export type DifficultyId = 'relaxed' | 'normal' | 'challenging';
export const DIFFICULTY_IDS: readonly DifficultyId[] = ['relaxed', 'normal', 'challenging'];
export interface DifficultyDef {
  label: string; blurb: string;
  /** Multiplier on the starting money. */
  money: number;
  /** Multiplier on bank interest rates (credit-rating based rate is scaled, then clamped to the loan rules). */
  loanRate: number;
  /** Multiplier on daily building / lift upkeep and on staff wages. */
  upkeep: number; wages: number;
  /** Multiplier on the arrival rate. */
  spawn: number;
  /** Multiplier on the injury risk per run (incident frequency). */
  incidents: number;
  /** Multiplier on lift-queue patience (higher = more forgiving guests). */
  patience: number;
  /** Multiplier on guest price sensitivity (elasticity exponent). */
  priceSens: number;
  /** Automatic foreclosure: continuous days below -foreclosureFloor before the bank ends the game (0 = never; declaring bankruptcy stays the player's choice). */
  foreclosureDays: number; foreclosureFloor: number;
}
export const DIFFICULTY: Record<DifficultyId, DifficultyDef> = {
  relaxed: { label: 'Relaxed', blurb: 'More money, forgiving guests, lower upkeep.', money: 1.5, loanRate: 0.8, upkeep: 0.75, wages: 0.75, spawn: 1.2, incidents: 0.6, patience: 1.3, priceSens: 0.8, foreclosureDays: 0, foreclosureFloor: 150_000 },
  normal: { label: 'Normal', blurb: 'The intended balance.', money: 1, loanRate: 1, upkeep: 1, wages: 1, spawn: 1, incidents: 1, patience: 1, priceSens: 1, foreclosureDays: 0, foreclosureFloor: 150_000 },
  challenging: { label: 'Challenging', blurb: 'Less money, higher upkeep, tougher guests and more incidents.', money: 0.75, loanRate: 1.2, upkeep: 1.15, wages: 1.15, spawn: 0.93, incidents: 1.4, patience: 0.8, priceSens: 1.15, foreclosureDays: 360, foreclosureFloor: 150_000 },
};
/** Allowed custom starting-money range (Normal difficulty default = STARTING_MONEY). */
export const START_MONEY_RANGE = { min: 50_000, max: 1_000_000, step: 10_000 } as const;
/** Allowed walking-radius override (tiles); default WALKING_RADIUS_TILES. */
export const WALKING_RADIUS_RANGE = { min: 6, max: 30 } as const;

// ---- Staff upgrade modifiers (M5.4 Task 20) ----
export type { ModKey } from './staffUpgrades';
/** Anything that carries the staff-upgrade state (the Sim). */
export interface ModSource { staffUpgrades: { mod(key: ModKey): number } }
/** Multiplier of a balance knob from trained staff upgrades (1 = untouched). The ONLY way upgrade effects reach the systems. */
export const mod = (sim: ModSource, key: ModKey): number => sim.staffUpgrades.mod(key);
