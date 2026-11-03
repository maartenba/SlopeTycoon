import type { SeasonId, WeatherKind } from '../core/events';
import type { ModeName } from './theory';

export type Layer = 'pad' | 'bass' | 'arp' | 'melody' | 'counter' | 'perc';
export const LAYERS: readonly Layer[] = ['pad', 'bass', 'arp', 'melody', 'counter', 'perc'];
/**
 * Instruments (all harmonic, soft attacks; the old inharmonic FM 'bell', 'glock', 'marimba' and 'handpan' are gone, see docs/audio.md "Why it sounded weird").
 * pad / strings = detuned saws through a low-pass; epiano = sine + 2nd partial; pluck / guitar = filtered saw+triangle; harp = sines; flute = triangle+sine with vibrato.
 */
export type InstId = 'pad' | 'strings' | 'epiano' | 'pluck' | 'guitar' | 'harp' | 'flute' | 'sub' | 'brush' | 'shaker' | 'drone' | 'piano' | 'mallet' | 'warmLead' | 'bassPluck' | 'kickSoft' | 'snareSoft' | 'rim' | 'hatSoft' | 'kick' | 'snare' | 'clap' | 'hat' | 'hatO' | 'crash' | 'riser' | 'accordion' | 'brass' | 'bassSaw' | 'accM' | 'accm' | 'acc7' | 'brassStab';

export const TRACK_IDS = ['morningSnow', 'alpineNoon', 'apres', 'starlight', 'summerMeadow', 'autumnGold', 'blizzard', 'title', 'festival', 'snowPiano', 'nightChill', 'menu'] as const;
export type TrackId = (typeof TRACK_IDS)[number];
/** Player setting: pick automatically from the game state, or lock one track. (Off = the Music checkbox / `musicOn`.) */
export type MusicStyle = 'auto' | TrackId;
export const MUSIC_STYLES: readonly MusicStyle[] = ['auto', ...TRACK_IDS];
export const isMusicStyle = (v: unknown): v is MusicStyle => typeof v === 'string' && (MUSIC_STYLES as readonly string[]).includes(v);

export interface Theme {
  id: TrackId;
  /** Display name (Settings > Audio). */
  name: string;
  /** One-line mood. */
  mood: string;
  /** Tempo at 1x speed, daytime. */
  bpm: number;
  modes: readonly ModeName[];
  /** Pitch classes (midi root, 48..59) the piece may be in (the transposition below is added). */
  roots: readonly number[];
  /** Semitones added to every note of the piece (blizzard / title sit lower). */
  transpose: number;
  /** Chord progressions as scale degrees (0 = I). Each chord lasts `barsPerChord` bars (slow harmonic rhythm). */
  progressions: ReadonlyArray<readonly number[]>;
  barsPerChord: 1 | 2 | 4;
  /** Song form. I = intro (4 bars), A = verse, B = chorus, C = bridge (8 bars each), O = outro (4 bars); a repeated letter = varied repeat. */
  form: string;
  inst: { pad: InstId; bass: InstId; arp: InstId; melody: InstId; /** Counter-melody (harmony line under the lead; chorus / bridge). */ counter: InstId; /** Main percussion instrument (null = no drums). */ perc: InstId | null };
  /** Drum pattern family (see musicComposer `drumBar`); brush / shaker are the old light kits. */
  kit: 'none' | 'brush' | 'shaker' | 'lofi' | 'pop';
  /** Swing of the off-beat eighths 0..0.33. */
  swing: number;
  /** Pads / counter-melody duck gently against the kick (kit tracks only). */
  sidechain: boolean;
  /** Night drums level 0..1 (the lo-fi night track keeps its soft beat after dark). */
  nightPerc: number;
  /** Chance a bar's melody / arp step is a rest. */
  melodyRest: number; arpRest: number;
  /** Arp grid in beats and note pattern (chord-tone positions). */
  arpStep: number; arpPatterns: ReadonlyArray<readonly number[]>;
  bassStyle: 'whole' | 'rootFifth' | 'pulse' | 'groove';
  /** Pad level, melody level (0..1 velocity scales). */
  padVel: number; melodyVel: number;
  /** Melody uses only the pentatonic subset of the mode (no semitone clashes). */
  pentatonic: boolean;
  /** Pad voices are seventh chords (jazzy). */
  seventh: boolean;
  /** Baseline weight of the percussion layer; otherwise it only plays when the resort is busy. */
  percBase: number;
  /** Per-layer ceiling multipliers (e.g. night track: no percussion). */
  bias: Record<Layer, number>;
}

const B1: Record<Layer, number> = { pad: 1, bass: 1, arp: 1, melody: 1, counter: 1, perc: 1 };
const D = { kit: 'none', swing: 0, sidechain: false, nightPerc: 0 } as const;

