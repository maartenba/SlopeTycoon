import type { SeasonId } from '../../core/events';
import { Rng } from '../../core/Rng';
import { ANIMAL_SPEED_K } from '../../config/balance';
import type { Grid } from '../../world/Grid';
import { TileType, isWaterType } from '../../world/Grid';

/** Harmless wild fauna (bears/wolves stay in ops/Wildlife). Herd steering on the tile grid, time-sliced, deterministic. */
export type SpeciesId = 'deer' | 'ibex' | 'chamois' | 'marmot' | 'fox' | 'eagle' | 'cow' | 'sheep' | 'goat';
export const SPECIES_IDS: readonly SpeciesId[] = ['cow', 'sheep', 'goat', 'deer', 'ibex', 'chamois', 'marmot', 'fox', 'eagle'];

export interface Habitat {
  /** Altitude as a fraction of the map relief (0 valley .. 1 summit). */
  alt: [number, number];
  /** Tile steepness (half-steps / tile). */
  slope: [number, number];
  /** Forest density byte range 0..255. */
  forest: [number, number];
  rockBonus?: boolean;
}

export interface SpeciesDef {
  id: SpeciesId;
  herd: [number, number];
  /** Herds per 128x128 map (scaled by area, at least 1 on any map that has habitat). */
  herdsPer128: number;
  habitat: Habitat;
  /** Seasonal altitude preference override (fractions of relief). */
  altPref?: Partial<Record<SeasonId, [number, number]>>;
  /** Max snow depth the species tolerates when choosing a target (deer descend as snow deepens). */
  snowAvoid?: number;
  /** Guest flee distance (tiles). */
  flee: number;
  /** Tiles per sim tick when walking. */
  speed: number;
  /** Hours [from, to) the species is out (wraps midnight); null = always. */
  active: [number, number] | null;
  /** Seasons where it is hidden (hibernation). */
  hiddenIn?: SeasonId[];
  flies?: boolean;
  /** Scenery weight of one animal. */
  scenic: number;
}

export const SPECIES: Record<Exclude<SpeciesId, 'cow' | 'sheep' | 'goat'>, SpeciesDef> = {
  deer: { id: 'deer', herd: [4, 12], herdsPer128: 5, habitat: { alt: [0.04, 0.6], slope: [0, 1.6], forest: [0, 255] }, altPref: { winter: [0, 0.28], spring: [0.05, 0.4] }, snowAvoid: 0.3, flee: 9, speed: 0.11, active: null, scenic: 1 },
  ibex: { id: 'ibex', herd: [3, 7], herdsPer128: 2, habitat: { alt: [0.5, 1], slope: [1.0, 9], forest: [0, 60], rockBonus: true }, altPref: { winter: [0.4, 0.8] }, flee: 14, speed: 0.09, active: null, scenic: 1.6 },
  chamois: { id: 'chamois', herd: [3, 6], herdsPer128: 2, habitat: { alt: [0.38, 0.9], slope: [0.7, 9], forest: [0, 150] }, altPref: { winter: [0.3, 0.7] }, snowAvoid: 0.8, flee: 12, speed: 0.1, active: null, scenic: 1.4 },
  marmot: { id: 'marmot', herd: [3, 6], herdsPer128: 5, habitat: { alt: [0.3, 0.85], slope: [0, 1.2], forest: [0, 40] }, flee: 6, speed: 0.06, active: [7, 19], hiddenIn: ['winter'], scenic: 1.2 },
  fox: { id: 'fox', herd: [1, 2], herdsPer128: 2, habitat: { alt: [0.05, 0.55], slope: [0, 1.5], forest: [40, 255] }, flee: 10, speed: 0.09, active: [16, 9], scenic: 0.8 },
  eagle: { id: 'eagle', herd: [2, 4], herdsPer128: 3, habitat: { alt: [0.5, 1], slope: [1.2, 9], forest: [0, 255], rockBonus: true }, flee: 0, speed: 0.08, active: [8, 18], flies: true, scenic: 1.5 },
};

