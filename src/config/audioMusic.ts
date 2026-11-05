/**
 * Music tables. ALL the music is owner-provided Suno-generated mp3 files in `public/audio` (owner decision, 2026-11-05; sound effects and ambience stay procedural).
 * ONE place for: the track table (file, loudness, trim), the situation -> playlist table, the situation rules (hours, hysteresis, crossfades),
 * the Apres-bar hand-off and the bar-music levels. Players: `src/audio/Music.ts` (game), `BarMusic.ts` (next to an open bar), `MenuMusic.ts` (title / menu);
 * pure selection: `src/audio/musicPlaylist.ts`. Proximity levels stay in `audioProximity.ts` (`PROX`). Docs: docs/audio.md ("Music"), by-ear checklist: docs/playtest-audio.md.
 * Nothing here was tuned by ear (agents have no audio device): change numbers HERE.
 */

export type TrackGroup = 'menu' | 'game' | 'bar';

/**
 * Loudness targets (integrated LUFS) the trims normalise to. The old procedural music was normalised to -17 (game) and -15 (bar); the owner found the Suno
 * music "a bit loud" at the same slider, so every target is 3 dB lower (about -3 dB at the default Music slider; the slider range is unchanged).
 * Second step (owner playtest, 2026-11-05): the Music slider read 16 and was still too loud, 14 felt right: every target another 1.2 dB lower (20 log10(14/16) = -1.16 dB), so the SAME slider position now sounds like 14 did relative to 16; slider range and default untouched.
 * The bar target is the level it should sound at; the bar music runs on the (quieter by default) Ambience bus, `BAR_AUDIO.busBoost` makes up for that.
 */
export const MUSIC_TARGET_LUFS: Record<TrackGroup, number> = { menu: -21.2, game: -21.2, bar: -19.2 };

export interface TrackDef {
  /** Stable id (used by PLAYLISTS and the saved nothing: not persisted). */
  id: string;
  /** File in `public/audio` (clean ASCII name; the owner's original file name is in `public/audio/README.md`). */
  file: string;
  /** Display name (Settings "Now playing"). */
  title: string;
  group: TrackGroup;
  /** Integrated loudness of the committed file: `ffmpeg -i f.mp3 -af ebur128 -f null -` (2026-11-05). */
  lufs: number;
  /** Linear gain = 10^((MUSIC_TARGET_LUFS[group] - lufs) / 20), rounded to 3 decimals (tests/repo/musicAssets.test.ts checks it). */
  trim: number;
}

export const TRACKS: readonly TrackDef[] = [
  { id: 'seasons-of-management', file: 'menu-seasons-of-management.mp3', title: 'Seasons of Management', group: 'menu', lufs: -15.9, trim: 0.543 },
  { id: 'seasonal-menu', file: 'menu-seasonal-menu.mp3', title: 'Seasonal Menu', group: 'menu', lufs: -15.6, trim: 0.525 },
  { id: 'winter-mountain-morning', file: 'game-winter-mountain-morning.mp3', title: 'Mountain Morning', group: 'game', lufs: -15.8, trim: 0.537 },
  { id: 'winter-early-slopes', file: 'game-winter-early-slopes.mp3', title: 'Winter Early slopes', group: 'game', lufs: -14.3, trim: 0.452 },
  { id: 'winter-day', file: 'game-winter-day.mp3', title: 'Winter Day', group: 'game', lufs: -15.4, trim: 0.513 },
  { id: 'winter-snow', file: 'game-winter-snow.mp3', title: 'Winter Snow', group: 'game', lufs: -17.6, trim: 0.661 },
  { id: 'evening-corner', file: 'game-evening-corner.mp3', title: 'Evening Corner', group: 'game', lufs: -16.6, trim: 0.589 },
  { id: 'night-melted-snow', file: 'game-night-melted-snow.mp3', title: 'Melted Snow', group: 'game', lufs: -16.4, trim: 0.575 },
  { id: 'night-vinny-f-minor', file: 'game-night-vinny-f-minor.mp3', title: 'Vinny F Minor', group: 'game', lufs: -16.4, trim: 0.575 },
  { id: 'summer-meadow-loop', file: 'game-summer-meadow-loop.mp3', title: 'Meadow Loop', group: 'game', lufs: -15.7, trim: 0.531 },
  { id: 'summer-pastoral-walk', file: 'game-summer-pastoral-walk.mp3', title: 'Pastoral Walk', group: 'game', lufs: -15.3, trim: 0.507 },
  { id: 'autumn-gentle-sway', file: 'game-autumn-gentle-sway.mp3', title: "Autumn's Gentle Sway", group: 'game', lufs: -16.3, trim: 0.569 },
  { id: 'autumn-gold', file: 'game-autumn-gold.mp3', title: 'Autumn Gold', group: 'game', lufs: -16.0, trim: 0.55 },
  { id: 'storm-tente-restringida', file: 'game-storm-tente-restringida.mp3', title: 'Tente Restringida', group: 'game', lufs: -17.8, trim: 0.676 },
  { id: 'festival-groove', file: 'game-festival-groove.mp3', title: 'Festival groove', group: 'game', lufs: -15.8, trim: 0.537 },
  { id: 'bar-ski-hut-groove', file: 'apres-ski-hut-groove.mp3', title: 'Ski Hut Groove', group: 'bar', lufs: -16.1, trim: 0.7 },
  { id: 'bar-polka-party-time', file: 'apres-polka-party-time.mp3', title: 'Polka Party Time', group: 'bar', lufs: -16.5, trim: 0.733 },
  { id: 'bar-alpine-apres-ski', file: 'apres-alpine-apres-ski.mp3', title: 'Alpine Après-Ski', group: 'bar', lufs: -16.1, trim: 0.7 },
  { id: 'bar-ski-brass', file: 'apres-ski-brass.mp3', title: 'Après-Ski Brass', group: 'bar', lufs: -16.5, trim: 0.733 },
];
export const TRACK_BY_ID: ReadonlyMap<string, TrackDef> = new Map(TRACKS.map((t) => [t.id, t]));

