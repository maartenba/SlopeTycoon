/** Photographers (docs/photographers.md): arrival gating by light, the spot choice, the session timeline, the buzz cap, save / load, determinism. */
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../../src/game/createSim';
import { applySave, collectSave, stateHash } from '../../../src/game/saveState';
import { Layer } from '../../../src/world/Networks';
import { placeBuilding } from '../../../src/sim/PlaceBuilding';
import { buildHikingResort } from '../../../scripts/analysis/hikingLib';
import { GUEST_TYPE_DEFS, CORE_TYPE_COUNT } from '../../../src/config/guestTypes';
import { PHOTO } from '../../../src/config/photographers';
import { DAYS_PER_YEAR } from '../../../src/config/balance';
import { seasonStartDay } from '../../../src/sim/Clock';
import { arrivalLight, arrivalMult, lightAt, photoDay } from '../../../src/sim/guests/PhotoLight';
import { PhotoBuzz } from '../../../src/sim/guests/PhotoBuzz';
import { GState } from '../../../src/sim/guests/Guest';

const PHOTOG = CORE_TYPE_COUNT + GUEST_TYPE_DEFS.findIndex((d) => d.id === 'photographer');

/** First day of the year (from `from`) whose dusk is special (or plain) in this seed / season, with clear weather. */
const findDay = (seed: number, special: boolean, from: number, year = 0, season: 'winter' | 'summer' = 'winter'): number => {
  for (let d = from; d < from + 90; d++) { const p = photoDay(seed, year * DAYS_PER_YEAR + d, d, season, 'clear'); if ((p.dusk > 0) === special && !p.inversion) return d; }
  throw new Error('no such day');
};

describe('the light of a day (pure)', () => {
  it('storms, rain and heavy snow give no light; clear and cloudy do; a special sky is better than a plain one', () => {
    const d = findDay(61, true, 0), p = photoDay(61, d, d, 'winter', 'clear');
    const t = p.sunset - 0.2;
    expect(lightAt(p, t).q).toBeGreaterThanOrEqual(0.6);
    expect(lightAt({ ...p, weather: 'storm' }, t).q).toBe(0);
    expect(lightAt({ ...p, weather: 'rain' }, t).q).toBe(0);
    expect(lightAt({ ...p, weather: 'heavySnow' }, t).q).toBe(0);
    const plain = findDay(61, false, 0), q = photoDay(61, plain, plain, 'winter', 'clear');
    expect(lightAt(q, q.sunset - 0.2).q).toBe(PHOTO.plainLight);
    expect(lightAt(q, 12).q).toBe(0);
    expect(lightAt(p, p.sunset + 2).q).toBe(0);
  });
  it('arrivals bias to the golden hour and flock on a special-sky day', () => {
    const s = findDay(61, true, 0), pd = photoDay(61, s, s, 'winter', 'clear');
    const plainD = findDay(61, false, 0), pp = photoDay(61, plainD, plainD, 'winter', 'clear');
    const at = (p: typeof pd, h: number): number => arrivalMult(arrivalLight(p, h));
    expect(at(pd, pd.sunset - 1.5)).toBeGreaterThan(at(pp, pp.sunset - 1.5));
    expect(at(pp, pp.sunset - 1.5)).toBeGreaterThan(at(pp, 12));
    expect(at(pp, 12)).toBeCloseTo(PHOTO.arrivalFloor, 5);
    expect(at({ ...pd, weather: 'storm' }, pd.sunset - 1.5)).toBeCloseTo(PHOTO.arrivalFloor, 5);
  });
  it('the day roll is deterministic and reads the same specialSky the Atmosphere layer draws', async () => {
    const { specialSky } = await import('../../../src/render/atmosphere/SunFx');
    for (let d = 0; d < 40; d++) { const a = photoDay(5, d, d, 'winter', 'cloudy'), sk = specialSky({ seed: 5, dayKey: d, season: 'winter', weather: 'cloudy' }); expect([a.dawn, a.dusk]).toEqual([sk.dawn, sk.dusk]); }
  });
});

describe('the photographer type', () => {
  it('is index 13, needs a Viewpoint or a Treehouse, never arrives in a storm', () => {
    expect(PHOTOG).toBe(13);
    const d = GUEST_TYPE_DEFS[PHOTOG - CORE_TYPE_COUNT]!;
    expect(d.requires).toEqual(['viewpoint', 'treehouse']);
    expect(d.weather!.storm).toBe(0);
    expect(d.photographer).toBe(true);
  });
});

