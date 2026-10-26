import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, PRIORITY } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { RECIPES, RateLimiter, Sfx, SFX_NAMES } from '../../src/audio/Sfx';
import { FakeBackend, MemStorage } from './fakeBackend';

function setup(opts: { block?: boolean; maxVoices?: number } = {}) {
  const fb = new FakeBackend();
  fb.blockResume = !!opts.block;
  const settings = new AudioSettings(new MemStorage());
  const engine = new AudioEngine({ factory: () => fb, settings, maxVoices: opts.maxVoices });
  return { fb, settings, engine, sfx: new Sfx(engine) };
}

describe('AudioEngine state machine', () => {
  it('stays locked (no context, no nodes) until a gesture', async () => {
    const { fb, engine, sfx } = setup();
    expect(engine.state).toBe('locked');
    expect(engine.needsHint).toBe(true);
    expect(sfx.play('click')).toBe(false);
    expect(fb.nodes.length).toBe(1); // only the fake destination; no context graph yet
  });
  it('gesture -> running; buses wired through compressor', async () => {
    const { fb, engine } = setup();
    await engine.onGesture();
    expect(engine.state).toBe('running');
    expect(engine.needsHint).toBe(false);
    expect(fb.liveOf('comp')).toBe(1);
    expect(engine.busNode('sfx')).not.toBeNull();
  });
  it('autoplay blocked: state=blocked + hint; a later gesture retries and succeeds', async () => {
    const { fb, engine, sfx } = setup({ block: true });
    await engine.onGesture();
    expect(engine.state).toBe('blocked');
    expect(engine.needsHint).toBe(true);
    expect(sfx.play('click')).toBe(false);
    fb.blockResume = false;
    await engine.onGesture();
    expect(engine.state).toBe('running');
    expect(sfx.play('click')).toBe(true);
  });
  it('unsupported (factory returns null / throws): silent no-op, no console errors', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const factory of [() => null, () => { throw new Error('nope'); }]) {
      const engine = new AudioEngine({ factory, settings: new AudioSettings(null) });
      const sfx = new Sfx(engine);
      await engine.onGesture();
      expect(['unsupported', 'blocked']).toContain(engine.state);
      expect(sfx.play('thud')).toBe(false);
      expect(engine.createLayer('ambience', () => {})).toBeNull();
      await engine.setHidden(true);
      sfx.update();
      engine.dispose();
    }
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    err.mockRestore(); warn.mockRestore();
  });
  it('null factory -> unsupported exactly', async () => {
    const engine = new AudioEngine({ factory: () => null, settings: new AudioSettings(null) });
    await engine.onGesture();
    expect(engine.state).toBe('unsupported');
  });
  it('tab hidden suspends, visible resumes', async () => {
    const { fb, engine } = setup();
    await engine.onGesture();
    await engine.setHidden(true);
    expect(engine.state).toBe('suspended');
    expect(fb.suspendCalls).toBe(1);
    await engine.setHidden(false);
    expect(engine.state).toBe('running');
  });
  it('mute and volumes drive bus gains (smoothly via setTargetAtTime)', async () => {
    const { fb, engine, settings } = setup();
    await engine.onGesture();
    const sfxBus = engine.busNode('sfx') as unknown as { gain: { value: number; calls: string[] } };
    settings.set({ sfx: 0.5, master: 1 });
    expect(sfxBus.gain.value).toBeCloseTo(0.5);
    expect(sfxBus.gain.calls.at(-1)).toBe('target');
    settings.set({ muted: true });
    expect(sfxBus.gain.value).toBe(0);
    settings.set({ muted: false, ambienceOnly: true });
    expect(sfxBus.gain.value).toBe(0);
    expect((engine.busNode('ambience') as unknown as { gain: { value: number } }).gain.value).toBeCloseTo(0.45);
    void fb;
  });
  it('attach(): first pointerdown unlocks and listeners are removed after success', async () => {
    const { engine } = setup();
    const handlers = new Map<string, Array<(e?: unknown) => void>>();
    const win = { addEventListener: (t: string, h: (e?: unknown) => void) => { handlers.set(t, [...(handlers.get(t) ?? []), h]); }, removeEventListener: (t: string, h: (e?: unknown) => void) => { handlers.set(t, (handlers.get(t) ?? []).filter((x) => x !== h)); } };
    const doc = { hidden: false, addEventListener: win.addEventListener, removeEventListener: win.removeEventListener };
    const off = engine.attach(win as never, doc as never);
    handlers.get('pointerdown')![0]!();
    await vi.waitFor(() => expect(engine.state).toBe('running'));
    expect(handlers.get('pointerdown')!.length).toBe(0);
    off();
  });
});

