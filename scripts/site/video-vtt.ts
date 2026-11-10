/** Pure helpers for `npx vite-node scripts/site/video-captions.ts`, which writes site/assets/video/trailer-30.vtt and film-90.vtt from promo/scenes.json.
 * The film has no speech: these are the same on-screen captions that scripts/promo/assemble.ts burns into the picture (same timing rule:
 * the first shot's caption starts at logoReveal.captionAt, any other at 0.4 s into its clip, and ends 0.3 s before the clip ends, at least 1 s long). */
import { cutClips, type Cut } from '../promo/cuts';

export interface Cue { start: number; end: number; text: string }
export function captionCues(film: { cuts: Record<string, { xfade: number }>; logoReveal: Record<string, { captionAt: number }> } & Record<string, unknown>, cut: Cut): Cue[] {
  const plan = cutClips(film, cut), lr = film.logoReveal[`c${cut}`]!; const out: Cue[] = []; let acc = 0;
  plan.forEach((c, i) => {
    const text = String((c.shot as { caption?: string }).caption ?? '').trim();
    if (text && !c.endCard) { const t0 = i === 0 ? lr.captionAt : 0.4, t1 = Math.max(t0 + 1, c.len - 0.3); out.push({ start: acc + t0, end: acc + t1, text }); }
    acc += c.len; // the crossfades eat the padding: the clip lengths add up to the running time
  });
  return out;
}
const ts = (s: number): string => { const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`; };
export const vtt = (cues: readonly Cue[]): string => `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n')}`;

