/**
 * `npm run audio:render [-- --seconds 90 --only morningSnow,apres --rate 32000]`: renders each procedural music track (and the ambience beds)
 * offline with the software Web Audio renderer (tests/audio/offlineBackend.ts) into `.weave/audio-preview/*.wav|ogg` and a spectrogram PNG into
 * `.weave/shots/`, then prints peak / RMS / DC / spectral stats. Needs ffmpeg for ogg + spectrograms (skipped when missing). Not a listening test.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { AMB_BASE, AMB_CASES, renderAudio } from '../tests/audio/renderHarness';
import { maxStepDb, spectrum, statsOf, tonalProminence, toWav16 } from '../tests/audio/offlineBackend';
import { THEMES, TRACK_IDS, type TrackId } from '../src/audio/musicThemes';
import type { MusicInput } from '../src/audio/musicState';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] ?? d : d; };
const seconds = Number(arg('seconds', '90')), rate = Number(arg('rate', '32000')), only = arg('only', '').split(',').filter(Boolean);
const dir = '.weave/audio-preview', shots = '.weave/shots', tag = arg('tag', 'v2');
mkdirSync(dir, { recursive: true }); mkdirSync(shots, { recursive: true });
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

const CTX: Record<TrackId, Partial<MusicInput>> = {
  morningSnow: { season: 'winter', hour: 8, weather: 'clear' }, alpineNoon: { season: 'winter', hour: 13 }, apres: { season: 'winter', hour: 19 }, starlight: { season: 'winter', hour: 23 },
  summerMeadow: { season: 'summer', hour: 12 }, autumnGold: { season: 'autumn', hour: 15 }, blizzard: { season: 'winter', hour: 12, weather: 'storm' }, title: { menu: true }, festival: { season: 'summer', hour: 14, festival: true, busy: 1 },
};
function emit(name: string, l: Float32Array, r: Float32Array, sr: number): void {
  const wav = `${dir}/${tag}-${name}.wav`;
  writeFileSync(wav, toWav16(l, r, sr));
  if (!hasFfmpeg) return;
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', '3', `${dir}/${tag}-${name}.ogg`]);
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-lavfi', 'showspectrumpic=s=1200x400:legend=1:scale=log:fscale=log:start=40:stop=12000:color=intensity', `${shots}/audio-${tag}-${name}.png`]);
}
const row = (n: string, l: Float32Array, sr: number): void => {
  const s = statsOf(l), sp = spectrum(l, sr);
  const band = (a: number, b: number): number => { let e = 0, t = 0; sp.bins.forEach((v, k) => { const hz = k * sr / 2048; t += v; if (hz >= a && hz < b) e += v; }); return t > 0 ? e / t * 100 : 0; };
  console.log(`${n.padEnd(14)} peak ${s.peak.toFixed(3)}  rms ${s.rmsDb.toFixed(1)} dB  dc ${s.dc.toExponential(1)}  jump ${s.maxJump.toFixed(3)}  centroid ${sp.centroid.toFixed(0)} Hz  >4k ${(sp.above(4000) * 100).toFixed(2)}%  >8k ${(sp.above(8000) * 100).toFixed(3)}%  bands <150:${band(0, 150).toFixed(0)} 150-600:${band(150, 600).toFixed(0)} 0.6-2k:${band(600, 2000).toFixed(0)} >2k:${band(2000, 1e5).toFixed(1)}`);
};
for (const id of TRACK_IDS) {
  if (only.length && !only.includes(id)) continue;
  const r = await renderAudio({ seconds, sampleRate: rate, seed: 11, settings: { musicStyle: id, music: 1, master: 1 }, music: CTX[id], ambience: null });
  row(THEMES[id].name, r.l, rate); emit(id, r.l, r.r, rate);
}
if (!only.length || only.includes('ambience')) {
  for (const [n, patch] of Object.entries(AMB_CASES)) {
    const r = await renderAudio({ seconds: Math.min(seconds, 45), sampleRate: rate, seed: 7, settings: { ambience: 1, master: 1 }, ambience: { ...AMB_BASE, ...patch }, musicOn: false });
    const x = r.l.subarray(rate * 8), tp = tonalProminence(x, rate);
    row(`amb-${n}`, x, rate); console.log(`${''.padEnd(14)} tonal ${tp.db.toFixed(1)} dB @ ${tp.hz.toFixed(0)} Hz   burst ${maxStepDb(x, rate).toFixed(1)} dB`); emit(`amb-${n}`, r.l, r.r, rate);
  }
}
