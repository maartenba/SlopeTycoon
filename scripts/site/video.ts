/** The landing page's "Watch it" section: a click-to-play trailer (30 s) that can swap to the full film (90 s), plus VideoObject JSON-LD.
 * Files live in site/assets/video/ (binary media is NOT committed by default: see docs/promo-video.md "Website embed"). When the trailer or its poster is missing
 * the section and the JSON-LD are simply left out, so a checkout without the media still builds and passes site:check. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SiteEnv } from './templates';

export const VIDEO_DIR = 'site/assets/video';
export const VIDEO_UPLOAD_DATE = '2026-11-10';
export interface VideoDef { id: 'trailer' | 'film'; file: string; poster: string; vtt: string; duration: string; label: string; length: string; name: string; description: string; transcript: string }
const TRAILER_TEXT = 'A 30 second trailer with music and no speech. It opens at blue hour over a lit village with fog in the valley and a chairlift climbing the hill, then shows lifts and runs being built, busy slopes, an apres-ski bar, grooming at night, summer on the same mountain, and the village after dark. The on-screen captions read: I wanted a ski holiday that never ended. Build the lifts. Cut the runs. Apres-ski, on your terms. Your resort. Your seasons.';
const FILM_TEXT = 'A 90 second film with music and no speech. It follows one valley through the year: blue hour over the village, building lifts and cutting runs, busy slopes, a ride on a chairlift, the apres-ski bar, a storm and night grooming, summer with a plane, a glider and parachutes, autumn and the first snow, then the village after dark. The on-screen captions read: I wanted a ski holiday that never ended. Build the lifts. Cut the runs. Apres-ski, on your terms. Even at night, the snowcats are out. And when the snow melts, summer begins. Skydive. Paraglide. Whatever you build. Your resort. Your seasons.';
export const VIDEOS: Record<'trailer' | 'film', VideoDef> = {
  trailer: { id: 'trailer', file: 'trailer-30.mp4', poster: 'trailer-poster.jpg', vtt: 'trailer-30.vtt', duration: 'PT30S', label: 'The trailer (30 seconds)', length: '30 s', name: 'Slope Tycoon trailer (30 seconds)', description: 'A year in a ski resort built in Slope Tycoon, in 30 seconds.', transcript: TRAILER_TEXT },
  film: { id: 'film', file: 'film-90.mp4', poster: 'film-poster.jpg', vtt: 'film-90.vtt', duration: 'PT1M30S', label: 'The full film (90 seconds)', length: '90 s', name: 'Slope Tycoon, the full film (90 seconds)', description: 'A year in a ski resort built in Slope Tycoon: lifts, runs, apres-ski, grooming at night, summer and autumn, in 90 seconds.', transcript: FILM_TEXT },
};
const present = (v: VideoDef, dir: string): boolean => [v.file, v.poster, v.vtt].every((f) => existsSync(join(dir, f)));
export const videoAvailable = (dir = VIDEO_DIR): { trailer: boolean; film: boolean } => ({ trailer: present(VIDEOS.trailer, dir), film: present(VIDEOS.film, dir) });

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** `{{watch}}` replacement: '' when the trailer files are missing. All URLs are relative to the page. */
export function watchSection(dir = VIDEO_DIR): string {
  const a = videoAvailable(dir); if (!a.trailer) return '';
  const t = VIDEOS.trailer, f = VIDEOS.film, u = (_v: VideoDef, n: string): string => `assets/video/${n}`;
  return `<section id="watch" class="s-watch" aria-labelledby="watch-h"><div class="wrap">
  <h2 id="watch-h">Watch it</h2>
  <figure class="vid" data-video${a.film ? ` data-film="${esc(JSON.stringify({ title: f.label, src: u(f, f.file), poster: u(f, f.poster), vtt: u(f, f.vtt), desc: f.transcript, back: 'Back to the trailer (30 s)' }))}"` : ''}>
    <div class="vid-box">
      <video controls playsinline preload="none" poster="${u(t, t.poster)}" src="${u(t, t.file)}" width="1280" height="720" aria-label="${esc(t.name)}" aria-describedby="vid-desc">
        <track kind="captions" srclang="en" label="English" src="${u(t, t.vtt)}">
        Your browser cannot play this video. <a href="${u(t, t.file)}">Download the trailer (MP4)</a>.
      </video>
      <button type="button" class="vid-play" aria-label="Play the trailer" hidden><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg></button>
    </div>
    <p class="sr-only" id="vid-desc">${esc(t.transcript)}</p>
    <figcaption class="vid-cap">
      <div><h3 class="vid-title" data-vid-title>${esc(t.label)}</h3><p>A year at the resort in 30 seconds. Sound on, it has music.</p></div>${a.film ? `
      <button type="button" class="btn ghost" data-vid-switch>Watch the full film (90 s)</button>` : ''}
    </figcaption>
  </figure>
</div></section>
`;
}

/** VideoObject JSON-LD for the files that exist (empty array otherwise). */
export function videoLd(env: SiteEnv, dir = VIDEO_DIR): Array<Record<string, unknown>> {
  const base = env.siteUrl || './', a = videoAvailable(dir);
  return (['trailer', 'film'] as const).filter((k) => a[k]).map((k) => { const v = VIDEOS[k]; return { '@context': 'https://schema.org', '@type': 'VideoObject', name: v.name, description: v.description, thumbnailUrl: `${base}assets/video/${v.poster}`, uploadDate: VIDEO_UPLOAD_DATE, duration: v.duration, contentUrl: `${base}assets/video/${v.file}`, inLanguage: 'en', isAccessibleForFree: true, width: 1920, height: 1080 }; });
}
