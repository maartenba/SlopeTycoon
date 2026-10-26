import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings, AUDIO_STORAGE_KEY } from '../../src/audio/AudioSettings';
import { Music, composePiece } from '../../src/audio/Music';
import { MUSIC, THEMES, LAYERS } from '../../src/audio/musicThemes';
import { bpmFor, dayPart, targetParams } from '../../src/audio/musicState';
import { inScale } from '../../src/audio/theory';
import type { SeasonId } from '../../src/core/events';
import { FakeBackend, MemStorage } from './fakeBackend';

const SEASONS: SeasonId[] = ['winter', 'spring', 'summer', 'autumn'];

async function setup(seed = 3) {
  const fb = new FakeBackend(), settings = new AudioSettings(new MemStorage());
  const engine = new AudioEngine({ factory: () => fb, settings });
  await engine.onGesture();
  const music = new Music(engine, { seed });
  const run = (sec: number, each?: () => void): void => { for (let i = 0; i < Math.round(sec / 0.025); i++) { fb.t += 0.025; music.tick(); each?.(); } };
  return { fb, settings, engine, music, run };
}

describe('composer', () => {
  it('is deterministic per seed and differs across seeds', () => {
    expect(composePiece(5, 'summer', 50)).toEqual(composePiece(5, 'summer', 50));
    expect(composePiece(5, 'summer', 50).events).not.toEqual(composePiece(6, 'summer', 50).events);
  });
  it('uses only scale tones, melody in range, grid-aligned, in-bounds', () => {
    for (const s of SEASONS) for (let seed = 1; seed <= 12; seed++) {
      const p = composePiece(seed, s, 48 + (seed % 12));
      for (const e of p.events) {
        expect(e.beat % MUSIC.stepBeats).toBe(0);
        expect(e.beat).toBeGreaterThanOrEqual(0); expect(e.beat).toBeLessThan(p.totalBeats);
        if (e.layer !== 'perc') expect(inScale(e.midi, p.root, p.mode)).toBe(true);
        if (e.layer === 'melody') { expect(e.midi).toBeGreaterThanOrEqual(p.root + 11); expect(e.midi).toBeLessThanOrEqual(p.root + 36); }
      }
    }
  });
  it('avoids repeating identical bars', () => {
    for (const s of SEASONS) for (let seed = 1; seed <= 12; seed++) {
      const p = composePiece(seed, s, 52), sig = new Map<string, number>(), seq: string[] = [];
      for (let b = 0; b < p.bars; b++) {
        const k = p.events.filter((e) => e.beat >= b * 4 && e.beat < b * 4 + 4).map((e) => `${e.layer}${e.beat - b * 4}:${e.midi - p.root}`).join(',');
        sig.set(k, (sig.get(k) ?? 0) + 1); seq.push(k);
      }
      expect(Math.max(...sig.values())).toBeLessThanOrEqual(3);
      for (let i = 2; i < seq.length; i++) expect(seq[i] === seq[i - 1] && seq[i] === seq[i - 2]).toBe(false);
    }
  });
  it('seasonal themes differ in instruments, tempo, scales, progressions', () => {
    expect(new Set(SEASONS.map((s) => JSON.stringify(THEMES[s].inst))).size).toBe(4);
    expect(new Set(SEASONS.map((s) => THEMES[s].bpm)).size).toBe(4);
    expect(new Set(SEASONS.map((s) => JSON.stringify(THEMES[s].modes))).size).toBe(4);
    expect(new Set(SEASONS.map((s) => JSON.stringify(THEMES[s].progressions))).size).toBe(4);
    for (const s of SEASONS) { expect(THEMES[s].bpm).toBeGreaterThanOrEqual(70); expect(THEMES[s].bpm).toBeLessThanOrEqual(90); }
    expect(THEMES.winter.inst.melody).toBe('bell'); expect(THEMES.summer.inst.arp).toBe('guitar');
    const used = (s: SeasonId): string[] => [...new Set(composePiece(1, s, 50).events.map((e) => e.inst))].sort();
    expect(used('winter')).not.toEqual(used('summer'));
  });
  it('pieces last a couple of minutes', () => {
    for (const s of SEASONS) { const p = composePiece(1, s, 50); expect((p.totalBeats * 60) / THEMES[s].bpm).toBeGreaterThan(80); }
  });
});

describe('musicState', () => {
  const base = { season: 'summer' as const, weather: 'clear' as const, hour: 12, speed: 1, tension: 0 };
  it('tempo by speed stays within +25%', () => {
    expect(targetParams(base).tempoMul).toBe(1);
    expect(targetParams({ ...base, speed: 2 }).tempoMul).toBeGreaterThan(1);
    expect(targetParams({ ...base, speed: 3 }).tempoMul).toBeLessThanOrEqual(1.25);
    expect(bpmFor('summer', targetParams({ ...base, speed: 3 }).tempoMul)).toBeLessThanOrEqual(90 * 1.25 + 1e-9);
  });
  it('night is sparse and slow; dawn builds; snowstorm is pads only', () => {
    const n = targetParams({ ...base, hour: 2 }), d = targetParams(base), dawn = targetParams({ ...base, hour: 6.5 });
    expect(dayPart(2)).toBe('night'); expect(dayPart(6.5)).toBe('dawn');
    expect(n.tempoMul).toBeLessThan(d.tempoMul); expect(n.layers.melody).toBeLessThan(d.layers.melody);
    expect(dawn.layers.melody).toBeGreaterThan(n.layers.melody); expect(dawn.layers.melody).toBeLessThan(d.layers.melody);
    const s = targetParams({ ...base, weather: 'heavySnow' });
    for (const l of LAYERS) expect(s.layers[l]).toBe(l === 'pad' ? 1 : 0);
  });
  it('tension thins melody/perc', () => {
    const t = targetParams({ ...base, tension: 1 });
    expect(t.layers.melody).toBeLessThan(1); expect(t.layers.perc).toBe(0);
  });
});

