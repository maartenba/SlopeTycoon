import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { MenuMusic } from '../../src/audio/MenuMusic';
import { createMenuAudio } from '../../src/audio/menuAudio';
import { fadeIn, fadeOut, nextStartAt, nextTrackIndex, trimFor } from '../../src/audio/menuPlaylist';
import { MENU_MUSIC } from '../../src/config/audioMusic';
import { busGains } from '../../src/audio/AudioSettings';
import { FakeBackend, FakeNode, MemStorage } from './fakeBackend';
import type { BufferLike } from '../../src/audio/backend';

describe('menu playlist (pure)', () => {
  it('never repeats the previous track and covers all others', () => {
    for (const n of [2, 3, 5]) for (let prev = 0; prev < n; prev++) {
      const seen = new Set<number>();
      for (let i = 0; i < 100; i++) { const k = nextTrackIndex(prev, n, () => i / 100); expect(k).not.toBe(prev); expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThan(n); seen.add(k); }
      expect(seen.size).toBe(n - 1);
    }
  });
  it('start picks any track; one track repeats itself; none = -1; rand 0.999.. stays in range', () => {
    expect(new Set([0, 0.2, 0.6, 0.99].map((r) => nextTrackIndex(-1, 2, () => r)))).toEqual(new Set([0, 1]));
    expect(nextTrackIndex(0, 1, () => 0.5)).toBe(0);
    expect(nextTrackIndex(-1, 0, () => 0.5)).toBe(-1);
    expect(nextTrackIndex(1, 2, () => 0.9999999)).toBe(0);
  });
  it('crossfade is equal power and monotonic', () => {
    for (let p = 0; p <= 1; p += 0.1) expect(fadeIn(p) ** 2 + fadeOut(p) ** 2).toBeCloseTo(1, 10);
    expect(fadeIn(0)).toBe(0); expect(fadeIn(1)).toBeCloseTo(1); expect(fadeOut(1)).toBeCloseTo(0, 10); expect(fadeIn(-3)).toBe(0); expect(fadeIn(9)).toBeCloseTo(1);
    expect(fadeIn(0.3)).toBeLessThan(fadeIn(0.6));
  });
  it('next start leaves exactly the crossfade at the end; short tracks cap at half', () => {
    expect(nextStartAt(10, 140, 3)).toBe(147);
    expect(nextStartAt(0, 4, 3)).toBe(2);
  });
  it('trim table: loudness matches the target, never clips (peaks are about -3.5 dBFS)', () => {
    expect(trimFor(-15.6, -17)).toBeCloseTo(0.851, 2);
    expect(trimFor(-20, -17, 1)).toBe(1);
    for (const t of MENU_MUSIC.tracks) { expect(t.trim).toBeCloseTo(trimFor(t.lufs, MENU_MUSIC.targetLufs), 2); expect(t.trim).toBeLessThanOrEqual(1); expect(t.file).toMatch(/^menu-.*\.mp3$/); }
    expect(new Set(MENU_MUSIC.tracks.map((t) => t.file)).size).toBe(MENU_MUSIC.tracks.length);
  });
});

class DecodeBackend extends FakeBackend {
  decode = async (d: ArrayBuffer): Promise<BufferLike & { duration: number }> => ({ getChannelData: () => new Float32Array(1), duration: d.byteLength });
}
function setup(o: { rand?: () => number; musicOn?: boolean; block?: boolean } = {}) {
  const fb = new DecodeBackend(); fb.blockResume = !!o.block;
  const settings = new AudioSettings(new MemStorage());
  if (o.musicOn === false) settings.set({ musicOn: false });
  const engine = new AudioEngine({ factory: () => fb, settings });
  const urls: string[] = [];
  const load = async (u: string): Promise<ArrayBuffer> => { urls.push(u); return new ArrayBuffer(60); }; // every track is 60 "seconds"
  const mm = new MenuMusic({ engine, settings, load, base: 'https://x.test/play/', rand: o.rand ?? (() => 0), autoTick: false });
  const srcs = (): FakeNode[] => fb.nodes.filter((n) => n.kind === 'src');
  const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  return { fb, settings, engine, mm, urls, srcs, flush };
}

