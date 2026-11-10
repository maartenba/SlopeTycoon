/* eslint-disable @typescript-eslint/no-explicit-any -- manifest JSON + page.evaluate */
/** Promo assembler (M7.6.2, docs/promo-video.md): frames -> clips (+ burned-in captions) -> crossfades -> end card -> music -> mp4 (+ web encodes).
 *   npx vite-node scripts/promo/assemble.ts --draft|--final --cut 90|30|both [--tag 4k] [--out .weave/promo/out] [--no-music] [--no-web]
 * `--tag 4k` reads frames/final-4k (3840x2160) and writes the master `final-<cut>-4k.mp4` plus `web/` (1080p / 1440p H.264, 1080p VP9 + AV1 WebM, posters); `both` builds the 90 s cut and the 30 s teaser.
 * Captions and the end card are rendered by the installed Chrome (this ffmpeg build has no drawtext) with the game's own fonts (public/fonts, Nunito + Lilita One) as transparent PNGs.
 * Each clip is padded by the crossfade length (frozen last frame) so the cut keeps the manifest durations (90 s / 30 s). Music: public/audio/menu-seasons-of-management.mp3,
 * loudness-normalised to about -18 LUFS; the 90 s cut fades in 1.5 s and out over the last 3 s, the teaser uses the strongest 30 s window (loudness + onset density, `analyseMusic`). */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { launch, startServer } from '../lib/harness';
import { cutClips, parseCuts, type Cut } from './cuts';

const arg = (k: string, d = ''): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[i + 1]! : i > 0 ? '1' : d; };
const final = arg('final') === '1';
const TAG = arg('tag'); const is4k = TAG === '4k';
const RES = (final ? 'final' : 'draft') + (TAG ? `-${TAG}` : ''); // the frames dir under .weave/promo/frames
const W = Number(arg('w', is4k ? '3840' : final ? '2560' : '1280')), H = Number(arg('h', is4k ? '2160' : final ? '1440' : '720'));
const CUTS = parseCuts(arg('cut', '90'));
const OUT = arg('out', '.weave/promo/out'), ASSETS = `${OUT}/tmp-${RES}-assets`;
mkdirSync(ASSETS, { recursive: true }); mkdirSync(`${OUT}/web`, { recursive: true });
const manifest = JSON.parse(readFileSync(arg('manifest', 'promo/scenes.json'), 'utf8')); const FILM = manifest.film;
const fps: number = final ? FILM.fps : FILM.draftFps;
const MUSIC = 'public/audio/menu-seasons-of-management.mp3';
const run = (cmd: string, args: string[], opt: any = {}): string => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opt }); if (r.status !== 0) throw new Error(`${cmd} failed: ${String(r.stderr).slice(-1500)}`); return String(r.stdout); };
const ff = (args: string[]): string => run('ffmpeg', ['-v', 'error', '-y', ...args]);

/** Strongest 30 s window of the song: mean RMS + onset density (positive spectral-flux proxy: rises of the 0.1 s RMS envelope). */
function analyseMusic(len: number): { start: number; score: number; table: Array<{ start: number; score: number }> } {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', MUSIC, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const s = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4)); const hop = 800; const env: number[] = [];
  for (let i = 0; i + hop <= s.length; i += hop) { let a = 0; for (let j = 0; j < hop; j++) a += s[i + j]! * s[i + j]!; env.push(Math.sqrt(a / hop)); }
  const on = env.map((v, i) => (i ? Math.max(0, v - env[i - 1]!) : 0)); const mx = Math.max(...env), mo = Math.max(...on, 1e-9); const n = Math.round(len * 10);
  const table: Array<{ start: number; score: number }> = [];
  for (let st = 20; st + n <= env.length - 10; st += 5) { let a = 0, o = 0; for (let i = st; i < st + n; i++) { a += env[i]!; o += on[i]!; } table.push({ start: st / 10, score: (a / n / mx) * 0.6 + (o / n / mo) * 0.4 }); }
  table.sort((x, y) => y.score - x.score);
  return { start: table[0]!.start, score: table[0]!.score, table: table.slice(0, 3) };
}

const fontB64 = (f: string): string => readFileSync(`public/fonts/${f}`).toString('base64');
const FONTS = `@font-face{font-family:Nunito;font-weight:200 1000;src:url(data:font/woff2;base64,${fontB64('nunito-latin.woff2')})}@font-face{font-family:'Lilita One';src:url(data:font/woff2;base64,${fontB64('lilita-one-latin.woff2')})}`;

