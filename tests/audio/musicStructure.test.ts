import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { Music, composePiece, drumBar, sectionBars } from '../../src/audio/Music';
import { targetParams } from '../../src/audio/musicState';
import { THEMES, TRACK_IDS } from '../../src/audio/musicThemes';
import { trackFit, trackWeights } from '../../src/audio/musicSelect';
import { mulberry32 } from '../../src/audio/theory';
import { FakeBackend, MemStorage } from './fakeBackend';

describe('song structure (pure composer)', () => {
  it('every track is a full song: intro, verse(s), chorus, outro (bridge on the longer forms), 4-8 bar phrases that add up', () => {
    for (const id of TRACK_IDS) {
      if (id === 'blizzard') continue; // the storm track stays an unbroken drone
      const p = composePiece(3, id, 50), th = THEMES[id];
      expect(p.sections.map((s) => s.letter).join('')).toBe(th.form);
      expect(p.sections[0]!.role).toBe('intro'); expect(p.sections[p.sections.length - 1]!.role).toBe('outro');
      expect(p.sections.some((s) => s.role === 'verse')).toBe(true); expect(p.sections.some((s) => s.role === 'chorus')).toBe(true);
      expect(p.sections.reduce((a, s) => a + s.bars, 0)).toBe(p.bars);
      for (const s of p.sections) { expect(s.bars).toBe(sectionBars(s.letter)); expect(s.bars === 4 || s.bars === 8).toBe(true); }
    }
    expect(composePiece(1, 'alpineNoon', 50).sections.some((s) => s.role === 'bridge')).toBe(true);
  });
  it('the intro has no melody and no drums (a fill leads in), the chorus is the fullest part (counter-melody + melody + drums), the outro ends on a held melody note', () => {
    for (const id of ['alpineNoon', 'nightChill', 'festival', 'morningSnow'] as const) {
      const p = composePiece(8, id, 52), by = (r: string) => p.sections.filter((s) => s.role === r);
      const inRange = (s: { startBar: number; bars: number }, layer: string): number => p.events.filter((e) => e.layer === layer && e.beat >= s.startBar * 4 && e.beat < (s.startBar + s.bars) * 4).length;
      const intro = by('intro')[0]!, chorus = by('chorus')[0]!, verse = by('verse')[0]!;
      expect(inRange(intro, 'melody')).toBe(0); expect(inRange(intro, 'counter')).toBe(0);
      expect(inRange(chorus, 'counter')).toBeGreaterThan(inRange(verse, 'counter'));
      expect(inRange(chorus, 'melody')).toBeGreaterThan(8); // the hook is carried by the melody
      if (THEMES[id].kit !== 'none') expect(inRange(chorus, 'perc')).toBeGreaterThan(inRange(verse, 'perc'));
      const outro = by('outro')[0]!, last = p.events.filter((e) => e.layer === 'melody').pop()!; expect(last.beat).toBeGreaterThanOrEqual(outro.startBar * 4); expect(last.dur).toBeGreaterThanOrEqual(4);
    }
  });
  it('counter-melody notes are chord tones of the bar in the counter range; bass lines vary rhythmically (not one pattern all song)', () => {
    for (const id of ['alpineNoon', 'nightChill', 'summerMeadow', 'festival'] as const) {
      const p = composePiece(5, id, 50), bars = new Set<string>();
      for (let b = 0; b < p.bars; b++) bars.add(p.events.filter((e) => e.layer === 'bass' && e.beat >= b * 4 && e.beat < b * 4 + 4).map((e) => e.beat - b * 4).join(','));
      expect(bars.size, id).toBeGreaterThanOrEqual(3);
      const cn = p.events.filter((e) => e.layer === 'counter'); expect(cn.length, id).toBeGreaterThan(6);
      for (const e of cn) expect(e.midi).toBeGreaterThanOrEqual(p.root + 5);
    }
  });
  it('long-form variation: every new seed is a different arrangement (progression, motif, groove), same-seed identical', () => {
    for (const id of TRACK_IDS) { const a = composePiece(1, id, 50), b = composePiece(2, id, 50), c = composePiece(3, id, 50); expect(a).toEqual(composePiece(1, id, 50)); expect(new Set([JSON.stringify(a.events), JSON.stringify(b.events), JSON.stringify(c.events)]).size).toBe(3); }
    const chordSets = new Set<string>(); for (let s = 1; s <= 12; s++) chordSets.add(JSON.stringify(composePiece(s, 'alpineNoon', 50).chords)); expect(chordSets.size).toBeGreaterThanOrEqual(4);
  });
  it('percussion is deterministic, only sound on the grid, ghost notes and fills are the quiet / rare ones', () => {
    for (const kit of ['lofi', 'pop', 'brush', 'shaker'] as const) {
      const a = drumBar(kit, 2, true, mulberry32(4), 0.2), b = drumBar(kit, 2, true, mulberry32(4), 0.2);
      expect(a).toEqual(b);
      for (const h of a) { expect(h.beat).toBeGreaterThanOrEqual(0); expect(h.beat).toBeLessThan(4); expect(h.vel).toBeGreaterThan(0); expect(h.vel).toBeLessThanOrEqual(1); expect(h.nudge).toBeGreaterThanOrEqual(0); expect(h.nudge).toBeLessThan(0.25); }
    }
    const lofi = drumBar('lofi', 2, false, mulberry32(9), 0.3), kicks = lofi.filter((h) => h.inst === 'kickSoft'), snares = lofi.filter((h) => h.inst === 'snareSoft');
    expect(kicks.some((k) => k.beat === 0)).toBe(true); expect(snares.map((s) => s.beat).sort()).toEqual([1, 3]);
    expect(lofi.filter((h) => h.inst === 'hatSoft' && h.beat % 1 === 0.5).every((h) => h.nudge > 0)).toBe(true); // swung off-beats
    const ghost = lofi.filter((h) => h.vel < 0.35 && h.inst === 'hatSoft'); for (const g of ghost) expect(g.rank).toBeGreaterThan(0.6); // ghost notes drop out first when the resort is quiet
    const fill = drumBar('pop', 2, true, mulberry32(2), 0.1).filter((h) => h.beat >= 3); expect(fill.length).toBeGreaterThan(drumBar('pop', 2, false, mulberry32(2), 0.1).filter((h) => h.beat >= 3).length);
    expect(drumBar('pop', 0, false, mulberry32(2), 0.1).some((h) => h.inst === 'kickSoft')).toBe(false); // bridge: no kick
    expect(drumBar('none', 2, true, mulberry32(1), 0)).toEqual([]);
  });
  it('kit tracks swing on the grid (nudges are < one step) and the lo-fi track keeps a soft beat at night', () => {
    const p = composePiece(6, 'nightChill', 50); const nud = p.events.filter((e) => e.nudge); expect(nud.length).toBeGreaterThan(10);
    for (const e of nud) { expect(e.nudge!).toBeGreaterThan(0); expect(e.nudge!).toBeLessThan(0.25); }
    const base = { season: 'winter' as const, weather: 'clear' as const, hour: 23, speed: 1, tension: 0 };
    expect(targetParams(base, THEMES.nightChill).layers.perc).toBeGreaterThan(0.4); expect(targetParams(base, THEMES.starlight).layers.perc).toBe(0);
  });
});