export interface Critter {
  id: number; species: SpeciesId; herd: number; leader: boolean;
  x: number; y: number; tx: number; ty: number;
  heading: number;
  /** Ticks left of fleeing (set by guests / predators). */
  flee: number;
  hidden: boolean;
  /** Eagle orbit phase / walk-cycle seed 0..2pi. */
  phase: number;
  /** Owning farm building id for livestock, 0 for wild. */
  farm: number;
  /** Behaviour for rendering: 0 graze (head down), 1 walk, 2 rest/alert, 3 run. Optional (old saves). */
  mode?: number;
  /** Ticks left of graze/rest before the leader picks a new target. */
  timer?: number;
}
export const MODE = { graze: 0, walk: 1, rest: 2, run: 3 } as const;

export interface FaunaDeps {
  size: 64 | 128 | 256;
  grid: Grid;
  forest: Uint8Array;
  /** Tiles animals avoid: buildings, paths, roads, rail, pistes, lifts. */
  blocked: (i: number) => boolean;
  /** Nearest guest/vehicle within r tiles, or null. */
  threat: (x: number, y: number, r: number) => { x: number; y: number } | null;
  seed: number;
}

export const FAUNA = { sliceEvery: 2, maxPerMap: { 64: 120, 128: 240, 256: 440 } as Record<number, number>, maxWander: 14, fleeTicks: 12 } as const;

const centreDist = (i: number, N: number): number => Math.hypot((i % N) - N / 2, ((i / N) | 0) - N / 2);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Pure habitat suitability of a tile for a species (0..1). */
export function suitability(h: Habitat, altFrac: number, steep: number, forest: number, isRock: boolean, altOverride?: [number, number]): number {
  const [a0, a1] = altOverride ?? h.alt;
  if (altFrac < a0 - 0.08 || altFrac > a1 + 0.08) return 0;
  if (steep < h.slope[0] - 0.4 || steep > h.slope[1]) return 0;
  if (forest < h.forest[0] - 20 || forest > h.forest[1] + 20) return 0;
  let s = 1;
  if (altFrac < a0) s *= 1 - (a0 - altFrac) / 0.08;
  if (altFrac > a1) s *= 1 - (altFrac - a1) / 0.08;
  if (steep < h.slope[0]) s *= 0.5;
  if (h.rockBonus && isRock) s = Math.min(1, s * 1.3);
  return clamp01(s);
}

/** Per-tile altitude fraction + steepness cache shared by fauna and livestock. */
export class TerrainStats {
  readonly alt: Float32Array;
  readonly steep: Float32Array;
  constructor(readonly grid: Grid) {
    const N = grid.size;
    this.alt = new Float32Array(N * N); this.steep = new Float32Array(N * N);
    this.rebuild();
  }
  rebuild(): void {
    const g = this.grid, N = g.size, relief = 80 * Math.sqrt(N / 128);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const [n, e, s, w] = g.getCorners(x, y), i = y * N + x;
      this.alt[i] = clamp01(((n + e + s + w) / 4 - 8) / relief);
      this.steep[i] = g.steepness(x, y);
    }
  }
}

export class Fauna {
  animals: Critter[] = [];
  herdCount = 0;
  private rng: Rng;
  private nextId = 1;
  private nextHerd = 1;
  private leaders = new Map<number, Critter>();
  /** Sim cost accounting (ms) for perf logging. */
  msTotal = 0; updates = 0;

  constructor(private d: FaunaDeps, readonly stats: TerrainStats) {
    this.rng = new Rng((d.seed ^ 0xfa17a) >>> 0);
  }

