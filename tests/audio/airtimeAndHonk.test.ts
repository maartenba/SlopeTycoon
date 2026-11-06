import { describe, expect, it } from 'vitest';
import { AMB, Ambience, type AmbienceState } from '../../src/audio/Ambience';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioLog } from '../../src/audio/audioLog';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { soundsForEvent } from '../../src/audio/eventSounds';
import { Music } from '../../src/audio/Music';
import { MusicHandoff } from '../../src/audio/musicHold';
import { mayCutIn, playedLongEnough } from '../../src/audio/musicPlaylist';
import { apresBarLevel, apresLevel, crossingBellLevel } from '../../src/audio/proximity';
import { SamplePlayer } from '../../src/audio/SamplePlayer';
import { Sfx } from '../../src/audio/Sfx';
import { HANDOFF, MUSIC, SITUATION } from '../../src/config/audioMusic';
import { PROX } from '../../src/config/audioProximity';
import { SAMPLE_MIN_GAP, SAMPLE_RATES, SAMPLE_RETIRED, type ShotRole } from '../../src/config/audioSamples';
import { FakeBackend, fakeMediaHooks, MemStorage } from './fakeBackend';
import { SampleBackend } from './sampleBackend';

const flush = async (): Promise<void> => { for (let i = 0; i < 25; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

describe('music airtime: a playing game track gets MUSIC.minPlaySec = 30 s (pure)', () => {
  it('the constant is 30 s and a track has played long enough from 30 s of media time', () => {
    expect(MUSIC.minPlaySec).toBe(30); expect(playedLongEnough(29.9)).toBe(false); expect(playedLongEnough(30)).toBe(true);
  });
  it('a cut-in needs: a different urgent situation, the cut-in cooldown AND the minimum airtime; a refused cut-in stays possible later', () => {
    const o = { situation: 'storm' as const, playingSituation: 'winter-day' as const, now: 1000, lastChangeAt: -Infinity, positionSec: 31 };
    expect(mayCutIn(o)).toBe(true);
    expect(mayCutIn({ ...o, positionSec: 5 })).toBe(false); // just started: keeps playing
    expect(mayCutIn({ ...o, positionSec: 29.9 })).toBe(false);
    expect(mayCutIn({ ...o, lastChangeAt: 1000 - SITUATION.minChangeGapSec + 1 })).toBe(false); // cooldown still holds
    expect(mayCutIn({ ...o, lastChangeAt: 1000 - SITUATION.minChangeGapSec })).toBe(true);
    expect(mayCutIn({ ...o, situation: 'summer' })).toBe(false); // not urgent: waits for the track end
    expect(mayCutIn({ ...o, playingSituation: 'storm' })).toBe(false); // already playing it
  });
});

describe('music airtime in the scheduler (fake media)', () => {
  async function rig() {
    const fb = new FakeBackend(), settings = new AudioSettings(new MemStorage()), engine = new AudioEngine({ factory: () => fb, settings });
    const m = fakeMediaHooks({ dur: 300 });
    let x = 3; const rand = (): number => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
    const music = new Music(engine, { rand, player: m.hooks });
    await engine.onGesture();
    const run = async (sec: number): Promise<void> => { for (let i = 0; i < Math.round(sec / 0.25); i++) { fb.t += 0.25; m.advance(0.25); music.tick(); await flush(); } };
    return { music, run, m };
  }
  it('a storm that settles 20 s into a track waits for second 30, then cuts in once; the committed situation was storm all along', async () => {
    const r = await rig(); r.music.setInputs({ season: 'winter', hour: 13, busy: 0.9, weather: 'clear' });
    await r.run(4); const first = r.music.currentTrack!; expect(first).toBe('winter-day');
    r.music.setInputs({ weather: 'storm' });
    await r.run(SITUATION.settleSec + 1); // committed now (~20 s into the track): refused
    expect(r.music.situation).toBe('storm'); expect(r.music.currentTrack).toBe(first); expect(r.music.stats.crossfades).toBe(0); expect(r.music.player.position).toBeLessThan(MUSIC.minPlaySec);
    await r.run(3); expect(r.music.currentTrack).toBe(first); // ~28-29 s in: still the same song
    await r.run(8); expect(r.music.currentTrack).toBe('storm-tente-restringida'); expect(r.music.stats.crossfades).toBe(1); // after second 30: the pending change applies
  });
  it('"Next track" is an explicit action: immediate, never held back by the minimum', async () => {
    const r = await rig(); r.music.setInputs({ season: 'winter', hour: 8 });
    await r.run(4); const first = r.music.currentTrack!; expect(r.music.player.position).toBeLessThan(MUSIC.minPlaySec);
    r.music.next(); await r.run(2); expect(r.music.currentTrack).not.toBe(first); expect(r.music.stats.crossfades).toBe(1);
  });
});

describe('bar music hand-off: slightly closer, and bar songs keep their airtime', () => {
  /** Distance (tiles) at which ONE open bar's level reaches `lvl` with the camera zoomed right in (zoom window 1). */
  const distFor = (lvl: number): number => { let lo = 0, hi: number = PROX.apres.reach; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (apresBarLevel(mid) > lvl) lo = mid; else hi = mid; } return lo; };
  /** Zoom (tiles) at which a bar right next to the camera reaches `lvl`. */
  const zoomFor = (lvl: number): number => { let lo: number = PROX.apres.zoomNear, hi: number = PROX.apres.zoomFar; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (apresLevel(1, mid) > lvl) lo = mid; else hi = mid; } return lo; };
  it('old (0.12 / 0.04) vs new enter / exit levels: enter distance is about 75 % of the old one, exit about 90 %; zoom a little tighter', () => {
    expect(HANDOFF.enterLevel).toBeGreaterThan(HANDOFF.exitLevel); // hysteresis kept
    const oldEnter = distFor(0.12), oldExit = distFor(0.04), enter = distFor(HANDOFF.enterLevel), exit = distFor(HANDOFF.exitLevel);
    expect(oldEnter).toBeCloseTo(16.7, 0); expect(oldExit).toBeCloseTo(19.4, 0);
    expect(enter / oldEnter).toBeGreaterThan(0.7); expect(enter / oldEnter).toBeLessThan(0.8);
    expect(exit / oldExit).toBeGreaterThan(0.85); expect(exit / oldExit).toBeLessThan(0.95);
    expect(exit).toBeGreaterThan(enter); // you may drift out to ~17.5 tiles before the bar hands back
    expect(zoomFor(0.12)).toBeCloseTo(29.3, 0); expect(zoomFor(HANDOFF.enterLevel)).toBeLessThan(zoomFor(0.12));
    expect(zoomFor(HANDOFF.enterLevel)).toBeGreaterThan(PROX.apres.zoomNear + 8); // still reachable without zooming in all the way
  });
  it('a level that used to start the bar music (0.2) no longer does; one that now starts it (0.35) does; it hands back at 0.09', () => {
    const t = (lv: number): MusicHandoff => { const h = new MusicHandoff(); for (let s = 0; s <= 10; s += 0.1) h.update(lv, s); return h; };
    expect(t(0.2).transitions).toBe(0); expect(t(0.35).phase).toBe('apres');
    const h = new MusicHandoff(); for (let s = 0; s <= 100; s += 0.1) h.update(s < 20 ? 0.5 : 0.1, s); expect(h.phase).toBe('apres'); // 0.1 > exit: still there
    for (let s = 100; s <= 140; s += 0.1) h.update(0.05, s); expect(h.phase).toBe('main');
  });
  it('the hand-off still happens (apres still plays) and the bar song holds for MUSIC.minPlaySec before it hands back', () => {
    expect(HANDOFF.minApresSec).toBe(MUSIC.minPlaySec);
    const h = new MusicHandoff(); let applied = -1, back = -1;
    for (let s = 0; s <= 80; s += 0.1) { const lv = s < 3 ? 0.6 : 0; const p = h.update(lv, s); if (p === 'apres' && applied < 0) applied = s; if (p === 'toMain' && back < 0) back = s; }
    expect(applied).toBeGreaterThan(0); expect(back - applied).toBeGreaterThanOrEqual(MUSIC.minPlaySec - 0.15);
  });
});

