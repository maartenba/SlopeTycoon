import { AudioEngine } from './AudioEngine';
import { AudioSettings, type StorageLike } from './AudioSettings';
import { createRealBackend, type AudioBackend } from './backend';
import { MenuMusic, type MenuMusicDeps } from './MenuMusic';

export interface MenuAudio {
  settings: AudioSettings;
  engine: AudioEngine;
  music: MenuMusic;
  /** Fade the menu music out, then run `go` (immediately when nothing is playing). */
  leave(go: () => void): void;
  dispose(): void;
}

/**
 * Title-screen audio (no sim, no game audio engine): settings (shared with the Settings dialog), an engine that unlocks on the first
 * pointer / key press and suspends while the tab is hidden, the M mute key, and the menu music. Nothing is fetched until the engine runs.
 */
export function createMenuAudio(d: { storage: StorageLike | null; win?: Window; doc?: Document; factory?: () => AudioBackend | null; player?: MenuMusicDeps['player']; rand?: () => number }): MenuAudio {
  const settings = new AudioSettings(d.storage);
  const engine = new AudioEngine({ factory: d.factory ?? createRealBackend, settings });
  const music = new MenuMusic({ engine, settings, ...(d.player ? { player: d.player } : {}), ...(d.rand ? { rand: d.rand } : {}) });
  const win = d.win ?? (typeof window !== 'undefined' ? window : undefined), doc = d.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const offs: Array<() => void> = [];
  if (win && doc) {
    offs.push(engine.attach(win, doc));
    const onKey = (e: KeyboardEvent): void => {
      const t = ((e.composedPath?.()[0] as HTMLElement | undefined) ?? e.target) as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) settings.toggleMute();
    };
    win.addEventListener('keydown', onKey);
    offs.push(() => win.removeEventListener('keydown', onKey));
  }
  return {
    settings, engine, music,
    leave(go) { const ms = music.fadeOut(); if (ms <= 0) { go(); return; } setTimeout(go, ms); },
    dispose() { for (const o of offs.splice(0)) o(); music.dispose(); engine.dispose(); },
  };
}