  /** Save/load (Task 33). */
  serialize(): unknown { return { animals: this.animals.map((a) => ({ ...a })), herdCount: this.herdCount, rng: this.rng.getState(), nextId: this.nextId, nextHerd: this.nextHerd }; }
  load(d: unknown): void {
    const s = d as { animals: Critter[]; herdCount: number; rng: number; nextId: number; nextHerd: number };
    this.animals = s.animals.map((a) => ({ ...a })); this.herdCount = s.herdCount; this.rng.setState(s.rng); this.nextId = s.nextId; this.nextHerd = s.nextHerd;
    this.leaders.clear();
    for (const a of this.animals) if (a.leader) this.leaders.set(a.herd, a);
  }

  private walkable(x: number, y: number): boolean {
    const N = this.d.size;
    if (x < 0 || y < 0 || x >= N - 1 || y >= N - 1) return false;
    const i = (y | 0) * N + (x | 0), t = this.d.grid.tileType[i]!;
    return !isWaterType(t) && t !== TileType.Ice && !this.d.blocked(i);
  }

  private prefAlt(def: SpeciesDef, season: SeasonId): [number, number] { return def.altPref?.[season] ?? def.habitat.alt; }

  /** Tile score for a species in a season (suitability, snow penalty). */
  private score(def: SpeciesDef, i: number, season: SeasonId): number {
    const g = this.d.grid, N = this.d.size;
    let s = suitability(def.habitat, this.stats.alt[i]!, this.stats.steep[i]!, this.d.forest[i]!, g.tileType[i] === TileType.Rock, this.prefAlt(def, season));
    if (def.snowAvoid !== undefined && g.snowDepth[i]! > def.snowAvoid) s *= 0.15;
    void N;
    return s;
  }

  /** (Re)spawn herds on suitable habitat. Counts scale with map area, capped per map size. Deterministic. */
  populate(): void {
    const N = this.d.size, g = this.d.grid;
    this.animals = []; this.leaders.clear(); this.herdCount = 0;
    const area = (N / 128) ** 2, cap = FAUNA.maxPerMap[N] ?? 120;
    for (const def of Object.values(SPECIES)) {
      const cands: number[] = [];
      for (let i = 0; i < N * N; i++) {
        const x = i % N, y = (i / N) | 0;
        if (x < 2 || y < 2 || x >= N - 2 || y >= N - 2 || this.d.blocked(i) || isWaterType(g.tileType[i]!)) continue;
        if (suitability(def.habitat, this.stats.alt[i]!, this.stats.steep[i]!, this.d.forest[i]!, g.tileType[i] === TileType.Rock) >= 0.7) cands.push(i);
      }
      if (cands.length < 8) continue;
      const herds = Math.max(def.flies ? 1 : 2, Math.round(def.herdsPer128 * area ** 0.75));
      for (let h = 0; h < herds && this.animals.length < cap; h++) {
        // bias towards the playable middle: best (closest to the centre) of 3 random candidates, so herds are seen at default zoom
        let c = cands[Math.floor(this.rng.next() * cands.length)]!;
        const rank = (i: number): number => centreDist(i, N) + (def.flies ? 0 : this.d.forest[i]! * 0.08); // open meadows near the middle are seen; deep forest hides animals
        for (let t = 0; t < 3; t++) { const o = cands[Math.floor(this.rng.next() * cands.length)]!; if (rank(o) < rank(c)) c = o; }
        this.spawnHerd(def, (c % N) + 0.5, ((c / N) | 0) + 0.5, cap);
      }
    }
  }

  private spawnHerd(def: SpeciesDef, cx: number, cy: number, cap: number): void {
    const n = this.rng.int(def.herd[0], def.herd[1]), herd = this.nextHerd++;
    this.herdCount++;
    for (let k = 0; k < n && this.animals.length < cap; k++) {
      const ang = this.rng.next() * Math.PI * 2, r = k === 0 ? 0 : 0.6 + this.rng.next() * 1.8;
      const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r, ok = this.walkable(x, y) || def.flies;
      const c: Critter = {
        id: this.nextId++, species: def.id, herd, leader: k === 0, x: ok ? x : cx, y: ok ? y : cy, tx: cx, ty: cy,
        heading: this.rng.next() * Math.PI * 2, flee: 0, hidden: false, phase: this.rng.next() * Math.PI * 2, farm: 0, mode: MODE.graze, timer: this.rng.int(0, 60),
      };
      c.tx = c.x; c.ty = c.y;
      this.animals.push(c);
      if (k === 0) this.leaders.set(herd, c);
    }
  }

