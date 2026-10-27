import type { AudioEngine } from './AudioEngine';
import type { GainLike, NodeLike } from './backend';
import { playNote, type InstCtx, type InstVoice } from './instruments';
import { composePiece, nextRoot, pieceSeed, type NoteEvent, type Piece } from './musicComposer';
import { chooseTrack, shouldSwap } from './musicSelect';
import { bpmFor, smoothParams, targetParams, type MusicInput, type MusicParams } from './musicState';
import { MUSIC, THEMES, type MusicStyle, type TrackId } from './musicThemes';
import { mulberry32, scaleNote } from './theory';

export * from './musicComposer';

interface Track { piece: Piece; id: TrackId; ptr: number; beat: number; time: number; out: GainLike; /** Backend time the track started sounding. */ startedAt: number; /** Backend time when this track must stop (crossfade out). */ endAt: number; done: boolean }
interface Retiring { out: GainLike; at: number }

export interface MusicOpts { seed?: number; dayKey?: number }

/** Feedback-delay reverb (6 damped combs, two stereo taps): soft room tail, no impulse buffer, cheap, identical in the offline renderer. */
const COMBS = [0.0431, 0.0527, 0.0613, 0.0709, 0.0829, 0.0971];

/**
 * Lookahead step-sequencer. `tick()` (called every ~25 ms) schedules notes up to `MUSIC.lookahead` s ahead on the backend clock,
 * from pieces produced by the pure `composePiece`. A piece belongs to one of nine moods (`musicThemes.ts`) chosen by `chooseTrack` from the
 * game state (or locked by the player's Music style). Handles crossfades between tracks, pause/resume fades, silence gaps, tension and jingles.
 */
export class Music {
  params: MusicParams | null = null;
  readonly input: MusicInput = { season: 'winter', weather: 'clear', hour: 12, speed: 1, tension: 0 };
  tension = 0;
  stats = { notes: 0, dropped: 0, pieces: 0, crossfades: 0, late: 0, jingles: 0 };
  /** Tracks played, oldest first (capped at 12). */
  history: TrackId[] = [];
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
  private nextCheck = 0;
  private skipRequested = false;
  /** While the Settings dialog pauses the game, a Next / style change keeps the music audible for a while so it can be previewed. */
  private previewUntil = -1;
  private lastStyle: MusicStyle | null = null;
  private rng: () => number;
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
  get currentPiece(): Piece | null { return this.tracks[this.tracks.length - 1]?.piece ?? null; }
  /** Mood playing now (null in a silence gap / before the first piece). */
  get currentTrack(): TrackId | null { return this.tracks[this.tracks.length - 1]?.id ?? null; }
  get bpm(): number { const t = this.currentTrack; return this.params && t ? bpmFor(t, this.params.tempoMul) : 0; }

  setInputs(p: Partial<MusicInput>): void { Object.assign(this.input, p); }
  /** Crisis spike (0..1); decays over ~25 s. */
  addTension(x: number): void { this.tension = Math.min(1, Math.max(this.tension, x)); }
  /** Skip to another track (crossfade). In Auto the next track is drawn from what fits; with a locked style a fresh piece of that style. Works inside a silence gap too. */
  next(): void { this.skipRequested = true; this.previewUntil = this.engine.now() + MUSIC.previewSec; }

