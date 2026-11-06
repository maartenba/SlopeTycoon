import { describe, expect, it } from 'vitest';
import { CALL, VisitorCalls } from '../../src/audio/visitorCall';
import { soundsForEvent } from '../../src/audio/eventSounds';
import { RECIPES, type PlayOpts } from '../../src/audio/Sfx';
import { OfflineBackend, statsOf, windowedDb } from './offlineBackend';
import { MemStorage } from './fakeBackend';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings, type AudioSettingsData } from '../../src/audio/AudioSettings';
import { Sfx } from '../../src/audio/Sfx';

/** The rare visitor's call: when it is scheduled (pure) and how loud / long it is (offline render). */
const rig = (running = true) => {
  const calls: PlayOpts[] = []; let t = 1000, up = running;
  const vc = new VisitorCalls((o) => { if (!up) return false; calls.push(o); return true; }, () => t);
  return { vc, calls, at: (s: number) => { t = s; }, unlock: () => { up = true; } };
};

describe('visitor call scheduling', () => {
  it('the sighting event itself makes no cue (the render side schedules it)', () => {
    expect(soundsForEvent('visitor:spotted', { x: 1, y: 1, fx: 2, fy: 2, ranger: false })).toEqual([]);
  });
  it('a global quiet call at the sighting, panned by direction, from anywhere', () => {
    const r = rig(); r.vc.sighting(-2); r.vc.frame(true, 200, -2);
    expect(r.calls.length).toBe(1); expect(r.calls[0]!.pan).toBeCloseTo(-CALL.maxPan); expect(r.calls[0]!.gain).toBeLessThan(0.8);
  });
  it('stays pending while the audio is locked and plays the moment it runs, only while the visit is on', () => {
    const r = rig(false); r.vc.sighting(0.2); r.vc.frame(true, 80, 0.2); expect(r.calls.length).toBe(0);
    r.unlock(); r.vc.frame(true, 80, 0.2); expect(r.calls.length).toBe(1);
    const q = rig(false); q.vc.sighting(0); q.vc.frame(false, 80, 0); q.unlock(); q.vc.frame(true, 80, 0); expect(q.calls.length).toBe(0); // gone before the audio came up
  });
  it('a spatial call once the camera is within 25 tiles (louder when closer), after the 60 s limit, once per sighting', () => {
    const r = rig(); r.vc.sighting(0); r.vc.frame(true, 40, 0); expect(r.calls.length).toBe(1);
    r.vc.frame(true, 10, 0); expect(r.calls.length).toBe(1); // 0 s since the first: held back
    r.at(1030); r.vc.frame(true, 10, 0); expect(r.calls.length).toBe(1);
    r.at(1061); r.vc.frame(true, 10, 0); expect(r.calls.length).toBe(2);
    r.at(1200); r.vc.frame(true, 5, 0); expect(r.calls.length).toBe(2); // once per sighting
    const a = rig(); a.vc.sighting(0); a.at(1100); a.vc.frame(true, 2, 0); const b = rig(); b.vc.sighting(0); b.at(1100); b.vc.frame(true, 24, 0);
    expect(a.calls[1]!.gain!).toBeGreaterThan(b.calls[1]!.gain!);
  });
  it('Show me plays it again (not held by the 60 s limit, only a few seconds apart) and never faster than that', () => {
    const r = rig(); r.vc.sighting(0); r.at(1010); r.vc.showMe(0.3); expect(r.calls.length).toBe(2); expect(r.calls[1]!.gain).toBe(CALL.showMeGain);
    r.at(1012); r.vc.showMe(0.3); expect(r.calls.length).toBe(2);
    r.at(1020); r.vc.showMe(0.3); expect(r.calls.length).toBe(3);
  });
  it('never more than one automatic call per 60 s, even with a second sighting', () => {
    const r = rig(); r.vc.sighting(0); r.at(1010); r.vc.sighting(0); r.vc.frame(true, 3, 0); r.at(1059); r.vc.frame(true, 3, 0);
    expect(r.calls.length).toBe(1);
  });
});

describe('visitor call voice', () => {
  const render = async (name: 'distantCall' | 'churchBell', gain: number, secs: number, settings?: Partial<AudioSettingsData>) => {
    const ob = new OfflineBackend(24000), st = new AudioSettings(new MemStorage());
    if (settings) st.set(settings);
    const engine = new AudioEngine({ factory: () => ob as never, settings: st });
    await engine.onGesture();
    const sfx = new Sfx(engine);
    expect(sfx.play(name, { gain, noSample: true })).toBe(true);
    for (let i = 0; i < Math.round(secs / 0.025); i++) { ob.process(0.025); if (i % 8 === 0) sfx.update(); }
    const c = ob.capture();
    return { l: c.l, r: c.r, sr: c.sampleRate, sfx };
  };
  it('is a drawn-out two-syllable sound of about 2 s with a tail, never clips, and sits above the church bell level', async () => {
    expect(RECIPES.distantCall.bus).toBe('sfx');
    const call = await render('distantCall', 1, 6.5), bell = await render('churchBell', 1, 4);
    const sc = statsOf(call.l), sb = statsOf(bell.l);
    expect(sc.peak).toBeLessThan(0.15); expect(sc.peak).toBeGreaterThan(0.02); // audible at default levels, nowhere near clipping
    expect(Math.abs(sc.dc)).toBeLessThan(0.005);
    expect(sc.maxJump).toBeLessThan(0.2); // no clicks
    const w = windowedDb(call.l, call.sr, 0.5); // 13 half-second windows
    expect(Math.max(...w.slice(0, 6))).toBeGreaterThan(sc.rmsDb); // body in the first ~3 s
    expect(w[10]! < w[2]! - 12).toBe(true); // the tail has died away by 5 s
    // two syllables: a dip between the loud parts (about 1.0-1.2 s) is quieter than both
    const fine = windowedDb(call.l, call.sr, 0.1), peak1 = Math.max(...fine.slice(3, 9)), dip = Math.min(...fine.slice(9, 13)), peak2 = Math.max(...fine.slice(13, 22));
    expect(dip).toBeLessThan(Math.min(peak1, peak2) - 1.5);
    // level: the call's RMS over its body is above the church bell's, in the same master chain
    expect(sc.rmsDb - sb.rmsDb).toBeGreaterThan(6); expect(sc.rmsDb - sb.rmsDb).toBeLessThan(16); // clearly above the (very quiet) church bell, a soft call well under the UI click
    expect(Math.max(sc.peak, sb.peak)).toBeLessThan(0.9);
  });
  it('is silent when muted and follows the SFX slider', async () => {
    const mute = await render('distantCall', 1, 3, { muted: true }), low = await render('distantCall', 1, 3, { sfx: 0.2 }), full = await render('distantCall', 1, 3);
    expect(statsOf(mute.l).peak).toBeLessThan(1e-4);
    expect(statsOf(low.l).peak).toBeLessThan(statsOf(full.l).peak * 0.6);
  });
  it('is panned by the pan option (louder on that side)', async () => {
    const ob = new OfflineBackend(24000), st = new AudioSettings(new MemStorage()), engine = new AudioEngine({ factory: () => ob as never, settings: st });
    await engine.onGesture(); const sfx = new Sfx(engine); sfx.play('distantCall', { pan: 0.85, noSample: true });
    for (let i = 0; i < 120; i++) ob.process(0.025);
    const c = ob.capture(); expect(statsOf(c.r).rms).toBeGreaterThan(statsOf(c.l).rms * 2);
  });
});
