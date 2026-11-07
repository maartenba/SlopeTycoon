import { Rng } from '../core/Rng';
import { BED_SLOTS, EXTRA_ROLE_META, POOLS, SAMPLES, SAMPLE_BY_ID, SAMPLE_MIN_GAP, SAMPLE_RETIRED, SHOT_ROLES, sampleBytes, sampleUrl, type BedSlot, type GateId, type SampleDef, type ShotRole } from '../config/audioSamples';
import type { AudioEngine, BusId } from './AudioEngine';
import type { BufferLike, GainLike, SourceLike } from './backend';
import { gateLevels, pickIndex, shotParams, slotTargets, synthScale } from './sampleMix';
import type { AmbienceMix, AmbienceState, LayerId } from './Ambience';

/**
 * Plays the recorded CC0 samples (public/audio/sfx, config/audioSamples.ts) through the engine's buses; the synthesised sounds stay the fallback (docs/audio.md "Samples").
 *  - Nothing is fetched before the engine runs (a user gesture happened, the first frame is long painted). One-shot pools are fetched + decoded on FIRST USE of their role, in the
 *    background (`maxJobs` at a time): until the buffers exist `playShot` returns false and the caller plays the synth, so a footstep is never delayed. Beds are fetched when their slot
 *    first becomes audible. A failed fetch / decode is remembered (retried after `retryAfterSec`, one console warning in total) and just leaves the synth in charge.
 *  - Decoded PCM is capped (`memoryCapMB`): the least recently used IDLE buffers are dropped; a bed that plays keeps its buffer.
 *  - One-shots are engine voices (priority stealing, voice cap, buses, mute, ambience slider, hidden-tab suspend all apply). Beds are looping sources on the ambience bus whose gain follows
 *    the ambience mix; a bed that stays quiet for `silentSec` is stopped (no CPU) and restarts at a random offset.
 */
export interface SamplePlayerDeps {
  /** Encoded bytes of a URL (default: fetch, one plain GET the service worker can runtime-cache). */
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  /** Random numbers (cosmetic; inject for tests). */
  rng?: () => number;
  /** Base URL the sample dir is resolved against (default: the page). */
  base?: string;
  /** Extra switch on top of SAMPLES.enabled (main.ts passes `?nosamples=1`). */
  enabled?: () => boolean;
  /** True where looping beds may play (false on the Low graphics tier). */
  beds?: () => boolean;
  /** Console warning sink (default console.warn). */
  warn?: (m: string) => void;
}

interface Cached { buf: BufferLike; bytes: number; used: number }
interface BedRun { slot: BedSlot; def: SampleDef; src: SourceLike; gain: GainLike; quietSince: number; level: number }

export class SamplePlayer {
  private cache = new Map<string, Cached>();
  private loading = new Map<string, Promise<void>>();
  private queue: string[] = [];
  private running = 0;
  private failed = new Map<string, number>();
  private warned = false;
  private lastPlay = new Map<ShotRole, number>();
  private runs = new Map<string, BedRun>();
  private groupPick = new Map<string, string>();
  private crossingLevel = 0; private crossingUntil = -1;
  private rng: () => number;
  private tick = 0;
  /** File of the last sample one-shot (debug log). */
  lastFile: string | null = null;
  /** Debug recorder: bed starts are logged (`__slope.audio.log`). */
  log: import('./audioLog').AudioLog | null = null;
  /** Counters for tests / debug (window.__audio.samples.stats). */
  stats = { shots: 0, fallbacks: 0, loaded: 0, failed: 0, evicted: 0, bedsStarted: 0 };

  constructor(private engine: AudioEngine, private d: SamplePlayerDeps = {}) { this.rng = d.rng ?? ((): (() => number) => { const r = new Rng((Date.now() ^ 0x2f6e2b1) >>> 0); return () => r.next(); })(); /* cosmetic only (never feeds the simulation) */ }

