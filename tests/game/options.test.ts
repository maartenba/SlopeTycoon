import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/game/createSim';
import { applySave, stateHash } from '../../src/game/saveState';
import { decodeSave, encodeSave, makeMeta } from '../../src/persist/Serializer';
import { DEFAULT_CONFIG, randomSeed, configQuery, normalizeConfig, parseConfig, seedFromText, seedName, startingMoney, walkingRadius } from '../../src/game/difficulty';
import { DIFFICULTY, DIFFICULTY_IDS, START_MONEY_RANGE, WALKING_RADIUS_RANGE, WALKING_RADIUS_TILES } from '../../src/config/balance';
import { PRESET_IDS } from '../../src/world/TerrainPresets';
import { STARTING_MONEY } from '../../src/core/GameState';
import { seasonOf } from '../../src/sim/Clock';
import { BUILDINGS } from '../../src/config/buildings';

const hashH = (a: Int16Array): number => { let x = 2166136261; for (let i = 0; i < a.length; i++) x = Math.imul(x ^ (a[i]! & 0xffff), 16777619); return x >>> 0; };

describe('new game options (headless, same path as the dialog / URL)', () => {
  it('each map size is created correctly', () => {
    for (const size of [64, 128, 256] as const) {
      const sim = createSim({ size, seed: 5, now: () => 0 });
      expect(sim.grid.size).toBe(size);
      expect(sim.config.size).toBe(size);
      expect(sim.buildings.all().some((b) => b.type === 'baseLodge')).toBe(true);
      expect(sim.game.money).toBe(STARTING_MONEY);
    }
  });

  it('presets, difficulty and start seasons all create playable games (64)', () => {
    for (const preset of PRESET_IDS) for (const difficulty of DIFFICULTY_IDS) {
      const sim = createSim({ size: 64, seed: 9, preset, difficulty, now: () => 0 });
      expect(sim.config.preset).toBe(preset); expect(sim.config.difficulty).toBe(difficulty);
      expect(sim.game.money).toBe(Math.round(STARTING_MONEY * DIFFICULTY[difficulty].money));
      sim.tick(20);
    }
    for (const startSeason of ['winter', 'spring', 'summer', 'autumn'] as const) {
      const sim = createSim({ size: 64, seed: 9, startSeason, now: () => 0 });
      expect(seasonOf(sim.game.date)).toBe(startSeason);
      expect(sim.config.startSeason).toBe(startSeason);
    }
    const a = createSim({ size: 64, seed: 9, preset: 'gentle', now: () => 0 }), b = createSim({ size: 64, seed: 9, preset: 'peaks', now: () => 0 });
    expect(hashH(a.grid.heights)).not.toBe(hashH(b.grid.heights));
  });

  it('difficulty multipliers are applied (loan rate, spawn, patience, incidents, upkeep)', () => {
    const r = createSim({ size: 64, seed: 1, difficulty: 'relaxed', now: () => 0 }), n = createSim({ size: 64, seed: 1, now: () => 0 }), c = createSim({ size: 64, seed: 1, difficulty: 'challenging', now: () => 0 });
    expect(r.game.money).toBeGreaterThan(n.game.money); expect(n.game.money).toBeGreaterThan(c.game.money);
    const rate = (s: typeof n): number => s.loans.offers(s.creditCtx()).find((o) => o.id === 'medium')!.ratePct;
    expect(rate(r)).toBeLessThan(rate(n)); expect(rate(n)).toBeLessThan(rate(c));
    expect(r.guestSim.spawner.rateMult).toBeGreaterThan(c.guestSim.spawner.rateMult);
    expect(r.guestSim.patienceMult).toBeGreaterThan(c.guestSim.patienceMult);
    expect(r.guestSim.injuryMult).toBeLessThan(c.guestSim.injuryMult);
    const upkeep = (s: typeof n): number => { s.tick(240 * 20); return s.economy.expenses.upkeep; };
    expect(upkeep(r)).toBeLessThan(upkeep(c));
  });

  it('custom money, starter-loan toggle and sandbox starter resort', () => {
    const s = createSim({ size: 64, seed: 3, startLoan: true, now: () => 0 });
    expect(s.loans.totalDebt()).toBe(50000); expect(s.game.money).toBe(STARTING_MONEY + 50000);
    const sb = createSim({ size: 64, seed: 3, starterResort: true, now: () => 0 });
    expect(sb.lifts.all().length).toBeGreaterThan(0); expect(sb.game.money).toBe(STARTING_MONEY);
    expect(sb.economy.lifetimeExpense()).toBe(0); // a gift: the books start clean
    expect(createSim({ size: 64, seed: 3, now: () => 0 }).lifts.all().length).toBe(0);
  });

  it('config is validated / clamped', () => {
    const c = normalizeConfig({ size: 999, seed: 'x', preset: 'nope', difficulty: 'x', startSeason: 'y', money: 5, radius: 500 });
    expect(c).toMatchObject({ size: 128, preset: 'balanced', difficulty: 'normal', startSeason: 'winter', money: START_MONEY_RANGE.min, radius: WALKING_RADIUS_RANGE.max });
    expect(startingMoney(DEFAULT_CONFIG)).toBe(STARTING_MONEY);
    expect(walkingRadius(DEFAULT_CONFIG)).toBe(WALKING_RADIUS_TILES);
  });

  it('URL params: old params still work and the config round-trips through the query', () => {
    expect(parseConfig(new URLSearchParams('size=64&seed=7&start=summer')).config).toMatchObject({ size: 64, seed: 7, startSeason: 'summer', preset: 'balanced' });
    expect(parseConfig(new URLSearchParams('')).explicit).toBe(false);
    expect(parseConfig(new URLSearchParams('menu=1')).explicit).toBe(false);
    const cfg = normalizeConfig({ size: 256, seed: 42, preset: 'lakeland', difficulty: 'challenging', startSeason: 'autumn', money: 90000, startLoan: true, radius: 18, starterResort: true, hints: false });
    expect(parseConfig(new URLSearchParams(configQuery(cfg))).config).toEqual(cfg);
  });

  it('a missing seed in the URL is random (injected RNG = deterministic), never the old 1337; an explicit seed is kept', () => {
    const a = parseConfig(new URLSearchParams('size=64'), () => 0.25).config.seed, b = parseConfig(new URLSearchParams('size=64'), () => 0.75).config.seed;
    expect(a).toBe(250_000_000); expect(b).toBe(750_000_000);
    expect(parseConfig(new URLSearchParams('size=64&seed=1337'), () => 0.5).config.seed).toBe(1337);
    expect(randomSeed(() => 0.9999999999)).toBeLessThan(1e9);
    expect(parseConfig(new URLSearchParams('size=64')).config.seed).not.toBe(DEFAULT_CONFIG.seed);
  });

  it('seed names are deterministic and invertible', () => {
    for (const s of [0, 1, 255, 256, 1234, 98765432, 999999999]) {
      expect(seedName(s)).toBe(seedName(s));
      expect(seedFromText(seedName(s))).toBe(s);
    }
    expect(seedName(1234)).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-\d+$/);
    expect(seedFromText('  ')).toBeNull();
    expect(seedFromText('hello')).toBe(seedFromText('hello'));
  });
});

