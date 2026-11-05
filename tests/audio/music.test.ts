import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { Music } from '../../src/audio/Music';
import { MUSIC_PLAY, PLAYLISTS, SITUATION, TRACK_BY_ID } from '../../src/config/audioMusic';
import { FakeBackend, fakeMediaHooks, MemStorage, type FakeNode } from './fakeBackend';

const flush = async (): Promise<void> => { for (let i = 0; i < 25; i++) await Promise.resolve(); };

async function rig(o: { dur?: number; fail?: (src: string) => boolean; locked?: boolean; settings?: Record<string, unknown> } = {}) {
  const fb = new FakeBackend(), settings = new AudioSettings(new MemStorage());
  if (o.settings) settings.set(o.settings as never);
  const engine = new AudioEngine({ factory: () => fb, settings });
  const m = fakeMediaHooks({ ...(o.dur ? { dur: o.dur } : {}), ...(o.fail ? { fail: o.fail } : {}) });
  let x = 3; const rand = (): number => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  const music = new Music(engine, { rand, player: m.hooks });
  if (!o.locked) await engine.onGesture();
  /** Advance `sec` of game time in 0.25 s steps (clock, playing elements, scheduler). */
  const run = async (sec: number): Promise<void> => { for (let i = 0; i < Math.round(sec / 0.25); i++) { fb.t += 0.25; m.advance(0.25); music.tick(); await flush(); } };
  return { fb, settings, engine, m, music, run };
}
const files = (urls: string[]): string[] => urls.map((u) => u.split('/').pop()!);