  private build(): boolean {
    const b = this.engine.backend, bus = this.engine.busNode('music'), noise = this.engine.noise;
    if (!b || !bus || !noise) return false;
    if (this.ctx) return true;
    // gate (pause / mute fade) -> soft tone low-pass -> music bus
    const tone = b.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = MUSIC.toneHz; tone.Q.value = 0; tone.connect(bus);
    const gate = b.createGain(); gate.gain.value = 0; gate.connect(tone); this.gate = gate;
    const mkDelay = b.createDelay?.bind(b);
    if (mkDelay) {
      const rin = b.createGain(), pre = mkDelay(0.1), ret = b.createGain(), a = b.createGain(), c = b.createGain(), pa = b.createStereoPanner(), pc = b.createStereoPanner();
      rin.gain.value = 1; pre.delayTime.value = 0.03; ret.gain.value = MUSIC.reverbWet; a.gain.value = 0.5; c.gain.value = 0.5; pa.pan.value = -0.85; pc.pan.value = 0.85;
      rin.connect(pre);
      COMBS.forEach((tm, i) => {
        const d = mkDelay(0.2), damp = b.createBiquadFilter(), fb = b.createGain();
        d.delayTime.value = tm; damp.type = 'lowpass'; damp.frequency.value = 2600; damp.Q.value = 0; fb.gain.value = 0.84;
        pre.connect(d); d.connect(damp); damp.connect(fb); fb.connect(d); damp.connect(i % 2 ? c : a);
      });
      a.connect(pa); c.connect(pc); pa.connect(ret); pc.connect(ret); ret.connect(gate);
      this.reverb = rin;
    }
    this.ctx = { b, noise, dest: gate, reverb: this.reverb };
    return true;
  }

  private style(): MusicStyle { return this.engine.settings.get().musicStyle; }
  private pick(exclude?: TrackId): TrackId { return chooseTrack(this.input, this.rng, this.history, this.style(), exclude); }