/** A footpath tile nearest the base lodge (a place guests can walk from). */
const pathTile = (sim: Sim): { x: number; y: number } => {
  const n = sim.size, l = sim.buildings.all().find((b) => b.type === 'baseLodge')!;
  let best = { x: 0, y: 0 }, bd = Infinity;
  for (let t = 0; t < n * n; t++) if (sim.networks.kind[t] === 1) { const d = (t % n - l.x) ** 2 + (((t / n) | 0) - l.y) ** 2; if (d < bd) { bd = d; best = { x: t % n, y: (t / n) | 0 }; } }
  return best;
};

describe('a session at a viewpoint', () => {
  /** A summer hiking resort (64 / 11) with a real viewpoint on a ridge hike tile (view score > 0.4). */
  const setup = (): { sim: Sim; spot: number } => {
    const { sim, info } = buildHikingResort(64, 11, { defaultHours: true, noHut: true });
    sim.progression.unlockAll = true;
    const n = sim.size;
    let placed = 0;
    const cands: number[] = [];
    for (let t = 0; t < n * n; t++) if (sim.networks.layers[t]! & Layer.Hike) { const r = (sim.cond.altitude(t % n, (t / n) | 0) - info.altMin) / (info.altMax - info.altMin); if (r > 0.68 && r < 0.9) cands.push(t); }
    outer: for (const t of cands) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const o = placeBuilding(sim.env, sim.props, 'viewpoint', (t % n) + dx, ((t / n) | 0) + dy, 0, true, false);
      if (o.ok) { sim.refreshCoverage(o.building!, true); placed = o.building!.id; break outer; }
    }
    sim.buildings.reevaluate();
    expect(placed).toBeGreaterThan(0);
    sim.tick(2);
    return { sim, spot: placed };
  };
  const setClock = (sim: Sim, day: number, hour: number): void => { sim.game.date.day = day; sim.game.date.minute = Math.round(hour * 60); sim.tick(1); sim.weather.current.kind = 'clear'; sim.weather.current.intensity = 0; /* the new day rolled its own weather: hold a clear one */ };
  const spawn = (sim: Sim): number => {
    const st = sim.guestSim.store, path = pathTile(sim);
    const slot = st.add({ x: path.x + 0.5, y: path.y + 0.5, z: sim.guestSim.world.groundAt(path.x, path.y), type: PHOTOG, skill: 1, budget: 150, group: 1, mode: 0, overnight: false, leaveDay: 99, tick: 0 });
    st.state[slot] = GState.Idle; st.timer[slot] = 0;
    return slot;
  };
  const chooseAt = (sim: Sim, slot: number, hour: number): { kind: string; tile?: number } => {
    const d = sim.guestSim.decider;
    d.refresh(sim.buildings.all().map((b) => ({ ...b })) as never);
    d.photoDay = photoDay(sim.seed, sim.game.date.year * DAYS_PER_YEAR + sim.game.date.day, sim.game.date.day, 'summer', 'clear');
    return d.choose(sim.guestSim.store, slot, sim.game.rng as never, hour);
  };
  it('a photographer sets out for the viewpoint trail before a special evening, and not at midday', () => {
    const { sim } = setup();
    const day = findDay(11, true, seasonStartDay('summer') + 2, sim.game.date.year, 'summer');
    setClock(sim, day, 12);
    const slot = spawn(sim);
    sim.tick(1);
    const pd = photoDay(11, sim.game.date.year * DAYS_PER_YEAR + day, day, 'summer', 'clear');
    const view = sim.guestSim.decider.goals.viewTiles;
    expect(view.size).toBeGreaterThan(0);
    const go = chooseAt(sim, slot, pd.sunset - 2.4);
    expect(go.kind).toBe('hike');
    expect(view.has(go.tile!)).toBe(true);
    expect(chooseAt(sim, slot, 12).tile === undefined || !view.has(chooseAt(sim, slot, 12).tile!)).toBe(true);
    // the same guest once its evening session is done carries on with something else
    sim.guestSim.store.eve[slot] = 2;
    const again = chooseAt(sim, slot, pd.sunset - 2.4);
    expect(again.tile === undefined || !view.has(again.tile)).toBe(true);
  }, 120_000);
  it('a session: the event, the light quality, the buzz (capped), once per light window', () => {
    const { sim, spot } = setup();
    const day = findDay(11, true, seasonStartDay('summer') + 2, sim.game.date.year, 'summer');
    setClock(sim, day, 12);
    const got: Array<{ q: number; shots: number; spot: number }> = [];
    sim.bus.on('photo:taken', (e) => got.push({ q: e.q, shots: e.shots, spot: e.spot }));
    const slot = spawn(sim);
    sim.tick(1);
    const g = sim.guestSim as unknown as { hour: number; photoShoot(i: number, spot: number, score: number): boolean; decider: { photoDay: unknown } };
    g.decider.photoDay = photoDay(11, sim.game.date.year * DAYS_PER_YEAR + day, day, 'summer', 'clear');
    const pd = g.decider.photoDay as ReturnType<typeof photoDay>;
    g.hour = 12;
    expect(g.photoShoot(slot, spot, 0.8)).toBe(false); // no light at midday
    g.hour = pd.sunset - 0.3;
    const happy = sim.guestSim.store.happiness[slot]!;
    expect(g.photoShoot(slot, spot, 0.8)).toBe(true);
    expect(got).toHaveLength(1);
    expect(got[0]!.q).toBeGreaterThanOrEqual(0.6);
    expect(got[0]!.shots).toBeGreaterThanOrEqual(PHOTO.shotsBase);
    expect(sim.guestSim.store.happiness[slot]!).toBeGreaterThanOrEqual(happy);
    expect(sim.guestSim.store.eve[slot]! & 2).toBe(2);
    expect(g.photoShoot(slot, spot, 0.8)).toBe(false); // the evening window is used up
    for (let k = 0; k < 400; k++) sim.photoBuzz.session({ q: 1, day });
    expect(sim.photoBuzz.level).toBeLessThanOrEqual(PHOTO.maxBuzz);
    expect(sim.photoBuzz.mult()).toBeLessThanOrEqual(1 + PHOTO.maxBuzz + 1e-9);
  }, 120_000);
  it('the viewpoint, a special day and a photographer produce the same events twice (deterministic)', () => {
    const run = (): string => {
      const { sim } = setup();
      const day = findDay(11, true, seasonStartDay('summer') + 2, sim.game.date.year, 'summer');
      setClock(sim, day, 12);
      const slot = spawn(sim); sim.tick(1);
      const pd = photoDay(11, sim.game.date.year * DAYS_PER_YEAR + day, day, 'summer', 'clear');
      const c = chooseAt(sim, slot, pd.sunset - 2.4);
      return `${c.kind}:${c.tile}:${stateHash(sim).hash}`;
    };
    expect(run()).toBe(run());
  }, 120_000);
});

