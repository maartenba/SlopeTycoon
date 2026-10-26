import type { SeasonId } from '../core/events';
import type { AudioEngine } from './AudioEngine';
import type { GainLike, NodeLike } from './backend';
import { playNote, type InstCtx, type InstVoice } from './instruments';
import { composePiece, nextRoot, pieceSeed, type NoteEvent, type Piece } from './musicComposer';
import { bpmFor, smoothParams, targetParams, type MusicInput, type MusicParams } from './musicState';
import { MUSIC, THEMES } from './musicThemes';
import { mulberry32, scaleNote } from './theory';
import { reverbImpulse } from './synth';

export * from './musicComposer';

interface Track { piece: Piece; ptr: number; beat: number; time: number; out: GainLike; season: SeasonId; /** Backend time when this track must stop (crossfade out). */ endAt: number; done: boolean }
interface Retiring { out: GainLike; at: number }

export interface MusicOpts { seed?: number; dayKey?: number }

/**
 * Lookahead step-sequencer. `tick()` (called every ~25 ms) schedules notes up to `MUSIC.lookahead` s ahead on the backend clock,
 * from pieces produced by the pure `composePiece`. Handles crossfades on season change, pause/resume fades, silence gaps and tension / jingles.
 */
export class Music {
  params: MusicParams | null = null;
  readonly input: MusicInput = { season: 'winter', weather: 'clear', hour: 12, speed: 1, tension: 0 };
  tension = 0;
  stats = { notes: 0, dropped: 0, pieces: 0, crossfades: 0, late: 0, jingles: 0 };
  private gate: GainLike | null = null;
  private reverb: NodeLike | null = null;
  private ctx: InstCtx | null = null;
  private tracks: Track[] = [];
  private retiring: Retiring[] = [];
  private voices: InstVoice[] = [];
  private lastNow: number | null = null;
  private nextPieceAt = -1;
  private pieceIndex = 0;
  private lastRoot: number | null = null;
  private playing = false;
  private gateTarget = -1;
  private lastJingle = -1e9;
  private rng: () => number;
  /** Season the next piece / current track belongs to. */
  private curSeason: SeasonId | null = null;
  readonly seed: number; dayKey: number;

  constructor(private engine: AudioEngine, o: MusicOpts = {}) {
    this.seed = o.seed ?? 1; this.dayKey = o.dayKey ?? 0;
    this.rng = mulberry32(this.seed ^ 0x51ed);
  }

  /** Voices sounding right now (excludes notes scheduled a few ms ahead). */
  get activeVoices(): number { const n = this.lastNow ?? 0; return this.voices.filter((v) => v.start <= n && v.end > n).length; }
  get scheduledVoices(): number { return this.voices.length; }
  get trackCount(): number { return this.tracks.length; }
  get isPlaying(): boolean { return this.playing; }
  get gateValue(): number { return this.gateTarget; }
  get bpm(): number { return this.params ? bpmFor(this.params.season, this.params.tempoMul) : 0; }
  get currentPiece(): Piece | null { return this.tracks[this.tracks.length - 1]?.piece ?? null; }

  setInputs(p: Partial<MusicInput>): void { Object.assign(this.input, p); }
  /** Crisis spike (0..1); decays over ~25 s. */
  addTension(x: number): void { this.tension = Math.min(1, Math.max(this.tension, x)); }

  private build(): boolean {
    const b = this.engine.backend, bus = this.engine.busNode('music'), noise = this.engine.noise;
    if (!b || !bus || !noise) return false;
    if (this.ctx) return true;
    const gate = b.createGain(); gate.gain.value = 0; gate.connect(bus); this.gate = gate;
    if (b.createConvolver) {
      const cv = b.createConvolver(), n = Math.floor(b.sampleRate * MUSIC.reverbSeconds), buf = b.createBuffer(n, b.sampleRate);
      buf.getChannelData(0).set(reverbImpulse(b.sampleRate, MUSIC.reverbSeconds, 3));
      cv.buffer = buf; cv.normalize = true;
      const ret = b.createGain(); ret.gain.value = MUSIC.reverbWet; cv.connect(ret); ret.connect(gate);
      this.reverb = cv;
    }
    this.ctx = { b, noise, dest: gate, reverb: this.reverb };
    return true;
  }