/** Game situations (see `situationFor` in src/audio/musicPlaylist.ts). */
export const SITUATION_IDS = ['winter-morning', 'winter-day', 'snow', 'dusk', 'night', 'summer', 'autumn', 'storm', 'festival'] as const;
export type SituationId = (typeof SITUATION_IDS)[number];

/** Situation -> rotating playlist (track ids). Several tracks = they alternate, never the same one twice in a row. */
export const PLAYLISTS: Record<SituationId, readonly string[]> = {
  /** Winter, dawn to late morning (and a quiet afternoon). */
  'winter-morning': ['winter-mountain-morning', 'winter-early-slopes'],
  /** Winter, from late morning to dusk, resort busy. */
  'winter-day': ['winter-day'],
  /** Snowing in the daytime (any season). */
  snow: ['winter-snow'],
  /** Dusk (any season but autumn, which has its own evening). */
  dusk: ['evening-corner'],
  /** Night: the calm track and the chill lo-fi alternative alternate. */
  night: ['night-melted-snow', 'night-vinny-f-minor'],
  /** Spring and summer days. */
  summer: ['summer-meadow-loop', 'summer-pastoral-walk'],
  /** Autumn day and evening. */
  autumn: ['autumn-gentle-sway', 'autumn-gold'],
  /** Storm / heavy snow, any hour. */
  storm: ['storm-tente-restringida'],
  /** A festival on, in the daytime and evening. */
  festival: ['festival-groove'],
};
/** A playlist with a single track would repeat it; when it ends, the next track comes from this other situation's playlist instead (never the same track twice in a row). */
export const FALLBACK: Record<SituationId, SituationId> = {
  'winter-morning': 'winter-day', 'winter-day': 'winter-morning', snow: 'winter-morning', dusk: 'night', night: 'dusk', summer: 'autumn', autumn: 'summer', storm: 'night', festival: 'summer',
};
/** Menu / title screen: Seasons of Management is the title theme and always opens; the two alternate. */
export const MENU_PLAYLIST: readonly string[] = ['seasons-of-management', 'seasonal-menu'];
/** Next to an open Apres-Ski Bar or Schirmbar. */
export const BAR_PLAYLIST: readonly string[] = ['bar-ski-hut-groove', 'bar-polka-party-time', 'bar-alpine-apres-ski', 'bar-ski-brass'];

