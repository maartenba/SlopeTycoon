/**
 * `npm run audio:export [-- --only 10,20 --seconds 75]`: renders every music track (and the four Apres-Ski bar variants, and a hand-off demo) offline with the software Web Audio renderer
 * (tests/audio/offlineBackend.ts) into `.weave/audio-previews/NN-name.mp3` + `index.md` for the owner to listen to one by one. ffmpeg is local only (mp3 192 kbps + the loudness meter);
 * mp3s are NOT committed (.weave is git-ignored). Each render is normalised to a loudness target (music -17 LUFS, bar music -15 LUFS) with a soft peak limiter so tracks are comparable;
 * renders use the REAL default settings (Music 50 %, Ambience 28 %, master 70 %: below the master compressor, so the dynamics are the in-game ones) and are then lifted by a plain gain. Also prints peak / RMS / clipping / DC / spectrum checks (no device, no ears: objective only).
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { AMB_BASE, renderAudio } from '../tests/audio/renderHarness';
import { spectrum, statsOf, toWav16 } from '../tests/audio/offlineBackend';
import { THEMES, type TrackId } from '../src/audio/musicThemes';
import { TRACK_CONTEXT } from '../src/audio/musicContexts';
import { apresPlan, apresVariantIndex, APRES_VARIANTS } from '../src/audio/apresSong';
import { EXPORT, HANDOFF } from '../src/config/audioMusic';
import type { AmbienceState } from '../src/audio/Ambience';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] ?? d : d; };
const only = arg('only', '').split(',').filter(Boolean), secondsMusic = Number(arg('seconds', String(EXPORT.seconds))), secondsApres = Number(arg('apres-seconds', String(EXPORT.apresSeconds)));
const dir = EXPORT.dir, SR = EXPORT.sampleRate;
mkdirSync(dir, { recursive: true });
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
if (!hasFfmpeg) console.warn('ffmpeg not found: writing 16-bit WAV files instead of mp3 (install ffmpeg for mp3 + LUFS).');
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m: number): string => NOTE[((m % 12) + 12) % 12]!;

/** Integrated loudness (LUFS, ITU BS.1770 / EBU R128) of a wav via ffmpeg's ebur128 meter; null without ffmpeg. */
function lufs(wav: string): number | null {
  if (!hasFfmpeg) return null;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = [...(r.stderr ?? '').matchAll(/I:\s+(-?[\d.]+)\s+LUFS/g)].pop();
  return m ? Number(m[1]) : null;
}
/** Soft limiter: transparent below 0.7, tanh knee up to maxPeak. Returns how many samples it touched. */
function softLimit(x: Float32Array, maxPeak: number): number {
  const k = 0.7, w = maxPeak - k; let n = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]!); if (a > k) { x[i] = Math.sign(x[i]!) * (k + w * Math.tanh((a - k) / w)); n++; } }
  return n;
}

