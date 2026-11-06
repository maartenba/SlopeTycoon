/**
 * Runtime debug aid for "what was that beep / honk?" (owner report, 0.6.0): every one-shot (Sfx.play) and every loop start / crossing-bell ring is recorded
 * with its id, role bus, source (`sample` = a recorded file, `synth` = the procedural recipe), gain and time. Off by default (zero cost beyond one boolean check).
 * `__slope.audio.log(true)` prints each AMBIENT one-shot / loop start to the console (`log('all')` also prints UI and event sounds, `log(false)` stops);
 * `__slope.audio.counts()` returns per-id counts and per-minute rates since `reset()`. By-ear procedure: docs/playtest-audio.md.
 */
export type AudioLogSource = 'sample' | 'synth';
export interface AudioLogEntry { t: number; id: string; kind: 'shot' | 'loop' | 'ring'; bus: string; source: AudioLogSource; gain: number; file?: string }
export type AudioLogMode = false | true | 'all';

export class AudioLog {
  mode: AudioLogMode = false;
  /** Most recent entries (capped). */
  readonly entries: AudioLogEntry[] = [];
  /** Counts by `id|source` (kept while recording). */
  private counts_ = new Map<string, number>();
  private t0 = -1;
  private last = -1;
  constructor(private cap = 500, private print: (line: string) => void = (l) => console.log(l)) {}

  get recording(): boolean { return this.mode !== false; }
  set(mode: AudioLogMode): void { this.mode = mode; if (mode) this.reset(); }
  reset(): void { this.entries.length = 0; this.counts_.clear(); this.t0 = -1; this.last = -1; }

  record(e: AudioLogEntry): void {
    if (!this.mode) return;
    if (this.t0 < 0) this.t0 = e.t;
    this.last = e.t;
    this.entries.push(e); if (this.entries.length > this.cap) this.entries.shift();
    const k = `${e.id}|${e.source}`; this.counts_.set(k, (this.counts_.get(k) ?? 0) + 1);
    if (this.mode === 'all' || e.bus === 'ambience') this.print(`[audio] ${e.t.toFixed(1)}s ${e.kind} ${e.id} ${e.source}${e.file ? ' ' + e.file : ''} gain ${e.gain.toFixed(3)}`);
  }

  /** Per-id counts and per-minute rates since the recording started. */
  counts(): Array<{ id: string; source: AudioLogSource; n: number; perMin: number }> {
    const minutes = Math.max(1 / 60, (this.last - this.t0) / 60);
    return [...this.counts_.entries()].map(([k, n]) => { const [id, source] = k.split('|') as [string, AudioLogSource]; return { id, source, n, perMin: n / minutes }; }).sort((a, b) => b.n - a.n);
  }
}
