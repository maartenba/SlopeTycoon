import { describe, expect, it } from 'vitest';
import { SeasonalClosureGrouper } from '../../src/ui/closureGrouper';
import { formatEvent, seasonalKind } from '../../src/ui/newsFormat';

const c = (id: number, name: string, kind: 'snow' | 'warm' | 'season' = 'snow') => ({ id, name, kind, text: `${name} closed. No snow`, focus: { x: id, y: id } });

describe('SeasonalClosureGrouper', () => {
  it('classifies seasonal reasons only', () => {
    expect(seasonalKind('Closed: no snow at 1,258 m')).toBe('snow');
    expect(seasonalKind('Closed: too warm at 1,240 m (15°C)')).toBe('warm');
    expect(seasonalKind('Closed for the season')).toBe('season');
    expect(seasonalKind('Closed: no staff')).toBeNull();
    expect(seasonalKind('Inactive: road lost')).toBeNull();
    expect(formatEvent('attraction:closed', { id: 1, type: 'mountainHut', reason: 'Closed: no staff' }, {})!.seasonal).toBeUndefined();
    expect(formatEvent('attraction:closed', { id: 1, type: 'mountainHut', reason: 'Closed: no snow at 1,258 m' }, {})!.seasonal).toMatchObject({ id: 1, kind: 'snow' });
  });
  it('groups closures inside the window into one toast focusing the first', () => {
    const g = new SeasonalClosureGrouper(4000);
    g.add(c(1, 'Magic Carpet'), 'summer', 0); g.add(c(2, 'Ice Rink', 'warm'), 'summer', 500); g.add(c(3, 'Heated Terrace', 'warm'), 'summer', 900);
    expect(g.flush(2000)).toBeNull(); // window still open
    const r = g.flush(4100)!;
    expect(r.count).toBe(3);
    expect(r.text).toBe('3 winter attractions closed for summer: Magic Carpet, Ice Rink, Heated Terrace');
    expect(r.focus).toEqual({ x: 1, y: 1 });
    expect(g.flush(9000)).toBeNull();
  });
  it('a lone closure keeps its own text; many are summarised', () => {
    const g = new SeasonalClosureGrouper();
    g.add(c(1, 'Ice Rink'), 'summer', 0);
    expect(g.flush(5000)!.text).toBe('Ice Rink closed. No snow');
    for (let i = 10; i < 16; i++) g.add(c(i, `A${i}`), 'spring', 6000);
    expect(g.flush(11000)!.text).toBe('6 winter attractions closed for spring: A10, A11, A12 and 3 more');
    g.add(c(20, 'Lake', 'season'), 'autumn', 20000); g.add(c(21, 'Beach', 'season'), 'autumn', 20100);
    expect(g.flush(25000)!.text).toBe('2 attractions closed for the season: Lake, Beach');
  });
  it('dedupes per attraction per season and resets on a season change', () => {
    const g = new SeasonalClosureGrouper();
    expect(g.add(c(1, 'Ice Rink'), 'summer', 0)).toBe(true);
    g.flush(5000);
    expect(g.add(c(1, 'Ice Rink'), 'summer', 150_000)).toBe(false); // next day, same season: silent
    expect(g.flush(160_000)).toBeNull();
    expect(g.add(c(1, 'Ice Rink'), 'autumn', 200_000)).toBe(true); // new season
    expect(g.flush(205_000)!.count).toBe(1);
  });
});
