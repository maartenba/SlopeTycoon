import type { GameBus, GameEventName, GameEvents } from '../core/events';
import { AudioEngine } from './AudioEngine';
import { AudioSettings, type StorageLike } from './AudioSettings';
import { Ambience } from './Ambience';
import { createRealBackend, type AudioBackend } from './backend';
import { cueForNews, soundsForEvent } from './eventSounds';
import { GAME_EVENT_NAMES } from '../core/events';
import { Music } from './Music';
import { MUSIC } from './musicThemes';
import { Sfx } from './Sfx';
import { WorldProbe, type ProbeDeps } from './worldProbe';

export interface AudioDeps {
  bus: GameBus;
  probe: ProbeDeps;
  /** Camera target (tile coords: x, z) + yaw + visible height in tiles. */
  camera: () => { x: number; z: number; yaw: number; zoom: number };
  storage?: StorageLike | null;
  factory?: () => AudioBackend | null;
  win?: Window;
  doc?: Document;
  rng?: () => number;
  /** Composition seed (default: derived from today's date). */
  musicSeed?: number;
  /** Throttled tick period (s). */
  tickEvery?: number;
}

export interface AudioApi {
  engine: AudioEngine;
  sfx: Sfx;
  ambience: Ambience;
  music: Music;
  settings: AudioSettings;
  /** Call every frame with the frame delta (s); work is throttled internally (~10 Hz). */
  frame(dt: number): void;
  /** News feed output: critical / important items chime. */
  news(it: { tier: string }): void;
  dispose(): void;
}

/** Wires settings, engine, SFX, ambience, the GameEvents bus, first-gesture unlock, tab visibility, UI click ticks and the M mute key. */
export function createAudio(d: AudioDeps): AudioApi {
  const settings = new AudioSettings(d.storage ?? null);
  const engine = new AudioEngine({ factory: d.factory ?? createRealBackend, settings });
  const sfx = new Sfx(engine);
  const ambience = new Ambience(engine, sfx, d.rng);
  const probe = new WorldProbe(d.probe);
  const today = Math.floor(Date.now() / 86400000);
  const music = new Music(engine, { seed: d.musicSeed ?? 7, dayKey: d.musicSeed === undefined ? today : 0 });
  const offs: Array<() => void> = [];
  const win = d.win ?? (typeof window !== 'undefined' ? window : undefined);
  const doc = d.doc ?? (typeof document !== 'undefined' ? document : undefined);

  const hook = <K extends GameEventName>(name: K): void => {
    offs.push(d.bus.on(name, (p: GameEvents[K]) => { for (const c of soundsForEvent(name, p)) sfx.play(c.sfx, c.opts); }));
  };
  for (const n of GAME_EVENT_NAMES) hook(n);
  offs.push(d.bus.on('time:hour', (p) => ambience.onHour(p.hour)));
  offs.push(d.bus.on('speed:changed', (p) => music.setInputs({ speed: p.speed })));
  offs.push(d.bus.on('incident:avalanche', (p) => music.addTension(p.controlled ? 0.3 : 0.9)));
  offs.push(d.bus.on('incident:created', (p) => { if (p.severity >= 1) music.addTension(p.severity >= 2 ? 0.8 : 0.5); }));
  offs.push(d.bus.on('incident:escalated', () => music.addTension(0.6)));
  offs.push(d.bus.on('rating:changed', (p) => { if (p.stars > p.previous) music.jingle(); }));
  const musicTimer = typeof setInterval === 'function' ? setInterval(() => music.tick(), MUSIC.tickMs) : null;

  if (win && doc) {
    offs.push(engine.attach(win, doc));
    const onDown = (e: Event): void => { if (isButtonEvent(e)) sfx.play('click'); };
    const onOver = (e: Event): void => { if (isButtonEvent(e)) sfx.play('hover'); };
    const onKey = (e: KeyboardEvent): void => {
      const t = ((e.composedPath?.()[0] as HTMLElement | undefined) ?? e.target) as HTMLElement | null; // the real target: events from inputs inside a shadow root are retargeted to the host
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) settings.toggleMute();
    };
    win.addEventListener('pointerdown', onDown, true);
    win.addEventListener('pointerover', onOver, true);
    win.addEventListener('keydown', onKey);
    offs.push(() => { win.removeEventListener('pointerdown', onDown, true); win.removeEventListener('pointerover', onOver, true); win.removeEventListener('keydown', onKey); });
  }

  const every = d.tickEvery ?? 0.1;
  let acc = 0;
  return {
    engine, sfx, ambience, music, settings,
    frame(dt: number): void {
      acc += dt;
      if (acc >= every) { const e = d.probe.env(); music.setInputs({ season: e.season, weather: e.weather, hour: e.hour, sunrise: e.sunrise, sunset: e.sunset, busy: Math.min(1, (e.guests ?? 0) / 300), festival: !!e.festival }); }
      if (acc < every) return;
      const step = acc; acc = 0;
      if (!engine.running) return; // nothing to do (and no sim sampling) while locked / blocked / suspended / unsupported
      const c = d.camera();
      const st = probe.sample({ x: c.x, z: c.z, yaw: c.yaw }, c.zoom);
      ambience.liftPan = probe.liftPan;
      ambience.update(st, Math.min(step, 0.5));
      sfx.update();
    },
    news(it): void { const c = cueForNews(it); if (c) sfx.play(c.sfx, c.opts); },
    dispose(): void { for (const o of offs.splice(0)) o(); if (musicTimer !== null) clearInterval(musicTimer); music.dispose(); ambience.dispose(); engine.dispose(); },
  };
}

/** True when the pointer event originated on a <button> (including inside shadow roots) of the game UI. */
export function isButtonEvent(e: Event): boolean {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  for (const n of path) {
    const el = n as HTMLElement;
    if (el.tagName === 'BUTTON' && !(el as HTMLButtonElement).disabled) return true;
    if (el.id === 'ui') return false;
  }
  return false;
}
