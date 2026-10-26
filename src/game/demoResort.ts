import { DAYS_PER_YEAR } from '../config/balance';
import { NetKind, Layer, interpolateStroke, sweepBrush, type Rect } from '../world/Networks';
import type { LiftKind } from '../config/lifts';
import { buildStarterResort, type ResortKit, type StarterReport } from './starterResort';
import { Rng } from '../core/Rng';
import { GuestType, Mode } from '../sim/guests/Guest';
import type { Sim } from './createSim';

/** Scale of the demo / debug resort. */
export type DemoLevel = 'starter' | 'medium' | 'large';

export interface DemoReport {
  level: DemoLevel;
  /** building type -> count placed */
  placed: Record<string, number>;
  lifts: Array<{ id: number; kind: string }>;
  pisteTiles: number;
  /** A point in the middle of each new piste (camera targets). */
  pisteMids: Array<{ x: number; y: number }>;
  hikeTiles: number;
  mtbTiles: number;
  /** What could not be built (never throws). */
  failures: string[];
  /** One line per step, in order. */
  log: string[];
}

interface LevelSpec {
  liftKinds: LiftKind[];
  cannons: number;
  attractions: number;
  extras: Array<[type: string, count: number]>;
  trails: number;
  rail: boolean;
}

const SPECS: Record<DemoLevel, LevelSpec> = {
  starter: { liftKinds: ['chair4'], cannons: 3, attractions: 1, extras: [['rental', 1]], trails: 1, rail: false },
  medium: {
    liftKinds: ['tbar', 'chair4d', 'chair4'], cannons: 5, attractions: 3, trails: 2, rail: true,
    extras: [['rental', 1], ['chalet', 2], ['apartment', 1], ['mountainHut', 1], ['rangerStation', 1], ['shop', 1], ['alpineFarm', 1]],
  },
  large: {
    liftKinds: ['tbar', 'chair4d', 'chair8b', 'gondola6'], cannons: 8, attractions: 4, trails: 4, rail: true,
    extras: [['rental', 1], ['chalet', 3], ['apartment', 2], ['mountainHut', 1], ['rangerStation', 1], ['shop', 1], ['cafe', 1], ['liftWorkshop', 1], ['playground', 1], ['alpineFarm', 1]],
  },
};

type Pt = { x: number; y: number };

/**
 * Builds a showcase resort through the REAL placement / network / lift APIs (sim only; no renderer, free of charge: the funds are topped
 * up first and restored afterwards). Deterministic in the sim state. Safe to call on any map / seed: every step is a best-effort search near
 * the village and failures are reported in `failures` instead of thrown. Calling it again places more of the optional extras only when the
 * wanted count is not yet present (starter lifts are added only when the map has no lift yet).
 */
/** Builds the demo resort (title screen, 'Populate demo resort' debug); bypasses the Career unlock gate. */
export function buildDemoResort(sim: Sim, level: DemoLevel = 'large'): DemoReport {
  return sim.progression.withBypass(() => buildDemo(sim, level));
}

function buildDemo(sim: Sim, level: DemoLevel): DemoReport {
  const spec = SPECS[level];
  const out: DemoReport = { level, placed: {}, lifts: [], pisteTiles: 0, pisteMids: [], hikeTiles: 0, mtbTiles: 0, failures: [], log: [] };
  const moneyBefore = sim.game.money;
  const log = (m: string): void => { out.log.push(m); };
  let starter: StarterReport | null = null;
  const already = sim.lifts.all().length > 0;
  const existing = new Set(sim.buildings.all().map((b) => b.id));
  try {
    if (already) log('lifts already present: skipping the starter chain');
    starter = buildStarterResort(sim, {
      lifts: already ? 0 : spec.liftKinds.length, liftKinds: spec.liftKinds, cannons: already ? 0 : spec.cannons, attractions: already ? 0 : spec.attractions,
      pisteDifficulties: [1, 2, 0, 3], skipCore: already,
      pre: (kit) => trainStation(sim, kit, spec, out, log),
      extra: (kit) => extras(sim, kit, spec, out, log),
    });
  } catch (e) {
    out.failures.push(`exception: ${e instanceof Error ? e.message : String(e)}`);
  }
  // sites that could not be wired up (inactive) would only be dead weight in a showcase: take them back and say so
  let swept = false;
  for (const b of [...sim.buildings.all()]) {
    if (existing.has(b.id) || b.active) continue;
    sim.buildings.remove(b.id);
    if (starter) starter.placed[b.type] = Math.max(0, (starter.placed[b.type] ?? 1) - 1);
    out.failures.push(`${b.type}: removed (${b.reason ?? 'not connected'})`);
    swept = true;
  }
  if (swept) { sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true); }
  if (starter) {
    for (const [k, v] of Object.entries(starter.placed)) out.placed[k] = (out.placed[k] ?? 0) + v;
    out.pisteTiles += starter.pisteTiles;
    for (const l of starter.lifts) out.lifts.push({ id: l.id, kind: l.kind });
    out.failures.push(...starter.failures);
    log(`starter chain: ${starter.lifts.length} lifts, ${starter.pisteTiles} piste tiles`);
  }
  sim.game.money = moneyBefore; // debug / demo builds are free
  return out;
}