describe('beep / honk candidates: rate caps, gating, no double playback', () => {
  const winterBusy: AmbienceState = { season: 'winter', weather: 'clear', hour: 12, zoom: 12, altitude: 0.2, wind: 0.1, water: 0, crowd: 40, lifts: 1, buildings: 1, cows: 0, snowcat: 0, heli: 0 };
  async function rig(o: { samples?: boolean; rng?: () => number } = {}) {
    const fb = new SampleBackend(), settings = new AudioSettings(new MemStorage()), engine = new AudioEngine({ factory: () => fb, settings });
    const fetched: string[] = [];
    const sp = new SamplePlayer(engine, { fetchBytes: async (u) => { fetched.push(u); return new ArrayBuffer(1000); }, enabled: () => o.samples ?? true, beds: () => true, warn: () => {} });
    const sfx = new Sfx(engine); sfx.samples = sp;
    const log = new AudioLog(500, () => {}); sfx.log = log; sp.log = log; log.set('all'); log.set(true);
    await engine.onGesture();
    const amb = new Ambience(engine, sfx, o.rng, undefined, { rand: () => 0.3 });
    return { fb, engine, sp, sfx, amb, log, fetched };
  }
  it('village hour chime: at most one chime per AMB.church.minGapSec, at most maxStrikes strikes, only with the camera in the village', async () => {
    const r = await rig({ samples: false });
    r.amb.update(winterBusy, 0.1);
    expect(r.amb.mix!.bells).toBeGreaterThan(AMB.church.minBells);
    const strikes = (): number => r.sfx.played.churchBell ?? 0;
    // a game hour is 6.25 s at 1x: 24 hour events in 150 s of play must make at most ceil(150 / 60) chimes
    let t = 0; for (let h = 7; h < 31; h++) { r.fb.t = t; r.amb.onHour(h % 24); t += 6.25; r.engine.reap(r.fb.t); }
    expect(strikes()).toBeLessThanOrEqual(Math.ceil(150 / AMB.church.minGapSec) * AMB.church.maxStrikes); expect(strikes()).toBeGreaterThan(0);
    const before = strikes(); r.fb.t = t + AMB.church.minGapSec + 5; r.amb.onHour(12); expect(strikes()).toBeGreaterThan(before); // after the gap it chimes again
    const far = await rig({ samples: false }); far.amb.update({ ...winterBusy, zoom: 60 }, 0.1); far.amb.onHour(12); expect(far.sfx.played.churchBell ?? 0).toBe(0); // zoomed out: silent
  });
  it('the church-bell recording is retired: the soft synth plays (no fetch of the clip), and nothing plays twice', async () => {
    expect(SAMPLE_RETIRED).toContain('churchBell');
    const r = await rig(); r.sfx.play('churchBell', { gain: 0.5 }); await flush(); r.sfx.play('churchBell', { gain: 0.5, delay: 2 });
    expect(r.fetched.filter((u) => u.includes('bell-church'))).toEqual([]); expect(r.sp.stats.shots).toBe(0);
    expect(r.log.entries.every((e) => e.id !== 'churchBell' || e.source === 'synth')).toBe(true);
  });
  it('chairlift squeak (the clank recording): at most one per SAMPLE_MIN_GAP, nothing replaces a dropped one, and lift EVENT cues use the synth', async () => {
    const r = await rig(); r.sfx.play('clank'); await flush(); await flush(); // first play queues the pool; decode
    const gap = SAMPLE_MIN_GAP.clank!; expect(gap).toBeGreaterThanOrEqual(10);
    r.fb.t = 5; expect(r.sfx.play('clank')).toBe(true); const shots = r.sp.stats.shots; expect(shots).toBe(1);
    for (const dt of [1, 3, 6, gap - 1]) { r.fb.t = 5 + dt; expect(r.sfx.play('clank')).toBe(false); }
    expect(r.sp.stats.shots).toBe(shots); expect(r.log.entries.filter((e) => e.id === 'clank' && e.source === 'synth').length).toBeLessThanOrEqual(1); // no synth twin on top
    r.fb.t = 5 + gap + 1; expect(r.sfx.play('clank')).toBe(true); expect(r.sp.stats.shots).toBe(2);
    for (const c of [...soundsForEvent('lift:opened', { id: 1, open: true }), ...soundsForEvent('lift:built', {} as never)]) if (c.sfx === 'clank') expect(c.opts?.noSample).toBe(true);
    r.fb.t = 5 + gap + 2; r.sfx.play('clank', { noSample: true }); expect(r.sp.stats.shots).toBe(2); // the event path plays the synth
  });
  it('a sample and its synth twin never sound together: every ready role makes exactly one voice per play', async () => {
    const r = await rig(); const roles: ShotRole[] = ['stepSnow', 'thud', 'bell', 'clank', 'creak', 'cowbell', 'birdChirp']; // a subset: the fake decode is 1 MB a file and the 40 MB cap would evict the rest
    for (const k of roles) r.sfx.play(k as never); for (let i = 0; i < 60; i++) await flush();
    let tt = 100; for (const k of roles) { tt += 15; r.fb.t = tt; r.engine.reap(tt); const v0 = r.engine.voiceCount, s0 = r.sp.stats.shots; const ok = r.sfx.play(k as never); expect(r.sp.roleReady(k), k).toBe(true); if (ok) { expect(r.engine.voiceCount - v0, k).toBe(1); expect(r.sp.stats.shots - s0, k).toBe(1); /* sample ready: one voice, and it is the sample */ } }
  });
  it('rate budget: 10 minutes of a busy winter resort next to lifts and houses (10 Hz updates, speed-independent) stays far under one ambient one-shot every few seconds', async () => {
    let x = 11; const rng = (): number => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
    const r = await rig({ rng }); await r.sfx.play('clank'); await flush(); await flush();
    for (let s = 0; s < 6000; s++) { r.fb.t = s * 0.1; if (s % 62 === 0) r.amb.onHour(((s / 62) | 0) % 24 + 6); r.amb.update({ ...winterBusy, hour: 6 + (s / 62) % 14 }, 0.1); r.engine.reap(r.fb.t); }
    const per = (n: number): number => n / 10;
    const p = r.sfx.played; expect(per(p.clank ?? 0)).toBeLessThanOrEqual(60 / SAMPLE_MIN_GAP.clank! + 1); // <= 6 a minute
    expect(per(p.churchBell ?? 0)).toBeLessThanOrEqual(AMB.church.maxStrikes * (60 / AMB.church.minGapSec) + 1);
    const ambient = Object.entries(p).filter(([k]) => ['clank', 'churchBell', 'creak', 'cowbell', 'birdChirp', 'drip', 'crossingBell'].includes(k)).reduce((a, [, n]) => a + (n as number), 0);
    expect(per(ambient)).toBeLessThanOrEqual(12); // never more than about one every 5 s on average
  });
  it('crossing bell: silent beyond PROX.crossing.reach and when zoomed out; the old gain (1 - d/70)^2 from the far camera body is gone', () => {
    const C = PROX.crossing;
    expect(crossingBellLevel(C.reach, 8)).toBe(0); expect(crossingBellLevel(C.reach + 5, 8)).toBe(0);
    expect(crossingBellLevel(3, C.zoomFar)).toBe(0); expect(crossingBellLevel(3, 60)).toBe(0);
    expect(crossingBellLevel(3, C.zoomNear)).toBeGreaterThan(0.6); expect(crossingBellLevel(15, 14)).toBeLessThan(crossingBellLevel(3, 14));
    expect(crossingBellLevel(40, 14)).toBeLessThan(0.04); // the old formula still gave (1 - 40/70)^2 = 0.18 there, at any zoom
  });
  it('lower night-bird and clank rates (before: 0.06 and 0.35 per second at full intensity)', () => { expect(SAMPLE_RATES.nightBird).toBeLessThan(0.06); expect(AMB.rates.clanks).toBeLessThan(0.35); });
});