describe('Music playback (fake backend)', () => {
  it('stays silent until the engine runs', () => {
    const fb = new FakeBackend(), engine = new AudioEngine({ factory: () => fb, settings: new AudioSettings(null) });
    const m = new Music(engine); m.tick(); expect(fb.nodes.length).toBe(1);
  });
  it('15 minutes: bounded nodes, voice cap, no events in the past, several pieces', async () => {
    const { fb, music, run } = await setup();
    music.setInputs({ season: 'summer' });
    let maxLive = 0, maxVoices = 0;
    run(900, () => { maxLive = Math.max(maxLive, fb.live); maxVoices = Math.max(maxVoices, music.activeVoices); });
    const lead = fb.nodes.filter((n) => n.started).map((n) => n.startAt - n.createdAt);
    expect(music.stats.notes).toBeGreaterThan(500);
    expect(maxVoices).toBeLessThanOrEqual(MUSIC.maxVoices);
    expect(maxLive).toBeLessThan(300);
    expect(Math.min(...lead)).toBeGreaterThanOrEqual(-1e-9);
    expect(music.stats.late).toBe(0);
    expect(music.stats.pieces).toBeGreaterThanOrEqual(3);
    expect(music.stats.pieces).toBeLessThanOrEqual(10);
    expect(fb.live).toBeLessThan(300);
  }, 60000);
  it('keys change between pieces', async () => {
    const { music, run } = await setup();
    const roots: number[] = [];
    run(600, () => { const p = music.currentPiece; if (p && roots[roots.length - 1] !== p.root) roots.push(p.root); });
    expect(roots.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < roots.length; i++) expect(roots[i]).not.toBe(roots[i - 1]);
  });
  it('schedules only within the lookahead window', async () => {
    const { fb, music, run } = await setup();
    run(60, () => { for (const n of fb.nodes) if (n.started && n.createdAt === fb.t && n.startAt - fb.t > MUSIC.lookahead + 0.3) throw new Error('scheduled too far ahead'); });
    expect(music.stats.notes).toBeGreaterThan(10);
  });
  it('season change crossfades over ~8 s', async () => {
    const { music, run } = await setup();
    music.setInputs({ season: 'winter' }); run(10);
    expect(music.trackCount).toBe(1);
    music.setInputs({ season: 'spring' }); run(0.2);
    expect(music.stats.crossfades).toBe(1);
    expect(music.trackCount).toBe(2);
    run(MUSIC.crossfadeSec + 1);
    expect(music.trackCount).toBe(1);
    expect(music.currentPiece!.season).toBe('spring');
  });
  it('pauses (fade out) at speed 0 and resumes; honours the option', async () => {
    const { settings, music, run } = await setup();
    run(10);
    expect(music.gateValue).toBe(1);
    music.setInputs({ speed: 0 }); run(5);
    expect(music.gateValue).toBe(0); expect(music.isPlaying).toBe(false);
    const held = music.stats.notes; run(5); expect(music.stats.notes).toBe(held);
    music.setInputs({ speed: 1 }); run(5);
    expect(music.gateValue).toBe(1); expect(music.stats.notes).toBeGreaterThan(held);
    settings.set({ pauseMusicAtZero: false }); music.setInputs({ speed: 0 }); run(2);
    expect(music.gateValue).toBe(1);
  });
  it('music off fades out', async () => {
    const { settings, music, run } = await setup();
    run(5); settings.set({ musicOn: false }); run(1);
    expect(music.gateValue).toBe(0);
  });
  it('tempo follows game speed', async () => {
    const { music, run } = await setup();
    music.setInputs({ season: 'summer', hour: 12 }); run(5);
    const b1 = music.bpm; music.setInputs({ speed: 3 }); run(30);
    expect(music.bpm / b1).toBeGreaterThan(1.15); expect(music.bpm / b1).toBeLessThanOrEqual(1.25 + 1e-6);
  });
  it('tension adds a drone; jingle plays and is rate limited', async () => {
    const { music, run } = await setup();
    run(10);
    music.addTension(1); const before = music.stats.notes; run(10);
    expect(music.stats.notes).toBeGreaterThan(before);
    music.jingle(); music.jingle();
    expect(music.stats.jingles).toBe(1);
  });
  it('snowstorm is pads only (sparse)', async () => {
    const { music, run } = await setup();
    music.setInputs({ weather: 'heavySnow' }); run(30);
    const n = music.stats.notes; run(10);
    expect(music.stats.notes - n).toBeLessThan(25);
  });
});

describe('music settings', () => {
  it('defaults and LocalStorage roundtrip', () => {
    const st = new MemStorage(), a = new AudioSettings(st);
    expect(a.get().musicOn).toBe(true); expect(a.get().pauseMusicAtZero).toBe(true); expect(a.get().muteMusicInMenus).toBe(false);
    a.set({ musicOn: false, pauseMusicAtZero: false, muteMusicInMenus: true });
    expect(st.getItem(AUDIO_STORAGE_KEY)).toContain('musicOn');
    const b = new AudioSettings(st);
    expect(b.get().musicOn).toBe(false); expect(b.get().pauseMusicAtZero).toBe(false); expect(b.get().muteMusicInMenus).toBe(true);
  });
});