describe('Music (mp3 player, fake media)', () => {
  it('fetches nothing and plays nothing before the first gesture; starts after the gesture + start delay, relative to the page', async () => {
    const r = await rig({ locked: true }); r.music.tick(); await flush();
    expect(r.m.fetched).toEqual([]); expect(r.music.currentTrack).toBeNull();
    await r.engine.onGesture(); await r.run(1); expect(r.music.currentTrack).toBeNull(); // within the start delay
    await r.run(MUSIC_PLAY.startDelay + 1);
    expect(r.music.currentTrack).toBeTruthy(); expect(r.m.fetched[0]).toMatch(/^https:\/\/x\.test\/play\/audio\/game-.*\.mp3$/);
    expect(r.music.situation).toBe('winter-morning'); expect(PLAYLISTS['winter-morning']).toContain(r.music.currentTrack!);
  });
  it('plays a track of the situation through track gain (trim) -> hold -> gate -> music bus', async () => {
    const r = await rig(); r.music.setInputs({ season: 'winter', hour: 13, busy: 0.8 });
    await r.run(8);
    const id = r.music.currentTrack!; expect(id).toBe('winter-day');
    const g = r.fb.nodes.filter((n) => n.kind === 'gain') as FakeNode[];
    const gate = g.find((n) => n.connections.includes(r.engine.busNode('music')))!; const hold = g.find((n) => n.connections.includes(gate))!;
    const trackGain = g.find((n) => n.connections.includes(hold))!;
    expect(trackGain.gain.value).toBeCloseTo(TRACK_BY_ID.get(id)!.trim, 5);
    expect(gate.gain.value).toBe(1); expect(r.m.playing.length).toBe(1);
    r.settings.set({ music: 0.3 }); expect(r.engine.busNode('music')!.gain.value).toBeCloseTo(0.3, 5);
  });
  it('preloads the next track, crossfades near the end (never the same track), and keeps going', async () => {
    const r = await rig({ dur: 60 }); r.music.setInputs({ season: 'winter', hour: 8 });
    await r.run(10); const first = r.music.currentTrack!; expect(r.m.fetched.length).toBe(2); // the next is preloaded
    await r.run(40); expect(r.music.currentTrack).toBe(first); expect(r.m.playing.length).toBe(1);
    await r.run(12); expect(r.music.currentTrack).not.toBe(first); expect(r.m.playing.length).toBeGreaterThanOrEqual(1);
    await r.run(80); const hist = r.music.history; expect(hist.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < hist.length; i++) expect(hist[i]).not.toBe(hist[i - 1]);
    expect(r.music.stats.crossfades).toBeGreaterThanOrEqual(2);
  });
  it('hysteresis: the hour ticking over mid-song does not switch; the next track then comes from the new situation', async () => {
    const r = await rig({ dur: 60 }); r.music.setInputs({ season: 'winter', hour: 10.9, busy: 0.9 });
    await r.run(8); const first = r.music.currentTrack!; expect(PLAYLISTS['winter-morning']).toContain(first);
    r.music.setInputs({ hour: 11.2 }); await r.run(30);
    expect(r.music.situation).toBe('winter-day'); expect(r.music.currentTrack).toBe(first); expect(r.music.stats.crossfades).toBe(0);
    await r.run(30); expect(r.music.currentTrack).not.toBe(first); expect(PLAYLISTS['winter-day'].concat(PLAYLISTS['winter-morning'])).toContain(r.music.currentTrack!);
  });
  it('a storm cuts in with one crossfade after it settles, at most once per minChangeGap even when it flickers', async () => {
    const r = await rig({ dur: 200 }); r.music.setInputs({ season: 'winter', hour: 13, busy: 0.9 });
    await r.run(8); expect(r.music.currentTrack).toBe('winter-day');
    r.music.setInputs({ weather: 'storm' }); await r.run(SITUATION.settleSec - 5); expect(r.music.currentTrack).toBe('winter-day'); // not yet settled
    await r.run(12); expect(r.music.currentTrack).toBe('storm-tente-restringida'); expect(r.music.stats.crossfades).toBe(1);
    for (let i = 0; i < 6; i++) { r.music.setInputs({ weather: i % 2 ? 'storm' : 'clear' }); await r.run(SITUATION.settleSec + 2); }
    expect(r.music.stats.crossfades).toBeLessThanOrEqual(1 + Math.ceil(6 * (SITUATION.settleSec + 2) / SITUATION.minChangeGapSec));
  });
  it('mute / ambience-only / speed 0 fade to silence then PAUSE the element; resuming continues at the same position', async () => {
    const r = await rig({ dur: 200 }); r.music.setInputs({ season: 'summer', hour: 13 });
    await r.run(10); const el = r.m.playing[0]!; const pos = el.currentTime;
    r.settings.set({ muted: true }); await r.run(3); expect(r.music.gateValue).toBe(0); expect(el.paused).toBe(true);
    const frozen = el.currentTime; await r.run(5); expect(el.currentTime).toBe(frozen); expect(frozen).toBeGreaterThanOrEqual(pos);
    r.settings.set({ muted: false }); await r.run(2); expect(el.paused).toBe(false); expect(el.currentTime).toBeGreaterThanOrEqual(frozen);
    expect(el.currentTime).toBeLessThan(frozen + 3);
    r.music.setInputs({ speed: 0 }); await r.run(3); expect(el.paused).toBe(true);
    r.music.setInputs({ speed: 1 }); await r.run(2); expect(el.paused).toBe(false);
    r.settings.set({ ambienceOnly: true }); await r.run(3); expect(el.paused).toBe(true);
    r.settings.set({ ambienceOnly: false, musicOn: false }); await r.run(3); expect(el.paused).toBe(true);
    r.settings.set({ musicOn: true }); await r.run(2); expect(el.paused).toBe(false);
  });
  it('"Next track" crossfades to another track of the situation and stays audible for a while at speed 0', async () => {
    const r = await rig({ dur: 200 }); r.music.setInputs({ season: 'winter', hour: 8, speed: 0 });
    await r.run(8); r.music.setInputs({ speed: 1 }); await r.run(2); const first = r.music.currentTrack!;
    r.music.setInputs({ speed: 0 }); r.music.next(); await r.run(6);
    expect(r.music.currentTrack).not.toBe(first); expect(r.m.playing.length).toBeGreaterThanOrEqual(1); expect(r.music.gateValue).toBe(1);
  });
  it('tab hidden: the elements pause (position kept) and continue when visible again', async () => {
    const r = await rig({ dur: 200 }); await r.run(8); const el = r.m.playing[0]!; await r.run(2); const pos = el.currentTime;
    await r.engine.setHidden(true); expect(el.paused).toBe(true);
    r.fb.t += 50; r.music.tick(); await flush(); expect(el.currentTime).toBe(pos);
    await r.engine.setHidden(false); expect(el.paused).toBe(false); expect(el.currentTime).toBe(pos);
  });
  it('a track that cannot load is skipped for the next candidate; when every track fails: silence, one console warning, no throw, retries later', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const a = await rig({ fail: (s) => s.includes('mountain-morning') }); a.music.setInputs({ season: 'winter', hour: 8 }); await a.run(10);
      expect(a.music.currentTrack).toBe('winter-early-slopes'); expect(a.music.stats.failures + a.m.fetched.length).toBeGreaterThan(0);
      warn.mockClear(); const b = await rig({ fail: () => true }); await b.run(30);
      expect(b.music.currentTrack).toBeNull(); expect(b.m.playing.length).toBe(0);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('unavailable')).length).toBe(1);
      const before = b.m.fetched.length; await b.run(MUSIC_PLAY.failBackoffSec + 5); expect(b.m.fetched.length).toBeGreaterThan(before);
    } finally { warn.mockRestore(); }
  });
  it('the engine not running (blocked / locked): the scheduler does nothing', async () => {
    const r = await rig({ locked: true }); await r.run(20); expect(r.m.fetched).toEqual([]);
    expect(files(r.m.fetched)).toEqual([]);
  });
  it('dispose frees every element', async () => {
    const r = await rig(); await r.run(8); r.music.dispose(); expect(r.m.playing.length).toBe(0);
  });
});