describe('options survive save -> load', () => {
  it('new game with options -> save -> load: options, map and walking radius identical', async () => {
    const sim = createSim({ size: 64, seed: 11, preset: 'forested', difficulty: 'challenging', startSeason: 'autumn', radius: 20, startLoan: true, hints: false, now: () => 0 });
    sim.tick(240);
    const { bytes } = await encodeSave(sim, makeMeta(sim, 'opts'), { yieldBetween: false });
    const { envelope } = await decodeSave(bytes, { yieldBetween: false });
    expect(envelope.meta.config).toMatchObject({ size: 64, seed: 11, preset: 'forested', difficulty: 'challenging' });
    // note: size/seed come from the envelope, everything else (preset, difficulty, radius) from the 'config' module
    const loaded = createSim({ size: envelope.mapSize, seed: envelope.seed, now: () => 0, fromSave: structuredClone(envelope.modules) });
    expect(loaded.config).toEqual(sim.config);
    expect(loaded.config.radius).toBe(20);
    expect(loaded.buildings.walkingRadius).toBe(20);
    expect(loaded.difficulty).toEqual(DIFFICULTY.challenging);
    expect(loaded.guestSim.patienceMult).toBe(DIFFICULTY.challenging.patience);
    expect(hashH(loaded.grid.heights)).toBe(hashH(sim.grid.heights));
    expect(stateHash(loaded).parts.grid).toBe(stateHash(sim).parts.grid);
    applySave(sim, structuredClone(envelope.modules));
    expect(stateHash(loaded).hash).toBe(stateHash(sim).hash);
  });

  it('walking radius override changes Dependencies for shuttle-dependent buildings', () => {
    const def = BUILDINGS.trainStation!;
    expect(def.shuttleDependent).toBe(true);
    const small = createSim({ size: 64, seed: 4, radius: WALKING_RADIUS_RANGE.min, now: () => 0 }), big = createSim({ size: 64, seed: 4, radius: WALKING_RADIUS_RANGE.max, now: () => 0 });
    expect(small.buildings.depContext().walkingRadius).toBe(WALKING_RADIUS_RANGE.min);
    expect(big.buildings.depContext().walkingRadius).toBe(WALKING_RADIUS_RANGE.max);
    expect(createSim({ size: 64, seed: 4, now: () => 0 }).buildings.depContext().walkingRadius).toBe(WALKING_RADIUS_TILES);
  });
});
