import { describe, expect, it } from 'vitest';
import { TOWN_SEEDS } from '../../src/config/townSeeds';
import { TOWNS } from '../../src/game/demoTowns';
import { parseTownParams, pickTitleTown, sizeFor, townCaption, townKey } from '../../src/game/titleTown';
import { mulberry, pickPoi, type Poi } from '../../src/render/DemoCamera';
import { poiFocus, townPoiSpecs } from '../../src/render/townPois';
import { DisposeBag } from '../../src/render/DemoScene';

describe('title town picker', () => {
  it('never repeats the previous town and always returns a vetted seed', () => {
    const rand = mulberry(1);
    let last: string | null = null;
    for (let i = 0; i < 400; i++) {
      const t = pickTitleTown({ rand, last, deviceMemory: 8 });
      expect(townKey(t)).not.toBe(last);
      expect(TOWN_SEEDS[t.id][t.size]).toContain(t.seed);
      last = townKey(t);
    }
  });
  it('is weighted by archetype weight (alpine ~2x rescue) and covers every archetype', () => {
    const rand = mulberry(7);
    const n: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) { const t = pickTitleTown({ rand, deviceMemory: 8 }); n[t.id] = (n[t.id] ?? 0) + 1; }
    for (const t of TOWNS) expect(n[t.id] ?? 0, t.id).toBeGreaterThan(40);
    expect(n.alpine!).toBeGreaterThan(n.rescue! * 1.4);
  });
  it('falls back on capability: no 256 without >= 8 GB; low-memory devices only get 64 maps', () => {
    const rand = mulberry(3);
    for (let i = 0; i < 300; i++) {
      expect(pickTitleTown({ rand }).size).not.toBe(256); // unknown memory
      expect(pickTitleTown({ rand, deviceMemory: 4 }).size).not.toBe(256);
      expect(pickTitleTown({ rand, deviceMemory: 2 }).size).toBe(64);
    }
    expect(sizeFor('bigmountain', undefined, false, rand)).toBe(128);
    expect(sizeFor('bigmountain', 8, false, rand)).toBe(256);
    expect(sizeFor('bigmountain', undefined, true, rand)).toBe(256);
    expect(sizeFor('luxury', 2, false, rand)).toBeNull(); // no 64 variant
    let big = 0;
    for (let i = 0; i < 600; i++) if (pickTitleTown({ rand, deviceMemory: 16 }).size === 256) big++;
    expect(big).toBeGreaterThan(5);
  });
  it('parses ?town= / ?townseed= and builds captions', () => {
    expect(parseTownParams(new URLSearchParams('town=alpine&townseed=12'))).toEqual({ id: 'alpine', seed: 12, size: null });
    expect(parseTownParams(new URLSearchParams('town=hamlet&demosize=64'))?.size).toBe(64);
    expect(parseTownParams(new URLSearchParams('town=nonsense'))).toBeNull();
    expect(parseTownParams(new URLSearchParams(''))).toBeNull();
    expect(townCaption({ id: 'alpine', seed: 1234 })).toBe('Alpine Village · seed 1234');
  });
});

describe('POI selection per archetype (pure)', () => {
  const sites = { farm: { x: 10, y: 10 }, beach: { x: 20, y: 20 }, heli: { x: 30, y: 30 }, hut: { x: 5, y: 5 }, station: { x: 1, y: 1 }, nonsense: { x: 0, y: 0 } };
  it('maps the sites a town has to POIs and ignores unknown ones', () => {
    const p = townPoiSpecs('rescue', sites);
    expect(p.map((q) => q.kind).sort()).toEqual(['beach', 'farm', 'heli', 'hut', 'train']);
    expect(townPoiSpecs('alpine', {})).toEqual([]);
  });
  it('weights the characteristic POIs of an archetype higher', () => {
    const w = (a: string, k: string): number => townPoiSpecs(a, sites).find((p) => p.kind === k)!.weight;
    expect(w('rescue', 'heli')).toBeGreaterThan(w('alpine', 'heli'));
    expect(w('lakeside', 'beach')).toBeGreaterThan(w('alpine', 'beach'));
    expect(poiFocus('hamlet', 'animal')).toBeGreaterThan(1);
    expect(poiFocus('alpine', 'lift')).toBe(1);
  });
  it('the director can pick the new kinds and never repeats a kind twice in a row', () => {
    const pois: Poi[] = townPoiSpecs('hiking', sites).map((s) => ({ kind: s.kind, id: s.id, at: () => s.at, zoom: [1, 2], weight: s.weight }));
    const rand = mulberry(5);
    let lastKind = null as Poi['kind'] | null;
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) { const p = pickPoi(pois, [], lastKind, rand)!; expect(p.kind).not.toBe(lastKind); lastKind = p.kind; seen.add(p.kind); }
    expect(seen.size).toBe(5);
  });
});

describe('shuffle teardown (fake registry)', () => {
  it('a bag of town resources is disposed exactly once, newest first, and a failing callback does not leak the rest', () => {
    const order: string[] = [];
    const bag = new DisposeBag();
    bag.add(() => order.push('sim')); bag.add(() => order.push('renderer')); bag.add(() => { throw new Error('boom'); }); bag.add(() => order.push('caption'));
    const errs = bag.dispose();
    expect(order).toEqual(['caption', 'renderer', 'sim']);
    expect(errs.length).toBe(1);
    expect(bag.dispose()).toEqual([]);
    expect(order.length).toBe(3);
    bag.add(() => order.push('late')); // registered after teardown: runs immediately, never leaks
    expect(order.at(-1)).toBe('late');
  });
});
