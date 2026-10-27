import type { AudioBackend, BackendState, BufferLike, NodeLike, ParamLike } from '../../src/audio/backend';

class FakeParam implements ParamLike {
  value = 0; calls: string[] = [];
  setValueAtTime(v: number): void { this.value = v; this.calls.push('set'); }
  linearRampToValueAtTime(v: number): void { this.value = v; this.calls.push('lin'); }
  exponentialRampToValueAtTime(v: number): void { this.value = v; this.calls.push('exp'); }
  setTargetAtTime(v: number): void { this.value = v; this.calls.push('target'); }
  cancelScheduledValues(): void { this.calls.push('cancel'); }
}

export class FakeNode implements NodeLike {
  live = true; connections: unknown[] = [];
  gain = new FakeParam(); frequency = new FakeParam(); Q = new FakeParam(); pan = new FakeParam(); playbackRate = new FakeParam();
  delayTime = new FakeParam(); threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam(); attack = new FakeParam(); release = new FakeParam();
  type = ''; buffer: BufferLike | null = null; loop = false; onended: (() => void) | null = null;
  started = false; stopAt = Infinity; normalize = false; startAt = 0; createdAt = 0;
  constructor(public kind: string, private owner: FakeBackend) { owner.nodes.push(this); this.createdAt = owner.t; }
  connect(d: unknown): unknown { this.connections.push(d); return d; }
  disconnect(): void { this.live = false; }
  start(t = 0): void { this.started = true; this.startAt = t; }
  stop(t = 0): void { this.stopAt = t; }
}

/** Test double: counts nodes, tracks live (not-disconnected) nodes, controllable clock + context state. */
export class FakeBackend implements AudioBackend {
  nodes: FakeNode[] = [];
  t = 0;
  sampleRate = 8000;
  state: BackendState = 'suspended';
  /** When true resume() leaves the context suspended (autoplay blocked). */
  blockResume = false;
  resumeCalls = 0; suspendCalls = 0; buffers = 0;
  destination = new FakeNode('destination', this) as unknown as NodeLike;
  now(): number { return this.t; }
  async resume(): Promise<void> { this.resumeCalls++; if (!this.blockResume) this.state = 'running'; }
  async suspend(): Promise<void> { this.suspendCalls++; this.state = 'suspended'; }
  private mk(kind: string): FakeNode { return new FakeNode(kind, this); }
  createGain = (): FakeNode => this.mk('gain');
  createOscillator = (): FakeNode => this.mk('osc');
  createBufferSource = (): FakeNode => this.mk('src');
  createBiquadFilter = (): FakeNode => this.mk('filter');
  createStereoPanner = (): FakeNode => this.mk('pan');
  createConvolver = (): FakeNode => this.mk('convolver');
  createDelay = (): FakeNode => this.mk('delay');
  createDynamicsCompressor = (): FakeNode => this.mk('comp');
  createBuffer(length: number): BufferLike { this.buffers++; const d = new Float32Array(length); return { getChannelData: () => d }; }
  get live(): number { return this.nodes.filter((n) => n.live).length; }
  liveOf(kind: string): number { return this.nodes.filter((n) => n.live && n.kind === kind).length; }
}

export class MemStorage { m = new Map<string, string>(); getItem(k: string): string | null { return this.m.get(k) ?? null; } setItem(k: string, v: string): void { this.m.set(k, v); } }
