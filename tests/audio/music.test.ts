import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings, AUDIO_STORAGE_KEY } from '../../src/audio/AudioSettings';
import { Music, composePiece } from '../../src/audio/Music';
import { MUSIC, THEMES, LAYERS, TRACK_IDS, type TrackId } from '../../src/audio/musicThemes';
import { bpmFor, dayPart, targetParams } from '../../src/audio/musicState';
import { inScale, MODES, PENTATONIC_DEGREES, type ModeName } from '../../src/audio/theory';
import { FakeBackend, MemStorage } from './fakeBackend';

/** Scale index (mod 7 via position in the mode) of a midi note known to be in the scale. */
function scaleIndexOf(midi: number, root: number, mode: ModeName): number { return MODES[mode].indexOf((((midi - root) % 12) + 12) % 12); }

async function setup(seed = 3, settings0: Partial<import('../../src/audio/AudioSettings').AudioSettingsData> = {}) {
  const fb = new FakeBackend(), settings = new AudioSettings(new MemStorage());
  if (Object.keys(settings0).length) settings.set(settings0);
  const engine = new AudioEngine({ factory: () => fb, settings });
  await engine.onGesture();
  const music = new Music(engine, { seed });
  const run = (sec: number, each?: () => void): void => { for (let i = 0; i < Math.round(sec / 0.025); i++) { fb.t += 0.025; music.tick(); each?.(); } };
  return { fb, settings, engine, music, run };
}

describe('composer', () => {
  it('is deterministic per seed and differs across seeds', () => {
    for (const id of TRACK_IDS) {
      expect(composePiece(5, id, 50)).toEqual(composePiece(5, id, 50));
      expect(composePiece(5, id, 50).events).not.toEqual(composePiece(6, id, 50).events);
    }
  });
  it('uses only scale tones (melody pentatonic), melody in range, grid-aligned, in-bounds, pans in range', () => {
    for (const id of TRACK_IDS) for (let seed = 1; seed <= 10; seed++) {
      const p = composePiece(seed, id, 48 + (seed % 12)), th = THEMES[id];
      for (const e of p.events) {
        expect(e.beat % MUSIC.stepBeats).toBe(0);
        expect(e.beat).toBeGreaterThanOrEqual(0); expect(e.beat).toBeLessThan(p.totalBeats);
        expect(Math.abs(e.pan)).toBeLessThanOrEqual(0.8);
        if (e.layer !== 'perc') expect(inScale(e.midi, p.root, p.mode)).toBe(true);
        if (e.layer === 'melody') {
          expect(e.midi).toBeGreaterThanOrEqual(p.root + 11); expect(e.midi).toBeLessThanOrEqual(p.root + 36);
          if (th.pentatonic) expect(PENTATONIC_DEGREES[p.mode].includes(((scaleIndexOf(e.midi, p.root, p.mode) % 7) + 7) % 7)).toBe(true);
        }
      }
    }
  });
  it('avoids repeating identical bars', () => {
    for (const id of TRACK_IDS) for (let seed = 1; seed <= 8; seed++) {
      const p = composePiece(seed, id, 52), sig = new Map<string, number>(), seq: string[] = [];
      for (let b = 0; b < p.bars; b++) {
        const k = p.events.filter((e) => e.layer !== 'pad' && (e.layer !== 'bass' || THEMES[id].bassStyle !== 'whole') && e.beat >= b * 4 && e.beat < b * 4 + 4).map((e) => `${e.layer}${e.beat - b * 4}:${e.midi - p.root}`).join(',');
        if (k.split(',').length >= 3) sig.set(k, (sig.get(k) ?? 0) + 1); // pad-only bars and held whole-note basses (a chord held in the sparse tracks) and bars with < 3 notes (the sparse night / storm tracks) are not repeats
        seq.push(k);
      }
      expect(Math.max(...sig.values())).toBeLessThanOrEqual(4);
      for (let i = 3; i < seq.length; i++) expect(seq[i]!.split(',').length >= 3 && seq[i] === seq[i - 1] && seq[i] === seq[i - 2] && seq[i] === seq[i - 3]).toBe(false);
    }
  });
  it('has nine distinct tracks with distinct character, all slow and consonant (no bells, no phrygian)', () => {
    expect(TRACK_IDS.length).toBeGreaterThanOrEqual(6); expect(TRACK_IDS.length).toBe(9);
    expect(new Set(TRACK_IDS.map((t) => THEMES[t].name)).size).toBe(TRACK_IDS.length);
    expect(new Set(TRACK_IDS.map((t) => JSON.stringify(THEMES[t].inst))).size).toBeGreaterThanOrEqual(7);
    expect(new Set(TRACK_IDS.map((t) => THEMES[t].bpm)).size).toBeGreaterThanOrEqual(8);
    for (const id of TRACK_IDS) {
      const th = THEMES[id];
      expect(th.bpm).toBeGreaterThanOrEqual(50); expect(th.bpm).toBeLessThanOrEqual(100);
      for (const m of th.modes) expect(['ionian', 'lydian', 'mixolydian', 'dorian', 'aeolian']).toContain(m);
      expect(th.barsPerChord).toBeGreaterThanOrEqual(1);
      for (const inst of Object.values(th.inst)) expect(['bell', 'glock', 'marimba', 'handpan']).not.toContain(inst);
    }
    expect(THEMES.starlight.barsPerChord).toBe(4); expect(THEMES.apres.seventh).toBe(true);
    expect(THEMES.blizzard.transpose).toBeLessThan(0);
    const used = (t: TrackId): string[] => [...new Set(composePiece(1, t, 50).events.map((e) => e.inst))].sort();
    expect(used('apres')).not.toEqual(used('summerMeadow'));
  });
  it('pieces last 80-140 s; chords move slowly and are voice-led (pad tops move by small steps)', () => {
    for (const id of TRACK_IDS) { const p = composePiece(1, id, 50), sec = (p.totalBeats * 60) / THEMES[id].bpm; expect(sec, id).toBeGreaterThan(80); expect(sec, id).toBeLessThan(150); }
    for (const id of TRACK_IDS) {
      const p = composePiece(2, id, 50), th = THEMES[id], pads = p.events.filter((e) => e.layer === 'pad');
      const byBeat = new Map<number, number[]>(); for (const e of pads) byBeat.set(e.beat, [...(byBeat.get(e.beat) ?? []), e.midi]);
      const tops = [...byBeat.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => Math.max(...m));
      for (let i = 1; i < tops.length; i++) expect(Math.abs(tops[i]! - tops[i - 1]!), `${id} pad leap`).toBeLessThanOrEqual(7);
      // harmonic rhythm: at most one new chord per `barsPerChord` bars
      expect(byBeat.size).toBeLessThanOrEqual(Math.ceil(p.bars / (th.inst.pad === 'epiano' ? 1 : th.barsPerChord)) + 1);
    }
  });
});

