import { describe, expect, it } from 'vitest';
import { chooseTrack, shouldSwap, trackFit, trackWeights } from '../../src/audio/musicSelect';
import type { MusicInput } from '../../src/audio/musicState';
import { isMusicStyle, MUSIC_STYLES, TRACK_IDS, type TrackId } from '../../src/audio/musicThemes';
import { mulberry32 } from '../../src/audio/theory';

const base: MusicInput = { season: 'winter', weather: 'clear', hour: 12, speed: 1, tension: 0 };
const best = (c: Partial<MusicInput>): TrackId => { const w = trackWeights({ ...base, ...c }); return [...TRACK_IDS].sort((a, b) => w[b] - w[a])[0]!; };

describe('track fit by context', () => {
  it('maps the documented contexts to their mood', () => {
    expect(best({ hour: 8 })).toBe('morningSnow');
    expect(best({ hour: 13 })).toBe('alpineNoon');
    expect(best({ hour: 19.5 })).toBe('apres');
    expect(best({ hour: 23.5 })).toBe('starlight');
    expect(best({ hour: 2 })).toBe('starlight');
    expect(best({ season: 'summer', hour: 12 })).toBe('summerMeadow');
    expect(best({ season: 'autumn', hour: 15 })).toBe('autumnGold');
    expect(best({ weather: 'storm' })).toBe('blizzard');
    expect(best({ weather: 'heavySnow', hour: 23 })).toBe('blizzard');
    expect(best({ menu: true })).toBe('title');
    expect(best({ festival: true, season: 'summer', hour: 14 })).toBe('festival');
  });
  it('fit is within 0..1, the title only plays in the menu, a storm excludes everything but Blizzard, Blizzard needs weather', () => {
    for (const id of TRACK_IDS) for (let h = 0; h < 24; h += 1.5) for (const season of ['winter', 'spring', 'summer', 'autumn'] as const) for (const weather of ['clear', 'cloudy', 'snow', 'rain', 'storm', 'heavySnow'] as const) {
      const f = trackFit(id, { ...base, hour: h, season, weather, busy: 0.9 });
      expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThanOrEqual(1);
      if (id === 'title') expect(f).toBe(0);
      if ((weather === 'storm' || weather === 'heavySnow') && id !== 'blizzard') expect(f).toBe(0);
      if (id === 'blizzard' && (weather === 'clear' || weather === 'cloudy')) expect(f).toBe(0);
    }
  });
  it('every state has at least one track to play (no deadlock into silence)', () => {
    for (let h = 0; h < 24; h += 0.5) for (const season of ['winter', 'spring', 'summer', 'autumn'] as const) for (const weather of ['clear', 'cloudy', 'snow', 'rain', 'storm', 'heavySnow'] as const) {
      const w = trackWeights({ ...base, hour: h, season, weather });
      expect(Math.max(...Object.values(w)), `${season} ${h} ${weather}`).toBeGreaterThan(0.0025);
    }
  });
  it('sunrise / sunset shift the day parts', () => {
    expect(best({ hour: 8, sunrise: 8.5 })).not.toBe('alpineNoon');
    expect(shouldSwap('starlight', { ...base, hour: 12 })).toBe(true);
    expect(shouldSwap('alpineNoon', { ...base, hour: 12 })).toBe(false);
  });
});

describe('chooseTrack', () => {
  it('is deterministic per seed', () => {
    const seq = (seed: number): TrackId[] => { const r = mulberry32(seed), rec: TrackId[] = []; for (let i = 0; i < 30; i++) rec.push(chooseTrack({ ...base, hour: 15, season: 'summer' }, r, rec)); return rec; };
    expect(seq(4)).toEqual(seq(4)); expect(seq(4)).not.toEqual(seq(5));
  });
  it('never repeats the previous track while an alternative fits (and avoids the one before it)', () => {
    for (const ctx of [{ hour: 15, season: 'summer' as const }, { hour: 19 }, { hour: 8 }, { hour: 22 }, { hour: 13, season: 'autumn' as const }]) {
      const r = mulberry32(9), rec: TrackId[] = [];
      for (let i = 0; i < 200; i++) rec.push(chooseTrack({ ...base, ...ctx }, r, rec));
      for (let i = 1; i < rec.length; i++) expect(rec[i]).not.toBe(rec[i - 1]);
    }
  });
  it('uses several tracks in a busy summer afternoon (variety), only Blizzard in a storm', () => {
    const r = mulberry32(2), rec: TrackId[] = [], seen = new Set<TrackId>();
    for (let i = 0; i < 100; i++) { const t = chooseTrack({ ...base, hour: 15, season: 'summer', busy: 1, festival: true }, r, rec); rec.push(t); seen.add(t); }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 20; i++) expect(chooseTrack({ ...base, weather: 'storm' }, r, rec)).toBe('blizzard');
  });
  it('a locked style always wins; exclude is honoured in auto', () => {
    const r = mulberry32(1);
    for (const id of TRACK_IDS) expect(chooseTrack({ ...base, weather: 'storm' }, r, [], id)).toBe(id);
    for (let i = 0; i < 50; i++) expect(chooseTrack({ ...base, hour: 12 }, r, [], 'auto', 'alpineNoon')).not.toBe('alpineNoon');
  });
  it('music style validation', () => {
    expect(MUSIC_STYLES[0]).toBe('auto'); expect(MUSIC_STYLES.length).toBe(TRACK_IDS.length + 1);
    expect(isMusicStyle('apres')).toBe(true); expect(isMusicStyle('off')).toBe(false); expect(isMusicStyle(3)).toBe(false);
  });
});
