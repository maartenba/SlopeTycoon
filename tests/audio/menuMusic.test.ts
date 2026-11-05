import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, } from '../../src/audio/AudioEngine';
import { AudioSettings, busGains } from '../../src/audio/AudioSettings';
import { MenuMusic } from '../../src/audio/MenuMusic';
import { createMenuAudio } from '../../src/audio/menuAudio';
import { MENU_PLAYLIST, TRACK_BY_ID } from '../../src/config/audioMusic';
import { FakeBackend, fakeMediaHooks, MemStorage, type FakeNode } from './fakeBackend';

const flush = async (): Promise<void> => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function setup(o: { rand?: () => number; musicOn?: boolean; block?: boolean; fail?: () => boolean } = {}) {
  const fb = new FakeBackend(); fb.blockResume = !!o.block;
  const settings = new AudioSettings(new MemStorage());
  if (o.musicOn === false) settings.set({ musicOn: false });
  const engine = new AudioEngine({ factory: () => fb, settings });
  const m = fakeMediaHooks({ dur: 60, ...(o.fail ? { fail: o.fail } : {}) });
  const mm = new MenuMusic({ engine, settings, player: m.hooks, rand: o.rand ?? (() => 0), autoTick: false });
  const run = async (sec: number): Promise<void> => { for (let i = 0; i < Math.round(sec / 0.25); i++) { fb.t += 0.25; m.advance(0.25); mm.tick(); await flush(); } };
  return { fb, settings, engine, mm, m, run };
}

describe('MenuMusic', () => {
  it('loads nothing and plays nothing before the first gesture (engine locked)', async () => {
    const s = setup(); await flush();
    expect(s.m.fetched).toEqual([]); expect(s.mm.playing).toBe(false); expect(s.m.all.length).toBe(0);
  });
  it('after the gesture: Seasons of Management (the title theme) opens, fetched relative to the page, fades in, routes into the music bus (volume + mute apply)', async () => {
    const s = setup({ rand: () => 0.9 });
    await s.engine.onGesture(); await flush();
    expect(s.m.fetched[0]).toBe('https://x.test/play/audio/menu-seasons-of-management.mp3');
    expect(s.mm.playing).toBe(true); expect(s.mm.currentTrack).toBe('seasons-of-management');
    const out = s.fb.nodes.find((n) => n.kind === 'gain' && n.connections.includes(s.engine.busNode('music')))!; expect(out).toBeTruthy();
    const trackGain = (s.fb.nodes.filter((n) => n.kind === 'gain') as FakeNode[]).find((n) => n.connections.includes(out))!;
    expect(trackGain.gain.value).toBeCloseTo(TRACK_BY_ID.get('seasons-of-management')!.trim, 5);
    expect(s.m.playing.length).toBe(1);
    s.settings.set({ muted: true });
    expect(busGains(s.settings.get()).music).toBe(0); expect(s.engine.busNode('music')!.gain.value).toBe(0);
    s.settings.set({ muted: false, music: 0.3 });
    expect(s.engine.busNode('music')!.gain.value).toBeCloseTo(0.3, 5);
  });
  it('preloads the other track, then crossfades into it (never the same one) before the end, and keeps looping', async () => {
    const s = setup(); await s.engine.onGesture(); await flush();
    expect(s.mm.currentTrack).toBe(MENU_PLAYLIST[0]); expect(s.m.fetched.length).toBe(2); // the next one is preloaded
    await s.run(30); expect(s.m.all.length).toBe(2); expect(s.mm.currentTrack).toBe(MENU_PLAYLIST[0]);
    await s.run(30); expect(s.mm.currentTrack).toBe(MENU_PLAYLIST[1]);
    await s.run(60); expect(s.mm.currentTrack).toBe(MENU_PLAYLIST[0]); // loops back to the first
    expect(s.m.playing.length).toBeLessThanOrEqual(2);
  });
  it('fadeOut on game start: 1 s ramp to silence, then the track is dropped; no restart; nothing playing returns 0 ms', async () => {
    const s = setup(); await s.engine.onGesture(); await flush();
    await s.run(5);
    expect(s.mm.fadeOut()).toBe(1000);
    const out = s.fb.nodes.find((n) => n.kind === 'gain' && n.connections.includes(s.engine.busNode('music')))!;
    expect(out.gain.value).toBeCloseTo(0, 5);
    await s.run(10); expect(s.mm.playing).toBe(false); expect(s.m.playing.length).toBe(0);
    expect(setup().mm.fadeOut()).toBe(0);
  });
  it('leave(): goes at once when nothing plays', async () => {
    const fb = new FakeBackend(); let went = 0;
    const a = createMenuAudio({ storage: new MemStorage(), factory: () => fb, win: undefined, doc: undefined });
    a.leave(() => { went++; }); expect(went).toBe(1);
    a.dispose();
  });
  it('respects the music-off setting (no fetch; turning it on later starts it) and a blocked context', async () => {
    const s = setup({ musicOn: false }); await s.engine.onGesture(); await flush();
    expect(s.m.fetched).toEqual([]); expect(s.mm.playing).toBe(false);
    s.settings.set({ musicOn: true }); await flush();
    expect(s.mm.playing).toBe(true);
    const b = setup({ block: true }); await b.engine.onGesture(); await flush();
    expect(b.m.fetched).toEqual([]);
  });
  it('tab hidden: the element pauses where it is and continues from there when visible again', async () => {
    const s = setup(); await s.engine.onGesture(); await flush(); await s.run(5);
    const el = s.m.playing[0]!, pos = el.currentTime; expect(pos).toBeGreaterThan(4);
    await s.engine.setHidden(true); expect(s.engine.state).toBe('suspended'); expect(el.paused).toBe(true);
    s.fb.t += 300; s.mm.tick(); expect(el.currentTime).toBe(pos);
    await s.engine.setHidden(false); expect(el.paused).toBe(false); expect(el.currentTime).toBe(pos);
  });
  it('a failed load degrades quietly (no throw, no sound, one warning)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const s = setup({ fail: () => true }); await s.engine.onGesture(); await flush();
      expect(s.mm.playing).toBe(false); expect(s.mm.stats.errors).toBeGreaterThan(0); expect(warn.mock.calls.length).toBe(1);
    } finally { warn.mockRestore(); }
  });
});
