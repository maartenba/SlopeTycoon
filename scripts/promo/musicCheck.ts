/** Renders one promo music edit + the +/- 3 s seam-check snippets for listening:
 *    npx vite-node scripts/promo/musicCheck.ts -- --cut 90|30 [--song seasons-of-management|seasonal-menu] [--out .weave/promo/out]
 *  Writes music-<tag>.wav / .json, seam-check-<tag>.wav (the seam +/- 3 s) and seam-check-<tag>-ending.wav (the last 12 s). Same code as the film assembler. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildMusic } from './musicRender';
const run = (cmd: string, args: string[]): void => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(String(r.stderr)); };
const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };
const cut = arg('cut', '90') === '30' ? '30' : '90'; const song = arg('song', 'seasons-of-management'); const out = arg('out', '.weave/promo/out'); mkdirSync(out, { recursive: true });
const tag = `${cut}${song === 'seasons-of-management' ? '' : '-menu'}`; const wav = `${out}/music-${tag}.wav`;
const info = buildMusic(cut, cut === '30' ? 30 : 90, cut === '30' ? 4 : 7, song, wav); console.log(JSON.stringify(info, null, 1));
if (info.outA !== null) { const t = info.outA; run('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, t - 3)), '-t', '6', '-i', wav, `${out}/seam-check-${tag}.wav`]); }
run('ffmpeg', ['-v', 'error', '-y', '-ss', String((cut === '30' ? 30 : 90) - 12), '-i', wav, `${out}/seam-check-${tag}-ending.wav`]);
writeFileSync(`${out}/music-${tag}.json`, JSON.stringify(info, null, 1));