describe('context: tempo, track choice by season / time / weather', () => {
  const base = { season: 'summer' as const, weather: 'clear' as const, hour: 12, speed: 1, tension: 0 };
  it('season and weather colour the tempo (autumn / winter / snow / rain slower, summer = 1)', () => {
    const t = (o: object): number => targetParams({ ...base, ...o }).tempoMul;
    expect(t({})).toBe(1); expect(t({ season: 'autumn' })).toBeLessThan(1); expect(t({ season: 'winter' })).toBeLessThan(1);
    expect(t({ weather: 'snow' })).toBeLessThan(t({ weather: 'clear' })); expect(t({ weather: 'rain' })).toBeLessThan(1);
    expect(t({ hour: 2 })).toBeLessThan(t({ hour: 12 }));
  });
  it('snowy day = Snow Piano, night = Starlight or Night Chill, sunny summer day = Summer Meadow, storm = Blizzard only', () => {
    const best = (c: object): string => { const w = trackWeights({ ...base, ...c }); return [...TRACK_IDS].sort((a, b) => w[b] - w[a])[0]!; };
    expect(best({ season: 'winter', weather: 'snow', hour: 13 })).toBe('snowPiano');
    expect(['starlight', 'nightChill']).toContain(best({ season: 'winter', hour: 23 })); expect(trackFit('nightChill', { ...base, season: 'winter', hour: 23 })).toBeGreaterThan(0.5);
    expect(best({ season: 'summer', hour: 12 })).toBe('summerMeadow'); expect(best({ weather: 'storm' })).toBe('blizzard');
    expect(trackFit('snowPiano', { ...base, weather: 'clear' })).toBe(0); expect(trackFit('snowPiano', { ...base, weather: 'storm' })).toBe(0);
    expect(trackFit('menu', { ...base, menu: true, screen: 'menu' })).toBe(1); expect(trackFit('title', { ...base, menu: true, screen: 'menu' })).toBe(0); expect(trackFit('menu', base)).toBe(0);
  });
});

describe('Music scheduling extras (fake backend)', () => {
  it('kit tracks duck pads and the counter-line against the kick (sidechain), others do not; the delay send exists; nothing is scheduled late', async () => {
    const fb = new FakeBackend(), settings = new AudioSettings(new MemStorage()); settings.set({ musicStyle: 'nightChill' });
    const engine = new AudioEngine({ factory: () => fb, settings }); await engine.onGesture();
    const music = new Music(engine, { seed: 2 }); music.setInputs({ season: 'winter', hour: 22, busy: 1 });
    for (let i = 0; i < 40 * 40; i++) { fb.t += 0.025; music.tick(); }
    expect(music.currentTrack).toBe('nightChill'); expect(music.stats.late).toBe(0);
    const pump = (music as unknown as { tracks: Array<{ pump: { gain: { calls: string[] } } | null }> }).tracks[0]!.pump!;
    expect(pump.gain.calls.filter((c) => c === 'target').length).toBeGreaterThan(10);
    expect(fb.liveOf('delay')).toBe(9); // 6 reverb combs + pre-delay + the 2 ping-pong delay lines
  });
});
