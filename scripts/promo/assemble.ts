/* eslint-disable @typescript-eslint/no-explicit-any -- manifest JSON + page.evaluate */
/** Promo assembler (M7.6, docs/promo-video.md): frames -> clips (+ logo reveal, captions) -> crossfades -> end card -> music -> ONE mp4 per cut.
 *   npm run promo:video -- --final --cut both      # captures the missing shots (2560x1440, 30 fps) and writes .weave/promo/out/slope-tycoon-90.mp4 + slope-tycoon-30.mp4 (+ -poster.jpg each)
 *   npm run promo:video -- --draft --cut both      # 1280x720 / 12 fps draft files (draft-90.mp4, draft-30.mp4)
 * Flags: --cut 90|30|both, --no-capture (assemble only), --jobs N (capture browsers, default 3), --no-music, --reuse 1 (keep the picture master, redo the audio), --out DIR.
 * Everything is ONE resolution (2560x1440 H.264 crf 17 slow, yuv420p, bt709, AAC 192k, faststart, -18 LUFS): no 4K master, no web variants.
 * Captions, the logo reveal and the end card are rendered by the installed Chrome (this ffmpeg build has no drawtext) with the game's own fonts (public/fonts, Nunito + Lilita One) and logo (?uikit=logo-full) as transparent PNGs at the output size.
 * Each clip is padded by the crossfade length (frozen last frame) so the cut keeps the manifest durations (90 s / 30 s). Music: public/audio/menu-seasons-of-management.mp3, cut so the song's own last chord rings out under the end card (music.ts). */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { launch, startServer } from '../lib/harness';
import { cutClips, parseCuts, type Cut } from './cuts';
import { envelope, planSplice } from './music';

const arg = (k: string, d = ''): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--') ? process.argv[i + 1]! : i > 0 ? '1' : d; };
const final = arg('final') === '1';
const RES = final ? 'final' : 'draft'; // frames dir under .weave/promo/frames
const W = Number(arg('w', final ? '2560' : '1280')), H = Number(arg('h', final ? '1440' : '720'));
const CUTS = parseCuts(arg('cut', '90'));
const OUT = arg('out', '.weave/promo/out'), WORK = `.weave/promo/work-${RES}`, MANI = '.weave/promo/manifests';
mkdirSync(OUT, { recursive: true }); mkdirSync(WORK, { recursive: true }); mkdirSync(MANI, { recursive: true });
const manifest = JSON.parse(readFileSync(arg('manifest', 'promo/scenes.json'), 'utf8')); const FILM = manifest.film;
const E = FILM.endCard;
const fps: number = final ? FILM.fps : FILM.draftFps;
const MUSIC = 'public/audio/menu-seasons-of-management.mp3';
const run = (cmd: string, args: string[], opt: any = {}): string => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opt }); if (r.status !== 0) throw new Error(`${cmd} failed: ${String(r.stderr).slice(-1500)}`); return String(r.stdout); };
const ff = (args: string[]): string => run('ffmpeg', ['-v', 'error', '-y', ...args]);

