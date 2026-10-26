import type { SeasonId, WeatherKind } from '../core/events';
import type { ModeName } from './theory';

export type Layer = 'pad' | 'bass' | 'arp' | 'melody' | 'perc';
export const LAYERS: readonly Layer[] = ['pad', 'bass', 'arp', 'melody', 'perc'];
export type InstId = 'bell' | 'glock' | 'pad' | 'pluck' | 'guitar' | 'marimba' | 'handpan' | 'bass' | 'flute' | 'shaker' | 'drone';

export interface Theme {
  season: SeasonId;
  /** Tempo at 1x speed, daytime. */
  bpm: number;
  modes: readonly ModeName[];
  /** Pitch classes (midi root, 48..59) the piece may be in. */
  roots: readonly number[];
  /** Chord progressions as scale degrees (0 = I), each degree lasts 2 bars (4 degrees = 8-bar section). */
  progressions: ReadonlyArray<readonly number[]>;
  /** Section form, 8 bars each. Upper-case letter = new material, a repeated letter = varied repeat. */
  form: string;
  inst: { pad: InstId; bass: InstId; arp: InstId; melody: InstId; perc: InstId | null };
  /** Chance a bar's melody / arp step is a rest. */
  melodyRest: number; arpRest: number;
  /** Arp grid in beats and note pattern (chord-tone positions). */
  arpStep: number; arpPatterns: ReadonlyArray<readonly number[]>;
  bassStyle: 'whole' | 'rootFifth' | 'pulse';
  /** Pad level, melody level (0..1 velocity scales). */
  padVel: number; melodyVel: number;
}

export const THEMES: Record<SeasonId, Theme> = {
  winter: { season: 'winter', bpm: 70, modes: ['lydian', 'aeolian'], roots: [50, 53, 55, 57], progressions: [[0, 5, 3, 4], [0, 3, 0, 4], [0, 2, 5, 4]], form: 'ABAB',
    inst: { pad: 'pad', bass: 'bass', arp: 'glock', melody: 'bell', perc: null }, melodyRest: 0.35, arpRest: 0.25, arpStep: 1, arpPatterns: [[0, 1, 2, 1], [2, 1, 0, 1], [0, 2, 1, 2]], bassStyle: 'whole', padVel: 1, melodyVel: 0.8 },
  spring: { season: 'spring', bpm: 82, modes: ['ionian', 'mixolydian'], roots: [52, 55, 57, 59], progressions: [[0, 4, 5, 3], [1, 4, 0, 0], [0, 3, 4, 3]], form: 'ABAB',
    inst: { pad: 'pad', bass: 'bass', arp: 'pluck', melody: 'flute', perc: 'shaker' }, melodyRest: 0.25, arpRest: 0.15, arpStep: 0.5, arpPatterns: [[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3]], bassStyle: 'rootFifth', padVel: 0.7, melodyVel: 0.9 },
  summer: { season: 'summer', bpm: 90, modes: ['ionian', 'mixolydian', 'lydian'], roots: [48, 50, 52, 55], progressions: [[0, 5, 3, 4], [0, 3, 4, 4], [1, 4, 0, 5]], form: 'AABA',
    inst: { pad: 'pad', bass: 'bass', arp: 'guitar', melody: 'marimba', perc: 'shaker' }, melodyRest: 0.2, arpRest: 0.1, arpStep: 0.5, arpPatterns: [[0, 1, 2, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3, 2, 1]], bassStyle: 'pulse', padVel: 0.5, melodyVel: 1 },
  autumn: { season: 'autumn', bpm: 72, modes: ['dorian', 'aeolian'], roots: [50, 52, 55, 57], progressions: [[0, 3, 4, 0], [0, 5, 1, 4], [5, 3, 0, 4]], form: 'ABAB',
    inst: { pad: 'pad', bass: 'bass', arp: 'pluck', melody: 'handpan', perc: null }, melodyRest: 0.35, arpRest: 0.2, arpStep: 1, arpPatterns: [[0, 1, 2, 1], [0, 2, 1], [2, 1, 0, 1]], bassStyle: 'rootFifth', padVel: 1, melodyVel: 0.8 },
};

/** Layer multipliers + tempo by time of day (blended in musicState for dawn). */
export const NIGHT = { tempo: 0.85, layers: { pad: 1, bass: 0.4, arp: 0.35, melody: 0.3, perc: 0 } as Record<Layer, number> };
export const DAY = { tempo: 1, layers: { pad: 1, bass: 1, arp: 1, melody: 1, perc: 1 } as Record<Layer, number> };
export const DUSK = { tempo: 0.95, layers: { pad: 1, bass: 1, arp: 0.9, melody: 0.9, perc: 0.6 } as Record<Layer, number> };
/** Hour boundaries: night < DAWN_START, dawn build DAWN_START..DAWN_END, day, dusk from DUSK_START, night from NIGHT_START. */
export const HOURS = { dawnStart: 5, dawnEnd: 8, duskStart: 18, nightStart: 21 };

/** Layer multipliers by weather. Snowstorms (heavySnow / storm) are pads only. */
export const WEATHER_LAYERS: Record<WeatherKind, Record<Layer, number>> = {
  clear: { pad: 1, bass: 1, arp: 1, melody: 1, perc: 1 }, cloudy: { pad: 1, bass: 1, arp: 1, melody: 0.9, perc: 0.8 },
  snow: { pad: 1, bass: 1, arp: 0.8, melody: 0.8, perc: 0.3 }, rain: { pad: 1, bass: 0.9, arp: 0.8, melody: 0.8, perc: 0.4 },
  heavySnow: { pad: 1, bass: 0, arp: 0, melody: 0, perc: 0 }, storm: { pad: 1, bass: 0, arp: 0, melody: 0, perc: 0 },
};

/** Tuning constants for the scheduler / structure. */
export const MUSIC = {
  maxVoices: 12, lookahead: 0.15, tickMs: 25, crossfadeSec: 8, gapMin: 10, gapMax: 30,
  stepBeats: 0.25, barBeats: 4, barsPerSection: 8,
  pauseFadeTc: 0.5, resumeFadeTc: 0.8, tensionDecayTc: 25, jingleGap: 8, reverbSeconds: 2.2, reverbWet: 0.35,
  speedMul: { 0: 1, 1: 1, 2: 1.12, 3: 1.25 } as Record<number, number>,
};
