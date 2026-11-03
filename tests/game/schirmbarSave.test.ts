import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../../src/game/createSim';
import { collectSave, stateHash } from '../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { defaultResortName, sanitizeResortName, resortNameOr, RESORT_NAME_MAX } from '../../src/sim/ResortName';
import { configQuery, DEFAULT_CONFIG, parseConfig } from '../../src/game/difficulty';
import { simDayOf } from '../../src/sim/calendar';
import { findSite } from '../../src/tutorial/suggest';
import { placeBuilding } from '../../src/sim/PlaceBuilding';

async function snapshot(sim: Sim) {
  const { bytes } = await encodeSave(sim, makeMeta(sim, 'test'), { compress: true, yieldBetween: false });
  return (await decodeSave(bytes, { yieldBetween: false })).envelope;
}
const loadFrom = (env: Awaited<ReturnType<typeof snapshot>>): Sim => createSim({ size: env.mapSize, seed: env.seed, now: () => 0, fromSave: structuredClone(env.modules) });
const mk = (extra: object = {}): Sim => createSim({ size: 64, seed: 61, starterResort: true, mode: 'sandbox', startSeason: 'winter', startDay: simDayOf(11, 8), now: () => 0, ...extra });

describe('resort name', () => {
  it('sanitises: plain text, no markup, collapsed spaces, at most 24 characters', () => {
    expect(sanitizeResortName('  <b>Alp&amp;glow</b>  ')).toBe('Alpglow');
    expect(sanitizeResortName('<script>alert(1)</script>')).not.toMatch(/[<>]/);
    expect(sanitizeResortName('a\n\tb   c')).toBe('a b c');
    expect(sanitizeResortName('x'.repeat(80)).length).toBe(RESORT_NAME_MAX);
    expect(sanitizeResortName(42)).toBe('');
    expect(sanitizeResortName('\u202e\u0000')).toBe('');
  });
  it('the default name is a pure function of the seed and never empty', () => {
    expect(defaultResortName(61)).toBe(defaultResortName(61));
    const names = new Set<string>(); for (let s = 0; s < 200; s++) { const n = defaultResortName(s * 7919); expect(n.length).toBeGreaterThan(4); expect(n.length).toBeLessThanOrEqual(RESORT_NAME_MAX); names.add(n); }
    expect(names.size).toBeGreaterThan(40);
    expect(resortNameOr('', 61)).toBe(defaultResortName(61));
    expect(resortNameOr('Edelweiss', 61)).toBe('Edelweiss');
  });
  it('travels in the URL: only a custom name is written, and the sim takes it sanitised', () => {
    expect(configQuery({ ...DEFAULT_CONFIG, seed: 5 }, defaultResortName(5))).not.toContain('name=');
    expect(configQuery({ ...DEFAULT_CONFIG, seed: 5 }, 'Sonnenhang')).toContain('name=Sonnenhang');
    expect(parseConfig(new URLSearchParams('seed=5&name=x')).explicit).toBe(true);
    expect(mk({ resortName: '<i>Zirbenalm</i>' }).resort.name).toBe('Zirbenalm');
    expect(mk().resort.name).toBe(defaultResortName(61));
  });
  it('is saved and restored; an old save without the module falls back to the seed default; it is not part of the state hash', async () => {
    const sim = mk({ resortName: 'Hinterkogel' });
    const h0 = stateHash(sim).hash;
    sim.setResortName('Schneeblick');
    expect(stateHash(sim).hash).toBe(h0);
    const env = await snapshot(sim);
    expect(loadFrom(env).resort.name).toBe('Schneeblick');
    delete (env.modules as Record<string, unknown>).resort;
    expect(loadFrom(env).resort.name).toBe(defaultResortName(61));
    expect(sim.setResortName('   ')).toBe(defaultResortName(61));
  });
});

describe('Schirmbar save / placement', () => {
  const place = (sim: Sim, x: number, y: number) => placeBuilding(sim.env, sim.props, 'schirmbar', x, y, 0, true, false);
  it('closed-by-player survives a save and reload, and the state hash matches after the same ticks', async () => {
    const sim = mk();
    const lift = sim.lifts.all()[0]!;
    const site = findSite(sim, 'schirmbar', { x: lift.bottom.x, y: lift.bottom.y }, { rmax: 8 })!;
    const o = place(sim, site.x, site.y);
    expect(o.ok).toBe(true);
    sim.tick(2);
    sim.attractions.setSchirmbarClosed(o.building!.id, true);
    const env = await snapshot(sim);
    const b = loadFrom(env), c = loadFrom(env);
    b.tick(30); c.tick(30);
    expect(b.attractions.get(o.building!.id)!.playerClosed).toBe(true);
    expect(b.attractions.get(o.building!.id)!.open).toBe(false);
    expect(stateHash(b).hash).toBe(stateHash(c).hash); // a reload runs on identically (the documented demotions apply to both)
    expect(collectSave(b).resort).toBeDefined();
  }, 60_000);
  it('may stand right beside a lift station and a piste, never on a piste tile or in water', () => {
    const sim = mk();
    const lift = sim.lifts.all()[0]!;
    // beside the bottom station: some site within a few tiles is accepted
    const near = findSite(sim, 'schirmbar', { x: lift.bottom.x, y: lift.bottom.y }, { rmax: 3 });
    expect(near).toBeTruthy();
    // a piste tile: refused with the piste reason
    const net = sim.networks, n = sim.size;
    let pt = -1; for (let i = 0; i < n * n; i++) if ((net.layers[i]! & 1) !== 0) { pt = i; break; }
    expect(pt).toBeGreaterThanOrEqual(0);
    const r = place(sim, pt % n, Math.floor(pt / n));
    expect(r.ok).toBe(false);
    // a lake tile: refused
    const lake = sim.terrainInfo.lakes[0]!.tileIdx[0]!;
    expect(place(sim, lake % n, Math.floor(lake / n)).ok).toBe(false);
  });
});
