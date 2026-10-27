import type { AudioBackend, BackendState, BufferLike, NodeLike, ParamLike } from '../../src/audio/backend';

/**
 * Node-side software Web Audio renderer (test + tooling helper; never shipped). Implements the subset of the API the game uses
 * (oscillator, buffer source, gain, biquad, stereo panner, delay, dynamics compressor, param automation + audio-rate param inputs)
 * with Web Audio semantics (block of 128, lowpass/highpass Q in dB, bandpass Q linear, ramps / setTarget). Used to render music and
 * ambience offline so tests can assert peak / DC / clicks / loudness / spectrum, and `scripts/audio-render.ts` can export WAV previews.
 * Simplifications: polyBLEP saw/square, k-rate biquad coefficients per block, compressor makeup gain is an empirical constant.
 */
export const BLOCK = 128;
/** Chrome's DynamicsCompressor applies automatic makeup gain; measured against the real OfflineAudioContext (`npm run audio:crosscheck`) at about +5 dB for the engine's master compressor. */
const COMP_MAKEUP = 1.8;

interface Ev { k: 0 | 1 | 2 | 3; t: number; v: number; tc: number; s: number }

export class OParam implements ParamLike {
  base: number;
  private q: Ev[] = [];
  private cur: Ev | null = null;
  private last: number;
  inputs: ONode[] = [];
  private buf = new Float32Array(BLOCK);
  constructor(private owner: OfflineBackend, v: number) { this.base = v; this.last = v; }
  get value(): number { return this.last; }
  set value(v: number) { this.base = v; this.last = v; this.q = []; this.cur = null; }
  private add(e: Ev): void {
    let i = this.q.length;
    while (i > 0 && this.q[i - 1]!.t > e.t) i--;
    this.q.splice(i, 0, e);
  }
  private anchor(): void { if (!this.cur && this.q.length === 0) this.cur = { k: 0, t: this.owner.t, v: this.last, tc: 0, s: this.last }; }
  setValueAtTime(v: number, t: number): this { this.add({ k: 0, t, v, tc: 0, s: v }); return this; }
  linearRampToValueAtTime(v: number, t: number): this { this.anchor(); this.add({ k: 1, t, v, tc: 0, s: v }); return this; }
  exponentialRampToValueAtTime(v: number, t: number): this { this.anchor(); this.add({ k: 2, t, v, tc: 0, s: v }); return this; }
  setTargetAtTime(v: number, t: number, tc: number): this { this.add({ k: 3, t, v, tc: Math.max(1e-4, tc), s: 0 }); return this; }
  cancelScheduledValues(t: number): this { this.q = this.q.filter((e) => e.t < t); return this; }

  /** Param value per sample for the block starting at `t0` (includes audio-rate inputs). */
  block(t0: number, n: number, sr: number): Float32Array {
    const b = this.buf, dt = 1 / sr;
    const nx0 = this.q[0], end = t0 + n * dt;
    const busy = (nx0 && (nx0.t < end || nx0.k === 1 || nx0.k === 2)) || (this.cur && this.cur.k === 3 && t0 - this.cur.t <= 12 * this.cur.tc);
    if (!busy) {
      this.last = this.cur ? this.cur.v : this.base;
      b.fill(this.last, 0, n);
      return this.withInputs(b, n);
    }
    for (let i = 0; i < n; i++) {
      const ts = t0 + i * dt;
      while (this.q.length && this.q[0]!.t <= ts) {
        const e = this.q.shift()!;
        if (e.k === 3) e.s = this.last; else if (e.k === 0) e.s = e.v; else e.s = e.v;
        this.cur = e;
      }
      const c = this.cur, nx = this.q[0];
      let v: number;
      if (!c) v = this.base;
      else if (nx && (nx.k === 1 || nx.k === 2)) {
        const p = Math.min(1, Math.max(0, (ts - c.t) / Math.max(1e-9, nx.t - c.t))), s0 = c.k === 3 ? c.s : c.v;
        v = nx.k === 1 ? s0 + (nx.v - s0) * p : s0 > 0 && nx.v > 0 ? s0 * Math.pow(nx.v / s0, p) : s0;
      } else if (c.k === 3) v = c.v + (c.s - c.v) * Math.exp(-(ts - c.t) / c.tc);
      else v = c.v;
      this.last = v; b[i] = v;
    }
    return this.withInputs(b, n);
  }
  private withInputs(b: Float32Array, n: number): Float32Array {
    for (const src of this.inputs) { if (src.dead || src.silent) continue; const o = src.out[0]!; for (let i = 0; i < n; i++) b[i]! += o[i]!; }
    return b;
  }
  get hasInputs(): boolean { return this.inputs.some((s) => !s.dead && !s.silent); }
}

