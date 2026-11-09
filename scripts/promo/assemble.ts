/* eslint-disable @typescript-eslint/no-explicit-any -- manifest JSON + page.evaluate */
/** Promo assembler (M7.6.2, docs/promo-video.md): frames -> clips (+ burned-in captions) -> crossfades -> end card -> music -> mp4.
 *   npx vite-node scripts/promo/assemble.ts --draft|--final --cut 90|30 [--out .weave/promo/out] [--no-music]
 * Captions and the end card are rendered by the installed Chrome (this ffmpeg build has no drawtext) with the game's own fonts (public/fonts, Nunito + Lilita One) as transparent PNGs.
 * Each clip is padded by the crossfade length (frozen last frame) so the cut keeps the manifest durations (90 s / 30 s). Music: public/audio/menu-seasons-of-management.mp3,
 * loudness-normalised to about -18 LUFS; the 90 s cut fades in 1.5 s and out over the last 3 s, the teaser uses the strongest 30 s window (loudness + onset density, `analyseMusic`). */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { launch, startServer } from '../lib/harness';

const arg = (k: string, d = ''): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[i + 1]! : i > 0 ? '1' : d; };
const final = arg('final') === '1', RES = final ? 'final' : 'draft';
const W = Number(arg('w', final ? '2560' : '1280')), H = Number(arg('h', final ? '1440' : '720'));
const cut = arg('cut', '90') === '30' ? '30' : '90';
const OUT = arg('out', '.weave/promo/out'), TMP = `${OUT}/tmp-${RES}-${cut}`;
mkdirSync(TMP, { recursive: true });
const manifest = JSON.parse(readFileSync(arg('manifest', 'promo/scenes.json'), 'utf8')); const FILM = manifest.film;
const fps: number = final ? FILM.fps : FILM.draftFps;
const MUSIC = 'public/audio/menu-seasons-of-management.mp3';
const run = (cmd: string, args: string[], opt: any = {}): string => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opt }); if (r.status !== 0) throw new Error(`${cmd} failed: ${String(r.stderr).slice(-1500)}`); return String(r.stdout); };
const ff = (args: string[]): string => run('ffmpeg', ['-v', 'error', '-y', ...args]);
const xf: number = FILM.cuts[`c${cut}`].xfade;
const order: string[] = FILM.cuts[`c${cut}`].order ?? [...FILM.shots.filter((x: any) => x.cuts[`c${cut}`]).map((x: any) => x.id), 'end-card']; // the teaser reuses the 90 s shots (first `len` seconds from `from`)

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
const clips: Array<{ id: string; file: string; len: number }> = [];
try {
  const page = await br.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  // ---- caption + end card PNGs ----
  const shots: any[] = [...FILM.shots, { id: 'end-card', endCard: true, len: FILM.endCard.len, cuts: FILM.endCard.cuts }];
  const used = order.map((id) => shots.find((s) => s.id === id || (id === 'end-card' && s.endCard))).filter(Boolean);
  for (const s of used) {
    if (s.caption) {
      await page.setContent(`<style>${FONTS}html,body{margin:0;background:transparent}div{position:fixed;left:${H * 0.05}px;bottom:${H * 0.07}px;max-width:${W * 0.62}px;padding:${H * 0.014}px ${H * 0.026}px;border-radius:${H * 0.022}px;background:rgba(10,18,32,.55);color:#fff;font:800 ${H * 0.048}px Nunito,system-ui,sans-serif;letter-spacing:.01em;text-shadow:0 ${H * 0.003}px ${H * 0.012}px rgba(0,0,0,.6)}</style><div>${String(s.caption).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${TMP}/cap-${s.id}.png`, omitBackground: true });
    }
  }
  const ec = `${TMP}/endcard.png`;
  await page.goto(`${srv.url}?uikit=logo-full`, { waitUntil: 'load', timeout: 120000 }); await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate((c: any) => {
    const root = document.createElement('div'); root.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.2vh;background:radial-gradient(120% 90% at 50% 20%,#27456e 0%,#142238 55%,#0a1220 100%);color:#fff;font-family:Nunito,system-ui,sans-serif;text-align:center';
    const logo = Array.from(document.querySelectorAll('svg,img,canvas')).find((e) => (e as HTMLElement).getBoundingClientRect().width > 100) as HTMLElement | undefined;
    if (logo) { const clone = logo.cloneNode(true) as HTMLElement; clone.style.cssText = 'width:46vw;max-height:40vh;height:auto'; root.appendChild(clone); }
    const l1 = document.createElement('div'); l1.textContent = c.line1; l1.style.cssText = 'font:700 5.2vh Nunito,system-ui,sans-serif;letter-spacing:.02em';
    const l2 = document.createElement('div'); l2.textContent = c.line2; l2.style.cssText = 'font:400 4vh Lilita One,Nunito,system-ui,sans-serif;color:#9fd0ff'; root.append(l1, l2); document.body.appendChild(root);
  }, FILM.endCard);
  await new Promise((r) => setTimeout(r, 800)); await page.screenshot({ path: ec }); await page.close();

  // ---- clips ----
  for (let i = 0; i < used.length; i++) {
    const s = used[i]!; const last = i === used.length - 1; const c = s.cuts[`c${cut}`]; const len: number = (typeof c === 'object' && c.len) || s.len; const from: number = (typeof c === 'object' && c.from) || 0;
    const pad = last ? 0 : xf; const file = `${TMP}/${s.id}.mp4`;
    const enc = ['-c:v', 'libx264', '-preset', final ? 'slow' : 'veryfast', '-crf', final ? '12' : '20', '-pix_fmt', 'yuv420p', '-r', String(fps), '-an'];
    const stages: string[] = []; const ins: string[] = [];
    if (s.endCard) ins.push('-loop', '1', '-framerate', String(fps), '-i', ec); else ins.push('-framerate', String(fps), '-start_number', String(Math.round(from * fps) + 1), '-i', `.weave/promo/frames/${RES}/${s.id}/%05d.jpg`);
    stages.push(`[0:v]scale=${W}:${H}:flags=lanczos,format=yuv420p,tpad=stop_mode=clone:stop_duration=${pad},trim=duration=${len + pad},setpts=PTS-STARTPTS${s.endCard ? `,fade=in:st=0:d=0.001,fade=out:st=${Math.max(0, len - 1)}:d=1` : ''}[v]`);
    let map = '[v]';
    if (s.caption && !s.endCard) { const t0 = 0.4, t1 = Math.max(t0 + 1, len - 0.3); ins.push('-loop', '1', '-framerate', String(fps), '-i', `${TMP}/cap-${s.id}.png`); stages.push(`[1:v]format=rgba,fade=in:st=${t0}:d=0.4:alpha=1,fade=out:st=${t1 - 0.4}:d=0.4:alpha=1[cap]`, `[v][cap]overlay=0:0:shortest=1,format=yuv420p[o]`); map = '[o]'; }
    ff([...ins, '-filter_complex', stages.join(';'), '-map', map, '-frames:v', String(Math.round((len + pad) * fps)), ...enc, file]);
    clips.push({ id: s.id, file, len });
  }
  // ---- crossfade chain ----
  const total = clips.reduce((a, c) => a + c.len, 0);
  const inArgs = clips.flatMap((c) => ['-i', c.file]); const parts: string[] = []; let acc = 0; let prev = '[0:v]';
  for (let i = 1; i < clips.length; i++) { acc += clips[i - 1]!.len; const o = acc; const lab = i === clips.length - 1 ? '[vout]' : `[x${i}]`; parts.push(`${prev}[${i}:v]xfade=transition=fade:duration=${xf}:offset=${o.toFixed(3)}${lab}`); prev = lab; }
  const silent = `${TMP}/silent.mp4`;
  ff([...inArgs, '-filter_complex', parts.join(';'), '-map', '[vout]', '-c:v', 'libx264', '-preset', final ? 'slow' : 'veryfast', '-crf', final ? '14' : '17', '-pix_fmt', 'yuv420p', '-r', String(fps), '-an', silent]);
  // ---- music ----
  const outFile = `${OUT}/${RES}-${cut}.mp4`; const info: any = { cut, res: RES, W, H, fps, total, clips: clips.map((c) => ({ id: c.id, len: c.len })) };
  if (arg('no-music') !== '1') {
    let start = 0; if (cut === '30') { const a = analyseMusic(total); start = a.start; info.musicWindow = a; }
    const fin = cut === '30' ? 0.5 : 1.5, fout = cut === '30' ? 2 : 3;
    ff(['-i', silent, '-ss', String(start), '-t', String(total + 0.5), '-i', MUSIC, '-filter_complex', `[1:a]loudnorm=I=-18:TP=-1.5:LRA=11,afade=t=in:st=0:d=${fin},afade=t=out:st=${(total - fout).toFixed(2)}:d=${fout},atrim=duration=${total.toFixed(3)}[a]`, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', total.toFixed(3), '-movflags', '+faststart', outFile]);
    const lk = spawnSync('ffmpeg', ['-nostats', '-i', outFile, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }); const m = /I:\s+(-?[\d.]+) LUFS/g; let g: RegExpExecArray | null, lastI = ''; while ((g = m.exec(lk.stderr))) lastI = g[1]!; info.lufs = lastI;
  } else ff(['-i', silent, '-c', 'copy', '-movflags', '+faststart', outFile]);
  const poster = `${OUT}/${RES}-${cut}-poster.jpg`; ff(['-ss', String(Math.min(total - 1, cut === '90' ? 38 : 9)), '-i', outFile, '-frames:v', '1', '-q:v', '3', poster]);
  const dur = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outFile]).trim(); info.duration = Number(dur); info.file = outFile; info.poster = poster;
  writeFileSync(`${OUT}/${RES}-${cut}.manifest.json`, JSON.stringify(info, null, 1)); console.log(JSON.stringify({ ...info, clips: undefined }));
} finally { await br.close(); srv.stop(); }
void existsSync;