  get enabled(): boolean { return SAMPLES.enabled && (this.d.enabled ? this.d.enabled() : true) && !!this.engine.backend?.decodeAudioData; }
  get bedsEnabled(): boolean { return this.enabled && (this.d.beds ? this.d.beds() : true); }
  /** Decoded PCM currently held (bytes). */
  get memoryBytes(): number { let n = 0; for (const c of this.cache.values()) n += c.bytes; return n; }
  get loadedIds(): string[] { return [...this.cache.keys()]; }
  get activeBeds(): string[] { return [...this.runs.keys()]; }
  isReady(id: string): boolean { return this.cache.has(id); }
  /** True once at least one file of the role's pool is decoded. */
  roleReady(role: ShotRole, tag?: string): boolean { return POOLS[role].some((s) => (!tag || s.tag === tag) && this.cache.has(s.id)); }

  // ---- loading ----
  /** Queue the files for decoding (idempotent). Resolves when all are done or failed. */
  load(ids: readonly string[]): Promise<void> {
    const ps: Promise<void>[] = [];
    for (const id of ids) {
      if (this.cache.has(id)) { this.cache.get(id)!.used = ++this.tick; continue; }
      if (!SAMPLE_BY_ID.has(id)) continue;
      const bad = this.failed.get(id);
      if (bad !== undefined && this.engine.now() < bad) continue;
      let p = this.loading.get(id);
      if (!p) { p = new Promise<void>((res) => { this.queue.push(id); this.loadingResolvers.set(id, res); }); this.loading.set(id, p); }
      ps.push(p);
    }
    this.pump();
    return Promise.all(ps).then(() => undefined);
  }
  private loadingResolvers = new Map<string, () => void>();
  private pump(): void {
    while (this.running < SAMPLES.maxJobs && this.queue.length) {
      const id = this.queue.shift()!;
      this.running++;
      void this.job(id).finally(() => { this.running--; this.loading.delete(id); this.loadingResolvers.get(id)?.(); this.loadingResolvers.delete(id); this.pump(); });
    }
  }
  private async job(id: string): Promise<void> {
    const def = SAMPLE_BY_ID.get(id)!, be = this.engine.backend;
    try {
      if (!be?.decodeAudioData) throw new Error('no decodeAudioData');
      const url = this.d.base !== undefined ? new URL(sampleUrl(id), this.d.base).href : sampleUrl(id);
      const bytes = await (this.d.fetchBytes ?? defaultFetch)(url);
      const buf = await be.decodeAudioData(bytes, def.rate);
      this.cache.set(id, { buf, bytes: Math.max(buf.length ? buf.length * (buf.numberOfChannels ?? 1) * 4 : 0, 0) || sampleBytes(def, be.sampleRate), used: ++this.tick });
      this.stats.loaded++;
      this.evict();
    } catch (e) {
      this.failed.set(id, this.engine.now() + SAMPLES.retryAfterSec); this.stats.failed++;
      if (!this.warned) { this.warned = true; (this.d.warn ?? ((m: string) => console.warn(m)))(`[audio] sample ${id} not loaded (${e instanceof Error ? e.message : String(e)}); the synthesised sound stays in charge`); }
    }
  }
  /** Drop least recently used idle buffers above the memory cap. */
  private evict(): void {
    const cap = SAMPLES.memoryCapMB * 1048576;
    if (this.memoryBytes <= cap) return;
    const playing = new Set([...this.runs.values()].map((r) => r.def.id));
    const idle = [...this.cache.entries()].filter(([id]) => !playing.has(id)).sort((a, b) => a[1].used - b[1].used);
    for (const [id, c] of idle) { if (this.memoryBytes <= cap) break; this.cache.delete(id); this.stats.evicted++; void c; }
  }

