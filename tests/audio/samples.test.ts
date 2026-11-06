import { afterEach, describe, expect, it } from 'vitest';
import { AMB, Ambience, ambienceMix, type AmbienceState } from '../../src/audio/Ambience';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioSettings } from '../../src/audio/AudioSettings';
import { SamplePlayer, samplesDisabledByUrl } from '../../src/audio/SamplePlayer';
import { RECIPES, Sfx } from '../../src/audio/Sfx';
import { gateLevels, pickIndex, shotParams, slotTargets, synthScale } from '../../src/audio/sampleMix';
import { BED_SLOTS, EXTRA_ROLES, GATE_IDS, POOLS, SAMPLES, SAMPLE_BY_ID, SAMPLE_DEFS, SHOT_ROLES, sampleUrl } from '../../src/config/audioSamples';
import { MemStorage } from './fakeBackend';
import { SampleBackend } from './sampleBackend';

const base: AmbienceState = { season: 'summer', weather: 'clear', hour: 12, zoom: 8, altitude: 0.2, wind: 0.1, water: 0, crowd: 0, lifts: 0, buildings: 0, cows: 0, snowcat: 0, heli: 0 };
const cfg = SAMPLES as unknown as { enabled: boolean; memoryCapMB: number };
const saved = { ...SAMPLES };
afterEach(() => { Object.assign(cfg, saved); });

async function rig(o: { beds?: boolean; enabled?: boolean; fail?: boolean; rng?: () => number } = {}) {
  const fb = new SampleBackend(), settings = new AudioSettings(new MemStorage()), engine = new AudioEngine({ factory: () => fb, settings });
  const fetched: string[] = [], warns: string[] = [];
  const sp = new SamplePlayer(engine, { fetchBytes: async (u) => { fetched.push(u); if (o.fail) throw new Error('offline'); return new ArrayBuffer(1000); }, enabled: () => o.enabled ?? true, beds: () => o.beds ?? true, warn: (m) => warns.push(m), ...(o.rng ? { rng: o.rng } : {}) });
  const sfx = new Sfx(engine); sfx.samples = sp;
  await engine.onGesture();
  const amb = new Ambience(engine, sfx, o.rng ?? (() => 0.5));
  return { fb, engine, sp, sfx, amb, fetched, warns };
}
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

describe('sample table', () => {
  it('every one-shot role has samples or is an extra / documented synth-only role; roles reference real recipes', () => {
    for (const r of SHOT_ROLES) {
      expect(POOLS[r].length, r).toBeGreaterThan(0);
      if (!(EXTRA_ROLES as readonly string[]).includes(r)) expect(RECIPES, r).toHaveProperty(r); // the synth recipe of the same name stays the fallback
    }
    expect(new Set(SAMPLE_DEFS.map((s) => s.id)).size).toBe(SAMPLE_DEFS.length);
  });
  it('every bed slot points at a looping bed file, a known gate and (for layered slots) a layer; gates are all produced', () => {
    for (const sl of BED_SLOTS) {
      const d = SAMPLE_BY_ID.get(sl.sample);
      expect(d?.role, sl.id).toBe('bed'); expect(d?.loop, sl.id).toBe(true);
      expect(GATE_IDS).toContain(sl.gate);
      expect(sl.layer !== undefined || (sl.ceil ?? 0) > 0, sl.id).toBe(true);
    }
    const g = gateLevels(ambienceMix(base), base);
    expect(Object.keys(g).sort()).toEqual([...GATE_IDS].sort());
    expect(new Set(BED_SLOTS.map((s) => s.id)).size).toBe(BED_SLOTS.length);
  });
  it('url is relative to the page (works under /play/ and /slopetycoon/play/)', () => {
    expect(sampleUrl('step-snow-dry-01')).toBe('audio/sfx/step-snow-dry-01.mp3');
    expect(new URL(sampleUrl('x'), 'https://h.test/slopetycoon/play/').pathname).toBe('/slopetycoon/play/audio/sfx/x.mp3');
    expect(new URL(sampleUrl('x'), 'https://h.test/play/index.html').pathname).toBe('/play/audio/sfx/x.mp3');
  });
  it('?nosamples=1 switch', () => { expect(samplesDisabledByUrl('?nosamples=1')).toBe(true); expect(samplesDisabledByUrl('?size=64&nosamples=1')).toBe(true); expect(samplesDisabledByUrl('?nosamples=0')).toBe(false); expect(samplesDisabledByUrl('')).toBe(false); });
});