function countOf(sim: Sim, type: string): number { return sim.buildings.all().filter((b) => b.type === type).length; }

/** Station beside the rail stub, wired to rail + path (a site that cannot be wired up is taken back and the next one tried). Shared with the town archetypes. */
export function trainStation(sim: Sim, kit: ResortKit, spec: { rail: boolean }, out: { failures: string[] }, log: (m: string) => void): void {
  const { lc } = kit;
  // the station first: it needs the one flat-ish site beside the rail stub before the extras take it
  if (spec.rail && countOf(sim, 'trainStation') === 0) {
    const n = sim.networks;
    let tail: Pt | null = null;
    for (let i = 0; i < n.kind.length; i++) {
      if (n.kind[i] !== NetKind.Rail) continue;
      const x = i % sim.size, y = (i / sim.size) | 0;
      if (!tail || Math.hypot(x - lc.x, y - lc.y) < Math.hypot(tail.x - lc.x, tail.y - lc.y)) tail = { x, y };
    }
    let connected = false;
    if (tail) {
      for (let k = 0; k < 8 && !connected; k++) {
        const ax = tail.x + ((k % 3) - 1) * 2, ay = tail.y - 3 - Math.floor(k / 3) * 2;
        const st = kit.place('trainStation', ax, ay, 2);
        if (!st) { log(`train site ${k}: none at ${ax},${ay}`); continue; }
        const ring: Rect = { x: st.x, y: st.y, w: st.w, h: st.h };
        const goal = new Set<number>();
        for (let x = ring.x - 1; x <= ring.x + ring.w; x++) for (let y = ring.y - 1; y <= ring.y + ring.h; y++) if (n.inBounds(x, y)) goal.add(n.idxOf(x, y));
        const route = n.route(NetKind.Rail, tail, tail, 0, (x, y) => goal.has(n.idxOf(x, y)));
        for (const t of route) n.build(NetKind.Rail, t.x, t.y);
        kit.ensurePath(ring);
        kit.settle();
        if (n.serves('rail', ring) && n.serves('path', ring)) { connected = true; log('trainStation connected to the rail stub'); break; }
        log(`train site ${k} at ${st.x},${st.y}: rail=${n.serves('rail', ring)} path=${n.serves('path', ring)}`);
        sim.buildings.remove(st.id); // this site could not be wired up: take it back and try the next one
        kit.report.placed['trainStation'] = Math.max(0, (kit.report.placed['trainStation'] ?? 1) - 1);
        kit.settle();
      }
    }
    if (!connected) out.failures.push('cannot place a connected trainStation');
    kit.settle();
  }
}