const srv = await startServer(); const br = await launch();
const COL = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']; // every output carries bt709 / tv-range tags
const SCALE_IN = 'flags=lanczos+accurate_rnd+full_chroma_int:in_range=pc:in_color_matrix=bt601:out_range=tv:out_color_matrix=bt709'; // JPEG frames (JFIF = BT.601, full range) -> BT.709 limited
const SCALE_TV = 'flags=lanczos+accurate_rnd+full_chroma_int:in_range=tv:in_color_matrix=bt709:out_range=tv:out_color_matrix=bt709'; // limited -> limited, a pure resize
const ebur = (f: string): string => { const lk = spawnSync('ffmpeg', ['-nostats', '-i', f, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }); const m = /I:\s+(-?[\d.]+) LUFS/g; let g: RegExpExecArray | null, last = ''; while ((g = m.exec(lk.stderr))) last = g[1]!; return last; };
const timings: Record<string, number> = {}; const timed = <T>(k: string, f: () => T): T => { const t0 = Date.now(); const r = f(); timings[k] = Math.round((Date.now() - t0) / 1000); console.log(`[assemble] ${k}: ${timings[k]} s`); return r; };
const kb = (f: string): number => Math.round(statSync(f).size / 1024);
try {
  const page = await br.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  // ---- caption + end card PNGs, rendered AT the target resolution (never upscaled; all sizes are relative to H) ----
  const allShots: any[] = [...FILM.shots, { id: 'end-card', endCard: true, len: FILM.endCard.len, cuts: FILM.endCard.cuts }];
  for (const s of allShots) {
    if (s.caption) {
      await page.setContent(`<style>${FONTS}html,body{margin:0;background:transparent}div{position:fixed;left:${H * 0.05}px;bottom:${H * 0.07}px;max-width:${W * 0.62}px;padding:${H * 0.014}px ${H * 0.026}px;border-radius:${H * 0.022}px;background:rgba(10,18,32,.55);color:#fff;font:800 ${H * 0.048}px Nunito,system-ui,sans-serif;letter-spacing:.01em;text-shadow:0 ${H * 0.003}px ${H * 0.012}px rgba(0,0,0,.6)}</style><div>${String(s.caption).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${ASSETS}/cap-${s.id}.png`, omitBackground: true });
    }
  }
  const ec = `${ASSETS}/endcard.png`;
  await page.goto(`${srv.url}?uikit=logo-full`, { waitUntil: 'load', timeout: 120000 }); await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate((c: any) => {
    const root = document.createElement('div'); root.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.2vh;background:radial-gradient(120% 90% at 50% 20%,#27456e 0%,#142238 55%,#0a1220 100%);color:#fff;font-family:Nunito,system-ui,sans-serif;text-align:center';
    const logo = Array.from(document.querySelectorAll('svg,img,canvas')).find((e) => (e as HTMLElement).getBoundingClientRect().width > 100) as HTMLElement | undefined;
    if (logo) { const clone = logo.cloneNode(true) as HTMLElement; clone.style.cssText = 'width:46vw;max-height:40vh;height:auto'; root.appendChild(clone); }
    const l1 = document.createElement('div'); l1.textContent = c.line1; l1.style.cssText = 'font:700 5.2vh Nunito,system-ui,sans-serif;letter-spacing:.02em';
    const l2 = document.createElement('div'); l2.textContent = c.line2; l2.style.cssText = 'font:400 4vh Lilita One,Nunito,system-ui,sans-serif;color:#9fd0ff'; root.append(l1, l2); document.body.appendChild(root);
  }, FILM.endCard);
  await new Promise((r) => setTimeout(r, 800)); await page.screenshot({ path: ec }); await page.close();

  for (const cut of CUTS) await buildCut(cut);
} finally { await br.close(); srv.stop(); }

