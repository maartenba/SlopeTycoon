import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { Ambience, type AmbienceState } from '../../src/audio/Ambience';
import { Music } from '../../src/audio/Music';
import { MusicHandoff } from '../../src/audio/musicHold';
import { Sfx } from '../../src/audio/Sfx';
import { BAR_PLAYLIST, HANDOFF, MUSIC_PLAY } from '../../src/config/audioMusic';
import { FakeBackend, fakeMediaHooks, MemStorage } from './fakeBackend';

const run = (h: MusicHandoff, level: (t: number) => number, seconds: number, dt = 0.1): Array<{ t: number; phase: string }> => {
  const log: Array<{ t: number; phase: string }> = [];
  for (let t = 0; t <= seconds + 1e-9; t += dt) { h.update(level(t), t); log.push({ t, phase: h.phase }); }
  return log;
};

describe('music hand-off state machine (pure)', () => {
  it('walks main -> toApres -> apres -> toMain -> main with the configured fades', () => {
    const h = new MusicHandoff(); const log = run(h, (t) => (t < 10 ? 0.5 : 0), 60);
    const first = (p: string): number => log.find((x) => x.phase === p)!.t;
    expect(first('toApres')).toBeGreaterThanOrEqual(HANDOFF.enterDwell - 1e-9); expect(first('toApres')).toBeLessThan(1);
    expect(first('apres') - first('toApres')).toBeGreaterThanOrEqual(HANDOFF.mainFadeOut - 1e-9); expect(first('apres') - first('toApres')).toBeLessThan(HANDOFF.mainFadeOut + 0.2);
    expect(first('toMain')).toBeGreaterThanOrEqual(10 + HANDOFF.exitDwell - 0.15); expect(first('toMain') - first('apres')).toBeGreaterThanOrEqual(HANDOFF.minApresSec - 0.15); // a bar song keeps its minimum airtime
    expect(log.find((x) => x.t > first('toMain') && x.phase === 'main')!.t - first('toMain')).toBeGreaterThanOrEqual(HANDOFF.apresFadeOut - 1e-9);
    expect(h.phase).toBe('main'); expect(h.transitions).toBe(4);
  });
  it('hysteresis: a level hovering between the exit and enter thresholds never flips, and a quick zoom in / out does not start the bar music', () => {
    const h = new MusicHandoff();
    run(h, (t) => (HANDOFF.exitLevel + HANDOFF.enterLevel) / 2 + 0.02 * Math.sin(t * 5), 30); expect(h.transitions).toBe(0);
    const g = new MusicHandoff(); run(g, (t) => (Math.floor(t / 0.3) % 2 === 0 ? 0.6 : 0), 20); expect(g.transitions).toBe(0); // in for 0.3 s, out for 0.3 s: under the enter dwell
    // once in, a dip shorter than the exit dwell (or a level inside the band) keeps the bar music
    const k = new MusicHandoff(); const lg = run(k, (t) => (t > 8 && t < 8 + HANDOFF.exitDwell - 0.5 ? 0 : t > 15 ? (HANDOFF.exitLevel + HANDOFF.enterLevel) / 2 : 0.6), 40);
    expect(lg.filter((x) => x.phase === 'toMain').length).toBe(0); expect(k.phase).toBe('apres');
  });
  it('minimum dwell: no flip-flop even with a level that alternates every few seconds (at most one hand-off per min time)', () => {
    const h = new MusicHandoff(); const log = run(h, (t) => (Math.floor(t / 2.2) % 2 === 0 ? 0.6 : 0), 120);
    let last = -1e9, count = 0, prev = 'main'; for (const x of log) { if (x.phase !== prev) { if (x.phase === 'toApres' || x.phase === 'toMain') { expect(x.t - last).toBeGreaterThanOrEqual(Math.min(HANDOFF.minMainSec, HANDOFF.minApresSec) + HANDOFF.mainFadeOut - 0.2); last = x.t; count++; } prev = x.phase; } }
    expect(count).toBeLessThan(120 / 4); // far fewer switches than the 54 level flips
  });
  it('NEVER OVERLAP: the game-music envelope times the bar-music envelope is 0 at every instant, for random level walks', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const h = new MusicHandoff(); let x = seed * 0.37, lv = 0;
      for (let t = 0; t < 300; t += 0.05) {
        x = (x * 9301 + 49297) % 233280; if (Math.floor(t * 20) % 40 === 0) lv = (x / 233280) < 0.5 ? 0 : (x / 233280);
        if (Math.abs(t * 10 - Math.round(t * 10)) < 1e-6) h.update(lv, t);
        expect(h.mainEnvelope(t) * h.apresEnvelope(t), `t=${t} ${h.phase}`).toBe(0);
        expect(h.mainEnvelope(t)).toBeGreaterThanOrEqual(0); expect(h.mainEnvelope(t)).toBeLessThanOrEqual(1);
        if (h.mainScheduling) expect(h.apresScheduling).toBe(false);
      }
    }
  });
});

