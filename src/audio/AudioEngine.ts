import type { AudioBackend, CompressorLike, GainLike } from './backend';
import { AudioSettings, busGains } from './AudioSettings';
import { NodeScope, NoiseBank } from './synth';

export type BusId = 'music' | 'sfx' | 'ambience';
/**
 * locked      — no user gesture yet (context not created)
 * running     — context running
 * blocked     — a gesture happened but the browser still refuses to run the context (autoplay policy); keep listening, show the hint
 * suspended   — tab hidden (resumes on visible)
 * unsupported — no AudioContext; every call is a silent no-op
 */
export type EngineState = 'locked' | 'running' | 'blocked' | 'suspended' | 'unsupported';

/** Voice priorities: higher survives stealing. */
export const PRIORITY = { ambience: 1, action: 2, alert: 3 } as const;
export const MAX_VOICES = 24;

export interface Voice {
  readonly name: string;
  readonly priority: number;
  readonly end: number;
  dead: boolean;
  scope: NodeScope;
}

export interface EngineOpts {
  factory: () => AudioBackend | null;
  settings: AudioSettings;
  maxVoices?: number;
}

/** AudioContext lifecycle, bus graph (voices -> bus -> master -> compressor -> out) and the priority-stealing voice pool. */
export class AudioEngine {
  state: EngineState = 'locked';
  private b: AudioBackend | null = null;
  private master: GainLike | null = null;
  private comp: CompressorLike | null = null;
  private buses: Partial<Record<BusId, GainLike>> = {};
  private noiseBank: NoiseBank | null = null;
  private voices: Voice[] = [];
  private hidden = false;
  private subs = new Set<(s: EngineState) => void>();
  private unsubSettings: () => void;
  readonly maxVoices: number;
  /** Counters for tests / debug. */
  stats = { started: 0, stolen: 0, rejected: 0 };

  constructor(private o: EngineOpts) {
    this.maxVoices = o.maxVoices ?? MAX_VOICES;
    this.unsubSettings = o.settings.subscribe(() => this.applyGains(false));
  }

  get backend(): AudioBackend | null { return this.b; }
  get settings(): AudioSettings { return this.o.settings; }
  get running(): boolean { return this.state === 'running' && !!this.b; }
  get noise(): NoiseBank | null { return this.noiseBank; }
  /** Scale for harsh one-shots: lowered with 'reduce loud sounds'. */
  get loudScale(): number { return this.o.settings.get().reduceLoud ? 0.5 : 1; }
  /** True while the 'Click to enable sound' hint should be visible. */
  get needsHint(): boolean { return this.state === 'locked' || this.state === 'blocked'; }
  get voiceCount(): number { return this.voices.length; }
  now(): number { return this.b?.now() ?? 0; }
  busNode(id: BusId): GainLike | null { return this.buses[id] ?? null; }