  private isActive(def: SpeciesDef, season: SeasonId, hour: number): boolean {
    if (def.hiddenIn?.includes(season)) return false;
    if (!def.active) return true;
    const [a, b] = def.active;
    return a <= b ? hour >= a && hour < b : hour >= a || hour < b;
  }

  /** Spook a herd (predator / event). */
  /**
   * Debug helper: critters of a species ordered by distance from (x, y) (ties by id: deterministic). `species` omitted = all animals.
   * Hidden / flying ones are included; the caller decides what to show.
   */
  findNearest(species: SpeciesId | null, x: number, y: number): Critter[] {
    const list = this.animals.filter((a) => !species || a.species === species);
    return list.map((a) => ({ a, d: Math.hypot(a.x - x, a.y - y) })).sort((p, q) => p.d - q.d || p.a.id - q.a.id).map((e) => e.a);
  }
  scare(herd: number, ticks: number = FAUNA.fleeTicks): void { for (const a of this.animals) if (a.herd === herd) a.flee = ticks; }

  /** Time-sliced: each animal is processed every `sliceEvery` ticks (step scaled accordingly). */
  update(tick: number, season: SeasonId, hour: number): void {
    const t0 = performance.now();
    const S = FAUNA.sliceEvery;
    for (const a of this.animals) {
      if (a.farm) continue;
      if ((tick + a.id) % S !== 0) continue;
      const def = SPECIES[a.species as keyof typeof SPECIES];
      if (!def) continue;
      a.hidden = !this.isActive(def, season, hour);
      if (a.hidden) continue;
      if (def.flies) { this.fly(a, def, S); continue; }
      this.walk(a, def, season, S);
    }
    this.msTotal += performance.now() - t0; this.updates++;
  }

  private fly(a: Critter, def: SpeciesDef, S: number): void {
    // flocks circle a shared anchor (the leader's tx,ty) that drifts slowly; each bird has its own radius + phase
    const L = a.leader ? a : this.leaders.get(a.herd) ?? a, N = this.d.size;
    if (a.leader) {
      const dr = a.phase * 0.31 + a.id;
      a.tx = Math.min(N - 6, Math.max(6, a.tx + Math.cos(dr) * 0.03 * S)); a.ty = Math.min(N - 6, Math.max(6, a.ty + Math.sin(dr) * 0.03 * S));
    }
    a.phase += def.speed * ANIMAL_SPEED_K * S * 0.25;
    const r = 4 + (a.id % 4) * 0.8 + 1.5 * Math.sin(a.phase * 0.37 + a.id);
    a.x = L.tx + Math.cos(a.phase + (a.id % 7)) * r; a.y = L.ty + Math.sin(a.phase + (a.id % 7)) * r;
    a.heading = a.phase + (a.id % 7) + Math.PI / 2; a.mode = MODE.walk;
  }