interface Item { n: string; slug: string; title: string; mood: string; bpm: string; key: string; seed: number; listen: string; apres: boolean; render: () => Promise<{ l: Float32Array; r: Float32Array }> }
const items: Item[] = [];
const MUSIC_SEED = 11;
const LISTEN: Record<TrackId, string> = {
  title: 'Calm, a little cinematic: strings + harp, a piano melody; an intro of 4 bars, then verse / chorus; should feel like an opening, not a loop.',
  menu: 'Quiet, open: electric piano and mallets with a flute answer; no drums. Should sit politely behind menu clicks.',
  morningSnow: 'Bright mallet melody over harp arpeggios, a soft string counter-line in the chorus; clear and fresh. Does the chorus feel bigger than the verse?',
  alpineNoon: 'Warm major harmony, groovy plucked bass with rhythmic variation, soft pop beat (kick on 1 / 3, rim, swung hats, a small fill every 8 bars), a flute counter-line in the chorus, a bridge without kick. Pads should "breathe" slightly with the kick (sidechain).',
  snowPiano: 'Snowy and calm: felt piano lead, a soft mallet shimmer, slow strings. Listen for the piano timbre (soft attack, natural decay) and that nothing is busy.',
  apres: 'Evening jazz: electric piano chords (7ths), piano lead, walking-ish plucked bass, brushes with a little swing. Relaxed, not cheesy.',
  starlight: 'Night: sparse pads, slow harp, a distant string line. Very quiet and spacious; check the 4-bar chord changes feel slow but not static.',
  nightChill: 'Lo-fi night: swung soft beat (kick, laid-back rim, shuffled hats, ghost hats), electric piano, plucked bass, warm lead as counter-line. Pads dip gently with the kick. Is the swing pleasant or too lazy?',
  summerMeadow: 'Sunny uplift: airy flute over guitar, bouncy bass, soft shaker, mallet counter-line. Brighter and a bit faster than the winter tracks.',
  autumnGold: 'Warm strings, soft piano, a flute answer; slower and wistful. Does the minor-ish colour feel warm and not sad?',
  blizzard: 'Tension: dark drone, low strings, hardly any melody; unchanged in spirit. Should feel like weather, not like a song.',
  festival: 'Livelier groove at 104 bpm: warm synth lead, bouncing bass, flute answer, pop beat with fills. Should feel festive but still restrained.',
};
const MUSIC_ITEMS: Array<[string, string, TrackId, string]> = [
  ['01', 'title', 'title', 'Title theme (title screen / opening)'],
  ['10', 'winter-morning-morning-snow', 'morningSnow', 'Winter morning (auto: dawn to late morning)'],
  ['11', 'winter-day-alpine-noon', 'alpineNoon', 'Winter midday, resort busy (soft pop beat plays)'],
  ['12', 'winter-snowy-calm-snow-piano', 'snowPiano', 'Snowing, daytime (calm piano)'],
  ['13', 'winter-evening-apres-jazz', 'apres', 'Dusk (jazz evening)'],
  ['14', 'night-starlight', 'starlight', 'Night, calm and sparse'],
  ['15', 'night-chill-lofi', 'nightChill', 'Night, lo-fi beat (alternative to Starlight)'],
  ['16', 'summer-meadow-sunny', 'summerMeadow', 'Summer day (sunny uplift)'],
  ['17', 'autumn-gold', 'autumnGold', 'Autumn day / evening'],
  ['18', 'storm-blizzard-tension', 'blizzard', 'Storm / heavy snow (tension)'],
  ['19', 'festival-groove', 'festival', 'A festival is on'],
  ['90', 'menu-theme', 'menu', 'Menu theme (in-game menus)'],
];
for (const [n, slug, id, title] of MUSIC_ITEMS) {
  const th = THEMES[id];
  items.push({
    n, slug, title, mood: th.mood, bpm: '', key: '', seed: MUSIC_SEED, listen: LISTEN[id], apres: false,
    render: async () => { const r = await renderAudio({ seconds: secondsMusic, sampleRate: SR, seed: MUSIC_SEED, settings: { musicStyle: id }, music: TRACK_CONTEXT[id], ambience: null }); const p = r.music.currentPiece; const it = items.find((x) => x.n === n)!; it.bpm = `${Math.round(r.music.bpm)} (theme ${th.bpm}${th.kit !== 'none' ? ', ' + th.kit + ' kit' : ''})`; it.key = p ? `${noteName(p.root)} ${p.mode}, ${p.bars} bars: ${p.form}` : '?'; return { l: r.l, r: r.r }; },
  });
}
// Apres-Ski Bar variants: one seed per variant
const APRES_NAMES = ['party-schlager', 'polka-edm', 'ballermann-anthem', 'brass-drop'];
const apresLISTEN = [
  'Four-on-the-floor kick, clap on 2 and 4, off-beat open hats, pumping off-beat bass, accordion sing-along hook (no lyrics). Order: intro (filtered chords + hats), verse (beat, hook only in the last 4 bars), 4-bar snare-roll build-up with a riser and a gap, DROP with a crash, break (no kick, hook solo), build-up, second drop with brass doubling, outro.',
  'Polka-EDM hybrid: oompah bass on 1 / 3 (root, fifth) with accordion "pah" stabs on 2 / 4 over the four-on-the-floor kick. The build-up and the drop should clearly lift the energy.',
  'Ballermann anthem: minor-start progression (vi IV I V), brass lead hook with accordion doubling, pumping off-beat bass. Is the hook singable?',
  'Brass drop: rolling sixteenth bass (octave jumps) under brass hook, accordion doubling in the second drop. The most "EDM" of the four.',
];
for (let v = 0; v < 4; v++) {
  let seed = 1; while (apresVariantIndex(seed) !== v) seed++;
  const plan = apresPlan(seed);
  items.push({
    n: String(20 + v), slug: `apres-bar-${v + 1}-${APRES_NAMES[v]}`, title: `Apres-Ski Bar: ${APRES_VARIANTS[v]!.name} (heard zoomed in next to an open bar)`, mood: `Party-Schlager / EDM-polka, ${plan.bpm} bpm`, bpm: String(plan.bpm), key: `${noteName(plan.key)} major, ${plan.totalBars} bars`, seed, listen: apresLISTEN[v]!, apres: true,
    render: async () => { const r = await renderAudio({ seconds: secondsApres + 1.2, sampleRate: SR, seed: 5, apresSeed: seed, settings: {}, ambience: { ...AMB_BASE, season: 'winter', hour: 17, zoom: 8, wind: 0, apres: 1 }, musicOn: false }); return { l: r.l, r: r.r }; },
  });
}
// Hand-off demo: game music, then the camera walks up to the bar (music fades out, bar plays), walks away (bar fades out, music resumes at the same chord)
{
  let seed = 1; while (apresVariantIndex(seed) !== 0) seed++;
  const total = secondsApres + 30, inAt = 18, outAt = inAt + 40;
  items.push({
    n: '30', slug: 'handoff-demo-game-music-to-apres-and-back', title: 'Hand-off demo: game music, walk up to the bar, walk away', mood: 'Alpine Noon (busy), then the Apres bar (Party-Schlager)', bpm: '', key: '', seed, apres: true,
    listen: `0-${inAt} s game music; at ${inAt} s the camera reaches the bar: the game music fades out in ~${HANDOFF.mainFadeOut} s and ONLY THEN the bar music fades in (~${HANDOFF.apresFadeIn} s): they must never overlap. At ${outAt} s you walk away: the bar fades out (~${HANDOFF.apresFadeOut} s), then the game music fades back in (~${HANDOFF.mainFadeIn} s) from the start of the chord it was in. No clicks, no pumping.`,
    render: async () => { const r = await renderAudio({ seconds: total, sampleRate: SR, seed: MUSIC_SEED, apresSeed: seed, settings: { musicStyle: 'alpineNoon' }, music: TRACK_CONTEXT.alpineNoon, ambience: { ...AMB_BASE, season: 'winter', hour: 13, zoom: 8, wind: 0 } as AmbienceState, ambienceAt: (t) => ({ apres: t >= inAt && t < outAt ? 1 : 0 }) }); return { l: r.l, r: r.r }; },
  });
}