  onState(fn: (s: EngineState) => void): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }
  private setState(s: EngineState): void { if (s === this.state) return; this.state = s; for (const f of [...this.subs]) f(s); }

  /** Call on pointerdown / keydown. Creates the context on the first call; retries resume while blocked. Never throws. */
  async onGesture(): Promise<void> {
    if (this.state === 'unsupported' || this.state === 'running') return;
    try {
      if (!this.b) {
        this.b = this.o.factory();
        if (!this.b) { this.setState('unsupported'); return; }
        this.build(this.b);
      }
      if (this.hidden) { this.setState('suspended'); return; }
      await this.b.resume();
      this.setState(this.b.state === 'running' ? 'running' : 'blocked');
      if (this.b.state === 'running') this.applyGains(true);
    } catch { this.setState(this.b ? 'blocked' : 'unsupported'); }
  }

  /** Tab visibility: suspend while hidden (also silences everything), resume when visible again. */
  async setHidden(h: boolean): Promise<void> {
    this.hidden = h;
    if (!this.b || this.state === 'unsupported' || this.state === 'locked') return;
    try {
      if (h) { await this.b.suspend(); this.setState('suspended'); }
      else { await this.b.resume(); this.setState(this.b.state === 'running' ? 'running' : 'blocked'); }
    } catch { /* ignore */ }
  }

  private build(b: AudioBackend): void {
    this.master = b.createGain();
    this.comp = b.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 12; this.comp.ratio.value = 6; this.comp.attack.value = 0.005; this.comp.release.value = 0.2;
    this.master.connect(this.comp); this.comp.connect(b.destination);
    for (const id of ['music', 'sfx', 'ambience'] as const) { const g = b.createGain(); g.connect(this.master); this.buses[id] = g; }
    this.noiseBank = new NoiseBank(b);
    this.applyGains(true);
  }

  private applyGains(immediate: boolean): void {
    if (!this.b || !this.master) return;
    const g = busGains(this.o.settings.get()), t = this.b.now(), tc = immediate ? 0.001 : 0.06;
    this.master.gain.setTargetAtTime(g.master, t, tc);
    for (const id of ['music', 'sfx', 'ambience'] as const) this.buses[id]!.gain.setTargetAtTime(g[id], t, tc);
    if (this.comp) this.comp.threshold.setTargetAtTime(this.o.settings.get().reduceLoud ? -24 : -16, t, tc);
  }

  /**
   * Start a one-shot voice. `build` wires nodes via the scope (sources auto-start at t0 and stop after `dur`); the scope's `out`
   * is already connected to the bus. Returns null when not running or rejected (pool full of >= priority voices).
   */
  startVoice(name: string, priority: number, dur: number, bus: BusId, build: (s: NodeScope) => void, delay = 0): Voice | null {
    const b = this.b, busNode = this.buses[bus];
    if (!this.running || !b || !busNode) return null;
    const now = b.now();
    this.reap(now);
    if (this.voices.length >= this.maxVoices) {
      let victim: Voice | null = null;
      for (const v of this.voices) if (v.priority < priority && (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.end < victim.end))) victim = v;
      if (!victim) { this.stats.rejected++; return null; }
      this.kill(victim, now);
      this.stats.stolen++;
    }
    const out = b.createGain();
    out.connect(busNode);
    const scope = new NodeScope(b, this.noiseBank!, now + delay, dur, out);
    const voice: Voice = { name, priority, end: now + delay + dur + 0.06, dead: false, scope };
    try { build(scope); } catch { scope.dispose(); return null; }
    this.voices.push(voice);
    this.stats.started++;
    return voice;
  }

  private kill(v: Voice, now: number): void {
    v.dead = true;
    v.scope.out.gain.cancelScheduledValues(now);
    v.scope.out.gain.setTargetAtTime(0, now, 0.008);
    v.scope.stopAt(now + 0.05);
    v.scope.dispose();
    this.voices.splice(this.voices.indexOf(v), 1);
  }

  /** Free finished voices. Called from the throttled tick and before each start. */
  reap(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i]!;
      if (v.end <= now) { v.scope.dispose(); v.dead = true; this.voices.splice(i, 1); }
    }
  }

  /** A persistent looping layer scope on a bus (not counted against the voice pool). */
  createLayer(bus: BusId, build: (s: NodeScope) => void): NodeScope | null {
    const b = this.b, busNode = this.buses[bus];
    if (!this.running || !b || !busNode) return null;
    const out = b.createGain();
    out.gain.value = 0;
    out.connect(busNode);
    const scope = new NodeScope(b, this.noiseBank!, b.now(), Infinity, out);
    try { build(scope); } catch { scope.dispose(); return null; }
    return scope;
  }

  dispose(): void {
    this.unsubSettings();
    for (const v of [...this.voices]) this.kill(v, this.now());
    try { void this.b?.suspend(); } catch { /* ignore */ }
  }

  /** Browser wiring: first-gesture unlock (kept while blocked), tab visibility. Returns an unsubscribe. */
  attach(win: { addEventListener: Window['addEventListener']; removeEventListener: Window['removeEventListener'] }, doc: { hidden: boolean; addEventListener: Document['addEventListener']; removeEventListener: Document['removeEventListener'] }): () => void {
    const gesture = (): void => {
      void this.onGesture().then(() => { if (this.state === 'running' || this.state === 'unsupported') off(); });
    };
    const vis = (): void => { void this.setHidden(doc.hidden); };
    const off = (): void => { win.removeEventListener('pointerdown', gesture, true); win.removeEventListener('keydown', gesture, true); };
    win.addEventListener('pointerdown', gesture, true);
    win.addEventListener('keydown', gesture, true);
    doc.addEventListener('visibilitychange', vis);
    this.hidden = doc.hidden;
    return () => { off(); doc.removeEventListener('visibilitychange', vis); };
  }
}
