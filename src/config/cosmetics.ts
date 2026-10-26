/**
 * Cosmetic rewards (M5.3 Task 16): purely visual, unlocked by achievements, saved in the local profile, applied at runtime without a restart.
 * Defaults (`classic` palette, `none` flags, `none` photo frame, `red` chairs) are always owned and render exactly as before.
 * The unlock mapping is `ACHIEVEMENTS[].reward` (config/achievements.ts); `cosmeticUnlockedBy()` resolves it. Documented in docs/achievements.md.
 */
export type CosmeticKind = 'palette' | 'flags' | 'frame' | 'chair';
export const COSMETIC_KINDS: readonly CosmeticKind[] = ['palette', 'flags', 'frame', 'chair'];
export const COSMETIC_KIND_LABEL: Record<CosmeticKind, string> = { palette: 'Building palette', flags: 'Village flags', frame: 'Photo frame', chair: 'Lift chairs' };

export type Rgb = readonly [number, number, number];
export interface CosmeticDef {
  /** Globally unique id, `<kind>:<name>` (the profile stores this string). */
  id: string;
  kind: CosmeticKind;
  name: string;
  /** Always owned (the default look). */
  default?: boolean;
  /** Preview swatch colours (CSS hex) for the Settings tile. */
  swatch: readonly string[];
  /** Palette: RGB multipliers applied to the roof / wood material colour (multiply the vertex colours; stone and glass stay untouched). */
  palette?: { roof: Rgb; wood: Rgb };
  /** Flags: pennant colours along the village bunting (empty = no bunting). */
  flags?: { colors: readonly number[] };
  /** Chair: body colour (hex). */
  chair?: { body: number };
}

export const COSMETICS: readonly CosmeticDef[] = [
  { id: 'palette:classic', kind: 'palette', name: 'Classic', default: true, swatch: ['#a6482f', '#8b6a44'], palette: { roof: [1, 1, 1], wood: [1, 1, 1] } },
  { id: 'palette:alpine-red', kind: 'palette', name: 'Alpine Red', swatch: ['#b3261e', '#8b5a3a'], palette: { roof: [1.18, 0.62, 0.6], wood: [1.04, 0.92, 0.86] } },
  { id: 'palette:forest-green', kind: 'palette', name: 'Forest Green', swatch: ['#2f6b3a', '#7a5a3a'], palette: { roof: [0.62, 1.05, 0.7], wood: [0.92, 0.98, 0.88] } },
  { id: 'palette:slate', kind: 'palette', name: 'Slate', swatch: ['#56616e', '#9a9a96'], palette: { roof: [0.62, 0.74, 0.9], wood: [0.86, 0.9, 0.96] } },
  { id: 'palette:sunset', kind: 'palette', name: 'Sunset', swatch: ['#d9763a', '#c98f5a'], palette: { roof: [1.2, 0.86, 0.55], wood: [1.1, 0.94, 0.78] } },

  { id: 'flags:none', kind: 'flags', name: 'No bunting', default: true, swatch: ['#3a4658'], flags: { colors: [] } },
  { id: 'flags:tricolour', kind: 'flags', name: 'Alpine pennants', swatch: ['#d9453a', '#fafafa', '#2f6fb3'], flags: { colors: [0xd9453a, 0xfafafa, 0x2f6fb3] } },
  { id: 'flags:festival', kind: 'flags', name: 'Festival bunting', swatch: ['#f2c14e', '#f06292', '#4caf6a', '#8e5bd0'], flags: { colors: [0xf2c14e, 0xf06292, 0x4caf6a, 0x8e5bd0, 0xf08a24] } },
  { id: 'flags:golden', kind: 'flags', name: 'Golden pennants', swatch: ['#e8b93c', '#fff1b8'], flags: { colors: [0xe8b93c, 0xfff1b8, 0xc99a1e] } },

  { id: 'frame:none', kind: 'frame', name: 'Plain', default: true, swatch: ['#3a4658'] },
  { id: 'frame:alpine', kind: 'frame', name: 'Alpine badge', swatch: ['#1f3a5c', '#f4f0e4'] },
  { id: 'frame:noir', kind: 'frame', name: 'Film noir', swatch: ['#111111', '#d8d8d8'] },
  { id: 'frame:gold', kind: 'frame', name: 'Gold frame', swatch: ['#d9a521', '#fff1b8'] },

  { id: 'chair:red', kind: 'chair', name: 'Red', default: true, swatch: ['#d9453a'], chair: { body: 0xd9453a } },
  { id: 'chair:blue', kind: 'chair', name: 'Blue', swatch: ['#2f6fb3'], chair: { body: 0x2f6fb3 } },
  { id: 'chair:yellow', kind: 'chair', name: 'Yellow', swatch: ['#f2c14e'], chair: { body: 0xf2c14e } },
  { id: 'chair:green', kind: 'chair', name: 'Green', swatch: ['#3f9a55'], chair: { body: 0x3f9a55 } },
];

export const COSMETIC_BY_ID: Readonly<Record<string, CosmeticDef>> = Object.fromEntries(COSMETICS.map((c) => [c.id, c]));
export const cosmeticsOf = (k: CosmeticKind): readonly CosmeticDef[] => COSMETICS.filter((c) => c.kind === k);
export const defaultCosmetic = (k: CosmeticKind): CosmeticDef => cosmeticsOf(k).find((c) => c.default)!;
export const DEFAULT_COSMETIC_IDS: readonly string[] = COSMETICS.filter((c) => c.default).map((c) => c.id);