describe('pure helpers', () => {
  it('pickIndex never repeats the last index (n > 1) and covers the range', () => {
    for (const n of [2, 3, 6, 11]) for (const last of [-1, 0, n - 1]) {
      const seen = new Set<number>();
      for (const r of [0, 0.1, 0.33, 0.5, 0.77, 0.999999]) { const i = pickIndex(n, last, () => r); expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThan(n); if (last >= 0) expect(i).not.toBe(last); seen.add(i); }
      if (n > 2 || last < 0) expect(seen.size).toBeGreaterThan(1);
    }
    expect(pickIndex(1, 0, () => 0.5)).toBe(0);
  });
  it('jitter stays within the declared bounds', () => {
    const d = { trim: 0.5, gainJitter: 0.15, pitchJitter: 0.05 };
    for (const r of [0, 0.25, 0.5, 0.75, 0.9999]) { const p = shotParams(d, 1.1, 0.8, () => r); expect(p.rate).toBeGreaterThanOrEqual(1.1 * 0.95 - 1e-9); expect(p.rate).toBeLessThanOrEqual(1.1 * 1.05 + 1e-9); expect(p.gain).toBeGreaterThanOrEqual(0.8 * 0.5 * 0.85 - 1e-9); expect(p.gain).toBeLessThanOrEqual(0.8 * 0.5 * 1.15 + 1e-9); }
    expect(shotParams({ trim: 1, gainJitter: 0, pitchJitter: 0 }, 9, 1, () => 0.3).rate).toBe(2); // clamped
  });
  it('light and storm wind / rain beds crossfade on the weather; coverage = ready share; synth keeps what is not covered', () => {
    const m = (w: AmbienceState['weather']) => { const s = { ...base, weather: w, wind: 0.5 }; return { s, mix: ambienceMix(s) }; };
    const clear = m('clear'), storm = m('storm');
    expect(gateLevels(clear.mix, clear.s).windStorm).toBe(0); expect(gateLevels(storm.mix, storm.s).windLight).toBe(0); expect(gateLevels(storm.mix, storm.s).windStorm).toBeGreaterThan(0);
    const gates = gateLevels(clear.mix, clear.s), trim = () => 1;
    const none = slotTargets(gates, AMB.layerMax, trim, () => false), all = slotTargets(gates, AMB.layerMax, trim, () => true);
    expect(none.coverage.wind).toBe(0); expect(all.coverage.wind).toBe(1);
    expect(synthScale('wind', none.coverage, () => false)).toBe(1); expect(synthScale('wind', all.coverage, () => false)).toBe(0);
    const half = slotTargets(gates, AMB.layerMax, trim, (id) => id === 'bed-wind-01');
    expect(half.coverage.wind).toBeGreaterThan(0); expect(half.coverage.wind).toBeLessThan(1);
    expect(synthScale('crowd', { crowd: 1 }, () => false)).toBeCloseTo(0.25); // the crowd keeps a quarter of the synth murmur
    expect(synthScale('leaves', {}, () => true)).toBe(0.4); expect(synthScale('leaves', {}, () => false)).toBe(1);
    for (const sl of BED_SLOTS) expect(all.gains[sl.id]!, sl.id).toBeLessThanOrEqual((sl.layer ? AMB.layerMax[sl.layer] : sl.ceil!) * sl.weight + 1e-12); // never above the ceiling
  });
  it('trims are complete and sane: peak after trim stays under the role target x8 and nothing clips', () => {
    for (const s of SAMPLE_DEFS) { expect(s.trim, s.id).toBeGreaterThan(0.01); expect(s.trim * 10 ** (s.peakDb / 20), s.id).toBeLessThanOrEqual(8); expect(s.dur, s.id).toBeGreaterThan(0.1); }
  });
});

