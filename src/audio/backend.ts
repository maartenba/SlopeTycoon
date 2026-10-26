/**
 * Minimal structural subset of the Web Audio API that the game uses. `AudioBackend` lets unit tests drive the whole engine with a fake
 * (see tests/audio/fakeBackend.ts) and lets the game no-op where AudioContext does not exist.
 */
export interface ParamLike {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  exponentialRampToValueAtTime(v: number, t: number): unknown;
  setTargetAtTime(v: number, t: number, timeConstant: number): unknown;
  cancelScheduledValues(t: number): unknown;
}
export interface NodeLike { connect(dest: NodeLike): unknown; disconnect(): void }
export interface GainLike extends NodeLike { gain: ParamLike }
export interface OscLike extends NodeLike { type: string; frequency: ParamLike; start(t?: number): void; stop(t?: number): void; onended: (() => void) | null }
export interface BufferLike { getChannelData(ch: number): Float32Array }
export interface SourceLike extends NodeLike { buffer: BufferLike | null; loop: boolean; playbackRate: ParamLike; start(t?: number, offset?: number): void; stop(t?: number): void; onended: (() => void) | null }
export interface FilterLike extends NodeLike { type: string; frequency: ParamLike; Q: ParamLike }
export interface PannerLike extends NodeLike { pan: ParamLike }
export interface CompressorLike extends NodeLike { threshold: ParamLike; knee: ParamLike; ratio: ParamLike; attack: ParamLike; release: ParamLike }

export interface ConvolverLike extends NodeLike { buffer: BufferLike | null; normalize: boolean }

export type BackendState = 'running' | 'suspended' | 'closed';

export interface AudioBackend {
  readonly state: BackendState;
  readonly sampleRate: number;
  readonly destination: NodeLike;
  now(): number;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  createGain(): GainLike;
  createOscillator(): OscLike;
  createBufferSource(): SourceLike;
  createBiquadFilter(): FilterLike;
  createStereoPanner(): PannerLike;
  createDynamicsCompressor(): CompressorLike;
  createBuffer(length: number, sampleRate: number): BufferLike;
  /** Optional (music reverb); music runs dry without it. */
  createConvolver?(): ConvolverLike;
}

/** Wraps a real AudioContext (structurally compatible; only `now` and mono `createBuffer` differ). */
export function wrapContext(ctx: AudioContext): AudioBackend {
  return {
    get state() { return ctx.state === 'running' ? 'running' : ctx.state === 'closed' ? 'closed' : 'suspended'; },
    sampleRate: ctx.sampleRate,
    destination: ctx.destination as unknown as NodeLike,
    now: () => ctx.currentTime,
    resume: () => ctx.resume(),
    suspend: () => ctx.suspend(),
    createGain: () => ctx.createGain() as unknown as GainLike,
    createOscillator: () => ctx.createOscillator() as unknown as OscLike,
    createBufferSource: () => ctx.createBufferSource() as unknown as SourceLike,
    createBiquadFilter: () => ctx.createBiquadFilter() as unknown as FilterLike,
    createStereoPanner: () => ctx.createStereoPanner() as unknown as PannerLike,
    createDynamicsCompressor: () => ctx.createDynamicsCompressor() as unknown as CompressorLike,
    createBuffer: (length, rate) => ctx.createBuffer(1, length, rate),
    createConvolver: () => ctx.createConvolver() as unknown as ConvolverLike,
  };
}

/** Real-context factory; null where Web Audio is unavailable (node, ancient browsers) or construction throws. */
export function createRealBackend(): AudioBackend | null {
  try {
    const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (!Ctor) return null;
    return wrapContext(new Ctor({ latencyHint: 'interactive' }));
  } catch { return null; }
}