  private walk(a: Critter, def: SpeciesDef, season: SeasonId, S: number): void {
    const N = this.d.size;
    let speed = def.speed * ANIMAL_SPEED_K * S;
    a.mode ??= MODE.graze; a.timer ??= 0;
    if (def.flee > 0) {
      const th = this.d.threat(a.x, a.y, def.flee);
      if (th) { a.flee = FAUNA.fleeTicks; const ang = Math.atan2(a.y - th.y, a.x - th.x); a.tx = a.x + Math.cos(ang) * 6; a.ty = a.y + Math.sin(ang) * 6; a.timer = 0; }
    }
    const L = a.leader ? a : this.leaders.get(a.herd) ?? a;
    if (a.flee > 0) { a.flee -= S; speed *= 2.2; a.mode = MODE.run; }
    else if (a.leader) {
      const d = Math.hypot(a.tx - a.x, a.ty - a.y);
      if (a.timer > 0) { a.timer -= S; a.mode = a.timer > 20 ? MODE.graze : MODE.rest; return; }
      if (d < 0.5) { // arrived: graze / rest for a while, then pick the next target
        if (a.mode === MODE.walk || a.mode === MODE.run) { a.timer = this.rng.int(40, 140); a.mode = MODE.graze; return; }
        this.pickTarget(a, def, season); a.mode = MODE.walk;
      } else a.mode = MODE.walk;
    } else {
      // follow: cohesion to the leader with a stable personal offset; idle/graze when close, trot to catch up when far
      const off = 0.8 + (a.id % 5) * 0.5, ang = a.phase;
      a.tx = L.x + Math.cos(ang) * off; a.ty = L.y + Math.sin(ang) * off;
      const far = Math.hypot(a.tx - a.x, a.ty - a.y);
      if (far < 0.4) { a.mode = L.mode === MODE.rest ? MODE.rest : MODE.graze; if ((a.id + a.timer) % 37 === 0) a.phase += 0.9; a.timer++; return; }
      a.mode = MODE.walk; speed *= Math.min(2.4, 1 + far * 0.25);
    }
    const dx = a.tx - a.x, dy = a.ty - a.y, dist = Math.hypot(dx, dy);
    if (dist < 0.05) return;
    const step = Math.min(speed, dist);
    for (let k = 0; k < 4; k++) { // try the heading, then deflect around obstacles
      const ang = Math.atan2(dy, dx) + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.7);
      const nx = a.x + Math.cos(ang) * step, ny = a.y + Math.sin(ang) * step;
      if (!this.walkable(nx, ny)) continue;
      const i = (ny | 0) * N + (nx | 0);
      if (this.stats.steep[i]! > def.habitat.slope[1] + 0.6) continue;
      a.x = nx; a.y = ny; a.heading = ang;
      return;
    }
    if (a.leader) { a.tx = a.x; a.ty = a.y; a.mode = MODE.graze; a.timer = 20; } // boxed in: rest, re-pick later
  }

  private pickTarget(a: Critter, def: SpeciesDef, season: SeasonId): void {
    const N = this.d.size;
    let best = -1, bs = 0;
    for (let k = 0; k < 7; k++) {
      const r = 3 + this.rng.next() * FAUNA.maxWander, ang = this.rng.next() * Math.PI * 2;
      const x = Math.floor(a.x + Math.cos(ang) * r), y = Math.floor(a.y + Math.sin(ang) * r);
      if (x < 2 || y < 2 || x >= N - 2 || y >= N - 2) continue;
      const i = y * N + x;
      if (this.d.blocked(i) || isWaterType(this.d.grid.tileType[i]!)) continue;
      const s = this.score(def, i, season) * (0.8 + 0.2 * this.rng.next());
      if (s > bs) { bs = s; best = i; }
    }
    if (best >= 0) { a.tx = (best % N) + 0.5; a.ty = ((best / N) | 0) + 0.5; } else { a.tx = a.x; a.ty = a.y; }
  }

  /** Eagle anchors: set once to a steep/rock tile (called by populate callers when fauna exist). */
  anchorEagles(): void {
    for (const a of this.animals) if (a.species === 'eagle') { a.tx = a.x; a.ty = a.y; }
  }

  countBy(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of this.animals) out[a.species] = (out[a.species] ?? 0) + 1;
    return out;
  }

  hash(): string {
    let h = 0x811c9dc5;
    const mix = (v: number): void => { h ^= v | 0; h = Math.imul(h, 0x01000193) >>> 0; };
    for (const a of this.animals) { mix(Math.round(a.x * 20)); mix(Math.round(a.y * 20)); }
    mix(this.rng.getState());
    return h.toString(16).padStart(8, '0');
  }
}