/**
 * Twelve tracks, each a full song form (intro, verse, chorus, bridge, outro; 4-8 bar phrases) composed fresh from a seed (see musicComposer.ts).
 * Tempo, key and layer weights then follow season, time of day and weather (musicState.ts). Still quiet on purpose: everything sits in a warm band.
 */
export const THEMES: Record<TrackId, Theme> = {
  morningSnow: { id: 'morningSnow', name: 'Morning Snow', mood: 'Bright, clear pentatonic pads, mallets and a soft string counter-line', bpm: 76, modes: ['ionian', 'lydian'], roots: [50, 52, 55, 57], transpose: 0,
    progressions: [[0, 4, 5, 3], [0, 3, 4, 0], [0, 5, 3, 4], [0, 2, 3, 4]], barsPerChord: 2, form: 'IABABO', inst: { pad: 'pad', bass: 'sub', arp: 'harp', melody: 'mallet', counter: 'strings', perc: null }, ...D,
    melodyRest: 0.35, arpRest: 0.3, arpStep: 1, arpPatterns: [[0, 1, 2, 1], [2, 1, 0, 1], [0, 2, 1, 2]], bassStyle: 'rootFifth', padVel: 1, melodyVel: 0.8, pentatonic: true, seventh: false, percBase: 0, bias: B1 },
  alpineNoon: { id: 'alpineNoon', name: 'Alpine Noon', mood: 'Warm major harmony, a groovy plucked bass and a soft pop beat when the resort is busy', bpm: 84, modes: ['ionian', 'mixolydian'], roots: [48, 50, 52, 55], transpose: 0,
    progressions: [[0, 3, 4, 3], [0, 5, 3, 4], [0, 4, 3, 0], [0, 2, 3, 4]], barsPerChord: 2, form: 'IABCBO', inst: { pad: 'pad', bass: 'bassPluck', arp: 'guitar', melody: 'pluck', counter: 'flute', perc: 'kickSoft' }, kit: 'pop', swing: 0.12, sidechain: true, nightPerc: 0,
    melodyRest: 0.3, arpRest: 0.2, arpStep: 0.5, arpPatterns: [[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3]], bassStyle: 'groove', padVel: 0.8, melodyVel: 0.8, pentatonic: true, seventh: false, percBase: 0, bias: B1 },
  apres: { id: 'apres', name: 'Après', mood: 'Gentle jazzy electric piano, piano lead, walking bass and brushes for the evening', bpm: 72, modes: ['dorian', 'mixolydian'], roots: [50, 53, 55, 57], transpose: 0,
    progressions: [[0, 3, 0, 3], [0, 5, 3, 4], [1, 4, 0, 5], [0, 3, 1, 4]], barsPerChord: 2, form: 'IABABO', inst: { pad: 'epiano', bass: 'bassPluck', arp: 'guitar', melody: 'piano', counter: 'strings', perc: 'brush' }, kit: 'brush', swing: 0.22, sidechain: false, nightPerc: 0,
    melodyRest: 0.3, arpRest: 0.4, arpStep: 1, arpPatterns: [[0, 2, 1, 2], [0, 1, 2, 1], [2, 1, 0, 1]], bassStyle: 'groove', padVel: 0.9, melodyVel: 0.8, pentatonic: true, seventh: true, percBase: 0.55, bias: B1 },
  starlight: { id: 'starlight', name: 'Starlight', mood: 'Sparse pads, slow harp arpeggios and a distant string line for the night', bpm: 60, modes: ['aeolian', 'dorian', 'lydian'], roots: [48, 50, 52, 55], transpose: 0,
    progressions: [[0, 5], [0, 3], [5, 3], [0, 4]], barsPerChord: 4, form: 'IABAO', inst: { pad: 'pad', bass: 'sub', arp: 'harp', melody: 'harp', counter: 'strings', perc: null }, ...D,
    melodyRest: 0.5, arpRest: 0.25, arpStep: 2, arpPatterns: [[0, 1, 2], [2, 1, 0], [0, 2, 1]], bassStyle: 'whole', padVel: 1, melodyVel: 0.7, pentatonic: true, seventh: false, percBase: 0, bias: { ...B1, perc: 0 } },
  summerMeadow: { id: 'summerMeadow', name: 'Summer Meadow', mood: 'Sunny uplift: airy flute over soft guitar, a bouncing bass and a light shaker', bpm: 88, modes: ['ionian', 'lydian', 'mixolydian'], roots: [48, 50, 52, 55], transpose: 0,
    progressions: [[0, 4, 5, 3], [0, 3, 0, 4], [1, 4, 0, 3], [0, 2, 3, 4]], barsPerChord: 2, form: 'IAABAO', inst: { pad: 'pad', bass: 'bassPluck', arp: 'guitar', melody: 'flute', counter: 'mallet', perc: 'shaker' }, kit: 'shaker', swing: 0.1, sidechain: false, nightPerc: 0,
    melodyRest: 0.3, arpRest: 0.25, arpStep: 0.5, arpPatterns: [[0, 1, 2, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3, 2, 1]], bassStyle: 'groove', padVel: 0.6, melodyVel: 0.85, pentatonic: true, seventh: false, percBase: 0, bias: B1 },
  autumnGold: { id: 'autumnGold', name: 'Autumn Gold', mood: 'Warm strings, soft piano and a flute answer in the evening light', bpm: 70, modes: ['dorian', 'aeolian', 'mixolydian'], roots: [50, 52, 55, 57], transpose: 0,
    progressions: [[0, 3, 4, 0], [0, 5, 1, 4], [5, 3, 0, 4], [0, 4, 5, 2]], barsPerChord: 2, form: 'IABABO', inst: { pad: 'strings', bass: 'sub', arp: 'guitar', melody: 'piano', counter: 'flute', perc: null }, ...D,
    melodyRest: 0.35, arpRest: 0.3, arpStep: 1, arpPatterns: [[0, 1, 2, 1], [0, 2, 1], [2, 1, 0, 1]], bassStyle: 'rootFifth', padVel: 0.9, melodyVel: 0.8, pentatonic: true, seventh: false, percBase: 0, bias: B1 },
  blizzard: { id: 'blizzard', name: 'Blizzard', mood: 'Tension: dark drone and low strings while the storm passes', bpm: 52, modes: ['aeolian', 'dorian'], roots: [48, 50, 53, 55], transpose: -12,
    progressions: [[0, 5], [0, 3], [0, 6]], barsPerChord: 4, form: 'ABAB', inst: { pad: 'strings', bass: 'sub', arp: 'harp', melody: 'strings', counter: 'strings', perc: null }, ...D,
    melodyRest: 0.6, arpRest: 0.7, arpStep: 2, arpPatterns: [[0, 1, 2]], bassStyle: 'whole', padVel: 1, melodyVel: 0.6, pentatonic: true, seventh: false, percBase: 0, bias: { ...B1, perc: 0, arp: 0.5 } },
  title: { id: 'title', name: 'Title Theme', mood: 'Calm, slightly cinematic alpine opening: strings, harp and piano', bpm: 78, modes: ['lydian', 'ionian'], roots: [50, 53, 55, 57], transpose: -5,
    progressions: [[0, 4, 5, 3], [0, 3, 5, 4]], barsPerChord: 2, form: 'IABAO', inst: { pad: 'strings', bass: 'sub', arp: 'harp', melody: 'piano', counter: 'flute', perc: null }, ...D,
    melodyRest: 0.3, arpRest: 0.3, arpStep: 1, arpPatterns: [[0, 1, 2, 1], [2, 1, 0, 1]], bassStyle: 'whole', padVel: 1, melodyVel: 0.85, pentatonic: true, seventh: false, percBase: 0, bias: B1 },
  festival: { id: 'festival', name: 'Festival', mood: 'A livelier groove: warm lead, bouncing bass, a flute answer and a soft pop beat', bpm: 104, modes: ['ionian', 'mixolydian'], roots: [48, 50, 52, 55], transpose: 0,
    progressions: [[0, 4, 5, 3], [0, 3, 4, 4], [0, 5, 3, 4], [0, 2, 3, 4]], barsPerChord: 2, form: 'IAABABO', inst: { pad: 'pad', bass: 'bassPluck', arp: 'guitar', melody: 'warmLead', counter: 'flute', perc: 'kickSoft' }, kit: 'pop', swing: 0.14, sidechain: true, nightPerc: 0,
    melodyRest: 0.2, arpRest: 0.1, arpStep: 0.5, arpPatterns: [[0, 1, 2, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3, 2, 1]], bassStyle: 'groove', padVel: 0.7, melodyVel: 0.9, pentatonic: true, seventh: false, percBase: 0.7, bias: B1 },
  snowPiano: { id: 'snowPiano', name: 'Snow Piano', mood: 'Snowy and calm: felt piano, a soft mallet shimmer and slow strings', bpm: 62, modes: ['lydian', 'ionian', 'mixolydian'], roots: [50, 52, 55, 57], transpose: 0,
    progressions: [[0, 4, 5, 3], [0, 3, 0, 4], [5, 3, 0, 4], [0, 2, 5, 3]], barsPerChord: 2, form: 'IABAO', inst: { pad: 'pad', bass: 'sub', arp: 'mallet', melody: 'piano', counter: 'strings', perc: null }, ...D,
    melodyRest: 0.4, arpRest: 0.45, arpStep: 1, arpPatterns: [[0, 1, 2, 1], [2, 1, 0, 1], [0, 2, 1, 2]], bassStyle: 'whole', padVel: 0.7, melodyVel: 0.9, pentatonic: true, seventh: false, percBase: 0, bias: { ...B1, perc: 0 } },
  nightChill: { id: 'nightChill', name: 'Night Chill', mood: 'Lo-fi evening: swung soft beat, electric piano, plucked bass and a warm lead', bpm: 78, modes: ['dorian', 'aeolian'], roots: [48, 50, 53, 55], transpose: 0,
    progressions: [[0, 3, 1, 4], [1, 4, 0, 5], [0, 5, 3, 4], [5, 1, 4, 0]], barsPerChord: 2, form: 'IABABO', inst: { pad: 'epiano', bass: 'bassPluck', arp: 'mallet', melody: 'epiano', counter: 'warmLead', perc: 'kickSoft' }, kit: 'lofi', swing: 0.3, sidechain: true, nightPerc: 1,
    melodyRest: 0.4, arpRest: 0.4, arpStep: 1, arpPatterns: [[0, 2, 1, 2], [0, 1, 2, 1], [2, 1, 0, 1]], bassStyle: 'groove', padVel: 0.85, melodyVel: 0.75, pentatonic: true, seventh: true, percBase: 0.8, bias: B1 },
  menu: { id: 'menu', name: 'Menu Theme', mood: 'A quiet, open loop for menus: electric piano, mallets and a flute line', bpm: 72, modes: ['ionian', 'lydian'], roots: [48, 50, 53, 55], transpose: 0,
    progressions: [[0, 5, 3, 4], [0, 3, 4, 0], [0, 4, 5, 3]], barsPerChord: 2, form: 'IABAO', inst: { pad: 'strings', bass: 'sub', arp: 'mallet', melody: 'epiano', counter: 'flute', perc: null }, ...D,
    melodyRest: 0.35, arpRest: 0.35, arpStep: 1, arpPatterns: [[0, 1, 2, 1], [0, 2, 1, 2]], bassStyle: 'whole', padVel: 0.9, melodyVel: 0.8, pentatonic: true, seventh: false, percBase: 0, bias: { ...B1, perc: 0 } },
};

