/**
 * Terrain presets (Task 35): additive parameter sets for `generateTerrain(grid, seed, preset)`.
 * 'balanced' is the identity (every multiplier 1 / offset 0) so the default output is byte-identical to the pre-preset generator.
 * Ranges are kept narrow on purpose: every preset must still give the invariants the rest of the game relies on (village bench, skiable
 * slopes, lakes within the altitude band, adjacent-vertex limit). tests/world/presets.test.ts checks all presets x sizes.
 */
export type TerrainPresetId = 'balanced' | 'gentle' | 'peaks' | 'lakeland' | 'forested';
export const PRESET_IDS: readonly TerrainPresetId[] = ['balanced', 'gentle', 'peaks', 'lakeland', 'forested'];

export interface TerrainPreset {
  id: TerrainPresetId;
  label: string;
  blurb: string;
  /** Multiplier on the total relief (valid 0.8..1.2). */
  relief: number;
  /** Multiplier on the thermal-erosion talus (max edge slope; valid 0.7..1.3). */
  talus: number;
  /** Extra smoothing passes (-1..+2) over the raw height field. */
  smooth: number;
  /** Extra lakes allowed on top of the per-seed count (0..3). */
  extraLakes: number;
  /** Multiplier on forest density (0.6..1.5, result clamped to 255). */
  forest: number;
  /** Shift of the clearing threshold (lower = fewer clearings; -0.15..0.1). */
  groveShift: number;
}

export const TERRAIN_PRESETS: Record<TerrainPresetId, TerrainPreset> = {
  balanced: { id: 'balanced', label: 'Balanced', blurb: 'Varied terrain with a good mix of slopes.', relief: 1, talus: 1, smooth: 0, extraLakes: 0, forest: 1, groveShift: 0 },
  gentle: { id: 'gentle', label: 'Gentle valleys (beginner friendly)', blurb: 'Lower relief and softer flanks: easy pistes, easy lifts.', relief: 0.85, talus: 0.85, smooth: 1, extraLakes: 0, forest: 1, groveShift: 0 },
  peaks: { id: 'peaks', label: 'Dramatic peaks', blurb: 'Taller summits and steeper flanks: expert terrain, costly lifts.', relief: 1.15, talus: 1.2, smooth: -1, extraLakes: 0, forest: 0.9, groveShift: 0 },
  lakeland: { id: 'lakeland', label: 'Lakeland (more lakes)', blurb: 'Several mountain lakes: summer water attractions.', relief: 0.95, talus: 1, smooth: 0, extraLakes: 2, forest: 1, groveShift: 0 },
  forested: { id: 'forested', label: 'Forested', blurb: 'Dense woods with few clearings: build space is tight.', relief: 1, talus: 1, smooth: 0, extraLakes: 0, forest: 1.4, groveShift: -0.12 },
};

export const presetOf = (id: TerrainPresetId | undefined): TerrainPreset => TERRAIN_PRESETS[id ?? 'balanced'] ?? TERRAIN_PRESETS.balanced;