function extras(sim: Sim, kit: ResortKit, spec: LevelSpec, out: DemoReport, log: (m: string) => void): void {
  const { lc, roadTile } = kit;
  out.pisteMids = kit.pisteStroke.filter((l) => l.length).map((l) => ({ ...l[l.length >> 1]! }));
  const pl = kit.pisteStroke[0];
  const onPiste = pl?.[Math.floor((pl?.length ?? 2) * 0.4)] ?? lc;
  /** Place + connect; a site that cannot be wired up (inactive) is taken back so the next attempt can try elsewhere. */
  const place1 = (type: string, have: number, attempt: number): boolean => {
    const off = attempt * 3;
    const b = type === 'rangerStation' ? kit.placeConnected(type, roadTile.x + off, roadTile.y + 4, 26)
      : type === 'alpineFarm' ? kit.placeConnected(type, lc.x + [-8, 8, 0, -12, 12][attempt % 5]!, lc.y + [6, 6, 12, -4, -4][attempt % 5]!, 30, true) // a flattened pasture beside the village
      : type === 'mountainHut' ? kit.placeConnected(type, onPiste.x, onPiste.y, 10 + off)
        : kit.placeConnected(type, lc.x + (have % 2 ? 7 : -7) + have + off, lc.y + 5 + have * 2 - off, 22);
    if (!b) return false;
    if (b.active) return true;
    if (type === 'alpineFarm') { kit.ensureRoad(b); kit.settle(); if (b.active) return true; } // path access failed: the farm also accepts a road
    sim.buildings.remove(b.id);
    kit.report.placed[type] = Math.max(0, (kit.report.placed[type] ?? 1) - 1);
    kit.settle();
    return true; // not a dead end: another attempt may work
  };
  for (const [type, want] of spec.extras) {
    let have = countOf(sim, type);
    let tries = 0;
    while (have < want && tries < want + 4) {
      if (!place1(type, have, tries++)) break;
      have = countOf(sim, type);
    }
    log(`${type}: ${have}/${want}`);
    if (have < want) out.failures.push(`only ${have}/${want} ${type}`);
  }
  kit.settle();
  // hiking / MTB trails fanning out from the village
  const sz = sim.size;
  for (let k = 0; k < spec.trails; k++) {
    const layer = k % 2 === 0 ? Layer.Hike : Layer.Mtb;
    let best: Pt[] = [];
    for (let j = 0; j < 12; j++) { // best of 12 candidate arcs (water / cliffs veto tiles)
      const ang = (k / Math.max(1, spec.trails)) * Math.PI * 2 + 0.6 + j * 0.52;
      const r = sz * (0.14 + 0.04 * ((k + j) % 3));
      const a: Pt = { x: Math.round(lc.x + Math.cos(ang) * 4), y: Math.round(lc.y + Math.sin(ang) * 4) };
      const b: Pt = { x: Math.max(3, Math.min(sz - 4, Math.round(lc.x + Math.cos(ang + 0.5) * r))), y: Math.max(3, Math.min(sz - 4, Math.round(lc.y + Math.sin(ang + 0.5) * r))) };
      const mid: Pt = { x: Math.round((a.x + b.x) / 2 + Math.sin(ang) * 3), y: Math.round((a.y + b.y) / 2 - Math.cos(ang) * 3) };
      const line = sweepBrush(interpolateStroke([a, mid, b]), 0, sz);
      const okTiles = line.filter((t) => sim.networks.canPaint(t.x, t.y, layer).ok);
      if (okTiles.length > best.length && okTiles.length >= line.length * 0.8) best = line;
      else if (!best.length && okTiles.length > 0 && j === 11) best = line;
    }
    const res = sim.networks.paint(layer, best);
    if (layer === Layer.Hike) out.hikeTiles += res.painted; else out.mtbTiles += res.painted;
    if (res.painted < 8) out.failures.push(`trail ${k}: only ${res.painted} tiles`);
  }
  log(`trails: ${out.hikeTiles} hike / ${out.mtbTiles} mtb tiles`);
}

export type GuestMix = 'mixed' | 'skiers' | 'hikers';

/**
 * DEBUG / demo: add `n` guests around the lift bottoms and the lodge (own RNG stream seeded from `seed`: the sim's RNG is untouched).
 * Returns how many were really added (the store may be full).
 */
export function spawnGuests(sim: Sim, n: number, mix: GuestMix = 'mixed', seed = 1): number {
  const rng = new Rng((sim.seed ^ 0x51ed270b) + Math.imul(seed, 0x9e3779b1));
  const anchors: Pt[] = sim.lifts.all().map((l) => ({ x: l.bottom.x + 1, y: l.bottom.y + 1 }));
  const lodge = sim.buildings.all().find((b) => b.type === 'baseLodge');
  if (lodge) anchors.push({ x: lodge.x + lodge.w / 2, y: lodge.y + lodge.h + 1 });
  if (!anchors.length) return 0;
  const absDay = sim.game.date.year * DAYS_PER_YEAR + sim.game.date.day;
  const types = mix === 'skiers' ? [GuestType.Solo, GuestType.Couple, GuestType.Adventure, GuestType.VIP] : mix === 'hikers' ? [GuestType.Adventure, GuestType.Solo, GuestType.Family] : [GuestType.Solo, GuestType.Couple, GuestType.Family, GuestType.Budget, GuestType.Adventure, GuestType.VIP];
  let added = 0;
  const group = 90_000 + seed * 1000;
  for (let i = 0; i < n; i++) {
    const a = anchors[Math.floor(rng.next() * anchors.length)]!;
    const x = Math.max(1, Math.min(sim.size - 1, a.x + (rng.next() - 0.5) * 8)), y = Math.max(1, Math.min(sim.size - 1, a.y + (rng.next() - 0.5) * 8));
    const slot = sim.guestSim.store.add({
      x, y, z: sim.guestWorld.groundAt(x, y), type: types[Math.floor(rng.next() * types.length)]!, skill: Math.floor(rng.next() * 4), budget: 400 + rng.next() * 600,
      group: group + Math.floor(i / 3), mode: Mode.Road, overnight: false, leaveDay: absDay + 2, tick: sim.game.date.tick, happiness: 0.85, hunger: 0.1 + rng.next() * 0.2,
    });
    if (slot < 0) break;
    sim.guestSim.hash.insert(slot, x, y);
    sim.bus.emit('guest:arrived', { id: sim.guestSim.store.id[slot]! });
    added++;
  }
  return added;
}