/** Layer multipliers + tempo by time of day (blended in musicState for dawn). */
export const NIGHT = { tempo: 0.85, layers: { pad: 1, bass: 0.4, arp: 0.35, melody: 0.3, counter: 0.25, perc: 0 } as Record<Layer, number> };
export const DAY = { tempo: 1, layers: { pad: 1, bass: 1, arp: 1, melody: 1, counter: 1, perc: 1 } as Record<Layer, number> };
export const DUSK = { tempo: 0.95, layers: { pad: 1, bass: 1, arp: 0.9, melody: 0.9, counter: 0.9, perc: 0.6 } as Record<Layer, number> };
/** Hour boundaries: night < DAWN_START, dawn build DAWN_START..DAWN_END, day, dusk from DUSK_START, night from NIGHT_START. */
export const HOURS = { dawnStart: 5, dawnEnd: 8, duskStart: 18, nightStart: 21 };

/** Layer multipliers by weather. Snowstorms (heavySnow / storm) are pads only. */
export const WEATHER_LAYERS: Record<WeatherKind, Record<Layer, number>> = {
  clear: { pad: 1, bass: 1, arp: 1, melody: 1, counter: 1, perc: 1 }, cloudy: { pad: 1, bass: 1, arp: 1, melody: 0.9, counter: 0.9, perc: 0.8 },
  snow: { pad: 1, bass: 1, arp: 0.8, melody: 0.8, counter: 0.8, perc: 0.3 }, rain: { pad: 1, bass: 0.9, arp: 0.8, melody: 0.8, counter: 0.7, perc: 0.4 },
  heavySnow: { pad: 1, bass: 0, arp: 0, melody: 0, counter: 0, perc: 0 }, storm: { pad: 1, bass: 0, arp: 0, melody: 0, counter: 0, perc: 0 },
};

/** Tuning constants for the scheduler / structure. */
export const MUSIC = {
  maxVoices: 18, lookahead: 0.15, tickMs: 25, crossfadeSec: 8, introFadeSec: 3.5, gapMin: 12, gapMax: 35,
  stepBeats: 0.25, barBeats: 4, barsPerSection: 8, introBars: 4,
  pauseFadeTc: 0.5, resumeFadeTc: 0.8, tensionDecayTc: 25, jingleGap: 12, reverbWet: 0.3,
  /** Music bus tone: low-pass cutoff (Hz) keeping everything soft. */
  toneHz: 5200,
  /** A playing track must have been on for this long before a context change may swap it, and it must fit worse than `swapBelow`. */
  previewSec: 25, minPlaySec: 30, swapBelow: 0.12,
  speedMul: { 0: 1, 1: 1, 2: 1.12, 3: 1.25 } as Record<number, number>,
};

export type { SeasonId };
