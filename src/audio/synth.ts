import type { AudioBackend, BufferLike, FilterLike, GainLike, NodeLike, OscLike, ParamLike, PannerLike, SourceLike } from './backend';

export type NoiseKind = 'white' | 'pink' | 'brown';

/** Deterministic xorshift so noise (and tests) are reproducible. */
function xorshift(seed: number): () => number {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Pure noise generator, normalised to ±0.9 peak. Looping buffers get an equal-power crossfade of the tail into the head (no seam click). */
export function generateNoise(kind: NoiseKind, length: number, seed = 1, seamless = true): Float32Array {
  const n = seamless ? Math.min(length >> 3, 4096) : 0, total = length + n;
  const raw = new Float32Array(total), r = xorshift(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < total; i++) {
    const w = r() * 2 - 1;
    if (kind === 'white') raw[i] = w;
    else if (kind === 'pink') { // Paul Kellet's economy pink filter
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else { last = (last + 0.02 * w) / 1.02; raw[i] = last * 3.5; }
  }
  // Seamless loop: generate n extra samples and equal-power crossfade them into the head, so sample[length-1] -> sample[0] continues the stream.
  const out = raw.slice(0, length);
  for (let i = 0; i < n; i++) {
    const a = (i + 1) / (n + 1);
    out[i] = raw[i]! * Math.sin(a * Math.PI / 2) + raw[length + i]! * Math.cos(a * Math.PI / 2);
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const k = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < length; i++) out[i] = out[i]! * k;
  return out;
}

/** Exponentially decaying stereo-less noise impulse for a ConvolverNode later (music reverb, Task 31). */
export function reverbImpulse(sampleRate: number, seconds = 2, decay = 3, seed = 7): Float32Array {
  const n = Math.max(1, Math.floor(sampleRate * seconds)), r = xorshift(seed), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (r() * 2 - 1) * Math.pow(1 - i / n, decay);
  return out;
}

/** Seconds of noise per cached buffer. */
export const NOISE_SECONDS = 3;

/** One white/pink/brown buffer per backend, generated lazily and reused by every voice and layer. */
export class NoiseBank {
  private bufs: Partial<Record<NoiseKind, BufferLike>> = {};
  constructor(private b: AudioBackend) {}
  get(kind: NoiseKind): BufferLike {
    let buf = this.bufs[kind];
    if (!buf) {
      const len = Math.floor(this.b.sampleRate * NOISE_SECONDS);
      buf = this.b.createBuffer(len, this.b.sampleRate);
      buf.getChannelData(0).set(generateNoise(kind, len, kind === 'white' ? 11 : kind === 'pink' ? 23 : 37));
      this.bufs[kind] = buf;
    }
    return buf;
  }
  get count(): number { return Object.keys(this.bufs).length; }
}

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Percussive envelope: fast linear attack, exponential decay to ~silence. Never reaches exact 0 (exp ramp) then snaps. */
export function pluckEnv(p: ParamLike, t: number, peak: number, attack: number, decay: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, attack));
  p.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
/** Smooth swell: rise to `peak` over `attack`, hold, fall over `release` (ends at t+dur). */
export function swellEnv(p: ParamLike, t: number, peak: number, attack: number, dur: number, release: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  p.setValueAtTime(Math.max(0.0002, peak), Math.max(t + attack, t + dur - release));
  p.linearRampToValueAtTime(0.0001, t + dur);
}

/** Node factory that tracks everything it creates so a voice/layer can be stopped and disconnected as a unit. */
export class NodeScope {
  readonly nodes: NodeLike[] = [];
  readonly sources: Array<OscLike | SourceLike> = [];
  constructor(readonly b: AudioBackend, readonly noise: NoiseBank, readonly t0: number, readonly dur: number, readonly out: GainLike) {
    this.nodes.push(out);
  }
  private reg<T extends NodeLike>(n: T): T { this.nodes.push(n); return n; }
  private startSrc<T extends OscLike | SourceLike>(s: T): T {
    s.start(this.t0);
    if (Number.isFinite(this.dur)) s.stop(this.t0 + this.dur + 0.05);
    this.sources.push(s);
    return s;
  }
  gain(v = 1): GainLike { const g = this.reg(this.b.createGain()); g.gain.value = v; return g; }
  filter(type: string, f: number, q = 1): FilterLike { const n = this.reg(this.b.createBiquadFilter()); n.type = type; n.frequency.value = f; n.Q.value = q; return n; }
  pan(p: number): PannerLike { const n = this.reg(this.b.createStereoPanner()); n.pan.value = Math.max(-1, Math.min(1, p)); return n; }
  osc(type: string, freq: number): OscLike { const o = this.reg(this.b.createOscillator()); o.type = type; o.frequency.value = freq; return this.startSrc(o); }
  noiseSrc(kind: NoiseKind, rate = 1): SourceLike {
    const s = this.reg(this.b.createBufferSource());
    s.buffer = this.noise.get(kind); s.loop = true; s.playbackRate.value = rate;
    return this.startSrc(s);
  }
  /** FM voice: modulator osc (freq = carrier*ratio) scaled by `index` Hz-deviation into the carrier's frequency. Returns the carrier (its output carries the tone). */
  fm(carrierHz: number, ratio: number, indexHz: number): OscLike {
    const c = this.osc('sine', carrierHz), m = this.osc('sine', carrierHz * ratio), mg = this.gain(indexHz);
    m.connect(mg); mg.connect(c.frequency as unknown as NodeLike);
    return c;
  }
  /** Stop all sources at `t` (default now) and disconnect everything. */
  stopAt(t: number): void { for (const s of this.sources) { try { s.stop(t); } catch { /* already stopped */ } } }
  dispose(): void {
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* ignore */ } }
    this.nodes.length = 0; this.sources.length = 0;
  }
}