type Kind = 'gain' | 'osc' | 'src' | 'filter' | 'pan' | 'comp' | 'delay' | 'dest';

export class ONode implements NodeLike {
  dead = false; silent = false;
  ins: ONode[] = [];
  out: Float32Array[] = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  ch = 1;
  params: OParam[] = [];
  // fields shared by node kinds (declared loosely to keep the factory small)
  gain!: OParam; frequency!: OParam; Q!: OParam; pan!: OParam; playbackRate!: OParam; delayTime!: OParam;
  threshold!: OParam; knee!: OParam; ratio!: OParam; attack!: OParam; release!: OParam;
  type = ''; buffer: BufferLike | null = null; loop = false; onended: (() => void) | null = null;
  startT = Infinity; stopT = Infinity;
  private phase = 0; private pos = 0;
  private z: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0]];
  private ring: Float32Array[] | null = null; private wp = 0; private env = 0;
  constructor(readonly kind: Kind, private o: OfflineBackend) {}
  private p(v: number): OParam { const p = new OParam(this.o, v); this.params.push(p); return p; }
  init(): this {
    switch (this.kind) {
      case 'gain': this.gain = this.p(1); break;
      case 'osc': this.frequency = this.p(440); break;
      case 'src': this.playbackRate = this.p(1); break;
      case 'filter': this.frequency = this.p(350); this.Q = this.p(1); this.type = 'lowpass'; break;
      case 'pan': this.pan = this.p(0); break;
      case 'delay': this.delayTime = this.p(0); break;
      case 'comp': this.threshold = this.p(-24); this.knee = this.p(30); this.ratio = this.p(12); this.attack = this.p(0.003); this.release = this.p(0.25); break;
      default: break;
    }
    return this;
  }
  connect(d: unknown): unknown {
    if (d instanceof OParam) { if (!d.inputs.includes(this)) d.inputs.push(this); }
    else if (d instanceof ONode) { if (!d.ins.includes(this)) d.ins.push(this); }
    this.o.dirty = true;
    return d;
  }
  disconnect(): void { this.dead = true; this.o.dirty = true; }
  start(t = 0): void { this.startT = t; }
  stop(t = 0): void { this.stopT = Math.min(this.stopT, t); }

  private mixIn(n: number): { ch: number; a: Float32Array[] } {
    let ch = 1; const live = this.ins.filter((x) => !x.dead && !x.silent);
    for (const s of live) if (s.ch === 2) ch = 2;
    const a = [this.out[0]!, this.out[1]!];
    // scratch: reuse `scratch` per node to avoid aliasing with out
    const m = this.o.scratch();
    m[0]!.fill(0, 0, n); if (ch === 2) m[1]!.fill(0, 0, n);
    for (const s of live) {
      if (ch === 2 && s.ch === 1) { for (let i = 0; i < n; i++) { const v = s.out[0]![i]!; m[0]![i]! += v; m[1]![i]! += v; } }
      else for (let c = 0; c < ch; c++) { const o = s.out[c]!, d = m[c]!; for (let i = 0; i < n; i++) d[i]! += o[i]!; }
    }
    void a;
    return { ch, a: m };
  }
  get hasLiveInput(): boolean { return this.ins.some((x) => !x.dead && !x.silent); }

  process(n: number, t0: number, sr: number): void {
    const o = this.out;
    switch (this.kind) {
      case 'osc': {
        if (t0 + n / sr <= this.startT || t0 >= this.stopT) { this.silent = true; return; }
        this.silent = false; this.ch = 1;
        const f = this.frequency.block(t0, n, sr), out = o[0]!; let ph = this.phase;
        for (let i = 0; i < n; i++) {
          const ts = t0 + i / sr;
          if (ts < this.startT || ts >= this.stopT) { out[i] = 0; continue; }
          const dt = Math.abs(f[i]!) / sr; let v: number;
          switch (this.type) {
            case 'sawtooth': { v = 2 * ph - 1; v -= blep(ph, dt); break; }
            case 'square': { v = ph < 0.5 ? 1 : -1; v += blep(ph, dt); v -= blep((ph + 0.5) % 1, dt); break; }
            case 'triangle': v = 4 * Math.abs(ph - 0.5) - 1; break;
            default: v = Math.sin(2 * Math.PI * ph);
          }
          out[i] = v; ph += f[i]! / sr; ph -= Math.floor(ph);
        }
        this.phase = ph; return;
      }
      case 'src': {
        const buf = this.buffer?.getChannelData(0);
        if (!buf || t0 + n / sr <= this.startT || t0 >= this.stopT) { this.silent = true; return; }
        this.silent = false; this.ch = 1;
        const r = this.playbackRate.block(t0, n, sr), out = o[0]!, L = buf.length; let pos = this.pos;
        for (let i = 0; i < n; i++) {
          const ts = t0 + i / sr;
          if (ts < this.startT || ts >= this.stopT || (!this.loop && pos >= L - 1)) { out[i] = 0; continue; }
          const i0 = Math.floor(pos), fr = pos - i0, a = buf[i0 % L]!, b = buf[(i0 + 1) % L]!;
          out[i] = a + (b - a) * fr; pos += r[i]!; if (this.loop && pos >= L) pos -= L;
        }
        this.pos = pos; return;
      }
      case 'gain': {
        if (!this.hasLiveInput) { this.silent = true; return; }
        const { ch, a } = this.mixIn(n); this.silent = false; this.ch = ch;
        const g = this.gain.block(t0, n, sr);
        for (let c = 0; c < ch; c++) { const d = o[c]!, s = a[c]!; for (let i = 0; i < n; i++) d[i] = s[i]! * g[i]!; }
        return;
      }
      case 'filter': {
        const idle = !this.hasLiveInput;
        if (idle && this.z[0]![0] === 0 && this.z[0]![1] === 0 && this.z[1]![0] === 0 && this.z[1]![1] === 0) { this.silent = true; return; }
        const { ch, a } = this.mixIn(n); this.silent = false; this.ch = ch;
        const fr = this.frequency.block(t0, n, sr)[(n >> 1)]!, q = this.Q.block(t0, n, sr)[0]!;
        const k = biquad(this.type, fr, q, sr);
        for (let c = 0; c < ch; c++) {
          const s = a[c]!, d = o[c]!, z = this.z[c]!; let x1 = z[0]!, x2 = z[1]!, y1 = z[2]!, y2 = z[3]!;
          for (let i = 0; i < n; i++) {
            const x = s[i]!, y = k[0]! * x + k[1]! * x1 + k[2]! * x2 - k[3]! * y1 - k[4]! * y2;
            x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
          }
          if (Math.abs(y1) < 1e-20 && Math.abs(y2) < 1e-20 && idle) { x1 = x2 = y1 = y2 = 0; }
          z[0] = x1; z[1] = x2; z[2] = y1; z[3] = y2;
        }
        return;
      }
      case 'pan': {
        if (!this.hasLiveInput) { this.silent = true; return; }
        const { ch, a } = this.mixIn(n); this.silent = false; this.ch = 2;
        const pv = Math.max(-1, Math.min(1, this.pan.block(t0, n, sr)[0]!));
        if (ch === 1) {
          const x = (pv + 1) / 2, gl = Math.cos(x * Math.PI / 2), gr = Math.sin(x * Math.PI / 2);
          for (let i = 0; i < n; i++) { const v = a[0]![i]!; o[0]![i] = v * gl; o[1]![i] = v * gr; }
        } else {
          const x = pv <= 0 ? pv + 1 : pv, gl = Math.cos(x * Math.PI / 2), gr = Math.sin(x * Math.PI / 2);
          for (let i = 0; i < n; i++) {
            const l = a[0]![i]!, r = a[1]![i]!;
            if (pv <= 0) { o[0]![i] = l + r * gl; o[1]![i] = r * gr; } else { o[0]![i] = l * gl; o[1]![i] = r + l * gr; }
          }
        }
        return;
      }
      case 'delay': {
        // Output reads the ring (written >= BLOCK samples ago); the input is written in `post`.
        const maxS = this.o.delayMax(this);
        if (!this.ring) this.ring = [new Float32Array(maxS + BLOCK * 2), new Float32Array(maxS + BLOCK * 2)];
        const L = this.ring[0]!.length, d = Math.max(BLOCK, Math.min(maxS, Math.round(this.delayTime.block(t0, n, sr)[0]! * sr)));
        this.silent = false; this.ch = 2;
        for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) o[c]![i] = this.ring[c]![(this.wp + i - d + L * 4) % L]!;
        return;
      }
      case 'comp': {
        if (!this.hasLiveInput && this.env < 1e-6) { this.silent = true; return; }
        const { ch, a } = this.mixIn(n); this.silent = false; this.ch = ch;
        const thr = this.threshold.value, knee = this.knee.value, ratio = this.ratio.value;
        const at = Math.exp(-1 / (Math.max(1e-4, this.attack.value) * sr)), rl = Math.exp(-1 / (Math.max(1e-3, this.release.value) * sr));
        let env = this.env;
        for (let i = 0; i < n; i++) {
          let m = 0; for (let c = 0; c < ch; c++) m = Math.max(m, Math.abs(a[c]![i]!));
          env = m > env ? at * env + (1 - at) * m : rl * env + (1 - rl) * m;
          const db = 20 * Math.log10(Math.max(1e-9, env)), over = db - thr;
          let red = 0;
          if (over > knee / 2) red = over * (1 - 1 / ratio); else if (over > -knee / 2) red = (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee);
          const g = Math.pow(10, -red / 20) * COMP_MAKEUP;
          for (let c = 0; c < ch; c++) o[c]![i] = a[c]![i]! * g;
        }
        this.env = env; return;
      }
      case 'dest': {
        const { ch, a } = this.mixIn(n); this.ch = ch;
        for (let c = 0; c < ch; c++) o[c]!.set(a[c]!.subarray(0, n));
        return;
      }
    }
  }
  /** Delay input write (after every other node ran). */
  post(n: number): void {
    if (this.kind !== 'delay' || !this.ring) return;
    const { ch, a } = this.mixIn(n), L = this.ring[0]!.length;
    for (let i = 0; i < n; i++) { this.ring[0]![(this.wp + i) % L] = a[0]![i]!; this.ring[1]![(this.wp + i) % L] = ch === 2 ? a[1]![i]! : a[0]![i]!; }
    this.wp = (this.wp + n) % L;
  }
}

