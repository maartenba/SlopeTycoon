/**
 * `npm run audio:crosscheck`: renders the same music tracks / ambience states with (a) the software renderer used by the tests and (b) the real browser
 * OfflineAudioContext (installed Chrome, headless, own throw-away profile; only that process is closed), and prints peak / RMS / centroid / band shares side by side.
 * Purpose: shows the software renderer is a faithful stand-in (it is not bit-exact: filters are k-rate per block, compressor makeup differs).
 */
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { renderAudio, AMB_BASE, AMB_CASES } from '../tests/audio/renderHarness';
import { spectrum, statsOf } from '../tests/audio/offlineBackend';

const CHROMES = [process.env.CHROME_PATH ?? '', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const exe = CHROMES.find((p) => existsSync(p));
if (!exe) { console.log('no Chrome found, skipping'); process.exit(0); }
const out = await build({ entryPoints: ['scripts/lib/audioCrossEntry.ts'], bundle: true, write: false, format: 'iife', target: 'es2022' });
const code = out.outputFiles[0]!.text;
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check'] });
const SR = 24000, SEC = 30, T0 = 8;
const dec = (b64: string): Float32Array => { const buf = Buffer.from(b64, 'base64'); return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4); };
const sum = (n: string, x: Float32Array): string => { const s = statsOf(x.subarray(SR * T0)), sp = spectrum(x.subarray(SR * T0), SR); return `${n.padEnd(26)} peak ${s.peak.toFixed(3)} rms ${s.rmsDb.toFixed(1)} dB centroid ${sp.centroid.toFixed(0).padStart(5)} Hz  >2k ${(sp.above(2000) * 100).toFixed(1).padStart(5)}%`; };
try {
  const page = await browser.newPage(); await page.setContent('<html></html>'); await page.addScriptTag({ content: code });
  const jobs: Array<[string, Record<string, unknown>, Parameters<typeof renderAudio>[0]]> = [
    ['music alpineNoon', { style: 'alpineNoon', music: { hour: 13 } }, { musicStyle: 'x' } as never],
  ];
  void jobs;
  const musics: Array<['morningSnow' | 'apres' | 'summerMeadow' | 'blizzard', Record<string, unknown>]> = [['morningSnow', { hour: 8 }], ['apres', { hour: 19 }], ['summerMeadow', { season: 'summer', hour: 12 }], ['blizzard', { weather: 'storm' }]];
  for (const [id, ctxIn] of musics) {
    const sw = await renderAudio({ seconds: SEC, sampleRate: SR, seed: 21, settings: { musicStyle: id, music: 0.3, master: 1 }, music: ctxIn as never, ambience: null });
    const br = await page.evaluate((j) => (window as never as { run: (j: unknown) => Promise<{ l: string }> }).run(j), { seconds: SEC, sr: SR, style: id, music: ctxIn, ambience: null, seed: 21, volume: 0.3 });
    console.log(sum(`soft  ${id}`, sw.l)); console.log(sum(`chrome ${id}`, dec(br.l)));
  }
  for (const n of ['wind', 'crowd', 'water', 'rain']) {
    const st = { ...AMB_BASE, ...AMB_CASES[n] };
    const sw = await renderAudio({ seconds: SEC, sampleRate: SR, seed: 7, settings: { ambience: 0.3, master: 1 }, ambience: st, musicOn: false });
    const br = await page.evaluate((j) => (window as never as { run: (j: unknown) => Promise<{ l: string }> }).run(j), { seconds: SEC, sr: SR, ambience: st, seed: 7, volume: 0.3 });
    console.log(sum(`soft  amb-${n}`, sw.l)); console.log(sum(`chrome amb-${n}`, dec(br.l)));
  }
} finally { await browser.close(); }
