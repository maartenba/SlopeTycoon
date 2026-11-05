import { describe, expect, it } from 'vitest';
import { BAR_PLAYLIST, FALLBACK, MENU_PLAYLIST, PLAYLISTS, SITUATION, SITUATION_IDS, TRACK_BY_ID } from '../../src/config/audioMusic';
import { busyFlag, candidates, dayPart, fadeIn, fadeOut, isUrgent, nextInPlaylist, nextStartAt, pickNext, SituationTracker, situationFor, trimFor, type MusicInput } from '../../src/audio/musicPlaylist';

const SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const;
const WEATHERS = ['clear', 'cloudy', 'snow', 'rain', 'heavySnow', 'storm'] as const;

describe('situation -> playlist (pure)', () => {
  it('every season x hour x weather x festival x busy x sunrise maps to a situation whose playlist is not empty and whose tracks exist', () => {
    const seen = new Set<string>();
    for (const season of SEASONS) for (const weather of WEATHERS) for (let hour = 0; hour < 24; hour += 0.5) for (const festival of [false, true]) for (const busy of [false, true]) for (const sunrise of [undefined, 4.5, 8.5]) {
      const c: MusicInput = { season, weather, hour, speed: 1, festival, ...(sunrise !== undefined ? { sunrise, sunset: 22 - sunrise } : {}) };
      const s = situationFor(c, busy);
      expect(SITUATION_IDS).toContain(s); seen.add(s);
      expect(PLAYLISTS[s].length).toBeGreaterThan(0);
      for (const id of PLAYLISTS[s]) expect(TRACK_BY_ID.get(id)?.group).toBe('game');
      expect(candidates(s, null).length).toBeGreaterThan(0);
    }
    expect([...seen].sort()).toEqual([...SITUATION_IDS].sort()); // every situation is reachable
  });
  it('the owner mapping: winter morning / busy winter day / snow / dusk / night / summer / autumn / storm / festival', () => {
    const i = (o: Partial<MusicInput>): MusicInput => ({ season: 'winter', weather: 'clear', hour: 9, speed: 1, ...o });
    expect(situationFor(i({ hour: 6 }), false)).toBe('winter-morning'); expect(situationFor(i({ hour: 9.5 }), true)).toBe('winter-morning');
    expect(situationFor(i({ hour: 13 }), true)).toBe('winter-day'); expect(situationFor(i({ hour: 13 }), false)).toBe('winter-morning');
    expect(situationFor(i({ hour: 13, weather: 'snow' }), true)).toBe('snow');
    expect(situationFor(i({ hour: 19 }), true)).toBe('dusk'); expect(situationFor(i({ hour: 23 }), true)).toBe('night'); expect(situationFor(i({ hour: 2 }), false)).toBe('night');
    expect(situationFor(i({ season: 'summer', hour: 13 }), false)).toBe('summer'); expect(situationFor(i({ season: 'spring', hour: 10 }), false)).toBe('summer');
    expect(situationFor(i({ season: 'autumn', hour: 13 }), false)).toBe('autumn'); expect(situationFor(i({ season: 'autumn', hour: 19 }), false)).toBe('autumn');
    expect(situationFor(i({ weather: 'storm', hour: 23 }), false)).toBe('storm'); expect(situationFor(i({ weather: 'heavySnow' }), false)).toBe('storm');
    expect(situationFor(i({ season: 'summer', hour: 14, festival: true }), false)).toBe('festival'); expect(situationFor(i({ hour: 23, festival: true }), false)).toBe('night');
    expect(PLAYLISTS['winter-morning']).toEqual(['winter-mountain-morning', 'winter-early-slopes']);
    expect(PLAYLISTS.night).toEqual(['night-melted-snow', 'night-vinny-f-minor']);
    expect(BAR_PLAYLIST.length).toBe(4); expect(MENU_PLAYLIST[0]).toBe('seasons-of-management');
  });
  it('day parts follow the sunrise / sunset shift', () => {
    expect(dayPart(3)).toBe('night'); expect(dayPart(6)).toBe('dawn'); expect(dayPart(12)).toBe('day'); expect(dayPart(19)).toBe('dusk'); expect(dayPart(22)).toBe('night');
    expect(situationFor({ season: 'winter', weather: 'clear', hour: 6, sunrise: 8.5, speed: 1 }, false)).toBe('night'); // before a late winter sunrise (shifted to 4)
  });
  it('never the same track twice in a row: any playlist, any history, incl. single-track playlists (they fall back to another situation)', () => {
    for (const s of SITUATION_IDS) {
      let recent: string[] = []; const used = new Set<string>();
      let x = 7; const rand = (): number => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
      for (let n = 0; n < 200; n++) { const id = pickNext(s, recent, rand); expect(id).not.toBe(recent[recent.length - 1]); expect(TRACK_BY_ID.has(id)).toBe(true); used.add(id); recent = [...recent, id].slice(-4); }
      for (const id of PLAYLISTS[s]) expect(used.has(id)).toBe(true); // every track of the playlist gets played
    }
    for (const s of SITUATION_IDS) expect(PLAYLISTS[FALLBACK[s]].length).toBeGreaterThan(0);
  });
  it('two-track playlists alternate strictly', () => {
    let recent: string[] = []; const seq: string[] = [];
    for (let i = 0; i < 6; i++) { const id = pickNext('night', recent, () => 0.3); seq.push(id); recent = [...recent, id]; }
    expect(seq[0]).not.toBe(seq[1]); expect(seq[0]).toBe(seq[2]); expect(seq[1]).toBe(seq[3]);
  });
  it('menu / bar rotation never repeats the previous track and skips failed ones when it can', () => {
    for (const pl of [MENU_PLAYLIST, BAR_PLAYLIST]) for (const last of pl) { const seen = new Set<string>(); for (let i = 0; i < 100; i++) { const k = nextInPlaylist(pl, last, () => i / 100); expect(k).not.toBe(last); seen.add(k); } expect(seen.size).toBe(pl.length - 1); }
    expect(nextInPlaylist(BAR_PLAYLIST, 'bar-ski-brass', () => 0, ['bar-ski-hut-groove'])).not.toBe('bar-ski-hut-groove');
    expect(nextInPlaylist(['a'], 'a', () => 0.5)).toBe('a'); // a one-track list has nothing else
  });
});