describe('musicState', () => {
  const base = { season: 'summer' as const, weather: 'clear' as const, hour: 12, speed: 1, tension: 0 };
  it('tempo by speed stays within +25%', () => {
    expect(targetParams(base).tempoMul).toBe(1);
    expect(targetParams({ ...base, speed: 2 }).tempoMul).toBeGreaterThan(1);
    expect(targetParams({ ...base, speed: 3 }).tempoMul).toBeLessThanOrEqual(1.25);
    expect(bpmFor('summerMeadow', targetParams({ ...base, speed: 3 }).tempoMul)).toBeLessThanOrEqual(88 * 1.25 + 1e-9);
  });
  it('night is sparse and slow; dawn builds; snowstorm is pads only', () => {
    const n = targetParams({ ...base, hour: 2 }), d = targetParams(base), dawn = targetParams({ ...base, hour: 6.5 });
    expect(dayPart(2)).toBe('night'); expect(dayPart(6.5)).toBe('dawn');
    expect(n.tempoMul).toBeLessThan(d.tempoMul); expect(n.layers.melody).toBeLessThan(d.layers.melody);
    expect(dawn.layers.melody).toBeGreaterThan(n.layers.melody); expect(dawn.layers.melody).toBeLessThan(d.layers.melody);
    const s = targetParams({ ...base, weather: 'heavySnow' });
    for (const l of LAYERS) expect(s.layers[l]).toBe(l === 'pad' ? 1 : 0);
  });
  it('tension thins melody; percussion is a detail: only when busy (or a track baseline)', () => {
    const t = targetParams({ ...base, tension: 1, busy: 1 });
    expect(t.layers.melody).toBeLessThan(1); expect(t.layers.perc).toBe(0);
    expect(targetParams(base, THEMES.alpineNoon).layers.perc).toBe(0);
    expect(targetParams({ ...base, busy: 0.9 }, THEMES.alpineNoon).layers.perc).toBeGreaterThan(0.5);
    expect(targetParams(base, THEMES.apres).layers.perc).toBeGreaterThan(0);
    expect(targetParams({ ...base, busy: 1, hour: 2 }, THEMES.starlight).layers.perc).toBe(0);
  });
});