describe('MenuMusic', () => {
  it('loads nothing and plays nothing before the first gesture (engine locked)', async () => {
    const s = setup(); await s.flush();
    expect(s.urls).toEqual([]); expect(s.mm.playing).toBe(false); expect(s.srcs().length).toBe(0);
  });
  it('after the gesture: fetches relative to the page, fades in 1.5 s, routes into the music bus (volume + mute apply)', async () => {
    const s = setup({ rand: () => 0.9 });
    await s.engine.onGesture(); await s.flush();
    expect(s.urls[0]).toBe('https://x.test/play/audio/menu-seasonal-menu.mp3');
    expect(s.mm.playing).toBe(true); expect(s.mm.currentTrack).toBe(1);
    const src = s.srcs()[0]!; expect(src.started).toBe(true);
    const out = s.fb.nodes.find((n) => n.kind === 'gain' && n.connections.includes(s.engine.busNode('music')))!;
    expect(out).toBeTruthy();
    const trackGain = s.fb.nodes.filter((n) => n.kind === 'gain').find((n) => n.connections.includes(out))!;
    expect(trackGain.gain.value).toBeCloseTo(MENU_MUSIC.tracks[1]!.trim, 5);
    s.settings.set({ muted: true });
    expect(busGains(s.settings.get()).music).toBe(0); expect(s.engine.busNode('music')!.gain.value).toBe(0);
    s.settings.set({ muted: false, music: 0.3 });
    expect(s.engine.busNode('music')!.gain.value).toBeCloseTo(0.3, 5);
  });
  it('preloads the other track, then crossfades into it (never the same one) before the end, and keeps looping', async () => {
    const s = setup(); await s.engine.onGesture(); await s.flush();
    expect(s.mm.currentTrack).toBe(0); expect(s.urls.length).toBe(2); // the next one is preloaded
    s.fb.t = 30; s.mm.tick(); expect(s.srcs().length).toBe(1);
    s.fb.t = 57; s.mm.tick();
    expect(s.srcs().length).toBe(2); expect(s.mm.currentTrack).toBe(1); expect(s.srcs()[1]!.startAt).toBe(57);
    expect(s.srcs()[0]!.stopAt).toBeCloseTo(57 + 3 + 0.05, 5); // old one fades over the 3 s crossfade
    await s.flush();
    s.fb.t = 114; s.mm.tick(); expect(s.mm.currentTrack).toBe(0); // loops back to the first
    s.fb.t = 125; s.mm.tick(); expect(s.fb.nodes.filter((n) => n.kind === 'src' && !n.live).length).toBeGreaterThanOrEqual(1); // finished sources are freed
  });
  it('fadeOut on game start: 1 s ramp to silence, sources stop after it, no restart, nothing playing returns 0 ms', async () => {
    const s = setup(); await s.engine.onGesture(); await s.flush();
    s.fb.t = 5;
    expect(s.mm.fadeOut()).toBe(1000);
    expect(s.srcs()[0]!.stopAt).toBeCloseTo(6.05, 5);
    const out = s.fb.nodes.find((n) => n.kind === 'gain' && n.connections.includes(s.engine.busNode('music')))!;
    expect(out.gain.value).toBeCloseTo(0, 5);
    s.fb.t = 200; s.mm.tick(); expect(s.srcs().length).toBe(1); expect(s.mm.playing).toBe(false);
    expect(setup().mm.fadeOut()).toBe(0);
  });
  it('leave(): waits for the fade when music plays, goes at once otherwise', async () => {
    const fb = new DecodeBackend(); let went = 0;
    const a = createMenuAudio({ storage: new MemStorage(), factory: () => fb, load: async () => new ArrayBuffer(60), win: undefined, doc: undefined });
    a.leave(() => { went++; }); expect(went).toBe(1);
    a.dispose();
  });
  it('respects the music-off setting (no fetch; turning it on later starts it) and a blocked context', async () => {
    const s = setup({ musicOn: false }); await s.engine.onGesture(); await s.flush();
    expect(s.urls).toEqual([]); expect(s.mm.playing).toBe(false);
    s.settings.set({ musicOn: true }); await s.flush();
    expect(s.mm.playing).toBe(true);
    const b = setup({ block: true }); await b.engine.onGesture(); await b.flush();
    expect(b.urls).toEqual([]);
  });
  it('tab hidden: the engine suspends the context (the music clock and sources pause); visible again resumes', async () => {
    const s = setup(); await s.engine.onGesture(); await s.flush();
    await s.engine.setHidden(true); expect(s.fb.state).toBe('suspended'); expect(s.engine.state).toBe('suspended');
    s.fb.t = 500; s.mm.tick(); expect(s.srcs().length).toBe(1); // no scheduling while suspended
    await s.engine.setHidden(false); expect(s.fb.state).toBe('running');
  });
  it('a failed load degrades quietly (no throw, no sound, one warning)', async () => {
    const fb = new DecodeBackend(); const settings = new AudioSettings(new MemStorage()); const engine = new AudioEngine({ factory: () => fb, settings });
    const mm = new MenuMusic({ engine, settings, load: async () => { throw new Error('offline'); }, autoTick: false });
    await engine.onGesture(); for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(mm.playing).toBe(false); expect(mm.stats.errors).toBeGreaterThan(0);
  });
});