  /** Scheduler pass. Safe to call at any rate; does nothing until the engine is running. */
  tick(): void {
    if (!this.engine.running || !this.build()) { this.lastNow = null; return; }
    const b = this.engine.backend!, now = b.now(), st = this.engine.settings.get();
    const dt = this.lastNow === null ? 0 : Math.min(1, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    this.tension *= Math.exp(-dt / MUSIC.tensionDecayTc);
    this.input.tension = this.tension;
    this.params = smoothParams(this.params, targetParams(this.input), dt);
    this.reap(now);

    const want = st.musicOn && !st.muted && !st.ambienceOnly && !(st.pauseMusicAtZero && this.input.speed === 0);
    const target = want ? 1 : 0;
    if (target !== this.gateTarget) {
      this.gate!.gain.cancelScheduledValues(now);
      this.gate!.gain.setTargetAtTime(target, now, want ? MUSIC.resumeFadeTc : MUSIC.pauseFadeTc);
      this.gateTarget = target;
    }
    if (!want) { this.playing = false; return; }
    if (!this.playing) { // resume: continue the held piece from "now"
      this.playing = true;
      for (const t of this.tracks) t.time = Math.max(t.time, now + 0.1);
      if (this.nextPieceAt >= 0) this.nextPieceAt = Math.max(this.nextPieceAt, now + 0.5);
    }

    const season = this.params.season;
    if (this.curSeason !== null && season !== this.curSeason) this.changeSeason(season, now);
    this.curSeason = season;
    if (this.tracks.length === 0) {
      if (this.nextPieceAt < 0) this.nextPieceAt = now + 1.5;
      if (now >= this.nextPieceAt) this.startTrack(season, now + 0.1, now);
    }
    for (const t of [...this.tracks]) this.runTrack(t, now);
    for (const t of [...this.tracks]) if (t.done) this.finishTrack(t, now);
  }

  private startTrack(season: SeasonId, time: number, now: number, fadeIn = false): Track {
    const th = THEMES[season], seed = pieceSeed(this.seed, this.dayKey, this.pieceIndex, season);
    const root = nextRoot(this.lastRoot, th, mulberry32(seed ^ 0xabc));
    this.lastRoot = root; this.pieceIndex++;
    const piece = composePiece(seed, season, root);
    const out = this.ctx!.b.createGain();
    out.gain.value = fadeIn ? 0 : 1;
    if (fadeIn) { out.gain.setValueAtTime(0, now); out.gain.linearRampToValueAtTime(1, now + MUSIC.crossfadeSec); }
    out.connect(this.gate!);
    const t: Track = { piece, ptr: 0, beat: 0, time, out, season, endAt: Infinity, done: false };
    this.tracks.push(t); this.stats.pieces++;
    return t;
  }

  private changeSeason(season: SeasonId, now: number): void {
    const live = this.tracks.filter((t) => t.endAt === Infinity);
    for (const t of live) {
      t.out.gain.cancelScheduledValues(now); t.out.gain.setValueAtTime(1, now); t.out.gain.linearRampToValueAtTime(0, now + MUSIC.crossfadeSec);
      t.endAt = now + MUSIC.crossfadeSec;
    }
    if (live.length) { this.stats.crossfades++; this.startTrack(season, now + 0.1, now, true); }
    // no live track (silence gap): the next piece simply uses the new season.
  }

  private runTrack(t: Track, now: number): void {
    const p = this.params!, horizon = now + MUSIC.lookahead, step = MUSIC.stepBeats;
    while (t.time < horizon && !t.done) {
      const spb = 60 / bpmFor(t.season, p.tempoMul);
      if (t.time >= t.endAt) { t.done = true; break; }
      const barStart = t.beat % MUSIC.barBeats === 0;
      const ev = t.piece.events;
      while (t.ptr < ev.length && ev[t.ptr]!.beat < t.beat + step - 1e-9) {
        const e = ev[t.ptr++]!;
        if (e.beat < t.beat - 1e-9) continue;
        this.emit(e, t, spb, now);
      }
      if (barStart && this.tension > 0.2 && t.endAt === Infinity) this.drone(t, spb, now);
      t.beat += step; t.time += step * spb;
      if (t.beat >= t.piece.totalBeats) { t.done = true; }
    }
  }

  private drone(t: Track, spb: number, now: number): void {
    if (t.time < now) return;
    const th = t.piece, midi = scaleNote(th.root, th.mode, -14);
    this.voice('drone', midi, t.time, MUSIC.barBeats * spb, 0.5 + 0.5 * this.tension, t.out);
  }

  private emit(e: NoteEvent, t: Track, spb: number, now: number): void {
    if (t.time < now) { this.stats.late++; return; } // never schedule into the past
    const w = this.params!.layers[e.layer];
    if (!(e.rank < w)) return;
    this.voice(e.inst, e.midi, t.time, e.dur * spb, e.vel * (0.6 + 0.4 * w), t.out);
  }

  private voice(inst: Parameters<typeof playNote>[1], midi: number, time: number, dur: number, vel: number, dest: GainLike): void {
    const live = this.voices.filter((v) => v.end > time).length;
    if (live >= MUSIC.maxVoices) { this.stats.dropped++; return; }
    const v = playNote({ ...this.ctx!, dest }, inst, midi, time, dur, vel);
    if (v) { this.voices.push(v); this.stats.notes++; }
  }

  private finishTrack(t: Track, now: number): void {
    this.tracks.splice(this.tracks.indexOf(t), 1);
    this.retiring.push({ out: t.out, at: Math.max(now, t.time) + 4 });
    if (this.tracks.length === 0) this.nextPieceAt = Math.max(now, t.time) + MUSIC.gapMin + this.rng() * (MUSIC.gapMax - MUSIC.gapMin);
  }

  private reap(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) { const v = this.voices[i]!; if (v.end <= now) { v.scope.dispose(); this.voices.splice(i, 1); } }
    for (let i = this.retiring.length - 1; i >= 0; i--) { const r = this.retiring[i]!; if (r.at <= now) { try { r.out.disconnect(); } catch { /* ignore */ } this.retiring.splice(i, 1); } }
  }

  /** Short success motif (rating up) in the current key; rate-limited. */
  jingle(): void {
    if (!this.engine.running || !this.ctx || !this.playing) return;
    const now = this.engine.now();
    if (now - this.lastJingle < MUSIC.jingleGap) return;
    this.lastJingle = now; this.stats.jingles++;
    const p = this.currentPiece, root = p?.root ?? 55, mode = p?.mode ?? 'ionian';
    [0, 2, 4, 7].forEach((idx, i) => this.voice('glock', scaleNote(root, mode, idx + 7), now + 0.12 + i * 0.12, 0.4, 0.9, this.gate!));
  }

  dispose(): void {
    for (const v of this.voices.splice(0)) v.scope.dispose();
    for (const t of this.tracks.splice(0)) { try { t.out.disconnect(); } catch { /* ignore */ } }
    for (const r of this.retiring.splice(0)) { try { r.out.disconnect(); } catch { /* ignore */ } }
  }
}