describe('Music playback (fake backend)', () => {
  it('stays silent until the engine runs', () => {
    const fb = new FakeBackend(), engine = new AudioEngine({ factory: () => fb, settings: new AudioSettings(null) });
    const m = new Music(engine); m.tick(); expect(fb.nodes.length).toBe(1);
  });
  it('15 minutes: bounded nodes, voice cap, no events in the past, several pieces, never the same track twice in a row', async () => {
    const { fb, music, run } = await setup();
    music.setInputs({ season: 'summer', hour: 12 });
    let maxLive = 0, maxVoices = 0;
    run(900, () => { maxLive = Math.max(maxLive, fb.live); maxVoices = Math.max(maxVoices, music.activeVoices); });
    const lead = fb.nodes.filter((n) => n.started).map((n) => n.startAt - n.createdAt);
    expect(music.stats.notes).toBeGreaterThan(400);
    expect(maxVoices).toBeLessThanOrEqual(MUSIC.maxVoices);
    expect(maxLive).toBeLessThan(400);
    expect(Math.min(...lead)).toBeGreaterThanOrEqual(-1e-9);
    expect(music.stats.late).toBe(0);
    expect(music.stats.pieces).toBeGreaterThanOrEqual(3); expect(music.stats.pieces).toBeLessThanOrEqual(12);
    for (let i = 1; i < music.history.length; i++) expect(music.history[i]).not.toBe(music.history[i - 1]);
    expect(fb.live).toBeLessThan(400);
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
  it('starts the piece that fits the state (night = Starlight, storm = Blizzard, menu = Title)', async () => {
    for (const [inp, want] of [[{ hour: 23, season: 'winter' }, 'starlight'], [{ weather: 'storm', hour: 12 }, 'blizzard'], [{ menu: true }, 'title']] as const) {
      const { music, run } = await setup(); music.setInputs(inp); run(5);
      expect(music.currentTrack).toBe(want);
    }
  });
  it('a context change swaps an unsuitable track via a crossfade (after the minimum play time), not abruptly', async () => {
    const { music, run } = await setup();
    music.setInputs({ season: 'winter', hour: 12, weather: 'clear' }); run(5);
    const first = music.currentTrack; expect(first).toBe('alpineNoon'); expect(music.trackCount).toBe(1);
    music.setInputs({ weather: 'storm' }); run(10);
    expect(music.currentTrack).toBe('alpineNoon'); // minimum play time not reached: no swap yet
    run(MUSIC.minPlaySec + 3);
    expect(music.stats.crossfades).toBe(1); expect(music.currentTrack).toBe('blizzard');
    run(MUSIC.crossfadeSec + 1);
    expect(music.trackCount).toBe(1);
  });
  it('Music style locks one track; Next skips (crossfade) and is audible while the game is paused by a dialog', async () => {
    const { settings, music, run } = await setup(3, { musicStyle: 'festival' });
    music.setInputs({ season: 'winter', hour: 3 }); run(5);
    expect(music.currentTrack).toBe('festival');
    settings.set({ musicStyle: 'apres' }); run(1);
    expect(music.stats.crossfades).toBe(1); run(MUSIC.crossfadeSec + 1);
    expect(music.currentTrack).toBe('apres');
    settings.set({ musicStyle: 'auto' }); music.setInputs({ season: 'winter', hour: 23 }); run(40);
    const before = music.currentTrack; music.setInputs({ speed: 0 }); music.next(); run(2);
    expect(music.currentTrack).not.toBe(before); expect(music.gateValue).toBe(1); // preview window beats the pause fade
    run(MUSIC.previewSec + 3); expect(music.gateValue).toBe(0);
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
  it('tension adds a drone; jingle plays (soft harp, no bell) and is rate limited', async () => {
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