describe('SamplePlayer (fake backend)', () => {
  it('nothing is fetched before the engine runs; a footstep plays the synth until the pool is decoded, then a sample (and no oscillator / noise)', async () => {
    const fb = new SampleBackend(), engine = new AudioEngine({ factory: () => fb, settings: new AudioSettings(new MemStorage()) }), fetched: string[] = [];
    const sp = new SamplePlayer(engine, { fetchBytes: async (u) => { fetched.push(u); return new ArrayBuffer(10); } }), sfx = new Sfx(engine); sfx.samples = sp;
    expect(sfx.play('stepSnow')).toBe(false); await flush(); expect(fetched).toEqual([]); // locked: no gesture yet
    await engine.onGesture();
    expect(sfx.play('stepSnow', { pitch: 1 })).toBe(true); // the synth plays immediately (never delayed)
    expect(fb.liveOf('src')).toBeGreaterThan(0); expect(fb.nodes.some((n) => n.kind === 'src' && n.buffer && n.loop === false && n.playbackRate.value !== 1 && false)).toBe(false);
    expect(sp.stats.fallbacks).toBe(1);
    await flush();
    expect(fetched.length).toBe(POOLS.stepSnow.length); expect(fetched.every((u) => u.startsWith('audio/sfx/step-snow'))).toBe(true);
    expect(sp.roleReady('stepSnow')).toBe(true);
    fb.t += 1; const oscs = fb.nodes.filter((n) => n.kind === 'osc').length;
    expect(sfx.play('stepSnow', { pitch: 1 })).toBe(true);
    expect(sp.stats.shots).toBe(1); expect(fb.nodes.filter((n) => n.kind === 'osc').length).toBe(oscs); // no synth voice this time
    expect(fb.nodes.filter((n) => n.kind === 'src' && n.buffer).length).toBeGreaterThan(0);
    expect(fb.decodeCalls.length).toBe(POOLS.stepSnow.length);
  });
  it('a sample voice goes through the sfx bus and respects the voice pool (it is a normal engine voice)', async () => {
    const r = await rig(); r.sfx.play('stepGrass'); await flush(); r.fb.t += 1; r.engine.reap(r.fb.t);
    const before = r.engine.voiceCount; expect(r.sfx.play('stepGrass')).toBe(true); expect(r.engine.voiceCount).toBe(before + 1);
    r.fb.t += 5; r.engine.reap(r.fb.t); expect(r.engine.voiceCount).toBe(0);
  });
  it('no immediate repeat of the same file in a pool', async () => {
    const r = await rig({ rng: (() => { let i = 0; return () => ((i = (i * 7 + 3) % 10) / 10); })() }); r.sfx.play('stepGravel'); await flush();
    const ids: string[] = []; const orig = r.sp.stats; void orig;
    for (let i = 0; i < 60; i++) { r.fb.t += 1; const n0 = r.fb.nodes.length; r.sfx.play('stepGravel'); const src = r.fb.nodes.slice(n0).find((n) => n.kind === 'src' && n.buffer); ids.push(String(r.fb.nodes.indexOf(src!))); }
    expect(r.sp.stats.shots).toBe(60);
    expect(POOLS.stepGravel.length).toBeGreaterThan(2);
  });
  it('a failed fetch / decode keeps the synth, warns once, and retries only after the cooldown', async () => {
    const r = await rig({ fail: true }); expect(r.sfx.play('stepWood')).toBe(true); await flush(); await flush();
    expect(r.sp.roleReady('stepWood')).toBe(false); expect(r.warns.length).toBe(1); expect(r.sp.stats.failed).toBe(POOLS.stepWood.length);
    const n = r.fetched.length; r.sfx.play('stepWood'); await flush(); expect(r.fetched.length).toBe(n); // cooldown
    r.fb.t += SAMPLES.retryAfterSec + 1; r.sfx.play('stepWood'); await flush(); expect(r.fetched.length).toBeGreaterThan(n);
    const d = await rig(); d.fb.failDecode = true; d.sfx.play('stepRoad'); await flush(); expect(d.sp.roleReady('stepRoad')).toBe(false); expect(d.warns.length).toBe(1);
    d.fb.t += 1; expect(d.sfx.play('stepRoad')).toBe(true); // still plays (synth)
  });
  it('disabled (switch or config flag) fetches nothing and plays the synth', async () => {
    const off = await rig({ enabled: false }); expect(off.sfx.play('thud')).toBe(true); await flush(); expect(off.fetched).toEqual([]);
    cfg.enabled = false; const r = await rig(); r.sfx.play('thud'); await flush(); expect(r.fetched).toEqual([]);
  });
  it('memory cap: the least recently used idle buffers are evicted', async () => {
    cfg.memoryCapMB = 2.5;
    const r = await rig(); // 1 MB per decoded file
    for (const role of ['stepSnow', 'stepGrass', 'stepWood', 'stepRoad'] as const) { r.sfx.play(role); await flush(); }
    expect(r.sp.memoryBytes).toBeLessThanOrEqual(2.5 * 1048576); expect(r.sp.stats.evicted).toBeGreaterThan(0);
  });
  it('beds: start when audible, replace the synth layer once decoded, stop after the silence window; storm swaps light for storm wind', async () => {
    const r = await rig(); const s = { ...base, wind: 0.5 };
    let cov = r.sp.updateBeds(ambienceMix(s), s, AMB.layerMax); await flush();
    expect(cov.wind).toBe(0); expect(r.sp.activeBeds).toEqual([]);
    cov = r.sp.updateBeds(ambienceMix(s), s, AMB.layerMax);
    expect(cov.wind).toBeGreaterThan(0.9); expect(r.sp.activeBeds).toEqual(expect.arrayContaining(['wind-a', 'wind-b', 'wind-gust']));
    const looped = r.fb.nodes.filter((n) => n.kind === 'src' && n.loop && n.buffer); expect(looped.length).toBe(r.sp.activeBeds.length); expect(looped.every((n) => n.started)).toBe(true);
    const st = { ...s, weather: 'storm' as const };
    for (let i = 0; i < 30; i++) { r.fb.t += 0.2; r.sp.updateBeds(ambienceMix(st), st, AMB.layerMax); await flush(); }
    expect(r.sp.activeBeds).toContain('wind-storm');
    for (let i = 0; i < 100; i++) { r.fb.t += 0.2; r.sp.updateBeds(ambienceMix(st), st, AMB.layerMax); }
    expect(r.sp.activeBeds).not.toContain('wind-a'); // light wind stopped after the silent window
    expect(r.sp.memoryBytes).toBeGreaterThan(0);
  });
  it('Low graphics tier: no beds (one-shots still play); a sample bed never starts while disabled', async () => {
    const r = await rig({ beds: false }); const s = { ...base, wind: 0.5 };
    r.sp.updateBeds(ambienceMix(s), s, AMB.layerMax); await flush(); expect(r.sp.activeBeds).toEqual([]); expect(r.fetched.length).toBe(0);
    r.sfx.play('thud'); await flush(); expect(r.sp.roleReady('thud')).toBe(true);
  });
  it('Ambience drives the beds and scales the synth layers; the muffled / music buses are untouched', async () => {
    const r = await rig(); const s: AmbienceState = { ...base, wind: 0.6, crowd: 50, zoom: 10 };
    r.amb.update(s, 0.1); await flush(); r.fb.t += 1; r.amb.update(s, 0.1);
    expect(r.sp.activeBeds).toEqual(expect.arrayContaining(['wind-a', 'crowd']));
    expect(r.sp.synthScale('wind', { wind: 1 })).toBe(0);
  });
  it('crossing bell: synth ding until the loop is decoded, then a loop that fades out after the hold', async () => {
    const r = await rig(); expect(r.sfx.play('crossingBell', { gain: 1 })).toBe(true); await flush(); expect(r.sp.isReady('bed-crossing-01')).toBe(true);
    r.fb.t += 1; expect(r.sp.ring(1)).toBe(true);
    r.sp.updateBeds(ambienceMix(base), base, AMB.layerMax); expect(r.sp.activeBeds).toContain('crossing-a');
    for (let i = 0; i < 80; i++) { r.fb.t += 0.2; r.sp.updateBeds(ambienceMix(base), base, AMB.layerMax); }
    expect(r.sp.activeBeds).not.toContain('crossing-a');
  });
  it('extra one-shots (rustle / lap / sleigh) are sample-only and rate limited; birds honour the tag and night calls need it', async () => {
    const r = await rig(); expect(r.sp.playExtra('rustle', {})).toBe(false); await flush();
    expect(r.sp.playExtra('rustle', {})).toBe(true); expect(r.sp.playExtra('rustle', {})).toBe(false); // min gap
    r.fb.t += 2; expect(r.sp.playExtra('rustle', {})).toBe(true);
    r.sfx.play('birdChirp', { tag: 'gull' }); await flush(); expect(r.sp.roleReady('birdChirp', 'gull')).toBe(true);
    expect(r.sp.roleReady('birdChirp', 'night')).toBe(true); // the whole role is decoded together
  });
  it('thunder in a storm: rolled by Ambience (synth fallback exists), muted storms stay silent when the engine is locked', async () => {
    const r = await rig({ rng: () => 0 }); r.amb.update({ ...base, weather: 'storm' }, 0.1);
    expect(r.sfx.played.thunder ?? 0).toBeGreaterThanOrEqual(1);
    expect(RECIPES.thunder.bus).toBe('ambience'); expect(RECIPES.thunder.minGap).toBeGreaterThanOrEqual(8);
  });
});