/** Rules that pick the situation and when the music changes (pure logic in `musicPlaylist.ts`). */
export const SITUATION = {
  /** Day-part hours (shifted with today's sunrise / sunset): night < dawnStart, dawn dawnStart..dawnEnd, day, dusk from duskStart, night from nightStart. */
  hours: { dawnStart: 5, dawnEnd: 8, duskStart: 18, nightStart: 21 },
  /** Winter: the morning playlist plays until this hour (late morning); after it, Winter Day when busy. */
  lateMorning: 11,
  /** "Busy resort" = guests / 300 (index.ts): on above `busyOn`, off again below `busyOff` (hysteresis). */
  busyOn: 0.35, busyOff: 0.2,
  /** A new situation must hold this long (s) before it counts (the hour ticking over, a weather flicker, a short snow shower). */
  settleSec: 20,
  /** Situations that cut in with a crossfade (storm starts, night falls, a festival begins) instead of waiting for the track to end. */
  urgent: ['storm', 'night', 'festival'] as readonly SituationId[],
  /** Minimum time (s) between two such situation-driven crossfades (a flickering storm never ping-pongs). */
  minChangeGapSec: 150,
} as const;

/** Player timing (seconds). */
export const MUSIC_PLAY = {
  /** Scheduler period (ms). */
  tickMs: 250,
  /** First fade-in of the game music, and the crossfade at a track end (the next track starts this long before the end). */
  introFade: 3, trackCrossfade: 4,
  /** Crossfade for a situation change (storm, night, festival) and for "Next track". */
  situationCrossfade: 5, skipCrossfade: 2.5,
  /** Delay (s) between the engine running and the first track (after first paint, never during boot). */
  startDelay: 1.5,
  /** Gate fade time constants: pause (speed 0 / mute) and resume. */
  pauseFadeTc: 0.5, resumeFadeTc: 0.8,
  /** After the gain reached 0, the element is paused (position kept) this long after the music stopped being wanted. */
  holdAfter: 1.2,
  /** "Next track" in Settings keeps the music audible this long while the game is paused (so it can be previewed). */
  previewSec: 25,
  /** After a load failure the next candidate is tried; when every candidate failed, retry after this long. */
  failBackoffSec: 60,
} as const;

/** Hand-off between the game music and the bar music: the game music STOPS (fades out, holds its position, fades back in); the two never sound together. */
export const HANDOFF = {
  /** Bar level (proximity x zoom window, 0..1) to start the bar music / to give the game music back. enter > exit = hysteresis. */
  enterLevel: 0.12, exitLevel: 0.04,
  /** The level must stay beyond the threshold this long (s) before the state flips (no flip-flop while zooming). */
  enterDwell: 0.5, exitDwell: 2,
  /** Minimum time (s) spent in each steady state before the next switch may start. */
  minApresSec: 4, minMainSec: 3,
  /** Fades (s): game music out (before the bar music starts), bar music in, bar music out (before the game music returns), game music back in. */
  mainFadeOut: 0.7, apresFadeIn: 0.8, apresFadeOut: 0.6, mainFadeIn: 0.9,
} as const;

/** Bar music (src/audio/BarMusic.ts). It runs on the Ambience bus (the Ambience slider governs the bar, like the nearby-only sounds). */
export const BAR_AUDIO = {
  /** The Ambience bus defaults to 0.28 against 0.5 for Music (-5 dB): this linear factor (+5 dB) gives the bar the level its target says. */
  busBoost: 1.78,
  /** Level gain = minGain + (1 - minGain) * proximity level (the song is always clearly a song once the hand-off happened). */
  minGain: 0.3,
  /** Crossfade (s) to the next bar track when one ends while you stand there. */
  crossfade: 2.5,
  /** Absence (s) after which the next bar track plays when you come back (within it the same song resumes where it stopped). */
  restartAfterSec: 25,
} as const;

/**
 * Title-screen / main-menu music (src/audio/MenuMusic.ts): the two `menu` tracks. Swap a track: replace the file (or change `file`); add a track: add a row
 * to `TRACKS` and `MENU_PLAYLIST`; disable all: set `enabled` false. `dir` is relative to the page (`./audio/..`), so it works under `/play/` and `/slopetycoon/play/`;
 * the service worker caches the files at runtime (not precached).
 */
export const MENU_MUSIC = {
  enabled: true,
  dir: 'audio/',
  /** Seconds: fade in at the first start, crossfade between tracks, fade out when a game starts. */
  fadeIn: 1.5, crossfade: 3, fadeOut: 1,
  tickMs: 250,
} as const;