describe('photo buzz', () => {
  it('caps, decays, announces the first session once, and counts Golden Hour once a day', () => {
    const ev: string[] = [];
    const bus = { emit: (n: string) => { ev.push(n); } } as never;
    const b = new PhotoBuzz(bus);
    for (let i = 0; i < 100; i++) b.session({ q: 1, day: 5 });
    expect(b.level).toBeLessThanOrEqual(PHOTO.maxBuzz);
    expect(ev.filter((e) => e === 'milestone')).toHaveLength(1);
    expect(ev.filter((e) => e === 'photo:golden')).toHaveLength(1);
    const before = b.level; b.newDay(8);
    expect(b.level).toBeCloseTo(before * Math.pow(PHOTO.decayPerDay, 3), 6);
    const c = new PhotoBuzz(bus); c.load(JSON.parse(JSON.stringify(b.serialize())));
    expect(c.serialize()).toEqual(b.serialize());
    expect(new PhotoBuzz(bus).serialize()).toBeNull();
  });
});

describe('save and determinism', () => {
  it('a world without a photographer saves no photoBuzz module; one with it round-trips', () => {
    const sim = createSim({ size: 64, seed: 61, starterResort: true, now: () => 0 } as never);
    expect(collectSave(sim).photoBuzz!.data).toBeNull(); // null = omitted by the writer (omitWhenNull)
    const h0 = stateHash(sim).hash;
    sim.photoBuzz.session({ q: 0.9, day: 3 });
    expect(stateHash(sim).hash).toBe(h0); // observer state: never part of the hash
    const save = collectSave(sim);
    const sim2 = createSim({ size: 64, seed: 61, starterResort: true, now: () => 0 } as never);
    applySave(sim2, save);
    expect(sim2.photoBuzz.level).toBeCloseTo(sim.photoBuzz.level, 9);
    expect(sim2.photoBuzz.serialize()).toEqual(sim.photoBuzz.serialize());
  });
});