function blep(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

function biquad(type: string, f: number, q: number, sr: number): number[] {
  const fc = Math.min(sr * 0.49, Math.max(10, f)), w0 = 2 * Math.PI * fc / sr, cs = Math.cos(w0), sn = Math.sin(w0);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  if (type === 'lowpass' || type === 'highpass') {
    const al = sn / (2 * Math.pow(10, q / 20));
    if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; } else { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
  } else if (type === 'bandpass') {
    const al = sn / (2 * Math.max(1e-3, q)); b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
  } else return [1, 0, 0, 0, 0];
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

export class OfflineBackend implements AudioBackend {
  readonly state: BackendState = 'running';
  nodes: ONode[] = [];
  order: ONode[] = [];
  dirty = true;
  /** Clock = time of the next block to render (== audio processed so far). */
  t = 0;
  readonly destination: ONode;
  readonly left: Float32Array[] = []; readonly right: Float32Array[] = [];
  private scratchBufs: Float32Array[][] = [[new Float32Array(BLOCK), new Float32Array(BLOCK)], [new Float32Array(BLOCK), new Float32Array(BLOCK)]];
  private sIdx = 0;
  private delays = new Map<ONode, number>();
  peakNodes = 0; processedSamples = 0;
  constructor(readonly sampleRate = 24000) { this.destination = this.mk('dest'); }
  scratch(): Float32Array[] { this.sIdx ^= 1; return this.scratchBufs[this.sIdx]!; }
  delayMax(n: ONode): number { return this.delays.get(n) ?? 4 * this.sampleRate; }
  now(): number { return this.t; }
  async resume(): Promise<void> { /* always running */ }
  async suspend(): Promise<void> { /* no-op */ }
  private mk(k: Kind): ONode { const n = new ONode(k, this).init(); this.nodes.push(n); this.dirty = true; return n; }
  createGain = (): ONode => this.mk('gain');
  createOscillator = (): ONode => this.mk('osc');
  createBufferSource = (): ONode => this.mk('src');
  createBiquadFilter = (): ONode => this.mk('filter');
  createStereoPanner = (): ONode => this.mk('pan');
  createDynamicsCompressor = (): ONode => this.mk('comp');
  createDelay = (max: number): ONode => { const n = this.mk('delay'); this.delays.set(n, Math.ceil(max * this.sampleRate)); return n; };
  createBuffer(length: number): BufferLike { const d = new Float32Array(length); return { getChannelData: () => d }; }
  get live(): number { return this.nodes.filter((n) => !n.dead).length; }

  private sort(): void {
    this.nodes = this.nodes.filter((n) => !n.dead || n === this.destination);
    const live = this.nodes, seen = new Set<ONode>(), order: ONode[] = [];
    // dependency: node needs its ins (except delay inputs) and the sources of params on it
    const deps = (n: ONode): ONode[] => { const d = n.kind === 'delay' ? [] : [...n.ins]; for (const p of n.params) d.push(...p.inputs); return d; };
    const visit = (n: ONode, stack: Set<ONode>): void => {
      if (seen.has(n) || n.dead) return;
      if (stack.has(n)) return; stack.add(n);
      for (const d of deps(n)) visit(d, stack);
      stack.delete(n); seen.add(n); order.push(n);
    };
    for (const n of live) visit(n, new Set());
    this.order = order; this.dirty = false;
    for (const n of live) n.ins = n.ins.filter((x) => !x.dead);
  }

  /** Renders `seconds` of audio (multiple of BLOCK/sr, rounded up) and appends to the capture. */
  process(seconds: number): void {
    const blocks = Math.ceil(seconds * this.sampleRate / BLOCK);
    for (let b = 0; b < blocks; b++) {
      if (this.dirty) this.sort();
      this.peakNodes = Math.max(this.peakNodes, this.order.length);
      const t0 = this.t;
      for (const n of this.order) n.process(BLOCK, t0, this.sampleRate);
      for (const n of this.order) if (n.kind === 'delay') n.post(BLOCK);
      const d = this.destination;
      const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
      if (!d.silent || d.hasLiveInput) { L.set(d.out[0]!); R.set(d.ch === 2 ? d.out[1]! : d.out[0]!); }
      this.left.push(L); this.right.push(R);
      this.t += BLOCK / this.sampleRate; this.processedSamples += BLOCK;
    }
  }

  /** Captured stereo output so far. */
  capture(): { l: Float32Array; r: Float32Array; sampleRate: number } {
    const cat = (a: Float32Array[]): Float32Array => { const o = new Float32Array(a.length * BLOCK); a.forEach((c, i) => o.set(c, i * BLOCK)); return o; };
    return { l: cat(this.left), r: cat(this.right), sampleRate: this.sampleRate };
  }
}

// ---- analysis helpers ----------------------------------------------------------------------------------------------------------------

export interface Stats { peak: number; rms: number; dc: number; maxJump: number; rmsDb: number }
export function statsOf(x: Float32Array, from = 0, to = x.length): Stats {
  let peak = 0, sum = 0, sq = 0, jump = 0;
  for (let i = from; i < to; i++) { const v = x[i]!; peak = Math.max(peak, Math.abs(v)); sum += v; sq += v * v; if (i > from) jump = Math.max(jump, Math.abs(v - x[i - 1]!)); }
  const n = Math.max(1, to - from), rms = Math.sqrt(sq / n);
  return { peak, rms, dc: sum / n, maxJump: jump, rmsDb: 20 * Math.log10(Math.max(1e-9, rms)) };
}
/** Per-window RMS in dB (window seconds). */
export function windowedDb(x: Float32Array, sr: number, win = 1): number[] {
  const w = Math.floor(win * sr), out: number[] = [];
  for (let i = 0; i + w <= x.length; i += w) out.push(statsOf(x, i, i + w).rmsDb);
  return out;
}
/** Spectral centroid (Hz) + energy fraction above `hf` Hz, via averaged Hann-windowed FFT frames. */
export function spectrum(x: Float32Array, sr: number, size = 2048): { centroid: number; above: (hz: number) => number; bins: Float64Array } {
  const bins = new Float64Array(size / 2), win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size);
  const re = new Float64Array(size), im = new Float64Array(size);
  const hop = size * 2;
  for (let s = 0; s + size <= x.length; s += hop) {
    for (let i = 0; i < size; i++) { re[i] = x[s + i]! * win[i]!; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) bins[k]! += re[k]! * re[k]! + im[k]! * im[k]!;
  }
  let tot = 0, wsum = 0; const hz = (k: number): number => k * sr / size;
  for (let k = 1; k < size / 2; k++) { tot += bins[k]!; wsum += bins[k]! * hz(k); }
  return { centroid: tot > 0 ? wsum / tot : 0, bins, above: (f: number) => { let a = 0; for (let k = 1; k < size / 2; k++) if (hz(k) >= f) a += bins[k]!; return tot > 0 ? a / tot : 0; } };
}
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2, tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a]! += tr; im[a]! += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
export function toWav16(l: Float32Array, r: Float32Array, sr: number): Uint8Array {
  const n = l.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
  const w = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i]!)) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i]!)) * 32767, true); }
  return new Uint8Array(buf);
}

