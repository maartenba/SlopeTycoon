import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../src/config/buildings';
import { LIFTS } from '../../src/config/lifts';
import { BUILDING_TABS, buildingsInTab, liftSeason, networkSeason, NETWORK_ITEMS, seasonHint } from '../../src/ui/buildInfo';
import { relevance, seasonBadge, seasonSort, usableFrom, type SeasonTag } from '../../src/ui/seasonOrder';

const TAGS: SeasonTag[] = ['all', 'winter', 'summer', 'shoulder'];

describe('catalog season field', () => {
  it('is set on every building and sensible for the key types', () => {
    for (const d of Object.values(BUILDINGS)) expect(TAGS, d.id).toContain(d.season);
    for (const id of ['beach', 'boatRental', 'adventurePark', 'alpineFarm']) expect(BUILDINGS[id]!.season, id).toBe('summer');
    expect(BUILDINGS.playground!.season).toBe('shoulder');
    for (const id of ['iceRink', 'heatedTerrace', 'stuntPark', 'apresBar', 'skiSchoolHQ', 'magicCarpet', 'kidsGround', 'snowCannon', 'groomerGarage', 'snowcatOutpost']) expect(BUILDINGS[id]!.season, id).toBe('winter');
    for (const id of ['baseLodge', 'lodge', 'cafe', 'shop', 'ticketOffice', 'parking', 'patrolHub', 'firstAid', 'chalet', 'trainStation', 'reservoir']) expect(BUILDINGS[id]!.season, id).toBe('all');
  });
  it('lifts and network tools: drag lifts are winter-only, bike-capable lifts all year; ski winter, MTB/hiking summer', () => {
    expect(liftSeason('tbar')).toBe('winter');
    for (const k of Object.keys(LIFTS) as Array<keyof typeof LIFTS>) expect(liftSeason(k)).toBe(LIFTS[k].carriesBikes ? 'all' : 'winter');
    expect(networkSeason('ski')).toBe('winter'); expect(networkSeason('mtb')).toBe('summer'); expect(networkSeason('hike')).toBe('summer'); expect(networkSeason('road')).toBe('all');
    expect(NETWORK_ITEMS.map((n) => networkSeason(n.key)).length).toBe(6);
  });
});

describe('relevance / seasonSort (pure)', () => {
  it('winter: winter+all now, summer+shoulder off; summer: winter off; spring/autumn: nothing off', () => {
    expect(TAGS.map((t) => relevance(t, 'winter'))).toEqual(['now', 'now', 'off', 'off']);
    expect(TAGS.map((t) => relevance(t, 'summer'))).toEqual(['now', 'off', 'now', 'now']);
    expect(TAGS.map((t) => relevance(t, 'autumn'))).toEqual(['now', 'now', 'later', 'now']);
    expect(TAGS.map((t) => relevance(t, 'spring'))).toEqual(['now', 'later', 'now', 'now']);
  });
  const items = [{ n: 'a', t: 'summer' }, { n: 'b', t: 'all' }, { n: 'c', t: 'winter' }, { n: 'd', t: 'summer' }, { n: 'e', t: 'shoulder' }, { n: 'f', t: 'winter' }] as Array<{ n: string; t: SeasonTag }>;
  const names = (a: typeof items): string => a.map((x) => x.n).join('');
  it('is stable and puts in-season first (winter / summer / shoulder seasons)', () => {
    expect(names(seasonSort(items, (x) => x.t, 'winter', 'now'))).toBe('bcfade');
    expect(names(seasonSort(items, (x) => x.t, 'summer', 'now'))).toBe('abdecf');
    expect(names(seasonSort(items, (x) => x.t, 'autumn', 'now'))).toBe('bcefad');
    expect(names(seasonSort(items, (x) => x.t, 'spring', 'now'))).toBe('abdecf');
  });
  it("'All' mode equals the catalog order and never mutates the input", () => {
    const copy = items.slice();
    expect(names(seasonSort(items, (x) => x.t, 'winter', 'all'))).toBe('abcdef');
    expect(items).toEqual(copy);
    for (const tab of BUILDING_TABS) { const ds = buildingsInTab(tab.id); expect(seasonSort(ds, (d) => d.season, 'summer', 'all').map((d) => d.id)).toEqual(ds.map((d) => d.id)); }
  });
  it('winter Recreation tab: the beach is no longer among the first', () => {
    const ids = seasonSort(buildingsInTab('recreation'), (d) => d.season, 'winter', 'now').map((d) => d.id);
    expect(ids.indexOf('beach')).toBeGreaterThan(ids.indexOf('iceRink'));
    expect(ids.indexOf('beach')).toBeGreaterThan(ids.indexOf('stuntPark'));
    expect(ids.slice(0, 3)).toEqual(['iceRink', 'heatedTerrace', 'stuntPark']);
    const summer = seasonSort(buildingsInTab('recreation'), (d) => d.season, 'summer', 'now').map((d) => d.id);
    expect(summer.slice(-3)).toEqual(['iceRink', 'heatedTerrace', 'stuntPark']);
    expect(summer[0]).not.toBe('iceRink');
  });
  it('badges and hints for off-season items only', () => {
    expect(seasonBadge('summer', 'winter')).toBe('Summer'); expect(seasonBadge('winter', 'summer')).toBe('Winter');
    expect(seasonBadge('all', 'winter')).toBeNull(); expect(seasonBadge('winter', 'winter')).toBeNull(); expect(seasonBadge('winter', 'autumn')).toBeNull();
    expect(usableFrom('summer', 'winter')).toBe('summer'); expect(usableFrom('shoulder', 'winter')).toBe('spring'); expect(usableFrom('winter', 'summer')).toBe('winter');
    expect(seasonHint('summer', 'winter')).toMatch(/Not usable until summer/); expect(seasonHint('summer', 'summer')).toBeNull(); expect(seasonHint('summer', undefined)).toBeNull();
  });
});