describe('voice pool', () => {
  it('never exceeds maxVoices; same-priority overflow is rejected', async () => {
    const { engine } = setup({ maxVoices: 4 });
    await engine.onGesture();
    for (let i = 0; i < 4; i++) expect(engine.startVoice('x', PRIORITY.action, 5, 'sfx', (s) => { s.osc('sine', 440).connect(s.out); })).not.toBeNull();
    expect(engine.startVoice('y', PRIORITY.action, 5, 'sfx', () => {})).toBeNull();
    expect(engine.voiceCount).toBe(4);
    expect(engine.stats.rejected).toBe(1);
  });
  it('higher priority steals the lowest-priority (oldest) voice; alerts are never stolen by ambience', async () => {
    const { fb, engine } = setup({ maxVoices: 3 });
    await engine.onGesture();
    const a = engine.startVoice('amb', PRIORITY.ambience, 5, 'ambience', () => {})!;
    fb.t = 0.1;
    const b = engine.startVoice('act', PRIORITY.action, 5, 'sfx', () => {})!;
    const c = engine.startVoice('alert', PRIORITY.alert, 5, 'sfx', () => {})!;
    const d = engine.startVoice('alert2', PRIORITY.alert, 5, 'sfx', () => {});
    expect(d).not.toBeNull();
    expect(a.dead).toBe(true);
    expect(b.dead).toBe(false);
    expect(engine.voiceCount).toBe(3);
    expect(engine.startVoice('amb2', PRIORITY.ambience, 5, 'ambience', () => {})).toBeNull();
    expect(c.dead).toBe(false);
    expect(engine.stats.stolen).toBe(1);
  });
  it('finished voices are reaped and their nodes disconnected', async () => {
    const { fb, engine, sfx } = setup();
    await engine.onGesture();
    const base = fb.live;
    sfx.play('thud');
    expect(fb.live).toBeGreaterThan(base);
    fb.t = 10;
    engine.reap(fb.t);
    expect(engine.voiceCount).toBe(0);
    expect(fb.live).toBe(base);
  });
  it('default pool is ≤ 24 voices; stress of 200 plays across names stays within it', async () => {
    const { fb, engine, sfx } = setup();
    await engine.onGesture();
    expect(engine.maxVoices).toBeLessThanOrEqual(24);
    let peak = 0;
    for (let i = 0; i < 200; i++) { fb.t += 0.01; sfx.play(SFX_NAMES[i % SFX_NAMES.length]!); peak = Math.max(peak, engine.voiceCount); }
    expect(peak).toBeLessThanOrEqual(24);
  });
});

describe('rate limits', () => {
  it('RateLimiter: maxPerSec and minGap', () => {
    const l = new RateLimiter();
    expect(l.allows('a', 0, 2, 0.1)).toBe(true); l.record('a', 0);
    expect(l.allows('a', 0.05, 2, 0.1)).toBe(false); // gap
    expect(l.allows('a', 0.2, 2, 0.1)).toBe(true); l.record('a', 0.2);
    expect(l.allows('a', 0.5, 2, 0.1)).toBe(false); // 2 in the last second
    expect(l.allows('a', 1.05, 2, 0.1)).toBe(true); // first aged out
  });
  it('ka-ching ≤ 3/s and coalesces the rest into one arpeggio', async () => {
    const { fb, engine, sfx } = setup();
    await engine.onGesture();
    let started = 0;
    for (let i = 0; i < 20; i++) { fb.t = i * 0.02; if (sfx.play('kaching')) started++; }
    expect(started).toBe(2); // 0.2 s minGap: starts at 0 and 0.2 inside the first 0.4 s
    expect(sfx.pending).toBe(9); // 10 merged into the 2nd start (t=0.2), 9 arrived after
    fb.t = 0.5; sfx.update();
    expect(sfx.played.kaching).toBe(3);
    expect(sfx.pending).toBe(0);
    // over a whole second never more than 3 starts
    const before = sfx.played.kaching!;
    for (let i = 0; i < 100; i++) { fb.t = 2 + i * 0.01; sfx.play('kaching'); sfx.update(); }
    expect(sfx.played.kaching! - before).toBeLessThanOrEqual(3);
  });
  it('alert group: chimes never stack within the group gap', async () => {
    const { fb, engine, sfx } = setup();
    await engine.onGesture();
    expect(sfx.play('chimeCritical')).toBe(true);
    fb.t = 0.2;
    expect(sfx.play('chimeImportant')).toBe(false);
    expect(sfx.play('rescue')).toBe(false);
    fb.t = 1.5;
    expect(sfx.play('rescue')).toBe(true);
  });
  it('reduce-loud lowers loud recipes only', async () => {
    const { engine } = setup();
    expect(engine.loudScale).toBe(1);
    engine.settings.set({ reduceLoud: true });
    expect(engine.loudScale).toBe(0.5);
    expect(RECIPES.avalanche.loud).toBe(true);
  });
});

describe('node budget', () => {
  it('every recipe builds, stays small, and leaves no live nodes after its duration', async () => {
    const { fb, engine, sfx } = setup();
    await engine.onGesture();
    const base = fb.live;
    for (const n of SFX_NAMES) {
      fb.t += 5;
      const before = fb.nodes.length;
      expect(sfx.play(n), n).toBe(true);
      expect(fb.nodes.length - before, n + ' nodes').toBeLessThan(60);
      fb.t += 10; engine.reap(fb.t);
      expect(fb.live, n + ' leak').toBe(base);
    }
  });
});
