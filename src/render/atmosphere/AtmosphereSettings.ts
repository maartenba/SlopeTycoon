import { ATMOS_LEVELS, LEVEL_FEATURES, type AtmosLevel, type LevelFeatures } from '../../config/atmosphere';

export const ATMOS_STORAGE_KEY = 'slope.atmosphere';
export const isAtmosLevel = (v: unknown): v is AtmosLevel => (ATMOS_LEVELS as readonly unknown[]).includes(v);

/** Default level: High on a capable desktop, Low on touch / phones and when the graphics quality is Low. Documented in docs/atmosphere.md. */
export function defaultAtmosLevel(coarsePointer: boolean, graphicsQuality: string): AtmosLevel {
  return coarsePointer || graphicsQuality === 'low' ? 'low' : 'high';
}
export interface AtmosStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** The Atmosphere setting (Off / Low / High): persisted, subscribable. Reduced motion is applied by the controller on top (static layers). */
export class AtmosphereSettings {
  private stored: AtmosLevel | null;
  private listeners: Array<(l: AtmosLevel) => void> = [];
  constructor(private storage: AtmosStorage | null, private fallback: () => AtmosLevel) {
    let raw: string | null = null;
    try { raw = storage?.getItem(ATMOS_STORAGE_KEY) ?? null; } catch { /* storage blocked */ }
    this.stored = isAtmosLevel(raw) ? raw : null;
  }
  get level(): AtmosLevel { return this.stored ?? this.fallback(); }
  get features(): LevelFeatures { return LEVEL_FEATURES[this.level]; }
  set(l: AtmosLevel): void {
    if (!isAtmosLevel(l)) return;
    this.stored = l;
    try { this.storage?.setItem(ATMOS_STORAGE_KEY, l); } catch { /* quota / blocked */ }
    for (const f of [...this.listeners]) f(l);
  }
  subscribe(fn: (l: AtmosLevel) => void): () => void { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((x) => x !== fn); }; }
}
