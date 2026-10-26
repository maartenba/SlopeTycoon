export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

export interface AudioSettingsData {
  master: number; music: number; sfx: number; ambience: number;
  muted: boolean;
  /** Lowers the master ceiling and the loud one-shots (avalanche, alarms, bankruptcy). */
  reduceLoud: boolean;
  /** Silences sfx + music, keeps the ambience beds. */
  ambienceOnly: boolean;
  /** Generative music on/off. */
  musicOn: boolean;
  /** Fade the music out while the game is paused (speed 0). */
  pauseMusicAtZero: boolean;
  /** Placeholder: mute music while menus are open (not wired to any menu yet). */
  muteMusicInMenus: boolean;
}

/** Pre-M5.1 default ambience volume; persisted values exactly equal to it are migrated to the new default (users who never touched the slider). */
export const LEGACY_AMBIENCE_DEFAULT = 0.7;
export const AUDIO_STORAGE_KEY = 'slope.audio.v1';
export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettingsData> = { master: 0.7, music: 0.5, sfx: 0.8, ambience: 0.45, muted: false, reduceLoud: false, ambienceOnly: false, musicOn: true, pauseMusicAtZero: true, muteMusicInMenus: false };
export type VolumeKey = 'master' | 'music' | 'sfx' | 'ambience';
export const VOLUME_KEYS: readonly VolumeKey[] = ['master', 'music', 'sfx', 'ambience'];

const clamp01 = (n: unknown, d: number): number => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d);
const bool = (n: unknown, d: boolean): boolean => (typeof n === 'boolean' ? n : d);

/** Parses persisted JSON defensively: anything malformed falls back to the default for that field. */
export function parseSettings(raw: string | null): AudioSettingsData {
  const d = DEFAULT_AUDIO_SETTINGS;
  if (!raw) return { ...d };
  try {
    const o = JSON.parse(raw) as Partial<Record<keyof AudioSettingsData, unknown>> | null;
    if (!o || typeof o !== 'object') return { ...d };
    return { master: clamp01(o.master, d.master), music: clamp01(o.music, d.music), sfx: clamp01(o.sfx, d.sfx), ambience: o.ambience === LEGACY_AMBIENCE_DEFAULT ? d.ambience : clamp01(o.ambience, d.ambience), muted: bool(o.muted, d.muted), reduceLoud: bool(o.reduceLoud, d.reduceLoud), ambienceOnly: bool(o.ambienceOnly, d.ambienceOnly), musicOn: bool(o.musicOn, d.musicOn), pauseMusicAtZero: bool(o.pauseMusicAtZero, d.pauseMusicAtZero), muteMusicInMenus: bool(o.muteMusicInMenus, d.muteMusicInMenus) };
  } catch { return { ...d }; }
}

/** Observable, persisted audio settings. Storage is injected (LocalStorage in the browser, a fake in tests; may be null or throwing). */
export class AudioSettings {
  private data: AudioSettingsData;
  private subs = new Set<(s: Readonly<AudioSettingsData>) => void>();
  constructor(private storage: StorageLike | null = null) {
    let raw: string | null = null;
    try { raw = storage?.getItem(AUDIO_STORAGE_KEY) ?? null; } catch { /* private mode */ }
    this.data = parseSettings(raw);
  }
  /** Transient duck (fast-forward): reads as muted everywhere but is never persisted and never changes the saved `muted` flag. */
  private _ducked = false;
  private view: Readonly<AudioSettingsData> | null = null;
  get ducked(): boolean { return this._ducked; }
  setDucked(v: boolean): void {
    if (v === this._ducked) return;
    this._ducked = v; this.view = null;
    const cur = this.get();
    for (const s of [...this.subs]) s(cur);
  }
  get(): Readonly<AudioSettingsData> {
    if (!this._ducked) return this.data;
    return this.view ??= { ...this.data, muted: true };
  }
  set(p: Partial<AudioSettingsData>): void {
    const n = { ...this.data };
    for (const k of VOLUME_KEYS) if (p[k] !== undefined) n[k] = clamp01(p[k], n[k]);
    if (p.muted !== undefined) n.muted = !!p.muted;
    if (p.reduceLoud !== undefined) n.reduceLoud = !!p.reduceLoud;
    if (p.ambienceOnly !== undefined) n.ambienceOnly = !!p.ambienceOnly;
    if (p.musicOn !== undefined) n.musicOn = !!p.musicOn;
    if (p.pauseMusicAtZero !== undefined) n.pauseMusicAtZero = !!p.pauseMusicAtZero;
    if (p.muteMusicInMenus !== undefined) n.muteMusicInMenus = !!p.muteMusicInMenus;
    if (JSON.stringify(n) === JSON.stringify(this.data)) return;
    this.data = n; this.view = null;
    try { this.storage?.setItem(AUDIO_STORAGE_KEY, JSON.stringify(n)); } catch { /* quota / private mode */ }
    for (const s of [...this.subs]) s(this.get());
  }
  toggleMute(): boolean { this.set({ muted: !this.data.muted }); return this.data.muted; }
  subscribe(fn: (s: Readonly<AudioSettingsData>) => void): () => void { this.subs.add(fn); return () => this.subs.delete(fn); }
}

/** Reduce-loud master ceiling factor. */
export const REDUCE_LOUD_FACTOR = 0.55;

/** Effective linear gain per bus (mute / ambience-only / reduce-loud applied). Pure. */
export function busGains(s: Readonly<AudioSettingsData>): { master: number; music: number; sfx: number; ambience: number } {
  if (s.muted) return { master: 0, music: 0, sfx: 0, ambience: 0 };
  return {
    master: s.master * (s.reduceLoud ? REDUCE_LOUD_FACTOR : 1),
    music: s.ambienceOnly ? 0 : s.music, sfx: s.ambienceOnly ? 0 : s.sfx, ambience: s.ambience,
  };
}