  // ---- one-shots ----
  private lastIds = new Map<string, string>();
  private pick(role: ShotRole, tag?: string): SampleDef | null {
    const pool = POOLS[role].filter((s) => (!tag || s.tag === tag) && this.cache.has(s.id));
    if (!pool.length) return null;
    const key = role + (tag ?? ''), def = pool[pickIndex(pool.length, pool.findIndex((s) => s.id === this.lastIds.get(key)), this.rng)]!;
    this.lastIds.set(key, def.id);
    return def;
  }
  /**
   * Play a sample of `role` as an engine voice. False = nothing played (disabled, pool not decoded yet: it is queued now, or the voice pool refused): the caller plays the synth.
   * `tag` restricts the pool (birdChirp: partridge / gull / night; absent = every tag but `night`).
   */
  playShot(role: ShotRole, o: { pitch?: number; gain?: number; pan?: number; delay?: number; tag?: string }, v: { name?: string; priority: number; bus: BusId }): boolean {
    if (!this.enabled || !this.engine.running || this.retired(role)) return false;
    if (!this.roleReady(role, o.tag)) { this.load(POOLS[role].map((s) => s.id)); this.stats.fallbacks++; return false; }
    let def = this.pick(role, o.tag);
    if (def && !o.tag && role === 'birdChirp' && def.tag === 'night') def = this.pick(role, 'partridge') ?? def; // night calls only when asked for
    if (!def) return false;
    const c = this.cache.get(def.id)!; c.used = ++this.tick;
    const p = shotParams(def, o.pitch ?? 1, o.gain ?? 1, this.rng), pan = o.pan, dur = def.dur / p.rate + 0.06;
    const voice = this.engine.startVoice(v.name ?? role, v.priority, dur, v.bus, (s) => {
      const src = s.bufferSrc(c.buf, p.rate), g = s.gain(p.gain);
      src.connect(g);
      if (pan) { const pn = s.pan(pan); g.connect(pn); pn.connect(s.out); } else g.connect(s.out);
    }, o.delay ?? 0);
    if (!voice) return false;
    this.stats.shots++; this.lastFile = def.id; this.lastPlay.set(role, this.engine.now());
    return true;
  }
  /** True for a role whose recording is switched off (`SAMPLE_RETIRED`): the synth recipe plays instead and nothing is fetched. */
  retired(role: ShotRole): boolean { return SAMPLE_RETIRED.includes(role); }
  /** True while a role's recording is ready but still inside its minimum gap (`SAMPLE_MIN_GAP`): the caller plays NOTHING (neither sample nor synth). */
  gapBlocked(role: ShotRole): boolean {
    const gap = SAMPLE_MIN_GAP[role];
    return !!gap && this.enabled && this.roleReady(role) && this.engine.now() - (this.lastPlay.get(role) ?? -1e9) < gap;
  }
  /** Extra one-shots (rustle / lap / sleighBell): sample only, rate-limited, nothing plays while the pool is not ready (the synth bed carries the sound). */
  playExtra(role: 'rustle' | 'lap' | 'sleighBell', o: { pitch?: number; gain?: number; pan?: number }): boolean {
    if (!this.enabled || !this.engine.running) return false;
    const now = this.engine.now(), last = this.lastPlay.get(role) ?? -1e9;
    if (now - last < EXTRA_ROLE_META[role].gap) return false;
    const ok = this.playShot(role, o, { priority: 1, bus: 'ambience' });
    if (ok) this.lastPlay.set(role, now);
    return ok;
  }

  // ---- crossing bell (a loop that sounds while the barrier is down) ----
  /** A bell ding was reported (the view repeats it while the barrier is down): the loop plays and fades out `crossingHold` s after the last call. False = the sample is not ready: play the synth ding. */
  ring(gain: number): boolean {
    if (!this.enabled || !this.bedsEnabled || !this.engine.running) return false;
    const slot = BED_SLOTS.find((s) => s.gate === 'crossing')!;
    if (!this.cache.has(slot.sample)) { this.load([slot.sample]); return false; }
    this.crossingLevel = Math.max(0, Math.min(1, gain)); this.crossingUntil = this.engine.now() + SAMPLES.crossingHold;
    return true;
  }