const base: AmbienceState = { season: 'winter', weather: 'clear', hour: 17, zoom: 8, altitude: 0.2, wind: 0, water: 0, crowd: 0, lifts: 0, buildings: 0, cows: 0, snowcat: 0, heli: 0 };
const flush = async (): Promise<void> => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
async function rig(dur = 200) {
  const fb = new FakeBackend(), settings = new AudioSettings(new MemStorage()), engine = new AudioEngine({ factory: () => fb, settings });
  await engine.onGesture();
  const mm = fakeMediaHooks({ dur }), mb = fakeMediaHooks({ dur });
  const handoff = new MusicHandoff(), music = new Music(engine, { handoff, rand: () => 0.3, player: mm.hooks }), amb = new Ambience(engine, new Sfx(engine), () => 0.5, handoff, { rand: () => 0.3, player: mb.hooks });
  music.setInputs({ season: 'winter', hour: 13, weather: 'clear' });
  const log: string[] = [];
  const step = async (sec: number, apres: number): Promise<void> => {
    for (let i = 0; i < Math.round(sec / 0.1); i++) {
      fb.t += 0.1; mm.advance(0.1); mb.advance(0.1); music.tick(); amb.update({ ...base, apres }, 0.1); await flush();
      // invariants: the game music only plays in main / toApres (the element is paused up to holdAfter after the phase left), the bar music only in apres / toMain
      const ph = handoff.phase;
      const slack = fb.t - handoff.since > MUSIC_PLAY.holdAfter + HANDOFF.apresFadeOut + 0.4; // after the fade the element idles until it is paused: silent
      if (slack && mb.playing.length && (ph === 'main' || ph === 'toApres')) log.push(`bar element playing in ${ph} at ${fb.t.toFixed(1)}`);
      if (slack && mm.playing.length && ph === 'toMain') log.push(`game element playing in toMain at ${fb.t.toFixed(1)}`);
      if (music.holdValue === 1 && amb.apres.gateValue === 1) log.push('both gates open');
    }
  };
  return { fb, music, amb, handoff, step, mm, mb, log };
}

describe('game music stops near the bar and resumes exactly (fake backend, fake media)', () => {
  it('fades out, pauses and holds its position while a bar track plays, never overlaps, and resumes the same track where it stopped', async () => {
    const { music, amb, handoff, step, mm, mb, log } = await rig();
    await step(20, 0);
    const track = music.currentTrack!; expect(track).toBe('winter-mountain-morning'); expect(music.holdValue).toBe(1);
    const el = mm.playing[0]!; expect(mb.fetched).toEqual([]);
    await step(0.5, 1); // the bar is in reach: its first song is fetched ahead, the game music is still on
    expect(handoff.phase).toBe('main'); expect(mb.fetched.length).toBeGreaterThan(0); expect(mm.playing.length).toBe(1);
    await step(15, 1);
    expect(handoff.phase).toBe('apres'); expect(music.holdValue).toBe(0); expect(amb.apres.isActive).toBe(true);
    expect(el.paused).toBe(true); const held = el.currentTime; expect(mm.playing.length).toBe(0);
    expect(mb.playing.length).toBe(1); expect(BAR_PLAYLIST).toContain(amb.apres.currentTrack!); expect(mb.fetched[0]).toMatch(/apres-.*\.mp3$/);
    await step(10, 1); expect(el.currentTime).toBe(held); // frozen while the bar plays
    await step(10, 0);
    expect(handoff.phase).toBe('main'); expect(amb.apres.isActive).toBe(false); expect(mb.playing.length).toBe(0);
    await step(3, 0);
    expect(music.currentTrack).toBe(track); expect(el.paused).toBe(false); expect(el.currentTime).toBeGreaterThanOrEqual(held); expect(el.currentTime).toBeLessThan(held + 13);
    expect(log).toEqual([]);
  });
  it('coming back to the bar soon resumes the same song; after a long absence the next song of the rotation plays', async () => {
    const { amb, step, log } = await rig(200);
    await step(15, 1); const first = amb.apres.currentTrack!; expect(first).toBeTruthy(); expect(amb.apres.history).toEqual([first]);
    await step(10, 0); await step(5, 1); expect(amb.apres.history).toEqual([first]); expect(amb.apres.currentTrack).toBe(first); // away for ~10 s: same song, where it stopped
    await step(15, 0); await step(40, 0); await step(8, 1);
    expect(amb.apres.history.length).toBe(2); expect(amb.apres.currentTrack).not.toBe(first);
    expect(log).toEqual([]);
  });
  it('short songs: the next one crossfades in before the end, songs alternate and the same one never plays twice in a row', async () => {
    const { amb, step, log } = await rig(20);
    await step(100, 1);
    const h = amb.apres.history; expect(h.length).toBeGreaterThanOrEqual(5); for (let i = 1; i < h.length; i++) expect(h[i]).not.toBe(h[i - 1]);
    expect(new Set(h).size).toBeGreaterThanOrEqual(2); expect(log).toEqual([]);
  });
  it('hold gain is ramped (linear fade-out ~0.7 s, fade-in ~0.9 s), never switched', async () => {
    const { music, step } = await rig();
    await step(10, 0);
    const hold = (music as unknown as { hold: { gain: { calls: string[] } } }).hold.gain, c0 = hold.calls.length;
    await step(6, 1); const out = hold.calls.slice(c0); expect(out).toContain('lin'); expect(out.filter((c) => c === 'set').length).toBeLessThanOrEqual(3);
    const c1 = hold.calls.length; await step(14 + HANDOFF.minApresSec, 0); expect(hold.calls.slice(c1)).toContain('lin');
  });
  it('a bar that is out of reach never stops the game music, and with no media support (offline renderer) nothing is fetched', async () => {
    const { music, step, handoff, mb } = await rig();
    await step(10, 0); expect(handoff.transitions).toBe(0); expect(music.holdValue).toBe(1); expect(mb.fetched).toEqual([]);
  });
});