interface Row { n: string; file: string; title: string; mood: string; bpm: string; key: string; seed: number; listen: string; sec: number; peak: number; rmsDb: number; lufsRaw: number | null; lufsOut: number | null; gainDb: number; limited: number; clipped: number; dc: number; centroid: number; above8k: number; ok: boolean }
const rows: Row[] = [];
const wanted = (n: string): boolean => only.length === 0 || only.some((o) => n === o || n.startsWith(o));
for (const it of items) {
  if (!wanted(it.n)) continue;
  const t0 = Date.now();
  const raw = await it.render();
  const base = `${it.n}-${it.slug}`, tmp = `${dir}/.${base}.raw.wav`;
  writeFileSync(tmp, toWav16(raw.l, raw.r, SR));
  const lufsRaw = lufs(tmp), target = it.apres ? EXPORT.apresLufs : EXPORT.musicLufs;
  let gainDb = lufsRaw === null ? 0 : target - lufsRaw;
  const rawPeak = Math.max(statsOf(raw.l).peak, statsOf(raw.r).peak);
  gainDb = Math.min(gainDb, 20 * Math.log10(4 / Math.max(1e-6, rawPeak))); // at most what the soft limiter can hold
  const g = Math.pow(10, gainDb / 20), l = raw.l.map((v) => v * g), r = raw.r.map((v) => v * g);
  const limited = softLimit(l, EXPORT.maxPeak) + softLimit(r, EXPORT.maxPeak);
  // fade the very last 0.4 s so a cut-off render does not click
  const fadeN = Math.floor(SR * 0.4); for (let i = 0; i < fadeN; i++) { const k = i / fadeN, j = l.length - 1 - i; l[j]! *= k; r[j]! *= k; }
  const wav = `${dir}/.${base}.wav`; writeFileSync(wav, toWav16(l, r, SR));
  const lufsOut = lufs(wav);
  let file = `${base}.wav`;
  if (hasFfmpeg) {
    file = `${base}.mp3`;
    const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', `${EXPORT.mp3Kbps}k`, '-metadata', `title=${it.title}`, '-metadata', 'artist=Slope Tycoon (procedural, seed ' + it.seed + ')', `${dir}/${file}`], { encoding: 'utf8' });
    if (res.status !== 0) { console.error(res.stderr); file = `${base}.wav`; writeFileSync(`${dir}/${file}`, toWav16(l, r, SR)); }
  } else writeFileSync(`${dir}/${file}`, toWav16(l, r, SR));
  rmSync(tmp, { force: true }); rmSync(wav, { force: true });
  const sa = statsOf(l), sb = statsOf(r), sp = spectrum(l.subarray(SR * 6), SR);
  let clipped = 0; for (let i = 0; i < l.length; i++) if (Math.abs(l[i]!) >= 0.999 || Math.abs(r[i]!) >= 0.999) clipped++;
  const peak = Math.max(sa.peak, sb.peak), dc = Math.max(Math.abs(sa.dc), Math.abs(sb.dc));
  const finite = l.every(Number.isFinite) && r.every(Number.isFinite);
  const ok = finite && clipped === 0 && peak <= 0.9 && dc < 2e-3 && Math.max(sa.rmsDb, sb.rmsDb) > -40;
  rows.push({ n: it.n, file, title: it.title, mood: it.mood, bpm: it.bpm, key: it.key, seed: it.seed, listen: it.listen, sec: l.length / SR, peak, rmsDb: (sa.rmsDb + sb.rmsDb) / 2, lufsRaw, lufsOut, gainDb, limited, clipped, dc, centroid: sp.centroid, above8k: sp.above(8000), ok });
  console.log(`${file.padEnd(58)} ${(l.length / SR).toFixed(0)}s peak ${peak.toFixed(2)} rms ${((sa.rmsDb + sb.rmsDb) / 2).toFixed(1)} dBFS  LUFS ${lufsOut?.toFixed(1) ?? 'n/a'} (raw ${lufsRaw?.toFixed(1) ?? 'n/a'}, gain ${gainDb.toFixed(1)} dB)  limited ${limited}  clip ${clipped}  dc ${dc.toExponential(1)}  centroid ${sp.centroid.toFixed(0)} Hz  ${ok ? 'OK' : 'CHECK'}  [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
}

const lines = [
  '# Slope Tycoon: audio previews (procedural, rendered offline)', '',
  `Generated by \`npm run audio:export\` (${new Date().toISOString().slice(0, 10)}). Folder: \`${dir}/\` (git-ignored, not committed). Each file is a software render of the REAL game code (Music / Ambience / Apres scheduler + instruments) at ${SR} Hz, ${hasFfmpeg ? `mp3 ${EXPORT.mp3Kbps} kbps` : 'WAV (no ffmpeg)'}.`, '',
  `**Levels**: music is normalised to about ${EXPORT.musicLufs} LUFS and the bar music to ${EXPORT.apresLufs} LUFS (a bit hotter, it is a party) with a soft peak limiter, so the files are comparable. **In the game it is much quieter** (Music slider 50 %, Ambience 28 %, master 70 %): judge the arrangement and sounds here, the in-game level by ear in the game.`, '',
  '**Nobody has heard these** (the machine that rendered them has no audio device): the checks below are objective only (peak / loudness / clipping / DC / spectrum). The first ~3.5 s of a game track is its fade-in; each file is a slice of one piece generated from the seed shown (the game generates a new piece from a new seed every time).', '',
  '| # | file | what | bpm | key / form | seed | s | LUFS | peak | clip | checks |', '|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.n} | \`${r.file}\` | ${r.title} | ${r.bpm} | ${r.key} | ${r.seed} | ${r.sec.toFixed(0)} | ${r.lufsOut?.toFixed(1) ?? 'n/a'} | ${r.peak.toFixed(2)} | ${r.clipped} | ${r.ok ? 'ok' : 'CHECK'} |`), '',
  '## What to listen for', '',
  ...rows.flatMap((r) => [`### ${r.n} ${r.title}`, `- Mood: ${r.mood}`, `- Listen for: ${r.listen}`, `- Objective: ${r.sec.toFixed(0)} s, peak ${r.peak.toFixed(2)}, ${r.rmsDb.toFixed(1)} dBFS RMS, LUFS ${r.lufsOut?.toFixed(1) ?? 'n/a'} (raw render ${r.lufsRaw?.toFixed(1) ?? 'n/a'}, gain ${r.gainDb.toFixed(1)} dB, ${r.limited} samples soft-limited), clipped samples ${r.clipped}, |DC| ${r.dc.toExponential(1)}, spectral centroid ${r.centroid.toFixed(0)} Hz, share above 8 kHz ${(r.above8k * 100).toFixed(2)} %`, '']),
  '## General questions', '',
  '- Is any track still "meh"? Which one, and is it the melody, the sounds (timbre), the beat, or the arrangement?',
  '- Do the sections (intro, verse, chorus, bridge, outro) read as a song? Is the chorus clearly bigger than the verse?',
  '- Apres: is it danceable? Does the build-up + drop land? Is the accordion / brass hook catchy and not shrill? Which of the four variants do you like (they are chosen by seed per game)?',
  '- Hand-off demo (#30): the game music must stop, the bar music must start after it, and back again, never overlapping.',
  '- All tunables: `src/config/audioMusic.ts` (mix, hand-off, bar music), `src/config/audioProximity.ts`, `src/audio/musicThemes.ts` (per-track tempo / instruments / form).',
];
writeFileSync(`${dir}/index.md`, lines.join('\n') + '\n');
console.log(`\nindex: ${dir}/index.md (${rows.length} files)`);
if (rows.some((r) => !r.ok)) { console.error('some renders failed the objective checks'); process.exit(1); }

