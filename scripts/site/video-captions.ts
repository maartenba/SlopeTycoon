/** `npx vite-node scripts/site/video-captions.ts`: writes site/assets/video/trailer-30.vtt and film-90.vtt from promo/scenes.json (helpers in video-vtt.ts). Re-run when the captions or cut lengths change. */
import { readFileSync, writeFileSync } from 'node:fs';
import { captionCues, vtt } from './video-vtt';

const film = (JSON.parse(readFileSync('promo/scenes.json', 'utf8')) as { film: Parameters<typeof captionCues>[0] }).film;
for (const [cut, file] of [['30', 'trailer-30'], ['90', 'film-90']] as const) { const cues = captionCues(film, cut); writeFileSync(`site/assets/video/${file}.vtt`, vtt(cues)); console.log(file, cues.length, 'cues'); }