describe('audio debug log (__slope.audio.log)', () => {
  it('records nothing while off; when on it records id, source and gain, prints ambient ones, and counts per minute', () => {
    const lines: string[] = []; const log = new AudioLog(10, (l) => lines.push(l));
    log.record({ t: 1, id: 'clank', kind: 'shot', bus: 'ambience', source: 'sample', gain: 0.5 }); expect(log.entries.length).toBe(0);
    log.set(true);
    log.record({ t: 0, id: 'clank', kind: 'shot', bus: 'ambience', source: 'sample', gain: 0.5, file: 'mach-chairlift-squeak-01' });
    log.record({ t: 30, id: 'click', kind: 'shot', bus: 'sfx', source: 'synth', gain: 1 });
    log.record({ t: 60, id: 'clank', kind: 'shot', bus: 'ambience', source: 'sample', gain: 0.4 });
    expect(lines.length).toBe(2); expect(lines[0]).toMatch(/clank sample mach-chairlift-squeak-01 gain 0\.500/); // the UI click is not printed in 'ambient' mode
    const c = log.counts().find((x) => x.id === 'clank')!; expect(c.n).toBe(2); expect(c.perMin).toBeCloseTo(2, 5);
    log.set('all'); log.record({ t: 1, id: 'click', kind: 'shot', bus: 'sfx', source: 'synth', gain: 1 }); expect(lines.length).toBe(3);
    log.set(false); log.record({ t: 2, id: 'x', kind: 'shot', bus: 'ambience', source: 'synth', gain: 1 }); expect(log.entries.length).toBe(1); // set() resets; off records nothing more
  });
});
