import { describe, expect, it } from 'vitest';
import { AUDIO_STORAGE_KEY, AudioSettings, DEFAULT_AUDIO_SETTINGS, busGains, parseSettings } from '../../src/audio/AudioSettings';
import { MemStorage } from './fakeBackend';

describe('AudioSettings', () => {
  it('defaults: master .7, music .5, sfx .8, ambience .45, not muted', () => {
    expect(new AudioSettings(new MemStorage()).get()).toEqual({ master: 0.7, music: 0.5, sfx: 0.8, ambience: 0.45, muted: false, reduceLoud: false, ambienceOnly: false, musicOn: true, pauseMusicAtZero: true, muteMusicInMenus: false });
  });
  it('persists under slope.audio.v1 and round-trips', () => {
    const st = new MemStorage();
    const a = new AudioSettings(st);
    a.set({ master: 0.3, sfx: 0.1, muted: true, reduceLoud: true, ambienceOnly: true });
    expect(st.m.has('slope.audio.v1')).toBe(true);
    expect(AUDIO_STORAGE_KEY).toBe('slope.audio.v1');
    const b = new AudioSettings(st);
    expect(b.get()).toEqual({ ...DEFAULT_AUDIO_SETTINGS, master: 0.3, sfx: 0.1, muted: true, reduceLoud: true, ambienceOnly: true });
  });
  it('clamps values and survives corrupt / hostile storage', () => {
    const a = new AudioSettings(new MemStorage());
    a.set({ master: 5, music: -1 });
    expect(a.get().master).toBe(1); expect(a.get().music).toBe(0);
    expect(parseSettings('{not json')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseSettings('{"master":"loud","muted":3}')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_AUDIO_SETTINGS);
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    const t = new AudioSettings(throwing);
    expect(() => t.set({ master: 0.2 })).not.toThrow();
    expect(t.get().master).toBe(0.2);
    expect(new AudioSettings(null).get().master).toBe(0.7);
  });
  it('notifies subscribers only on change; toggleMute', () => {
    const a = new AudioSettings(null); let n = 0;
    const off = a.subscribe(() => n++);
    a.set({ master: 0.7 }); expect(n).toBe(0);
    a.set({ master: 0.6 }); expect(n).toBe(1);
    expect(a.toggleMute()).toBe(true); expect(n).toBe(2);
    off(); a.toggleMute(); expect(n).toBe(2);
  });
  it('busGains: mute zeroes, ambience-only silences sfx+music, reduce-loud lowers master', () => {
    const d = DEFAULT_AUDIO_SETTINGS;
    expect(busGains({ ...d, muted: true })).toEqual({ master: 0, music: 0, sfx: 0, ambience: 0 });
    const ao = busGains({ ...d, ambienceOnly: true });
    expect(ao.sfx).toBe(0); expect(ao.music).toBe(0); expect(ao.ambience).toBe(0.45);
    expect(busGains({ ...d, reduceLoud: true }).master).toBeLessThan(busGains(d).master);
  });
});

describe('legacy ambience default migration', () => {
  it('persisted ambience exactly 0.7 -> new default; other values untouched', () => {
    expect(parseSettings(JSON.stringify({ ambience: 0.7 })).ambience).toBe(0.45);
    expect(parseSettings(JSON.stringify({ ambience: 0.69 })).ambience).toBe(0.69);
    expect(parseSettings(JSON.stringify({ ambience: 0.9 })).ambience).toBe(0.9);
  });
});
