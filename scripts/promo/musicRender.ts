/** Renders the promo music edit (music.ts planEdit + refineSeam) to a 48 kHz stereo wav at -18 LUFS, and the +/- 3 s seam-check snippets.
 *    (CLI: scripts/promo/musicCheck.ts)
 *  assemble.ts calls `buildMusic` for the real films (same code, so what you listen to here is what ships). Features: promo/music-<song>.json (scripts/promo/musicFeatures.py). */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { naturalBaseline, pct, planEdit, refineSeam, type SongFeatures } from './music';

const run = (cmd: string, args: string[]): string => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error(`${cmd} failed: ${String(r.stderr).slice(-1500)}`); return String(r.stdout) + String(r.stderr); };
export const lufs = (f: string): number => { const t = run('ffmpeg', ['-nostats', '-i', f, '-af', 'ebur128=peak=true', '-f', 'null', '-']); const m = /I:\s+(-?[\d.]+) LUFS/g; let g: RegExpExecArray | null, last = ''; while ((g = m.exec(t))) last = g[1]!; return Number(last); };
export function loadSong(song: string): { sig: Float32Array; feat: SongFeatures; path: string } {
  const path = `public/audio/menu-${song}.mp3`; const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return { sig: new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + Math.floor(r.stdout.length / 4) * 4)), feat: JSON.parse(readFileSync(`promo/music-${song}.json`, 'utf8')), path };
}
export interface MusicInfo { song: string; start: number; a: number; b: number | null; xf: number; rate: number; score: number; cosPre: number; cosPost: number; cosAt: number; cosAcross: number; dDb: number; refineCorr: number; landing: number; naturalCosP10: number; naturalCosMedian: number; naturalDbMedian: number; naturalDbP90: number; gainDb: number; lufs: number; outA: number | null }
/** Plan + render. `total` = the film length, `endCard` = its end card (the song's final cadence should land there). Returns the edit report; writes `wav`. */
export function buildMusic(cut: '90' | '30', total: number, endCard: number, song: string, wav: string, loaded = loadSong(song)): MusicInfo {
  const xfa = 0.1; const { sig, feat, path } = loaded; const ed = planEdit(feat, { total, endCard, xf: xfa, startSections: cut === '30', minBody: cut === '30' ? 5 : 8 }, 1)[0]!;
  const rf0 = ed.cut ? refineSeam(sig, 8000, ed.a, ed.b) : { b: ed.b, corr: 1 };
  const rf = rf0.corr >= 0.3 ? rf0 : { b: ed.b, corr: rf0.corr }; const b2 = rf.b; // soft pads often give no usable envelope match: then keep the tracked beat
  const len = ed.cut ? (ed.a - ed.start) + (feat.dur - b2) : feat.dur - ed.start; const rate = len / total;
  const fin = ed.start === 0 ? 1.5 : 0.5; // the natural intro needs at most a 1.5 s fade-in; a section start gets a short 0.5 s one
  const body = ed.cut ? `[0:a]asplit=2[a1][a2];[a1]atrim=start=${ed.start.toFixed(4)}:end=${ed.a.toFixed(4)},asetpts=PTS-STARTPTS[A];[a2]atrim=start=${(b2 - xfa).toFixed(4)},asetpts=PTS-STARTPTS[B];[A][B]acrossfade=d=${xfa}:c1=qsin:c2=qsin` : `[0:a]atrim=start=${ed.start.toFixed(4)},asetpts=PTS-STARTPTS`;
  // the song decays to silence on its own; the only fade at the end is a 0.5 s anti-click one. Static gain to -18 LUFS (no dynamic loudnorm: it would pump the quiet decay up).
  const mk = (gain: number): void => { run('ffmpeg', ['-v', 'error', '-y', '-i', path, '-filter_complex', `${body},atempo=${rate.toFixed(5)},volume=${gain.toFixed(2)}dB,alimiter=limit=0.89,afade=t=in:st=0:d=${fin},afade=t=out:st=${(total - 0.5).toFixed(2)}:d=0.5,apad=whole_dur=${total.toFixed(3)},atrim=duration=${total.toFixed(3)}[m]`, '-map', '[m]', '-ar', '48000', '-ac', '2', wav]); };
  mk(0); const l0 = lufs(wav); const gain = Number.isFinite(l0) ? -18 - l0 : 0; if (Math.abs(gain) > 0.1) mk(gain);
  const nb = naturalBaseline(feat); const r2 = (v: number): number => Number(v.toFixed(2));
  return { song, start: r2(ed.start), a: Number(ed.a.toFixed(3)), b: ed.cut ? Number(b2.toFixed(3)) : null, xf: ed.cut ? xfa : 0, rate: Number(rate.toFixed(5)), score: Number(ed.score.toFixed(3)), cosPre: r2(ed.cosPre), cosPost: r2(ed.cosPost), cosAt: r2(ed.cosAt), cosAcross: r2(ed.cosAcross), dDb: r2(ed.dDb), refineCorr: Number(rf.corr.toFixed(3)), landing: Number(ed.landing.toFixed(1)),
    naturalCosP10: r2(pct(nb.cos, 0.1)), naturalCosMedian: r2(pct(nb.cos, 0.5)), naturalDbMedian: r2(pct(nb.dDb, 0.5)), naturalDbP90: r2(pct(nb.dDb, 0.9)), gainDb: r2(gain), lufs: lufs(wav), outA: ed.cut ? Number(((ed.a - ed.start) / rate).toFixed(3)) : null };
}