  // ---- beds ----
  /**
   * Drive the loops from the ambience mix (called by Ambience.update ~10 Hz). Returns the sample coverage per synth layer (the caller scales the synth beds by `synthScale`).
   * Starts a slot when its gain exceeds the silence threshold (loading its file first), stops it after `silentSec` of silence.
   */
  updateBeds(mix: AmbienceMix, s: Pick<AmbienceState, 'weather'>, layerMax: Record<LayerId, number>, fadeTc = 0.9, extra: Partial<Record<GateId, number>> = {}): Partial<Record<LayerId, number>> {
    if (!this.bedsEnabled || !this.engine.running) { if (this.runs.size) this.stopAll(); return {}; }
    const now = this.engine.now(), cross = now < this.crossingUntil ? this.crossingLevel : 0;
    const gates = gateLevels(mix, s, cross, extra);
    // Slot groups play ONE member (cannon beds): picked at random when the group becomes audible, forgotten when its gate is back at zero (the next activation picks again).
    const groups = new Map<string, BedSlot[]>();
    for (const sl of BED_SLOTS) if (sl.group) groups.set(sl.group, [...(groups.get(sl.group) ?? []), sl]);
    for (const [g, members] of groups) {
      const lvl = Math.max(...members.map((m) => gates[m.gate] * m.weight));
      if (lvl <= SAMPLES.silentBelow) this.groupPick.delete(g);
      else if (!this.groupPick.has(g)) this.groupPick.set(g, members[Math.min(members.length - 1, Math.floor(this.rng() * members.length))]!.id);
    }
    const { gains, coverage } = slotTargets(gates, layerMax, (id) => SAMPLE_BY_ID.get(id)!.trim, (id) => this.cache.has(id), BED_SLOTS, (id) => { const g = BED_SLOTS.find((x) => x.id === id)?.group; return !!g && this.groupPick.get(g) !== id; });
    const busNode = this.engine.busNode('ambience'), be = this.engine.backend;
    for (const sl of BED_SLOTS) {
      const g = gains[sl.id]!, run = this.runs.get(sl.id);
      if (g > SAMPLES.silentBelow) {
        if (!this.cache.has(sl.sample)) { this.load([sl.sample]); continue; }
        this.cache.get(sl.sample)!.used = ++this.tick;
        if (!run && busNode && be) this.startBed(sl, busNode as unknown as { connect(d: unknown): void }, g);
        const r = this.runs.get(sl.id);
        if (r) { r.quietSince = -1; r.level = g; r.gain.gain.setTargetAtTime(g, now, sl.gate === 'crossing' ? 0.08 : fadeTc); }
      } else if (run) {
        run.level = 0; run.gain.gain.setTargetAtTime(0, now, sl.gate === 'crossing' ? 0.08 : fadeTc);
        if (run.quietSince < 0) run.quietSince = now;
        else if (now - run.quietSince >= SAMPLES.silentSec) this.stopBed(sl.id);
      }
    }
    return coverage;
  }
  /** Synth layer multiplier for the current coverage (see sampleMix.synthScale). */
  synthScale(id: LayerId, coverage: Partial<Record<LayerId, number>>): number { return synthScale(id, coverage, (r) => this.roleReady(r)); }

  private startBed(sl: BedSlot, bus: { connect(d: unknown): void }, g: number): void {
    const be = this.engine.backend!, c = this.cache.get(sl.sample)!, def = SAMPLE_BY_ID.get(sl.sample)!;
    try {
      const src = be.createBufferSource(), gain = be.createGain();
      src.buffer = c.buf; src.loop = true; gain.gain.value = 0;
      src.connect(gain); gain.connect(bus as never);
      src.start(0, SAMPLES.randomOffset ? this.rng() * def.dur : 0);
      this.runs.set(sl.id, { slot: sl, def, src, gain, quietSince: -1, level: g });
      this.stats.bedsStarted++;
      this.log?.record({ t: this.engine.now(), id: sl.id, kind: 'loop', bus: 'ambience', source: 'sample', gain: g, file: def.id });
    } catch { /* leave the synth bed in charge */ }
  }
  private stopBed(id: string): void {
    const r = this.runs.get(id); if (!r) return;
    try { r.src.stop(); } catch { /* already stopped */ }
    try { r.src.disconnect(); r.gain.disconnect(); } catch { /* ignore */ }
    this.runs.delete(id);
  }
  stopAll(): void { for (const id of [...this.runs.keys()]) this.stopBed(id); }
  /** Free everything (tests, dispose). */
  dispose(): void { this.stopAll(); this.cache.clear(); this.queue.length = 0; }
}

async function defaultFetch(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.arrayBuffer();
}

/** True when the page asks for no samples (`?nosamples=1`). */
export function samplesDisabledByUrl(search: string): boolean { return /[?&]nosamples=(1|true)\b/.test(search); }
export const ALL_SHOT_ROLES = SHOT_ROLES;