  /** Scheduler pass. Safe to call at any rate; does nothing until the engine is running. */
  tick(): void {
    if (!this.engine.running || !this.build()) { this.lastNow = null; return; }
    const b = this.engine.backend!, now = b.now(), st = this.engine.settings.get();
    const dt = this.lastNow === null ? 0 : Math.min(1, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    this.tension *= Math.exp(-dt / MUSIC.tensionDecayTc);
    this.input.tension = this.tension;
    const cur = this.tracks[this.tracks.length - 1];
    this.params = smoothParams(this.params, targetParams(this.input, THEMES[cur?.id ?? 'alpineNoon']), dt);
    this.reap(now);

    const want = st.musicOn && !st.muted && !st.ambienceOnly && !(st.pauseMusicAtZero && this.input.speed === 0 && now > this.previewUntil);
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

    this.decide(now);
    for (const t of [...this.tracks]) this.runTrack(t, now);
    for (const t of [...this.tracks]) if (t.done) this.finishTrack(t, now);
  }

  /** Track-level decisions: start the first piece, honour Next / Music style, swap a track that no longer fits the context. */
  private decide(now: number): void {
    const live = this.tracks.filter((t) => t.endAt === Infinity), cur = live[live.length - 1];
    const style = this.style(), styleChanged = this.lastStyle !== null && style !== this.lastStyle;
    this.lastStyle = style;
    if (styleChanged) this.previewUntil = now + MUSIC.previewSec;
    if (!cur) {
      if (this.skipRequested) { this.skipRequested = false; this.nextPieceAt = now; }
      if (this.nextPieceAt < 0) this.nextPieceAt = now + 1.5;
      if (this.tracks.length === 0 && now >= this.nextPieceAt) this.startTrack(this.pick(), now + 0.1, now, MUSIC.introFadeSec);
      return;
    }
    if (this.skipRequested) { this.skipRequested = false; this.crossfadeTo(this.pick(cur.id), now); return; }
    if (styleChanged && style !== 'auto' && cur.id !== style) { this.crossfadeTo(style, now); return; }
    if (now < this.nextCheck) return;
    this.nextCheck = now + 2;
    if (style === 'auto' && now - cur.startedAt >= MUSIC.minPlaySec && shouldSwap(cur.id, this.input)) this.crossfadeTo(this.pick(cur.id), now);
  }

  private startTrack(id: TrackId, time: number, now: number, fade: number): Track {
    const th = THEMES[id], seed = pieceSeed(this.seed, this.dayKey, this.pieceIndex, id);
    const root = nextRoot(this.lastRoot, th, mulberry32(seed ^ 0xabc));
    this.lastRoot = root; this.pieceIndex++;
    const piece = composePiece(seed, id, root);
    const out = this.ctx!.b.createGain();
    out.gain.value = fade > 0 ? 0 : 1;
    if (fade > 0) { out.gain.setValueAtTime(0, now); out.gain.linearRampToValueAtTime(1, now + fade); }
    out.connect(this.gate!);
    const t: Track = { piece, id, ptr: 0, beat: 0, time, out, startedAt: now, endAt: Infinity, done: false };
    this.tracks.push(t); this.stats.pieces++;
    this.history.push(id); if (this.history.length > 12) this.history.shift();
    return t;
  }

  private crossfadeTo(id: TrackId, now: number): void {
    const live = this.tracks.filter((t) => t.endAt === Infinity);
    for (const t of live) {
      t.out.gain.cancelScheduledValues(now); t.out.gain.setValueAtTime(1, now); t.out.gain.linearRampToValueAtTime(0, now + MUSIC.crossfadeSec);
      t.endAt = now + MUSIC.crossfadeSec;
    }
    this.stats.crossfades++;
    this.startTrack(id, now + 0.1, now, MUSIC.crossfadeSec);
  }

  private runTrack(t: Track, now: number): void {
    const p = this.params!, horizon = now + MUSIC.lookahead, step = MUSIC.stepBeats;
    while (t.time < horizon && !t.done) {
      const spb = 60 / bpmFor(t.id, p.tempoMul);
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
    this.voice('drone', midi, t.time, MUSIC.barBeats * spb, 0.5 + 0.5 * this.tension, t.out, 0);
  }

  private emit(e: NoteEvent, t: Track, spb: number, now: number): void {
    if (t.time < now) { this.stats.late++; return; } // never schedule into the past
    const w = this.params!.layers[e.layer];
    if (!(e.rank < w)) return;
    this.voice(e.inst, e.midi, t.time, e.dur * spb, e.vel * (0.6 + 0.4 * w), t.out, e.pan);
  }

  private voice(inst: Parameters<typeof playNote>[1], midi: number, time: number, dur: number, vel: number, dest: GainLike, pan: number): void {
    const live = this.voices.filter((v) => v.end > time).length;
    if (live >= MUSIC.maxVoices) { this.stats.dropped++; return; }
    const v = playNote({ ...this.ctx!, dest }, inst, midi, time, dur, vel, pan);
    if (v) { this.voices.push(v); this.stats.notes++; }
  }

  private finishTrack(t: Track, now: number): void {
    this.tracks.splice(this.tracks.indexOf(t), 1);
    this.retiring.push({ out: t.out, at: Math.max(now, t.time) + 5 });
    if (this.tracks.length === 0) this.nextPieceAt = Math.max(now, t.time) + MUSIC.gapMin + this.rng() * (MUSIC.gapMax - MUSIC.gapMin);
  }

  private reap(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) { const v = this.voices[i]!; if (v.end <= now) { v.scope.dispose(); this.voices.splice(i, 1); } }
    for (let i = this.retiring.length - 1; i >= 0; i--) { const r = this.retiring[i]!; if (r.at <= now) { try { r.out.disconnect(); } catch { /* ignore */ } this.retiring.splice(i, 1); } }
  }

  /** Short success motif (rating up): three soft harp notes in the current key (pentatonic); rate-limited. */
  jingle(): void {
    if (!this.engine.running || !this.ctx || !this.playing) return;
    const now = this.engine.now();
    if (now - this.lastJingle < MUSIC.jingleGap) return;
    this.lastJingle = now; this.stats.jingles++;
    const p = this.currentPiece, root = p?.root ?? 55, mode = p?.mode ?? 'ionian';
    [0, 2, 4].forEach((idx, i) => this.voice('harp', scaleNote(root, mode, idx + 7), now + 0.12 + i * 0.2, 0.4, 0.7, this.gate!, (i - 1) * 0.2));
  }

  dispose(): void {
    for (const v of this.voices.splice(0)) v.scope.dispose();
    for (const t of this.tracks.splice(0)) { try { t.out.disconnect(); } catch { /* ignore */ } }
    for (const r of this.retiring.splice(0)) { try { r.out.disconnect(); } catch { /* ignore */ } }
  }
}