async function buildCut(cut: Cut): Promise<void> {
  const TMP = `${OUT}/tmp-${RES}-${cut}`; mkdirSync(TMP, { recursive: true });
  const xf: number = FILM.cuts[`c${cut}`].xfade;
  const plan = cutClips(FILM, cut); // the teaser reuses the 90 s shots (first `len` seconds from `from`)
  const clips: Array<{ id: string; file: string; len: number }> = [];
  const ec = `${ASSETS}/endcard.png`;
  const hq = final; const enc = ['-c:v', 'libx264', '-preset', hq ? 'veryfast' : 'veryfast', '-crf', hq ? '8' : '20', '-pix_fmt', 'yuv420p', '-r', String(fps), '-an']; // intermediates: near-lossless, fast
  const reuse = arg('reuse') === '1' && existsSync(`${TMP}/silent.mp4`); // --reuse 1: keep the picture master of a previous run, redo audio + web encodes only
  timed(`${cut}: clips`, () => {
    for (let i = 0; i < plan.length; i++) {
      const s = plan[i]!.shot; const last = i === plan.length - 1; const { len, from } = plan[i]!;
      const pad = last ? 0 : xf; const file = `${TMP}/${s.id}.mp4`;
      const stages: string[] = []; const ins: string[] = [];
      if (s.endCard) ins.push('-loop', '1', '-framerate', String(fps), '-i', ec); else ins.push('-framerate', String(fps), '-start_number', String(Math.round(from * fps) + 1), '-i', `.weave/promo/frames/${RES}/${s.id}/%05d.jpg`);
      stages.push(`[0:v]scale=${W}:${H}:${final ? SCALE_IN : 'flags=lanczos'},format=yuv420p,tpad=stop_mode=clone:stop_duration=${pad},trim=duration=${len + pad},setpts=PTS-STARTPTS${s.endCard ? `,fade=in:st=0:d=0.001,fade=out:st=${Math.max(0, len - 1)}:d=1` : ''}[v]`);
      let map = '[v]';
      if (s.caption && !s.endCard) { const t0 = 0.4, t1 = Math.max(t0 + 1, len - 0.3); ins.push('-loop', '1', '-framerate', String(fps), '-i', `${ASSETS}/cap-${s.id}.png`); stages.push(`[1:v]format=rgba,fade=in:st=${t0}:d=0.4:alpha=1,fade=out:st=${t1 - 0.4}:d=0.4:alpha=1[cap]`, `[v][cap]overlay=0:0:shortest=1,format=yuv420p[o]`); map = '[o]'; }
      if (!reuse) ff([...ins, '-filter_complex', stages.join(';'), '-map', map, '-frames:v', String(Math.round((len + pad) * fps)), ...enc, file]);
      clips.push({ id: s.id, file, len });
    }
  });
  // ---- crossfade chain: the picture master (silent), 4:2:0 BT.709 limited ----
  const total = clips.reduce((a, c) => a + c.len, 0);
  const inArgs = clips.flatMap((c) => ['-i', c.file]); const parts: string[] = []; let acc = 0; let prev = '[0:v]';
  for (let i = 1; i < clips.length; i++) { acc += clips[i - 1]!.len; const lab = i === clips.length - 1 ? '[vout]' : `[x${i}]`; parts.push(`${prev}[${i}:v]xfade=transition=fade:duration=${xf}:offset=${acc.toFixed(3)}${lab}`); prev = lab; }
  const silent = `${TMP}/silent.mp4`;
  if (!reuse) timed(`${cut}: crossfade + master encode`, () => ff([...inArgs, '-filter_complex', parts.join(';'), '-map', '[vout]', '-c:v', 'libx264', '-preset', final ? 'slow' : 'veryfast', '-crf', is4k ? '16' : final ? '14' : '17', '-pix_fmt', 'yuv420p', ...(final ? COL : []), '-r', String(fps), '-an', silent]));
  // ---- music: loudnorm, fades, then a measured gain trim so the integrated loudness lands on -18 LUFS ----
  const outFile = `${OUT}/${RES.replace('final-4k', 'final')}-${cut}${is4k ? '-4k' : ''}.mp4`; const info: any = { cut, res: RES, W, H, fps, total, clips: clips.map((c) => ({ id: c.id, len: c.len })) };
  const wav = `${TMP}/music.wav`;
  if (arg('no-music') !== '1') {
    let start = 0; if (cut === '30') { const a = analyseMusic(total); start = a.start; info.musicWindow = a; }
    const fin = cut === '30' ? 0.5 : 1.5, fout = cut === '30' ? 2 : 3;
    const mk = (gain: number): void => { ff(['-ss', String(start), '-t', String(total + 0.5), '-i', MUSIC, '-af', `loudnorm=I=-18:TP=-1.5:LRA=11,volume=${gain.toFixed(2)}dB,afade=t=in:st=0:d=${fin},afade=t=out:st=${(total - fout).toFixed(2)}:d=${fout},atrim=duration=${total.toFixed(3)}`, '-ar', '48000', '-ac', '2', wav]); };
    mk(0); const l0 = Number(ebur(wav)); const gain = Number.isFinite(l0) ? -18 - l0 : 0; if (Math.abs(gain) > 0.15) mk(gain); info.audioTrimDb = Number(gain.toFixed(2));
    ff(['-i', silent, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', ...(final ? COL : []), '-t', total.toFixed(3), '-movflags', '+faststart', outFile]);
    info.lufs = ebur(outFile);
  } else ff(['-i', silent, '-c', 'copy', '-movflags', '+faststart', outFile]);
  const poster = outFile.replace(/\.mp4$/, '-poster.jpg'); ff(['-ss', String(Math.min(total - 1, cut === '90' ? 38 : 9)), '-i', outFile, '-frames:v', '1', '-q:v', '2', poster]);
  const dur = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outFile]).trim(); info.duration = Number(dur); info.file = outFile; info.poster = poster; info.master = { W, H, kb: kb(outFile) };
  // ---- web encodes from the master picture (lanczos downscale): 1080p / 1440p H.264, 1080p VP9 + AV1 WebM ----
  if (is4k && arg('no-web') !== '1') {
    const web = `${OUT}/web`; const base = `slope-tycoon-${cut}`; const hasA = existsSync(wav); const opus = `${TMP}/music.opus`;
    if (hasA) ff(['-i', wav, '-c:a', 'libopus', '-b:a', '160k', opus]);
    const vf = (w: number, h: number): string[] => ['-vf', `scale=${w}:${h}:${SCALE_TV},format=yuv420p`];
    const rate = cut === '90' ? { m1080: ['-crf', '19', '-maxrate', '2.7M', '-bufsize', '6M'], m1440: ['-crf', '19', '-maxrate', '6.5M', '-bufsize', '14M'] } : { m1080: ['-crf', '19', '-maxrate', '2.7M', '-bufsize', '6M'], m1440: ['-crf', '19', '-maxrate', '6.5M', '-bufsize', '14M'] };
    const a264 = hasA ? ['-i', wav, '-map', '1:a', '-c:a', 'aac', '-b:a', '192k'] : [];
    const out: Record<string, { file: string; kb: number; s: number }> = {};
    const enc264 = (name: string, w: number, h: number, r: string[]): void => { const f = `${web}/${base}-${name}.mp4`; const t0 = Date.now(); ff(['-i', silent, ...a264, '-map', '0:v', ...vf(w, h), '-c:v', 'libx264', '-preset', 'slow', ...r, '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...COL, '-r', String(fps), '-t', total.toFixed(3), '-movflags', '+faststart', f]); out[name] = { file: f, kb: kb(f), s: Math.round((Date.now() - t0) / 1000) }; console.log(`[assemble] web ${name}: ${(kb(f) / 1024).toFixed(1)} MB in ${out[name]!.s} s`); };
    enc264('1080p', 1920, 1080, rate.m1080); enc264('1440p', 2560, 1440, rate.m1440);
    if (arg('no-webm') !== '1') {
      const aw = hasA ? ['-i', opus, '-map', '1:a', '-c:a', 'copy'] : [];
      const v9 = `${web}/${base}-1080p-vp9.webm`; let t0 = Date.now();
      ff(['-i', silent, ...aw, '-map', '0:v', ...vf(1920, 1080), '-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '3M', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-tile-columns', '2', '-pix_fmt', 'yuv420p', ...COL, '-r', String(fps), '-t', total.toFixed(3), v9]); out['1080p-vp9'] = { file: v9, kb: kb(v9), s: Math.round((Date.now() - t0) / 1000) }; console.log(`[assemble] web vp9: ${(kb(v9) / 1024).toFixed(1)} MB in ${out['1080p-vp9']!.s} s`);
      const a1 = `${web}/${base}-1080p-av1.webm`; t0 = Date.now();
      ff(['-i', silent, ...aw, '-map', '0:v', ...vf(1920, 1080), '-c:v', 'libsvtav1', '-preset', '6', '-crf', '38', '-g', '120', '-pix_fmt', 'yuv420p', ...COL, '-r', String(fps), '-t', total.toFixed(3), a1]); out['1080p-av1'] = { file: a1, kb: kb(a1), s: Math.round((Date.now() - t0) / 1000) }; console.log(`[assemble] web av1: ${(kb(a1) / 1024).toFixed(1)} MB in ${out['1080p-av1']!.s} s`);
    }
    ff(['-ss', String(Math.min(total - 1, cut === '90' ? 38 : 9)), '-i', outFile, '-frames:v', '1', '-vf', `scale=1920:1080:${SCALE_TV}`, '-q:v', '2', `${web}/${base}-poster.jpg`]);
    info.web = out;
  }
  info.timings = { ...timings };
  writeFileSync(`${OUT}/${RES}-${cut}.manifest.json`, JSON.stringify(info, null, 1)); console.log(JSON.stringify({ ...info, clips: undefined, web: undefined }));
}