describe('hysteresis', () => {
  const base: MusicInput = { season: 'winter', weather: 'clear', hour: 13, speed: 1, busy: 0.5 };
  it('busy flag: on at 0.35, off again only below 0.2', () => {
    expect(busyFlag(0.3, false)).toBe(false); expect(busyFlag(0.35, false)).toBe(true); expect(busyFlag(0.25, true)).toBe(true); expect(busyFlag(0.19, true)).toBe(false); expect(busyFlag(undefined, true)).toBe(false);
  });
  it('a new situation counts only after it held settleSec; a flicker is ignored; the hour ticking over mid-song changes nothing at once', () => {
    const t = new SituationTracker(); expect(t.update(base, 0)).toBe(true); expect(t.committed).toBe('winter-day');
    const storm: MusicInput = { ...base, weather: 'storm' };
    expect(t.update(storm, 1)).toBe(false); expect(t.update(storm, 10)).toBe(false); expect(t.update(base, 12)).toBe(false); // flicker back
    expect(t.update(storm, 13)).toBe(false); expect(t.update(storm, 13 + SITUATION.settleSec - 1)).toBe(false);
    expect(t.update(storm, 13 + SITUATION.settleSec)).toBe(true); expect(t.committed).toBe('storm');
    // busy hovering around the threshold never flaps day <-> morning
    const u = new SituationTracker(); u.update({ ...base, busy: 0.4 }, 0); let flips = 0;
    for (let s = 1; s < 600; s++) if (u.update({ ...base, busy: 0.2 + 0.2 * Math.abs(Math.sin(s / 7)) + 0.01 }, s)) flips++;
    expect(flips).toBeLessThanOrEqual(1);
  });
  it('urgent situations are storm, night and festival only', () => {
    expect(SITUATION_IDS.filter(isUrgent).sort()).toEqual(['festival', 'night', 'storm']);
  });
});

describe('fades and trim', () => {
  it('crossfade is equal power and monotonic', () => {
    for (let p = 0; p <= 1; p += 0.1) expect(fadeIn(p) ** 2 + fadeOut(p) ** 2).toBeCloseTo(1, 10);
    expect(fadeIn(0)).toBe(0); expect(fadeIn(1)).toBeCloseTo(1); expect(fadeOut(1)).toBeCloseTo(0, 10); expect(fadeIn(-3)).toBe(0); expect(fadeIn(9)).toBeCloseTo(1);
    expect(fadeIn(0.3)).toBeLessThan(fadeIn(0.6));
  });
  it('next start leaves exactly the crossfade at the end; short tracks cap at half', () => {
    expect(nextStartAt(140, 3)).toBe(137); expect(nextStartAt(4, 3)).toBe(2); expect(nextStartAt(0, 3)).toBe(0);
  });
  it('trim: -3 dB is a factor 0.708; louder files get less gain', () => {
    expect(trimFor(-17, -20)).toBeCloseTo(0.708, 3); expect(trimFor(-20, -20)).toBe(1); expect(trimFor(-14, -20)).toBeLessThan(trimFor(-18, -20));
  });
});
