/** Frame-time statistics + the scripted in-browser benchmark state machine. Pure (no three/DOM): driven by main.ts, unit-tested headless. */

export interface FrameSummary { frames: number; avgMs: number; fps: number; /** FPS of the slowest 1 % of frames. */ fpsLow1: number; p99Ms: number; maxMs: number }

/** Ring buffer of frame durations (ms). */
export class FrameStats {
  private ring: number[] = [];
  private i = 0;
  constructor(readonly capacity = 600) {}
  push(ms: number): void {
    if (!(ms > 0) || !Number.isFinite(ms)) return;
    this.ring[this.i] = ms;
    this.i = (this.i + 1) % this.capacity;
  }
  reset(): void { this.ring = []; this.i = 0; }
  get count(): number { return this.ring.length; }
  summary(): FrameSummary {
    const n = this.ring.length;
    if (n === 0) return { frames: 0, avgMs: 0, fps: 0, fpsLow1: 0, p99Ms: 0, maxMs: 0 };
    const sorted = [...this.ring].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / n;
    // 1 % low = mean FPS of the slowest 1 % of frames (at least one frame)
    const k = Math.max(1, Math.ceil(n * 0.01));
    let tail = 0;
    for (let j = n - k; j < n; j++) tail += sorted[j]!;
    const p99 = sorted[Math.min(n - 1, Math.floor(n * 0.99))]!;
    return { frames: n, avgMs: avg, fps: 1000 / avg, fpsLow1: 1000 / (tail / k), p99Ms: p99, maxMs: sorted[n - 1]! };
  }
}

export type BenchView = 'near' | 'mid' | 'far';

/** What the benchmark needs from the running game. */
export interface BenchDriver {
  setSpeed(speed: 1 | 2 | 3): void;
  /** `progress` 0..1 within the phase (camera glides while it runs). */
  setView(view: BenchView, progress: number): void;
  /** Called when the benchmark finishes / is cancelled (restore speed + camera). */
  restore(): void;
  /** Current renderer / sim counters. */
  sample(): BenchSample;
}
export interface BenchSample { calls: number; triangles: number; geometries: number; textures: number; tickAvgMs: number; tickP95Ms: number; guests: number; heapMB: number }

export interface PhaseResult extends FrameSummary {
  speed: number; view: BenchView;
  calls: number; triangles: number; geometries: number; textures: number;
  tickAvgMs: number; tickP95Ms: number; guests: number; heapMB: number;
}

export interface BenchSchedule { speed: 1 | 2 | 3; view: BenchView; ms: number }

/** Default flythrough: zoomed in -> mid -> far out, ~20 s at speed 1 and again at speed 3. */
export function defaultSchedule(phaseMs = 6700): BenchSchedule[] {
  const out: BenchSchedule[] = [];
  for (const speed of [1, 3] as const) for (const view of ['near', 'mid', 'far'] as const) out.push({ speed, view, ms: phaseMs });
  return out;
}

/**
 * Scripted benchmark. Call `start(now)`, then `frame(now, frameMs)` every rendered frame until `done`. Per phase it records the
 * frame statistics and the mean of renderer/sim counters sampled ~4x per second (skipping the first 10 % of the phase as warm-up).
 */
export class PerfBench {
  readonly results: PhaseResult[] = [];
  done = false;
  private idx = -1;
  private phaseStart = 0;
  private stats = new FrameStats(4096);
  private samples: BenchSample[] = [];
  private lastSample = 0;
  private running = false;
  meta: Record<string, unknown> = {};

  constructor(private driver: BenchDriver, private schedule: BenchSchedule[] = defaultSchedule()) {}

  get active(): boolean { return this.running; }
  get totalMs(): number { return this.schedule.reduce((a, s) => a + s.ms, 0); }
  get progress(): number { return this.done ? 1 : this.idx < 0 ? 0 : (this.schedule.slice(0, this.idx).reduce((a, s) => a + s.ms, 0) + this.elapsedInPhase) / this.totalMs; }
  private elapsedInPhase = 0;
  get label(): string { const s = this.schedule[this.idx]; return s ? `${s.view} @ speed ${s.speed}` : ''; }

  start(now: number): void {
    this.results.length = 0; this.done = false; this.running = true; this.idx = -1;
    this.next(now);
  }

  cancel(): void { if (!this.running) return; this.running = false; this.done = true; this.driver.restore(); }

  private next(now: number): void {
    if (this.idx >= 0) this.finishPhase();
    this.idx++;
    if (this.idx >= this.schedule.length) { this.running = false; this.done = true; this.driver.restore(); return; }
    const s = this.schedule[this.idx]!;
    this.phaseStart = now; this.elapsedInPhase = 0; this.lastSample = now;
    this.stats.reset(); this.samples = [];
    this.driver.setSpeed(s.speed);
    this.driver.setView(s.view, 0);
  }

  private finishPhase(): void {
    const s = this.schedule[this.idx]!;
    const f = this.stats.summary();
    const mean = (k: keyof BenchSample): number => (this.samples.length ? this.samples.reduce((a, x) => a + x[k], 0) / this.samples.length : 0);
    this.results.push({
      ...f, speed: s.speed, view: s.view,
      calls: mean('calls'), triangles: mean('triangles'), geometries: mean('geometries'), textures: mean('textures'),
      tickAvgMs: mean('tickAvgMs'), tickP95Ms: Math.max(0, ...this.samples.map((x) => x.tickP95Ms)), guests: mean('guests'), heapMB: mean('heapMB'),
    });
  }

  /** Feed one rendered frame. */
  frame(now: number, frameMs: number): void {
    if (!this.running) return;
    const s = this.schedule[this.idx]!;
    this.elapsedInPhase = now - this.phaseStart;
    if (this.elapsedInPhase >= s.ms) { this.next(now); return; }
    if (this.elapsedInPhase > s.ms * 0.1) {
      this.stats.push(frameMs);
      if (now - this.lastSample >= 250) { this.lastSample = now; this.samples.push(this.driver.sample()); }
    }
    this.driver.setView(s.view, this.elapsedInPhase / s.ms);
  }

  /** Plain-text summary table (also printed to the console). */
  table(): string {
    const f = (x: number, d = 1): string => x.toFixed(d);
    const head = ['view', 'spd', 'fps', '1%low', 'ms avg', 'ms p99', 'calls', 'tris(k)', 'geo', 'tex', 'tick ms', 'tick p95', 'guests', 'heap MB'];
    const rows = this.results.map((r) => [r.view, String(r.speed), f(r.fps, 0), f(r.fpsLow1, 0), f(r.avgMs), f(r.p99Ms), f(r.calls, 0), f(r.triangles / 1000, 0), f(r.geometries, 0), f(r.textures, 0), f(r.tickAvgMs, 2), f(r.tickP95Ms, 2), f(r.guests, 0), f(r.heapMB, 0)]);
    const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
    const line = (r: string[]): string => r.map((c, i) => c.padStart(w[i]!)).join(' ');
    return [line(head), ...rows.map(line)].join('\n');
  }

  json(): string { return JSON.stringify({ date: new Date().toISOString(), meta: this.meta, results: this.results }, null, 1); }
}
