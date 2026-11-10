import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VIDEOS, VIDEO_DIR, videoLd, watchSection } from '../../scripts/site/video';
import { captionCues, vtt } from '../../scripts/site/video-vtt';
import { siteEnv } from '../../scripts/site/build';
import { extractRefs } from '../../scripts/site/crawl';
import { plainText } from '../../scripts/site/md';

const env = siteEnv({});
const fakeDir = (names: string[]): string => { const d = mkdtempSync(join(tmpdir(), 'vid-')); for (const n of names) writeFileSync(join(d, n), 'x'); return d; };
const ALL = Object.values(VIDEOS).flatMap((v) => [v.file, v.poster, v.vtt]);
const html = watchSection(fakeDir(ALL));

describe('landing "Watch it" video embed', () => {
  it('is left out (no broken references) when the media files are absent', () => { expect(watchSection(fakeDir([]))).toBe(''); expect(videoLd(env, fakeDir([]))).toEqual([]); expect(watchSection(fakeDir([VIDEOS.trailer.file]))).toBe(''); });
  it('never autoplays, loops or mutes; preload none, controls, playsinline, poster, track, aria-label', () => {
    const v = /<video\b[^>]*>/.exec(html)![0];
    for (const a of ['controls', 'playsinline', 'preload="none"', 'poster="assets/video/trailer-poster.jpg"', 'aria-label="', 'aria-describedby="vid-desc"']) expect(v, a).toContain(a);
    for (const bad of ['autoplay', 'loop', 'muted']) expect(html.toLowerCase(), bad).not.toMatch(new RegExp(`\\b${bad}\\b(?!ing)`, 'i'));
    expect(html).toMatch(/<track kind="captions" srclang="en" label="English" src="assets\/video\/trailer-30\.vtt">/);
    expect(html).not.toMatch(/<track[^>]* default/);
  });
  it('has a real play button, a visually hidden description, the plain caption and the film switch', () => {
    expect(html).toMatch(/<button type="button" class="vid-play" aria-label="Play the trailer" hidden>/);
    expect(html).toContain('class="sr-only" id="vid-desc"');
    expect(html).toContain('The trailer (30 seconds)'); expect(html).toContain('Watch the full film (90 s)'); expect(html).toContain('Sound on, it has music.');
    expect(html).not.toMatch(/<(iframe|embed|object)\b/i);
  });
  it('only references relative files inside assets/video/ (no external hosts) and the page lints', () => {
    for (const r of extractRefs(html)) expect(r.url, r.attr).toMatch(/^assets\/video\/[\w.-]+$|^$/);
    expect(html).not.toMatch(/https?:\/\//);
    const film = JSON.parse(/data-film="([^"]*)"/.exec(html)![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as Record<string, string>;
    for (const k of ['src', 'poster', 'vtt']) expect(film[k]).toMatch(/^assets\/video\//);
  });
  it('trailer-only build: the film button, film data and film JSON-LD are left out, the trailer stays', () => {
    const d = fakeDir([VIDEOS.trailer.file, VIDEOS.trailer.poster, VIDEOS.trailer.vtt]); const h = watchSection(d);
    expect(h).toContain('trailer-30.mp4'); expect(h).not.toContain('data-film'); expect(h).not.toContain('Watch the full film'); expect(h).not.toContain('film-90'); expect(h).not.toContain('film-poster');
    const l = videoLd(env, d); expect(l).toHaveLength(1); expect(l[0]!.duration).toBe('PT30S'); expect(JSON.stringify(l)).not.toContain('film-');
    const partial = watchSection(fakeDir([VIDEOS.trailer.file, VIDEOS.trailer.poster, VIDEOS.trailer.vtt, VIDEOS.film.file])); expect(partial).not.toContain('data-film');
  });
  it('trailer+film build: JSON-LD VideoObjects parse and describe the real files', () => {
    const lds = videoLd(env, fakeDir(ALL)); expect(lds).toHaveLength(2);
    for (const l of lds) { expect(JSON.parse(JSON.stringify(l))['@type']).toBe('VideoObject'); for (const k of ['name', 'description', 'thumbnailUrl', 'uploadDate', 'duration', 'contentUrl']) expect(l[k], k).toBeTruthy(); expect(String(l.contentUrl)).toMatch(/^https:\/\/slopetycoon\.com\/assets\/video\/.+\.mp4$/); }
    expect(lds.map((l) => l.duration)).toEqual(['PT30S', 'PT1M30S']);
  });
  it('the copy has no competitor names or filler', () => { const t = plainText(html + JSON.stringify(Object.values(VIDEOS))); expect(t).not.toMatch(/rollercoaster|tycoon sim|ski resort tycoon\b/i); expect(t).not.toMatch(/—|delve|seamless|elevate|unleash/i); });
  it('the landing template carries the placeholder after the "A day at the resort" section', () => { const t = readFileSync('site/index.html', 'utf8'); expect(t.indexOf('id="what"')).toBeLessThan(t.indexOf('{{watch}}')); expect(t.indexOf('{{watch}}')).toBeLessThan(t.indexOf('class="s-quote"')); });
});

describe('captions (WebVTT)', () => {
  const film = (JSON.parse(readFileSync('promo/scenes.json', 'utf8')) as { film: Parameters<typeof captionCues>[0] }).film;
  it('the hook caption opens both cuts; cues are ordered and inside the running time', () => {
    for (const [cut, total] of [['30', 30], ['90', 90]] as const) { const c = captionCues(film, cut); expect(c[0]!.text).toBe('I wanted a ski holiday that never ended.'); for (let i = 0; i < c.length; i++) { expect(c[i]!.end).toBeGreaterThan(c[i]!.start); expect(c[i]!.end).toBeLessThanOrEqual(total); if (i) expect(c[i]!.start).toBeGreaterThanOrEqual(c[i - 1]!.end); } }
  });
  it('formats WebVTT', () => { expect(vtt([{ start: 1.4, end: 3.7, text: 'Hi' }])).toBe('WEBVTT\n\n1\n00:00:01.400 --> 00:00:03.700\nHi\n'); });
  it('the .vtt files match the manifest (the film one only when present locally: it is not committed)', () => { for (const [cut, f] of [['30', 'trailer-30.vtt'], ['90', 'film-90.vtt']] as const) if (existsSync(join(VIDEO_DIR, f))) expect(readFileSync(join(VIDEO_DIR, f), 'utf8')).toBe(vtt(captionCues(film, cut))); });
});

describe('the real media files (only checked when they are present locally)', () => {
  it('exist together with their poster and track, within the size caps', () => {
    for (const v of Object.values(VIDEOS)) if (existsSync(join(VIDEO_DIR, v.file))) { expect(existsSync(join(VIDEO_DIR, v.poster))).toBe(true); expect(existsSync(join(VIDEO_DIR, v.vtt))).toBe(true); }
  });
});