// ---- capture what is missing (resumes: shots with a matching .done marker are skipped) ----
if (arg('no-capture') !== '1') {
  const need = CUTS.includes('90') ? '90' : '30';
  const r = spawnSync('npx', ['vite-node', 'scripts/promo/capture.ts', ...(final ? ['--final', '--quality', '97'] : ['--draft']), '--cut', need, '--jobs', arg('jobs', '3')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`capture failed (exit ${r.status})`);
}

/** Decode the song once (8 kHz mono): its 100 Hz envelope + duration, for the splice plan. */
function songInfo(): { env: Float32Array; dur: number } {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', MUSIC, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const s = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + Math.floor(r.stdout.length / 4) * 4));
  return { env: envelope(s, 8000), dur: s.length / 8000 };
}
/** Strongest `len` s window of the body of the song (mean envelope + onset density), bar-free: the teaser start. */
function strongestWindow(env: Float32Array, dur: number, len: number): number {
  const n = Math.round(len * 100); const mx = Math.max(...env), on = new Float32Array(env.length); for (let i = 1; i < env.length; i++) on[i] = Math.max(0, env[i]! - env[i - 1]!); const mo = Math.max(...on, 1e-9);
  let best = 20, bs = -1;
  for (let st = 200; st + n <= Math.min(env.length, (dur - 20) * 100); st += 50) { let a = 0, o = 0; for (let i = st; i < st + n; i++) { a += env[i]!; o += on[i]!; } const sc = (a / n / mx) * 0.6 + (o / n / mo) * 0.4; if (sc > bs) { bs = sc; best = st / 100; } }
  return best;
}

const fontB64 = (f: string): string => readFileSync(`public/fonts/${f}`).toString('base64');
const FONTS = `@font-face{font-family:Nunito;font-weight:200 1000;src:url(data:font/woff2;base64,${fontB64('nunito-latin.woff2')})}@font-face{font-family:'Lilita One';src:url(data:font/woff2;base64,${fontB64('lilita-one-latin.woff2')})}`;

const srv = await startServer(); const br = await launch();
const COL = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']; // every output carries bt709 / tv-range tags
const SCALE_IN = 'flags=lanczos+accurate_rnd+full_chroma_int:in_range=pc:in_color_matrix=bt601:out_range=tv:out_color_matrix=bt709'; // JPEG frames (JFIF = BT.601, full range) -> BT.709 limited
const ebur = (f: string): number => { const lk = spawnSync('ffmpeg', ['-nostats', '-i', f, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }); const m = /I:\s+(-?[\d.]+) LUFS/g; let g: RegExpExecArray | null, last = ''; while ((g = m.exec(lk.stderr))) last = g[1]!; return Number(last); };
const timings: Record<string, number> = {}; const timed = <T>(k: string, f: () => T): T => { const t0 = Date.now(); const r = f(); timings[k] = Math.round((Date.now() - t0) / 1000); console.log(`[assemble] ${k}: ${timings[k]} s`); return r; };
const LW = Math.round(W * 0.3), LM = Math.round(W * 0.12); // logo width centred / as the corner mark
try {
  const page = await br.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  // ---- caption PNGs, rendered AT the target resolution (all sizes relative to H) ----
  const allShots: any[] = [...FILM.shots, { id: 'end-card', endCard: true, len: FILM.endCard.len, cuts: FILM.endCard.cuts }];
  for (const s of allShots) {
    if (s.caption) {
      await page.setContent(`<style>${FONTS}html,body{margin:0;background:transparent}div{position:fixed;left:${H * 0.05}px;bottom:${H * 0.07}px;max-width:${W * 0.62}px;padding:${H * 0.014}px ${H * 0.026}px;border-radius:${H * 0.022}px;background:rgba(10,18,32,.55);color:#fff;font:800 ${H * 0.048}px Nunito,system-ui,sans-serif;letter-spacing:.01em;text-shadow:0 ${H * 0.003}px ${H * 0.012}px rgba(0,0,0,.6)}</style><div>${String(s.caption).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${WORK}/cap-${s.id}.png`, omitBackground: true });
    }
  }
  // ---- the logo (the real ?uikit=logo-full page asset) -> the reveal PNG, then the four end-card layers ----
  await page.goto(`${srv.url}?uikit=logo-full`, { waitUntil: 'load', timeout: 120000 }); await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(() => { const logo = Array.from(document.querySelectorAll('svg,img,canvas')).find((e) => (e as HTMLElement).getBoundingClientRect().width > 100) as HTMLElement | undefined; if (!logo) throw new Error('no logo element'); (window as any).__logo = logo.cloneNode(true); });
  const layer = async (file: string, html: string, clip?: any): Promise<void> => {
    await page.evaluate((h: string, f: string) => {
      document.documentElement.style.cssText = 'background:transparent!important'; document.body.style.cssText = 'margin:0;background:transparent!important;overflow:hidden'; document.body.replaceChildren();
      const st = document.createElement('style'); st.textContent = f + 'body *{box-sizing:border-box}'; document.head.appendChild(st);
      const root = document.createElement('div'); root.id = 'root'; root.innerHTML = h; document.body.appendChild(root);
      const slot = root.querySelector('[data-logo]') as HTMLElement | null; if (slot) { const c = (window as any).__logo.cloneNode(true) as HTMLElement; c.style.cssText = 'display:block;width:100%;height:auto'; slot.appendChild(c); }
    }, html, FONTS);
    await page.evaluate(() => document.fonts.ready); await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: file, omitBackground: true, ...(clip ? { clip } : {}) });
  };
  const SH = `filter:drop-shadow(0 ${H * 0.006}px ${H * 0.02}px rgba(0,0,0,.55))`;
  const pad = Math.round(H * 0.03);
  await layer(`${WORK}/logo-reveal.png`, `<div style="position:fixed;left:0;top:0;width:${LW + pad * 2}px;padding:${pad}px;${SH}"><div data-logo style="width:${LW}px"></div></div>`, undefined);
  { // crop the reveal PNG to its content box (width LW + 2 pad); height follows the logo's aspect
    const hh = await page.evaluate(() => (document.querySelector('[data-logo]') as HTMLElement).getBoundingClientRect().height);
    await page.screenshot({ path: `${WORK}/logo-reveal.png`, omitBackground: true, clip: { x: 0, y: 0, width: LW + pad * 2, height: Math.ceil(hh + pad * 2) } });
  }
  const stack = (show: string): string => `<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${H * 0.028}px;color:#fff;text-align:center;font-family:Nunito,system-ui,sans-serif">
    <div data-logo style="width:${H * 0.34}px;${show === 'logo' ? SH : 'visibility:hidden'}"></div>
    <div style="font:400 ${H * 0.165}px/1 'Lilita One',Nunito,sans-serif;letter-spacing:.01em;color:#fff;text-shadow:0 ${H * 0.006}px ${H * 0.03}px rgba(0,0,0,.6),0 0 ${H * 0.05}px rgba(120,190,255,.35);${show === 'url' ? '' : 'visibility:hidden'}">${E.url}</div>
    <div style="font:800 ${H * 0.052}px/1.1 Nunito,sans-serif;letter-spacing:.01em;text-shadow:0 ${H * 0.004}px ${H * 0.016}px rgba(0,0,0,.6);${show === 'verb' ? '' : 'visibility:hidden'}">${E.verb}</div>
    <div style="font:700 ${H * 0.036}px/1.1 Nunito,sans-serif;color:#cfe3fb;opacity:.9;text-shadow:0 ${H * 0.004}px ${H * 0.014}px rgba(0,0,0,.6);${show === 'small' ? '' : 'visibility:hidden'}">${E.small}</div></div>`;
  for (const k of ['logo', 'url', 'verb', 'small']) await layer(`${WORK}/ec-${k}.png`, stack(k));
  await page.close();
  const song = songInfo();

  for (const cut of CUTS) await buildCut(cut, song);
} finally { await br.close(); srv.stop(); }