/** Strongest narrow spectral line vs its +-`span` Hz neighbourhood (dB) and where it sits: a whistle / hum / beep detector (noise ~ 5-8 dB, a tone 25 dB+). */
export function tonalProminence(x: Float32Array, sr: number, span = 150, size = 8192): { db: number; hz: number } {
  const sp = spectrum(x, sr, size), n = sp.bins.length, hzOf = (k: number): number => k * sr / size, w = Math.max(2, Math.round(span / (sr / size)));
  let best = -99, at = 0;
  for (let k = w + 1; k < n - w - 1; k++) {
    if (hzOf(k) < 60) continue;
    let m = 0; for (let j = k - w; j <= k + w; j++) if (Math.abs(j - k) > 2) m += sp.bins[j]!;
    m /= 2 * w - 4;
    const peak = Math.max(sp.bins[k - 1]!, sp.bins[k]!, sp.bins[k + 1]!), d = 10 * Math.log10(Math.max(1e-30, peak) / Math.max(1e-30, m));
    if (d > best) { best = d; at = hzOf(k); }
  }
  return { db: best, hz: at };
}
/** Largest short-window (`win` s) RMS change between consecutive windows (dB): catches bursts / pops in a bed. */
export function maxStepDb(x: Float32Array, sr: number, win = 0.05): number {
  const w = Math.floor(win * sr); let prev = -999, worst = 0;
  for (let i = 0; i + w <= x.length; i += w) { const d = statsOf(x, i, i + w).rmsDb; if (prev > -200 && d > -90 && prev > -90) worst = Math.max(worst, Math.abs(d - prev)); prev = d; }
  return worst;
}

/**
 * Click detector: the largest second difference relative to the mean |second difference| of the surrounding +-`win` samples (the sample itself excluded).
 * Smooth tones and noise score ~3-9; a step / pop (a discontinuity) scores 30+. Needs signal context: pass a stretch with sound in it.
 */
export function clickScore(x: Float32Array, win = 48): number {
  const n = x.length, d2 = new Float32Array(n);
  for (let i = 2; i < n; i++) d2[i] = Math.abs(x[i]! - 2 * x[i - 1]! + x[i - 2]!);
  let worst = 0, run = 0;
  for (let i = 0; i < Math.min(n, 2 * win + 1); i++) run += d2[i]!;
  for (let i = win; i < n - win; i++) {
    if (i > win) { run += d2[i + win]! - d2[i - win - 1]!; }
    const mean = (run - d2[i]!) / (2 * win), floor = 2e-5; // floor: digital silence around a tiny blip is not a click
    worst = Math.max(worst, d2[i]! / (mean + floor));
  }
  return worst;
}
