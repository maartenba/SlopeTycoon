import { el, registerComponents } from './index';
import type { MainMenuApi, StMainMenu } from './components/StMainMenu';
import type { StNewGame } from './components/StNewGame';
import type { StScenarios } from './components/StScenarios';
import type { StTrophies } from './components/StTrophies';
import { cosmeticsApiFromProfile, trophiesApiFromProfile } from './trophyData';
import type { StSaveLoad } from './components/StSaveLoad';
import type { StSettings } from './components/StSettings';
import type { StHelp } from './components/StHelp';
import type { SaveManager } from '../persist/SaveManager';
import { AudioSettings } from '../audio/AudioSettings';
import { configQuery, type GameConfig } from '../game/difficulty';
import { SCENARIOS, scenarioQuery } from '../config/scenarios';
import { profileStore, type ProfileStore } from '../persist/ProfileStore';
import { TUTORIAL_QUERY } from '../tutorial/scenario';
import { GRAPHICS_QUALITIES } from '../config/balance';

export interface MenuHostDeps {
  ui: HTMLElement;
  saves: SaveManager | null;
  /** Navigate: the page is reloaded with this query (no leading '?'). Boot is always reload-based. */
  go(query: string): void;
  version: string;
  plainBackground?: boolean;
  storage?: Storage | null;
  initial?: Partial<GameConfig>;
  /** Local profile (scenario medals). Default: the shared IndexedDB-backed store. */
  profile?: ProfileStore;
  /** New-game seed RNG (tests inject a fixed one; default Math.random: every New Game dialog opens with a fresh seed). */
  random?: () => number;
  /** A game is running behind the menu (⌂ Menu): Resume + Save game + Quit to title are added. */
  running?: MainMenuApi['running'];
  /** Reuse the game's own dialogs instead of creating new ones (in-game menu). */
  parts?: { settings?: StSettings; help?: StHelp; saveLoad?: StSaveLoad | null };
}
export interface MenuHandle {
  menu: StMainMenu; newGame: StNewGame; scenarios: StScenarios; trophies: StTrophies; saveLoad: StSaveLoad | null; settings: StSettings; help: StHelp;
  /** Remove every element the menu added (nothing full-screen may remain). */
  dispose(): void;
}

/** Mounts the title screen + New Game dialog + (Load / Settings / Help) next to it. All starts go through `go(...)` = the normal URL boot path. */
export function mountMainMenu(d: MenuHostDeps): MenuHandle {
  registerComponents();
  const menu = el('st-main-menu'), newGame = el('st-new-game'), scenarios = el('st-scenarios'), trophies = el('st-trophies');
  const settings = d.parts?.settings ?? el('st-settings'), help = d.parts?.help ?? el('st-help');
  const added: HTMLElement[] = [menu, newGame, scenarios, trophies];
  const profile = d.profile ?? profileStore();
  scenarios.bind({ list: () => SCENARIOS, record: (id) => profile.record(id), play: (id) => d.go(scenarioQuery(id)), onChange: (fn) => profile.subscribe(fn) });
  void profile.ready.then(() => { if (scenarios.isOpen) scenarios.open(); if (trophies.isOpen) trophies.open(); });
  trophies.bind(trophiesApiFromProfile(profile));
  if (!d.parts?.settings) added.push(settings);
  if (!d.parts?.help) { added.push(help); help.setButtonVisible(false); }
  const tut = TUTORIAL_QUERY.replace(/^\?/, '');
  newGame.bind({ start: (cfg) => d.go(configQuery(cfg)), initial: d.initial, random: d.random, openScenarios: () => scenarios.open() });
  if (!d.parts?.settings) {
    const st = d.storage ?? null;
    const quality = { get: () => { try { const v = st?.getItem('slope.quality'); return (GRAPHICS_QUALITIES as readonly string[]).includes(v ?? '') ? v! : 'medium'; } catch { return 'medium'; } }, set: (q: string) => { try { st?.setItem('slope.quality', q); } catch { /* storage unavailable */ } }, options: GRAPHICS_QUALITIES };
    settings.bind(new AudioSettings(st), null, [], { quality, profile: { cosmetics: cosmeticsApiFromProfile(profile, (kind, id) => { void profile.update((p) => { p.achievements.cosmetics.selected[kind] = id; }); return true; }), reset: () => profile.resetProfile() } });
  }
  let saveLoad: StSaveLoad | null = d.parts?.saveLoad ?? null;
  const saves = d.saves;
  if (saves && !d.parts?.saveLoad) {
    saveLoad = el('st-save-load');
    saveLoad.bind({
      list: () => saves.list(), save: async () => { /* nothing to save from the title screen */ }, load: async (id) => { await saves.load(id); },
      remove: (id) => saves.delete(id), rename: (id, n) => saves.rename(id, n), exportSlot: async () => {}, importFile: async (f) => { await saves.importFile(f); },
      autosave: { get: () => saves.autosaveEnabled, set: () => {} }, backendKind: saves.backendKind, onChange: (fn) => saves.onChange(fn), canSave: false,
    });
    added.push(saveLoad);
  }
  menu.bind({
    version: d.version, plainBackground: d.plainBackground, running: d.running,
    hasContinue: async () => (saves ? await saves.hasContinue() : false),
    continueGame: () => d.go('continue=1'),
    newGame: () => newGame.open(),
    scenarios: () => scenarios.open(),
    trophies: () => trophies.open(),
    ...(saveLoad ? { loadGame: () => saveLoad!.open('load') } : {}),
    tutorial: () => d.go(tut),
    settings: () => settings.open(),
    help: () => help.open(),
  });
  d.ui.append(...added);
  return { menu, newGame, scenarios, trophies, saveLoad, settings, help, dispose: () => { for (const e of added) e.remove(); } };
}