async function buildCut(cut: Cut, song: { env: Float32Array; dur: number }): Promise<void> {
  const TMP = `${WORK}/${cut}`; mkdirSync(TMP, { recursive: true });
  const xf: number = FILM.cuts[`c${cut}`].xfade; const lr = FILM.logoReveal[`c${cut}`];
  const plan = cutClips(FILM, cut); // the teaser reuses the 90 s shots (first `len` seconds from `from`)
  const clips: Array<{ id: string; file: string; len: number }> = [];
  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', final ? '8' : '20', '-pix_fmt', 'yuv420p', '-r', String(fps), '-an']; // intermediates: near-lossless, fast
  const reuse = arg('reuse') === '1' && existsSync(`${TMP}/silent.mp4`);
  const ES = (a: number, b: number): string => { const s = `clip((t-${a})/${(b - a).toFixed(3)},0,1)`; return `(${s}*${s}*(3-2*${s}))`; }; // smoothstep expression for ffmpeg
  timed(`${cut}: clips`, () => {
    for (let i = 0; i < plan.length; i++) {
      const s = plan[i]!.shot; const last = i === plan.length - 1; const { len, from } = plan[i]!;
      const pad = last ? 0 : xf; const file = `${TMP}/${s.id}.mp4`; const stages: string[] = []; const ins: string[] = []; const nF = Math.round((len + pad) * fps);
      if (s.endCard) {
        // dimmed, softly blurred, slowly pushing-in (about 1.8x, centred on the village so the map edge never shows) last frame of the night pull-back behind the card; four layers fade in 0.4 s apart
        const bgShot = plan.find((q) => q.id === E.bgFrom)!; const lastFrame = Math.round((bgShot.from + bgShot.len) * fps) + 1;
        ins.push('-i', `.weave/promo/frames/${RES}/${E.bgFrom}/${String(lastFrame).padStart(5, '0')}.jpg`);
        const lay = ['logo', 'url', 'verb', 'small']; lay.forEach((k) => ins.push('-loop', '1', '-framerate', String(fps), '-i', `${WORK}/ec-${k}.png`));
        stages.push(`[0:v]scale=${W * 2}:${H * 2}:${SCALE_IN},gblur=sigma=${H * 0.012},eq=brightness=-0.26:saturation=0.82:contrast=0.95,zoompan=z='1.75+0.1*on/${nF}':x='iw*0.45-(iw/zoom/2)':y='ih*0.38-(ih/zoom/2)':d=${nF}:s=${W}x${H}:fps=${fps},format=yuv420p,fade=in:st=0:d=0.001[bg]`);
        let prev = '[bg]'; const st0 = 0.35;
        lay.forEach((k, j) => { const t0 = st0 + j * (E.stagger ?? 0.4); stages.push(`[${j + 1}:v]format=rgba,fade=in:st=${t0.toFixed(2)}:d=0.6:alpha=1[l${j}]`, `${prev}[l${j}]overlay=0:0:shortest=1:format=auto[o${j}]`); prev = `[o${j}]`; });
        stages.push(`${prev}fade=out:st=${Math.max(0, len - 1)}:d=1,format=yuv420p,trim=duration=${len + pad},setpts=PTS-STARTPTS[o]`);
        if (!reuse) ff([...ins, '-filter_complex', stages.join(';'), '-map', '[o]', '-frames:v', String(nF), ...enc, file]);
        clips.push({ id: s.id, file, len }); continue;
      }
      ins.push('-framerate', String(fps), '-start_number', String(Math.round(from * fps) + 1), '-i', `.weave/promo/frames/${RES}/${s.id}/%05d.jpg`);
      stages.push(`[0:v]scale=${W}:${H}:${final ? SCALE_IN : 'flags=lanczos'},format=yuv420p,tpad=stop_mode=clone:stop_duration=${pad},trim=duration=${len + pad},setpts=PTS-STARTPTS[v]`);
      let map = '[v]'; let n = 1;
      if (s.caption) { const t0 = i === 0 ? lr.captionAt : 0.4, t1 = Math.max(t0 + 1, len - 0.3); ins.push('-loop', '1', '-framerate', String(fps), '-i', `${WORK}/cap-${s.id}.png`); stages.push(`[${n}:v]format=rgba,fade=in:st=${t0}:d=0.4:alpha=1,fade=out:st=${t1 - 0.4}:d=0.4:alpha=1[cap]`, `${map}[cap]overlay=0:0:shortest=1,format=yuv420p[o${n}]`); map = `[o${n}]`; n++; }
      if (i === 0) { // logo reveal: fades in at the centre, settles into the bottom-right mark, stays, fades
        const e = ES(lr.centreUntil, lr.settleEnd); const wExpr = `${LW}+(${LM}-${LW})*${e}`;
        ins.push('-loop', '1', '-framerate', String(fps), '-i', `${WORK}/logo-reveal.png`);
        stages.push(`[${n}:v]format=rgba,scale=w='${wExpr}':h=-1:eval=frame:flags=bicubic,fade=in:st=0:d=${lr.fadeIn}:alpha=1,fade=out:st=${lr.markUntil}:d=${lr.markFade}:alpha=1[lg]`,
          `${map}[lg]overlay=x='(main_w-overlay_w)/2+((main_w-${(H * 0.03).toFixed(1)}-overlay_w)-(main_w-overlay_w)/2)*${e}':y='(main_h-overlay_h)/2+((main_h-${(H * 0.035).toFixed(1)}-overlay_h)-(main_h-overlay_h)/2)*${e}':eval=frame:shortest=1,format=yuv420p[o${n}]`); map = `[o${n}]`; n++;
      }
      if (!reuse) ff([...ins, '-filter_complex', stages.join(';'), '-map', map, '-frames:v', String(nF), ...enc, file]);
      clips.push({ id: s.id, file, len });
    }
  });
  // ---- crossfade chain: the picture master (silent), 4:2:0 BT.709 limited, the ONE video encode ----
  const total = clips.reduce((a, c) => a + c.len, 0);
  const inArgs = clips.flatMap((c) => ['-i', c.file]); const parts: string[] = []; let acc = 0; let prev = '[0:v]';
  for (let i = 1; i < clips.length; i++) { acc += clips[i - 1]!.len; const lab = i === clips.length - 1 ? '[vout]' : `[x${i}]`; parts.push(`${prev}[${i}:v]xfade=transition=fade:duration=${xf}:offset=${acc.toFixed(3)}${lab}`); prev = lab; }
  const silent = `${TMP}/silent.mp4`;
  if (!reuse) timed(`${cut}: crossfade + encode`, () => ff([...inArgs, '-filter_complex', parts.join(';'), '-map', '[vout]', '-c:v', 'libx264', '-preset', final ? 'slow' : 'veryfast', '-crf', final ? '17' : '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...(final ? COL : []), '-r', String(fps), '-an', silent]));
  // ---- music: the song from `start` to P, an acrossfade into its own ending from Q (the last chord rings out under the end card), a static gain to -18 LUFS (no dynamic loudnorm: it would pump the quiet decay up) ----
  const outFile = final ? `${OUT}/slope-tycoon-${cut}.mp4` : `${OUT}/draft-${cut}.mp4`; const info: any = { cut, res: RES, W, H, fps, total, clips: clips.map((c) => ({ id: c.id, len: c.len })) };
  const wav = `${TMP}/music.wav`;
  if (arg('no-music') !== '1') {
    const tail = cut === '30' ? [6, 10] : [10, 16]; const xfa = cut === '30' ? 1.0 : 1.5;
    const start = cut === '30' ? strongestWindow(song.env, song.dur, total - tail[0]!) : 0;
    const sp = planSplice(song.env, song.dur, start, total, xfa, tail[0]!, tail[1]!); info.splice = sp;
    const fin = cut === '30' ? 0.5 : 1.5;
    const mk = (gain: number): void => { ff(['-i', MUSIC, '-filter_complex', `[0:a]asplit=2[a1][a2];[a1]atrim=start=${sp.start.toFixed(3)}:end=${sp.p.toFixed(3)},asetpts=PTS-STARTPTS[A];[a2]atrim=start=${sp.q.toFixed(3)},asetpts=PTS-STARTPTS[B];[A][B]acrossfade=d=${xfa}:c1=qsin:c2=qsin,volume=${gain.toFixed(2)}dB,alimiter=limit=0.89,afade=t=in:st=0:d=${fin},afade=t=out:st=${(total - 1).toFixed(2)}:d=1,atrim=duration=${total.toFixed(3)}[m]`, '-map', '[m]', '-ar', '48000', '-ac', '2', wav]); };
    mk(0); const l0 = ebur(wav); const gain = Number.isFinite(l0) ? -18 - l0 : 0; if (Math.abs(gain) > 0.1) mk(gain); info.audioTrimDb = Number(gain.toFixed(2));
    ff(['-i', silent, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', ...(final ? COL : []), '-t', total.toFixed(3), '-movflags', '+faststart', outFile]);
    info.lufs = ebur(outFile);
  } else ff(['-i', silent, '-c', 'copy', '-movflags', '+faststart', outFile]);
  const poster = outFile.replace(/\.mp4$/, '-poster.jpg'); ff(['-ss', String(Math.min(total - 1, cut === '90' ? 38 : 9)), '-i', outFile, '-frames:v', '1', '-q:v', '2', poster]);
  info.duration = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outFile]).trim()); info.file = outFile; info.poster = poster; info.kb = Math.round(statSync(outFile).size / 1024);
  info.timings = { ...timings };
  writeFileSync(`${MANI}/${RES}-${cut}.manifest.json`, JSON.stringify(info, null, 1)); console.log(JSON.stringify({ ...info, clips: undefined }));
  if (final && arg('keep') !== '1') rmSync(TMP, { recursive: true, force: true });
}
