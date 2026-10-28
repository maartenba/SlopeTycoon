import { regionNameOf } from './sim/Names';
import { GhostTip } from './ui/GhostTip';
import { STAFF_POOLS, POOL_INFO } from '@/config/staff';
import { UPGRADE_BY_ID } from '@/config/staffUpgrades';
import { STAFF_WAGE_PER_DAY } from '@/config/prices';
import '@/ui/fonts.css';
import '@/ui/styles.css';
import { accessibility, getReducedMotion } from '@/ui/accessibility';
import { Emotes, WildlifeSight, coldness, Feedback, FloatText, Particles, renderRng, FEEDBACK_INTENSITIES, type FeedbackIntensity } from '@/render/fx';
accessibility(); // applies the saved UI scale / reduced-motion choice to <html> before anything is built
import { Renderer } from '@/render/Renderer';
import { panBasis, snapYaw } from '@/render/CameraController';
import { TerrainMesh } from '@/render/TerrainMesh';
import { TreeLayer, createPropUniforms } from '@/render/props/Trees';
import { RockLayer } from '@/render/props/Rocks';
import { PropKind, TREE_KINDS, surfaceHeight } from '@/world/Props';
import { Water } from '@/render/Water';
import { PisteHighlight } from '@/render/PisteHighlight';
import type { StPisteInspector } from '@/ui/components/StPisteInspector';
import { SnowFlush } from '@/render/SnowFlush';
import { seasonTerrain, seasonTerrainSim, freezeFromSnowline, seasonWeights } from '@/render/Season';
import { collectProtectedChunks } from '@/render/ProtectedChunks';
import { Precipitation } from '@/render/Precipitation';
import { NatureView } from '@/render/NatureView';
import { VillageDecor } from '@/render/VillageDecor';
import { buildEventsView } from '@/ui/eventsFormat';
import { maintDate } from '@/ui/maintFormat';
import { generatorLines, greenLines, type EnergyOps } from '@/ui/energyFormat';
import { FESTIVAL_BY_ID, type FestivalId } from '@/config/festivals';
import { FestivalDressing } from '@/render/festival/FestivalDressing';
import { TourVehicles } from '@/render/TourVehicles';
import type { DressingWorld } from '@/render/festival/placeDressing';
import { dressingWorldOf } from '@/render/festival/dressingWorld';
import { almabtriebWindow } from '@/sim/events/EventCalendar';
import { Fireworks, fireworksAllowed } from '@/render/fx/Fireworks';
import { isWaterType } from '@/world/Grid';
import { SmokeView, type SmokeSource } from '@/render/Smoke';
import { SnowSprayView } from '@/render/SnowSpray';
import { modalPause } from '@/ui/modalPauseGate';
import { PlantTool } from '@/build/PlantTool';
import { LandscapeTool } from '@/build/LandscapeTool';
import { applyDecor, applyPond, applyRocks, planDecor, planPond, planRocks, pondRectAround } from '@/sim/landscape/Landscape';
import { LandscapeDecorView } from '@/render/LandscapeDecor';
import { PLANT_GROUPS, PLANT_GROUP_IDS, type PlantGroup } from '@/sim/nature/Planting';
import { DAYS_PER_YEAR, SPEED_MULTIPLIERS, TICKS_PER_SECOND, TILE_METRES } from '@/config/balance';
import { AchievementAnnouncer } from '@/ui/achievementToasts';
import { cosmeticsApiFromEngine, trophiesApiFromProfile } from '@/ui/trophyData';
import { COSMETIC_BY_ID, defaultCosmetic } from '@/config/cosmetics';
import { cosmeticUnlockedBy } from '@/config/achievements';
import { setGroundCaps } from '@/render/lod/nearLod';
import { RideAlong, rideActivityLabel, rideTimeFactor, easeRideFactor } from '@/render/view/RideAlong';
import type { RideSample } from '@/render/view/ViewCameraRig';
import { RIDE_NEAR_TERRAIN_TILES, horizonFraction, isPerspective, lodHeightFor, projectToScreen, terrainLodHeightFor } from '@/render/view/cameraMath';
import type { StViewHud } from '@/ui/components/StViewHud';
import type { StPhoto } from '@/ui/components/StPhoto';
import { HourOverride, PhotoMode, downloadBlob, sanitizeSettings } from '@/render/view/PhotoMode';
import { filterCss } from '@/render/view/postfx';
import { WalkMode, buildWalkWorld, compassPoint } from '@/render/view/WalkMode';
import { WalkInputHandler, loadWalkSettings, mouseHint, sanitizeWalkSettings, saveWalkSettings, type WalkSettings } from '@/render/view/WalkInput';
import { chooseStart, resolveDrop, type DropResult } from '@/render/view/walkStart';
import { DropRing } from '@/render/view/DropRing';
import { WalkDropMarker, DROP_HINT } from '@/ui/walkDropMarker';
import { yawOfHeading } from '@/render/view/ViewCameraRig';
import { surfaceHeightAt, NET_NIGHT } from '@/render/meshes/Paths';
import { RailCrossingsView } from '@/render/RailCrossings';
import { liftStats } from '@/sim/Lift';
import { PhotoStore } from '@/persist/PhotoStore';
import { YearReportGate } from '@/ui/yearReportFormat';
import { composeYearCanvas, yearImageName } from '@/render/view/yearCompose';
import { fillDemoStats } from '@/sim/meta/demoStats';
import { Safety } from '@/sim/ops/Safety';
import { IncidentView } from '@/render/IncidentView';
import { type Ops, type CannonInfo, cannonInfo } from '@/sim/ops';
import { GROOM } from '@/sim/ops/Grooming';
import { WILD } from '@/sim/ops/Wildlife';
import { placeBuilding as debugPlaceBuilding } from '@/sim/PlaceBuilding';
import { GroomingView } from '@/render/GroomingView';
import { OpenStatus } from '@/sim/OpenStatus';
import { SEASON_LABELS, altitudeMetres, freezeFromTemp, isSummer, seasonalValleyTemp, snowlineHeight, worldScaleFor } from '@/sim/Season';
import { seasonOf, monthIndex, seasonProgress, dayFromSeasonYear } from '@/sim/Clock';
import { formatSeasonProgress } from '@/ui/format';
import { HEIGHT_UNIT, GAME_MINUTES_PER_TICK, TERRAIN_MACRO_VIEW_HEIGHT } from '@/config/balance';
import { BuildingMeshes } from '@/render/meshes';
import { setGuestDistrict } from '@/render/guestAppearance';
import { GroundMask, treeTowerAo } from '@/render/groundMask';
import { buildModelGallery, type ModelGallery } from '@/render/meshes/Gallery';
import { BuildingsView } from '@/render/BuildingsView';
import { BUILDINGS } from '@/config/buildings';
import { openDirection } from '@/sim/attractions/Viewpoint';
import * as THREE from 'three';
import { Overlays } from '@/render/Overlays';
import { TerraformTool } from '@/build/TerraformTool';
import { PlacementTool, type PlaceOutcome } from '@/build/PlacementTool';
import { rotateBuilding } from '@/sim/PlaceBuilding';
import { refundValue } from '@/build/Bulldoze';
import { suggestPiste } from '@/tutorial/suggest';
import { slopeProfile } from '@/sim/PisteStats';
import type { ProfileView } from '@/ui/components/StProfile';
import { Undo, undoMessage, redoMessage, verbIng } from '@/build/UndoActions';
import { creditScore, creditLetter, debtCap } from '@/sim/Loans';
import { formatSigned } from '@/ui/financeFormat';
import { buildMarketingView } from '@/ui/marketingFormat';
import { formatMoney, formatDate } from '@/ui/format';
import { formatGameDate, simDayOf } from '@/sim/calendar';
import { canPlace } from '@/sim/Dependencies';
import { autoFlattenDefault } from '@/sim/PlacementRules';
import { pickHeightfield } from '@/render/Picking';
import type { StDock } from '@/ui/components/StDock';
import type { PanelRef } from '@/sim/goals/Goals';
import { Thumbnails } from '@/render/thumbnails/Thumbnails';
import { LIFTS } from '@/config/lifts';
import type { StInspector } from '@/ui/components/StInspector';
import { registerSW, watchOnline, watchInstall } from '@/pwa/registerSW';
import { analytics } from '@/analytics';
import { consentUi, settingsPrivacy } from '@/analytics/ui';
import { attachGameplayAnalytics, appStartParams, onceTracker, startHeartbeat } from '@/analytics/gameplay';
import type { StToast } from '@/ui/components/StToast';
import { EventBus } from '@/core/EventBus';
import { registerComponents, el } from '@/ui';
import { wireTouch } from '@/ui/touchWire';
import { onPalette } from '@/config/palette';
import { createAudio, type AudioApi } from '@/audio';
import { countTrunks, hashCount } from '@/audio/worldProbe';
import { AMB } from '@/audio/Ambience';
import { THEMES } from '@/audio/musicThemes';
import type { StSettings } from '@/ui/components/StSettings';
import type { StSaveLoad } from '@/ui/components/StSaveLoad';
import { createSim } from '@/game/createSim';
import { buildDemoResort, spawnGuests, type DemoLevel, type DemoReport } from '@/game/demoResort';
import { buildTown, townOf, TOWNS, type TownReport } from '@/game/demoTowns';
import { pickTitleTown, parseTownParams, sizeFor, townCaption, townKey, TITLE_LAST_KEY, type TitleTown } from '@/game/titleTown';
import { TOWN_SEEDS } from '@/config/townSeeds';
import { townPoiSpecs, poiFocus } from '@/render/townPois';
import { mountTownCaption } from '@/ui/townCaption';
import { DemoScene, DisposeBag, disposeTree, demoTimeScale } from '@/render/DemoScene';
import { mulberry, type Poi } from '@/render/DemoCamera';
/** UI-only randomness (title town pick, debug seeds): never the sim's RNG. */
const uiRand = mulberry((Date.now() ^ Math.imul(performance.now() | 0, 0x9e3779b1)) >>> 0);
import { carrierStates, liftPath, samplePath, type CablePath } from '@/sim/Lift';
import { isSkiMode } from '@/sim/guests/NavGraph';
import { findBear as dbgFindBear, spawnBear as dbgSpawnBear } from '@/sim/ops/wildlifeDebug';
import { buildDebugTools } from '@/ui/debugTools';
import { FrameStats, PerfBench, type BenchDriver, type BenchView } from '@/render/PerfStats';
import { GRAPHICS_QUALITIES, QUALITY_PRESETS, GUEST_CAP, defaultQuality, type GraphicsQuality } from '@/config/balance';
import type { PerfLive } from '@/ui/perfFormat';
import type { GameEvents } from '@/core/events';
import { AttractionSystem } from '@/sim/attractions/AttractionSystem';
import { TOILET_USES_PER_DAY } from '@/sim/attractions/Toilets';
import { AttractionActivity, type ActivityView } from '@/render/AttractionActivity';
import { GState } from '@/sim/guests/Guest';
import { guestTypeBreakdown } from '@/sim/guests/TypeBreakdown';
import { Act } from '@/sim/guests/Decision';
import { guestInspectorModel } from '@/ui/guestInfo';
import type { StGuestInspector } from '@/ui/components/StGuestInspector';
import { GuestRenderer } from '@/render/GuestRenderer';
import { VehicleRenderer } from '@/render/meshes/Vehicles';
import { heightAt } from '@/render/Picking';
import { MaterialGuard, type GuardRenderer } from '@/render/MaterialGuard';
import { seasonYear, hourOfDay } from '@/sim/Clock';
import { sunTimes, isNightHour, fmtClock } from '@/sim/Daylight';
import { Lighting } from '@/render/Lighting';
import { speedKeyAction } from '@/ui/shortcuts';
import { GAME_EVENT_NAMES } from '@/core/events';
import { FastForward, FF_KINDS, FF_LABELS, FF_STOP_TEXT, type FfKind } from '@/core/FastForward';
import type { StDebug } from '@/ui/components/StDebug';
import { nextFps } from '@/ui/format';
import { registerLiftTools, type LiftTools } from '@/build/registerLiftTools';
import { ToolManager } from '@/build/ToolManager';
import { routeMapClick } from '@/build/selectMode';
import { liftClearanceViolations, liftPlantBlocker } from '@/sim/Lift';
import { WALKING_RADIUS_TILES } from '@/config/balance';
import type { StHelp } from '@/ui/components/StHelp';
import { registerNetworkTools, type NetworkTools } from '@/build/registerNetworkTools';
import { OVERLAY_MODES, type OverlayMode } from '@/sim/Coverage';
import { CoverageOverlay } from '@/render/CoverageOverlay';
import { safely } from '@/core/safe';
import { formatInputLine } from '@/ui/inputDebug';
import { parseConfig } from '@/game/difficulty';
import { getScenario, scenarioQuery, scenarioSimOptions } from '@/config/scenarios';
import { profileStore, type ScenarioRecord } from '@/persist/ProfileStore';
import { MODE_INFO } from '@/config/progression';
import { unlockIcon, unlockName } from '@/config/unlocks';
import { startMenuPreview } from '@/render/MenuPreview';
import { mountMainMenu } from '@/ui/menuHost';
import { modalStack } from '@/ui/modal';
import { showModal } from '@/ui/components/StModal';
import { APP_VERSION } from '@/ui/version';
import { installErrorBoundary } from '@/ui/errorBoundary';
import { openBackend, resolveBootSave, stripBootParams, loadQuery, type BootSave } from '@/game/restore';
import { SaveManager, downloadBytes } from '@/persist/SaveManager';
import { createTutorial, isTutorialRequest, TUTORIAL_QUERY, TUTORIAL_SCENARIO, type TutorialSetup } from '@/tutorial';
import { resolveChain } from '@/tutorial/ui-targets';
import { TutorialMarker } from '@/render/TutorialMarker';
import { displayName, sentence } from '@/ui/text';
import type { FocusTarget } from '@/ui/newsFormat';
import { t as tr } from '@/tutorial/strings';
import { ADVISOR_UI } from '@/sim/advisor/strings';
import { formatRecap, shouldShowRecap, wireMonthCard, type RecapModel } from '@/ui/recap';
import { sessionIssues } from '@/game/sessionIssues';
import { bootStage, bootFail, bootFailed, bootDone, bootPause, bootPaint } from '@/ui/bootProgress';
/** Title-screen demo days on the real calendar: mid-July (warmest, snow-free) and mid-January (coldest, deep snow). */
const DEMO_SUMMER_DAY = simDayOf(6, 8), DEMO_WINTER_DAY = simDayOf(0, 8);

/** Boot splash (index.html #splash): fades out and is removed once the menu / game is up. pointer-events:none as soon as it starts fading. */
function hideSplash(): void {
  const sp = document.getElementById('splash');
  if (!sp || bootFailed()) return; // an error state stays up (reload button)
  bootDone();
  sp.classList.add('done');
  window.setTimeout(() => sp.remove(), 500);
}
window.setTimeout(hideSplash, 20000); // safety net: never leave it up
bootStage('module');
const params = new URLSearchParams(window.location.search);
// New-game options (Task 35): `?size=&seed=&start=&preset=&difficulty=&money=&radius=&loan=&starter=&hints=` (old params keep working).
const { config: CFG, explicit: CFG_EXPLICIT } = parseConfig(params);
let MAP_SIZE: 64 | 128 | 256 = CFG.size;
let SEED = CFG.seed;
/** `?scenario=<id>`: a shipped scenario (src/config/scenarios). Its definition overrides size / seed / preset / season / money / mode for a NEW game; a loaded save restores its own config. */
const SCEN = CFG.scenario ? getScenario(CFG.scenario) ?? null : null;
const START_SEASON = SCEN ? SCEN.startSeason : CFG.startSeason;
const TUTORIAL_MODE = isTutorialRequest(params); // ?tutorial=1: fixed 64 gentle-valley scenario + guided tutorial (Task 34a)
const ui = document.getElementById('ui');
if (ui) document.title = 'Slope Tycoon';

const root = document.getElementById('app') ?? document.body;

// Layout (see styles.css): top-left bar, right column = HUD + tool status + inspectors, bottom-centre tool dock.
const rightCol = document.createElement('div'); rightCol.id = 'right-col';
ui?.append(rightCol);

function showFatal(msg: string): void {
  bootFail(msg);
  if (document.getElementById('splash')) return;
  const el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font:16px sans-serif;color:#fff;background:#222;z-index:210';
  el.textContent = msg;
  root.appendChild(el);
}

function mountFallbackUi(): void {
  if (!ui) return;
  registerComponents();
  const toolbar = el('st-topbar');
  const hud = el('st-hud');
  toolbar.bind({
    rotate: () => {}, help: () => {},
    menu: () => { window.location.search = 'menu=1'; },
  });
  hud.bind(new EventBus<GameEvents>(), () => 0);
  ui.append(toolbar, hud);
}

// Save/load (Task 33): `?load=<slot>` / `?continue=1` boot from a save (see game/restore.ts); the map size + seed come from the save.
const saveBackend = openBackend();
let bootSave: BootSave | null = null;
let bootWarnings: string[] = [];
let globalToast: StToast | null = null;
installErrorBoundary(window, {
  onReport: (kind) => { analytics().track('error', { kind }); }, // class only (never the message / stack)
  notify: (text, action) => { if (globalToast) globalToast.show(text, 'error', 12000, { action }); },
  copy: (t) => { void navigator.clipboard?.writeText(t).catch(() => {}); },
});
const DEMO_SCENE_PARAM = params.has('demoscene'); // harness: the live title-screen demo even when size/seed are explicit
const UIKIT_MODE = params.has('uikit'); // dev pages: ?uikit=1 (controls) / ?uikit=logo-full|logo-badge|logo-wordmark|logo-mark|logo-light (single large logo)
const MENU_MODE = !UIKIT_MODE && (DEMO_SCENE_PARAM || (!CFG_EXPLICIT && !TUTORIAL_MODE && !params.has('load') && !params.has('continue')));
// Anonymous, opt-in analytics (docs/analytics.md): inert unless consent === 'granted' AND a production build on a real host; never blocks boot.
if (!UIKIT_MODE) {
  const a = analytics(); a.init();
  const page = MENU_MODE ? 'menu' : 'game';
  const send = (): boolean => a.track('app_start', appStartParams({ version: APP_VERSION, page, standalone: window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as { standalone?: boolean }).standalone === true, touch: window.matchMedia?.('(pointer: coarse)').matches === true, width: window.innerWidth }));
  let done = send();
  a.subscribe((c) => { if (c === 'granted' && !done) done = send(); });
}
/** Title-screen demo (live sim + real renderer, no game UI). Set before `boot()` runs. */
let DEMO = false;
/** Seed of the title-screen demo map (chosen by scanning seeds: lake + gentle valley + skiable flank + forest) and its size. */
/** Title town: a random vetted (archetype, seed, size, season) per boot (never the previous one, `slope.title.last`), `?town=<id>&townseed=<n>` forces one, `Shuffle` stores the next pick and reloads. */
const DEMO_TOWN: TitleTown = ((): TitleTown => {
  if (!MENU_MODE) return { id: 'alpine', seed: 7, size: 128, season: 'winter' }; // a normal game: no pick, nothing stored
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  let store: Storage | null = null;
  try { store = window.localStorage; } catch { /* private mode */ }
  const forced = parseTownParams(params);
  const legacySeed = Number(params.get('demoseed')) || 0;
  const demoSize = params.get('demosize');
  const sizeOver = demoSize === '64' || demoSize === '128' || demoSize === '256' ? (Number(demoSize) as 64 | 128 | 256) : null;
  let town: TitleTown;
  let next: TitleTown | null = null;
  try { const n = store?.getItem('slope.title.next'); if (n) { store?.removeItem('slope.title.next'); const [id, seed, size] = n.split(':'); const a = townOf(id ?? ''); if (a) next = { id: a.id, seed: Number(seed), size: Number(size) as 64 | 128 | 256, season: a.season }; } } catch { /* ignore */ }
  if (forced || legacySeed) {
    const a = townOf(forced?.id ?? 'alpine')!;
    const size = sizeOver ?? forced?.size ?? sizeFor(a.id, mem, false, () => 0.5) ?? a.size;
    town = { id: a.id, seed: forced?.seed ?? (legacySeed || (TOWN_SEEDS[a.id][size] ?? [7])[0]!), size, season: a.season };
  } else if (next && !params.has('nodemo')) town = next;
  else town = pickTitleTown({ rand: uiRand, last: (() => { try { return store?.getItem(TITLE_LAST_KEY) ?? null; } catch { return null; } })(), deviceMemory: mem });
  try { if (!forced) store?.setItem(TITLE_LAST_KEY, townKey(town)); } catch { /* ignore */ }
  return town;
})();
const DEMO_SEED = DEMO_TOWN.seed;
const DEMO_SIZE: 64 | 128 | 256 = DEMO_TOWN.size;
let demoHandle: { dispose(): void } | null = null;
/** Title screen: preview renderer (plain background if WebGL fails) + st-main-menu / st-new-game. Starting a game reloads with URL params. */
async function showMainMenu(): Promise<void> {
  let preview: { dispose(): void } | null = null;
  let demoRenderer: Renderer | null = null;
  if (!params.has('nodemo')) {
    try {
      DEMO = true; MAP_SIZE = DEMO_SIZE; SEED = DEMO_SEED;
      demoRenderer = new Renderer(root, MAP_SIZE);
      boot(demoRenderer);
      preview = demoHandle;
    } catch (err) {
      console.warn('Live demo unavailable (no WebGL?), trying the static preview', err);
      DEMO = false;
      if (demoHandle) demoHandle.dispose(); else { try { demoRenderer?.dispose(); } catch { /* ignore */ } }
      demoHandle = null;
      try { preview = startMenuPreview(new Renderer(root, 64)); } catch (err2) { console.warn('Menu preview unavailable (no WebGL?)', err2); }
    }
  }
  if (!ui || params.has('nomenu')) return;
  const saves = saveBackend ? new SaveManager({ backend: saveBackend, getSim: () => null, restore: async (_env, id) => { window.location.search = loadQuery(id); }, toast: () => {}, download: downloadBytes }) : null;
  const h = mountMainMenu({
    ui, saves, version: APP_VERSION, plainBackground: !preview, consent: consentUi(),
    go: (q) => { preview?.dispose(); window.location.search = q; },
    storage: (() => { try { return window.localStorage; } catch { return null; } })(),
  });
  watchOnline(window, () => navigator.onLine, (off) => h.menu.setOffline(off));
  watchInstall(window, (install) => h.menu.setInstall(install ? () => { void install(); } : null));
}
void (async () => {
  try {
    await bootPause(params);
    if (params.has('bootfail') && import.meta.env.DEV) throw new Error('bootfail test');
    bootStage('fonts');
    await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => window.setTimeout(r, 1500))]);
    await bootPause(params);
    bootStage('renderer');
    await bootPaint();
    await bootMain();
  } catch (e) { console.error(e); bootFail('The game hit an error while starting. Reloading usually fixes it.'); }
})();
async function bootMain(): Promise<void> {
  if (UIKIT_MODE) { if (ui) (await import('@/ui/uikit')).mountUiKit(ui, params.get('uikit') ?? '1'); hideSplash(); return; }
  if (MENU_MODE) { bootStage('world'); await bootPause(params); await bootPaint(); try { await showMainMenu(); } catch (e) { console.error(e); showFatal('Could not show the menu. Try ?size=128&seed=1 to start directly.'); } requestAnimationFrame(() => hideSplash()); return; }
  const r = await resolveBootSave(saveBackend, params);
  bootSave = r.save; bootWarnings = r.warnings;
  if (bootSave) { MAP_SIZE = bootSave.env.mapSize; SEED = bootSave.env.seed; }
  else if (TUTORIAL_MODE) { MAP_SIZE = TUTORIAL_SCENARIO.size; SEED = TUTORIAL_SCENARIO.seed; }
  else if (SCEN) { MAP_SIZE = SCEN.mapSize; SEED = SCEN.seed; }
  let created: Renderer | null = null;
  try {
    created = new Renderer(root, MAP_SIZE);
  } catch (err) {
    console.error('Renderer creation failed', err);
    showFatal('Could not start the 3D view: WebGL is unavailable or failed to initialise. Try a different browser or enable hardware acceleration.');
    try { mountFallbackUi(); } catch (e) { console.error(e); }
    hideSplash();
  }
  if (created) { bootStage('world'); await bootPause(params); await bootPaint(); boot(created); }
}

function boot(renderer: Renderer): void {
bootStage('world');
const demoBag = new DisposeBag(); // everything the title-screen demo owns (timers, sim, GL resources): disposed when a game starts
// Touch input (docs/touch.md): registered FIRST so its window-capture listeners see touch pointers before any tool; tools/placement are only read lazily.
const touchWire = wireTouch({
  dom: renderer.webgl.domElement, camera: renderer.controls, toolId: () => tools.current, cancelTool: () => tools.reset(),
  confirmPlacement: () => (tools.current === 'lift' ? (liftToolsRef?.tool.confirm() ?? false) : placement.confirm()), rotateGhost: (d) => placement.rotate(d), togglePause: () => loop.togglePause(),
  ghostText: () => { if (tools.current === 'lift') return liftToolsRef?.tool.touchHint() ?? ''; const g = placement.ghostInfo(); return !g ? 'Not on the map: tap the ground' : g.valid ? `$${Math.round(g.totalCost).toLocaleString('en-US')} · tap again to place` : `\u2716 ${g.reasons[0] ?? 'cannot build here'}`; },
  undo: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })),
});

const sim = createSim({
  size: MAP_SIZE, seed: SEED, startSeason: TUTORIAL_MODE && !bootSave ? TUTORIAL_SCENARIO.startSeason : START_SEASON,
  ...(SCEN && !bootSave && !TUTORIAL_MODE ? { ...scenarioSimOptions(SCEN), hints: CFG.hints, radius: CFG.radius } : {}),
  ...(TUTORIAL_MODE && !bootSave || (SCEN && !bootSave) ? {} : { preset: CFG.preset, difficulty: CFG.difficulty, radius: CFG.radius, startLoan: CFG.startLoan, starterResort: CFG.starterResort, hints: CFG.hints, ...(CFG.money !== null ? { money: CFG.money } : {}) }),
  ...(TUTORIAL_MODE && !bootSave ? { money: TUTORIAL_SCENARIO.money } : {}),
  hooks: {
    toast: (t, k, c) => toast(t, k, c),
    onDay: () => { refreshUi(); if (overlayMode === 'snow') covOverlay.invalidate(); },
  },
  fromSave: bootSave?.env.modules,
  ...(DEMO ? { hints: false, preset: townOf(DEMO_TOWN.id)!.preset, startSeason: DEMO_TOWN.season } : {}),
  ...(DEMO ? { remoteSupply: false } : {}), // Phase 6 Task 2: +25% upkeep for sites supplied only on foot (trail / piste edge)
  ...(DEMO ? { campaignsV2: false } : {}), // Phase 6 Task 50: rail share tracking + the capped train sustainability bonus (Come by Train)
  ...(DEMO ? { stories: false } : {}), // Story guests (M5.4 Task 22): about 1.5% of arrivals get a name and one wish; never in the title demo
  ...(TUTORIAL_MODE ? { rivalMarket: false } : {}), // rival market share scales arrivals; the guided tutorial resort stays exactly neutral (Task 23)
  ...(DEMO ? { autoEvents: false } : {}), // Events calendar: Almabtrieb / New Year / critic / powder day run by themselves in a real game (not in the title demo)
  deferAchievements: true, // armed below, once the local profile has loaded (never in the title demo)
  gameId: `g${Date.now().toString(36)}${(globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ?? 0).toString(36)}`,
});
/** Title guest cap: <= 200 (the archetype's own count), fewer on 64. */
const demoGuestCap = (): number => Math.min(200, Math.round((townOf(DEMO_TOWN.id)?.guestCount ?? 200) * (DEMO_SIZE === 64 ? 0.55 : DEMO_SIZE === 256 ? 1.1 : 1)));
let demoReport: TownReport | null = null;
if (DEMO) { // the showcase resort, built through the real placement APIs (deterministic in the seed); ~0.1-0.2 s
  const t0 = performance.now();
  demoReport = buildTown(sim, DEMO_TOWN.id, DEMO_TOWN.seed);
  sim.jumpToDay(DEMO_TOWN.season === 'summer' ? DEMO_SUMMER_DAY : DEMO_WINTER_DAY, 9); // late morning; BEFORE the guests so their leave day lies ahead
  spawnGuests(sim, demoGuestCap(), townOf(DEMO_TOWN.id)!.guests, 1);
  if (import.meta.env.DEV) console.log(`[demo] ${DEMO_TOWN.id} seed ${DEMO_TOWN.seed} (${DEMO_SIZE}) built in ${(performance.now() - t0).toFixed(0)} ms: ${JSON.stringify(demoReport.placed)} failures=${demoReport.failures.length}`);
}
{ // restore the camera of a loaded save (position / yaw / zoom)
  const cam = bootSave?.env.meta.camera, c = renderer.controls;
  if (cam) { c.target.set(cam.x, 0, cam.y); c.yaw = cam.yaw; c.zoom = cam.zoom; c.clampTarget(); }
}
const { grid, terrainInfo, props, genMs, game, bus, eventLog, registry, loop, economy, buildings, env, coverage, networks, lifts, weather, cond, snow, openStatus, guestSim, ops, safety, attractions, rating, loans, finance, creditCtx } = sim;
const terrain = new TerrainMesh(grid, renderer.sun);
renderer.scene.add(terrain.group);

const water = new Water(grid, terrainInfo.lakes, terrainInfo.streams, renderer.sun);
renderer.scene.add(water.group);

const uniforms = createPropUniforms(renderer.sun.position);
bootStage('trees');
const trees = new TreeLayer(props, uniforms);
const rocks = new RockLayer(props, uniforms);
renderer.scene.add(trees.group, rocks.group);

// Village dressing around the base lodge (3 draw calls; rebuilt when the lodge or the set of buildings changes).
const villageDecor = new VillageDecor((x, z) => surfaceHeight(grid, x, z));
renderer.scene.add(villageDecor.group);
let decorCheck = 0;
const updateVillageDecor = (dt: number): void => {
  decorCheck -= dt;
  villageDecor.setNight(lighting.nightUniform.value);
  if (decorCheck > 0) return;
  decorCheck = 1.5;
  const lodge = buildings.all().find((b) => b.type === 'baseLodge');
  const a = terrainInfo.villageAnchor;
  const rect = lodge ? { x: lodge.x, y: lodge.y, w: lodge.w, h: lodge.h } : { x: a.x - 2, y: a.y - 1.5, w: 4, h: 3 };
  villageDecor.homes = buildings.all().filter((b) => b.type === 'chalet' || b.type === 'apartment' || b.type === 'mountainHut').map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  villageDecor.festival = DEMO && DEMO_TOWN.id === 'festival';
  villageDecor.build(rect, { size: grid.size, blocked: (i) => (grid.occupancy.flags[i] ?? 0) !== 0 || (networks.layers[i] ?? 0) !== 0 || (networks.kind[i] ?? 0) !== 0, solid: (i) => (grid.occupancy.flags[i] ?? 0) !== 0, isWater: (i) => isWaterType(grid.tileType[i]!) }, buildings.all().length);
};

// Nature: livestock + wild fauna (instanced per species) and chimney smoke (1 draw call). Both are driven by sim state.
const natureView = new NatureView((x, y) => surfaceHeight(grid, x, y));
renderer.scene.add(natureView.group);

// Tour carriers (Phase 6 Task 5): cosmetic sleighs / scooters / rafts on the rides in progress; instanced, capped, view only. Empty until a tour building exists.
const tourVehicles = new TourVehicles((x, z) => surfaceHeight(grid, x, z), (t, out, max) => sim.tours.carriers(t, out, max));
renderer.scene.add(tourVehicles.group);

// Festival set dressing (M5.4 Task 21): bunting, flags, banners, stalls, grandstand + a procession for the running events. View only (no Occupancy / pathing); 3 draw calls in total.
const festivalWorld = (): DressingWorld => dressingWorldOf(sim);
const festivalDressing = new FestivalDressing((x, z) => surfaceHeight(grid, x, z), festivalWorld, SEED);
renderer.scene.add(festivalDressing.group);
let festivalCheck = 0;
const updateFestival = (dt: number): void => {
  festivalCheck -= dt;
  if (festivalCheck <= 0) {
    festivalCheck = 0.5;
    festivalDressing.setEvents(sim.events.active().map((e) => ({ id: e.id, start: e.start })), `${buildings.all().length}:${sim.lifts.all().length}`);
  }
  festivalDressing.update(dt, currentHour());
};

// Building meshes: shared registry; roof snow follows the season (same cold mapping as the terrain snowline).
const buildingMeshes = new BuildingMeshes();
buildingMeshes.setDistrict(SEED);
setGuestDistrict(SEED);
const applyBuildingSnow = (snowline: number): void => {
  const hi = maxWorld + 1, lo = Math.max(1, maxWorld * 0.3);
  const cold = hi > lo ? (hi - snowline) / (hi - lo) : 0;
  buildingMeshes.setSnow((cold - 0.5) / 0.4);
};
let gallery: ModelGallery | null = null;
/** Debug (key B): all buildings plus every lift kind's bottom/top station, tower and carrier in labelled rows at a flat height. */
const toggleGallery = (): void => {
  if (gallery) { renderer.scene.remove(gallery.group); gallery.dispose(); gallery = null; return; }
  const vh = grid.getCorner(terrainInfo.villageAnchor.x, terrainInfo.villageAnchor.y) * HEIGHT_UNIT + 0.4; // flat village level (debug only)
  gallery = buildModelGallery(buildingMeshes, terrainInfo.villageAnchor.x, vh, terrainInfo.villageAnchor.y);
  renderer.scene.add(gallery.group);
};

const lighting = new Lighting(renderer.sun, renderer.hemi, renderer.scene, MAP_SIZE * 1.87);
lighting.skyElement = renderer.webgl.domElement.parentElement; // sky gradient (CSS) behind the transparent canvas
lighting.addUniforms(terrain.material.uniforms);
lighting.addUniforms(water.uniforms);
lighting.addUniforms(uniforms);
let useClock = true; // season follows the game clock (debug panel can override)
let timeOverride: number | null = null; // debug time-of-day lock (hours), null = auto
let lastHour = -1, lastLightDay = -1;
const currentHour = (): number => timeOverride ?? ((hourOfDay(game.date) + (loop.paused || loop.isHidden ? 0 : (loop.alpha * GAME_MINUTES_PER_TICK) / 60)) % 24);
const FAST_NIGHTS_KEY = 'slope.fastNights';
try { loop.fastNights = localStorage.getItem(FAST_NIGHTS_KEY) !== '0'; } catch { /* storage unavailable: default ON */ }
const fastNightsApi = {
  get: (): boolean => loop.fastNights,
  set: (v: boolean): void => { loop.fastNights = v; try { localStorage.setItem(FAST_NIGHTS_KEY, v ? '1' : '0'); } catch { /* ignore */ } },
  warp: (): number => loop.currentWarp,
};
const overlays = new Overlays(grid);
const ghostTip = new GhostTip();
overlays.onTooltip = (t) => ghostTip.show(t);
renderer.scene.add(overlays.group);
let netTools: NetworkTools | null = null;
// Soft piste / trail / contact-shadow ground data (one N x N texture sampled by the terrain shader; rewritten only when the networks or buildings change).
const groundMask = new GroundMask(MAP_SIZE, () => netTools?.networks ?? networks, () => buildings.all(), () => (netTools?.networks ?? networks).version, 8, {
  // contact-shadow dabs for tree clusters + lift towers (A channel, below the building level): no extra draw calls
  sig: () => `${props.chunkVersion.reduce((a, v) => a + v, 0)}|${lifts.size}`,
  apply: (data, n) => treeTowerAo(data, n, (function* () { for (const c of props.chunks) for (let i = 0; i < c.kind.length; i++) if (TREE_KINDS.includes(c.kind[i]!)) yield { tx: c.tx[i]!, ty: c.ty[i]! }; })(), lifts.all().flatMap((l) => l.towers)),
});
terrain.setGroundMask(groundMask.texture, MAP_SIZE);
const refreshProps = (dirty: number[]): void => {
  netTools?.refreshChunks(dirty);
  trees.refreshChunks(dirty);
  rocks.refreshChunks(dirty);
};

const buildingsView = new BuildingsView(renderer.scene, buildingMeshes, grid, buildings); buildingsView.spin = (id) => sim.energy.rotorSpeed(id); // single sync point: store -> meshes (boot, place, remove, rotate, terraform)

// Service coverage + overlays (sim-side coverage/networks come from createSim).
const covOverlay = new CoverageOverlay(grid, coverage, () => buildings.all(), () => sim.networkProvider, () => ({ depth: grid.snowDepth, skiOpen: cond.skiOpen }), () => ops.quality.state, () => safetyRef?.wildlife.threat ?? null, () => { const q = opsRef?.quality; if (!q) return null; if (!trafficMix) trafficMix = new Uint16Array(q.traffic.length); for (let i = 0; i < trafficMix.length; i++) trafficMix[i] = Math.min(65535, q.traffic[i]! + q.trafficDay[i]!); return trafficMix; }, () => { const sm = opsRef?.snowmaking; if (!sm) return null; if (!gainMix) gainMix = new Float32Array(sm.gainToday.length); for (let i = 0; i < gainMix.length; i++) gainMix[i] = Math.max(sm.gainToday[i]!, sm.gainLast[i]!); return gainMix; }, () => sim.runIndex.labelMap());
let trafficMix: Uint16Array | null = null;
let gainMix: Float32Array | null = null;
renderer.scene.add(covOverlay.group);
onPalette(() => covOverlay.invalidate()); // Settings > Colour palette: repaint the overlay texture
const opsRef: Ops | null = ops;
const safetyRef: Safety | null = safety;
const openStatusRef: OpenStatus | null = openStatus;
const attractionsRef: AttractionSystem | null = attractions;
let groomingView: GroomingView | null = null;
let incidentView: IncidentView | null = null;
let overlayMode: OverlayMode = 'off';
const setOverlay = (m: OverlayMode): void => { overlayMode = m; covOverlay.setMode(m); dockRef?.syncOverlay(); if (m !== 'off') tutorialRef?.engine.notify('overlay:cycled'); };
/** Recompute coverage: region-limited when only one building changed and no dependency statuses flipped. */
const refreshCoverage = (b?: { x: number; y: number; w: number; h: number; type: string }, statusChanged = false): void => {
  sim.refreshCoverage(b, statusChanged);
  covOverlay.invalidate();
};
overlays.onRect = (r) => {
  const def = placement.type ? BUILDINGS[placement.type] : undefined;
  if (r && def?.shuttleDependent) {
    // Walking radius is measured from the resort core (Base Lodge), not from the ghost.
    const lodge = buildings.all().find((b) => b.type === 'baseLodge');
    if (lodge) covOverlay.setRing(lodge.x + lodge.w / 2, lodge.y + lodge.h / 2, WALKING_RADIUS_TILES, 0x66ccff);
    else covOverlay.setRing(null);
    return;
  }
  if (!r || !def?.serviceRadius) { covOverlay.setRing(null); return; }
  covOverlay.setRing((r.vx0 + r.vx1) / 2, (r.vy0 + r.vy1) / 2, def.serviceRadius, 0xffffff);
};
let liftToolsRef: LiftTools | null = null;
let helpRef: StHelp | null = null;
let statsRef: import('@/ui/components/StStats').StStats | null = null; // Statistics dialog (Task 30), set once the game UI is built
let tutorialRef: TutorialSetup | null = null;
let toastRef: StToast | null = null;
/** Slope profile chart (piste / lift ghosts); created with the UI. */
let profileRef: { show(v: ProfileView | null): void } | null = null;
const snowlineNow = (): number => altitudeMetres(sim.weather.current.snowline);
let dockRef: StDock | null = null;
let hudRef: { showRating(): void } | null = null;
let inspectorRef: StInspector | null = null;
let schoolInfoRef: ((id: number, type: string) => NonNullable<import('@/ui/components/StInspector').InspectorTarget['school']> | undefined) | null = null;
let selectedId: number | null = null;
let selectedPiste: { x: number; y: number } | null = null;
let pisteHighlightOn = false;
let pisteInspectorRef: StPisteInspector | null = null;
const pisteHl = new PisteHighlight();
renderer.scene.add(pisteHl.mesh);
const startupErrors: string[] = [];
const toast = (t: string, k: 'info' | 'error' | 'warn' = 'info', category?: string): void => { if (toastRef) toastRef.show(t, k, 3500, { category }); else if (k !== 'info') startupErrors.push(t); };
// ---- Save manager (Task 33): slots, rolling autosave, quick save/load; loading reloads the page with ?load=<slot> ----
const saves = saveBackend && !DEMO ? new SaveManager({
  backend: saveBackend,
  getSim: () => sim,
  restore: async (_env, id) => { window.location.search = loadQuery(id); }, // validated by SaveManager.read first; the reload boots from the slot
  toast: (t, k) => toast(t, k),
  extraMeta: () => {
    const c = renderer.controls;
    let screenshot: string | undefined;
    try { // fresh render + immediate copy so the WebGL buffer is still valid (UNVERIFIED in a real browser)
      renderer.webgl.render(renderer.scene, renderer.camera);
      const cv = document.createElement('canvas'); cv.width = 160; cv.height = 100;
      cv.getContext('2d')?.drawImage(renderer.webgl.domElement, 0, 0, 160, 100);
      screenshot = cv.toDataURL('image/jpeg', 0.6);
    } catch { /* thumbnails are optional */ }
    return { camera: { x: c.target.x, y: c.target.z, yaw: c.yaw, zoom: c.zoom }, ...(screenshot ? { screenshot } : {}) };
  },
  defaultName: (s) => `Resort — ${formatDate(s.game.date)}`,
  download: downloadBytes,
}) : null;
// Loading validates the slot (CRC / version) BEFORE reloading the page into it, so a bad slot never costs the running game.
stripBootParams(window.location, window.history);
/** ⌂ Menu: autosave first (a failed / disabled autosave asks before leaving), then boot the title screen. */
async function goToMenu(): Promise<void> {
  if (saves && !sim.finance.ended) {
    const rec = await saves.autosave('manual').catch(() => null);
    if (!rec && !window.confirm('Autosave is off or failed: leave without saving this game?')) return;
  }
  window.location.search = 'menu=1';
}
let pauseRef: import('@/ui/components/StPauseMenu').StPauseMenu | null = null;
/** ⌂ Menu: the main menu as a screen OVER the running game (Resume, Save game, Load, New game, Settings, Help, About, Quit to title). The game pauses while it is open. */
let gameMenuHandle: ReturnType<typeof mountMainMenu> | null = null;
let closeGameMenu: () => void = () => {};
function openGameMenu(): void {
  if (!ui) return;
  if (gameMenuHandle) { gameMenuHandle.menu.show(); return; }
  const speedBefore = loop.speed;
  loop.setSpeed(0);
  const resume = closeGameMenu = (): void => { gameMenuHandle?.dispose(); gameMenuHandle = null; if (!sim.finance.ended && loop.speed === 0 && speedBefore > 0) loop.setSpeed(speedBefore); };
  gameMenuHandle = mountMainMenu({
    ui, saves, version: APP_VERSION, go: (q) => { window.location.search = q; },
    parts: { settings: settingsRef ?? undefined, help: helpRef ?? undefined, saveLoad: saveLoadRef },
    running: { resume, save: saves ? () => saveLoadRef?.open('save') : undefined, quit: () => { void goToMenu(); } },
  });
}
let debugRef: StDebug | null = null;
let activeTool = (): string => 'select';

const terraform = new TerraformTool({
  beginStroke: () => undo.terrainStroke('Terrain', 'terraformed'),
  grid, camera: renderer.controls.camera, dom: renderer.webgl.domElement, overlays, props,
  charge: (cost) => economy.charge(cost),
  constructionMultiplier: () => economy.constructionMultiplier(),
  liftClearanceViolations: (changed) => (liftToolsRef ? liftClearanceViolations(grid, liftToolsRef.lifts, changed) : 0),
  onModeChange: (st) => dockRef?.syncTerraform(st),
  onGhost: (g) => dockRef?.syncTerraGhost(g),
  onApplied: (r) => { if (r.touchedChunks.length) refreshProps(r.touchedChunks); covOverlay.invalidateHeights(); landscapeDecor?.invalidate(); },
});

const plantTool = new PlantTool({
  beginStroke: () => undo.terrainStroke('Trees', 'planted'),
  grid, props, camera: renderer.controls.camera, dom: renderer.webgl.domElement, overlays,
  env: () => ({ grid, props, seed: SEED, blocked: (i) => grid.occupancy.flags[i] !== 0 || (networks.layers[i] ?? 0) !== 0 || (networks.kind[i] ?? 0) !== 0, liftBlocks: liftPlantBlocker(lifts, grid) }),
  now: () => game.date.year * DAYS_PER_YEAR + game.date.day,
  charge: (cost) => economy.charge(cost),
  earn: (amount) => economy.earn('other', amount),
  multiplier: () => economy.constructionMultiplier(),
  plantDiscount: () => sim.energy.plantCostMult(),
  onApplied: (chunks) => { refreshProps(chunks); sim.nature.growth.track(chunks); sim.nature.cover.dirty = true; },
  onState: () => dockRef?.syncNature(),
});
sim.nature.onPropChunks = (c) => refreshProps(c);

// ---- Landscaping (Landscape drawer): ponds / boulders / garden decor. Water goes through the natural-lake Water mesh; decor through a second VillageDecor (3 draw calls). ----
const landscapeDecor = new LandscapeDecorView(sim.landscape, (x, z) => surfaceHeight(grid, x, z));
renderer.scene.add(landscapeDecor.group);
let landscapeSeen = -1;
/** Per frame: rebuild the water mesh / decor meshes when the Landscape changed (dig, fill, place, undo, redo, load). Cheap: one integer compare. */
const updateLandscapeView = (): void => {
  landscapeDecor.setNight(lighting.nightUniform.value);
  if (landscapeSeen === sim.landscape.version) return;
  landscapeSeen = sim.landscape.version;
  water.setLakes([...terrainInfo.lakes, ...sim.landscape.ponds]);
  landscapeDecor.sync();
  covOverlay.invalidateHeights();
};
let landscapeWalkItems: readonly import('@/render/VillageDecor').DecorItem[] = [], landscapeWalkKey: readonly unknown[] = [];
/** Walk mode collides with the village decor AND the player's decor (stable array identity while neither changes: the walk world caches on it). */
const allDecorItems = (): readonly import('@/render/VillageDecor').DecorItem[] => {
  if (landscapeWalkKey[0] !== villageDecor.items || landscapeWalkKey[1] !== landscapeDecor.items) { landscapeWalkKey = [villageDecor.items, landscapeDecor.items]; landscapeWalkItems = [...villageDecor.items, ...landscapeDecor.items]; }
  return landscapeWalkItems;
};
const landscapeTool = new LandscapeTool({
  grid, props, ls: sim.landscape, camera: renderer.controls.camera, dom: renderer.webgl.domElement, overlays,
  env: () => sim.landscapeEnv(),
  now: () => game.date.year * DAYS_PER_YEAR + game.date.day,
  charge: (cost) => economy.charge(cost),
  beginStroke: (label) => undo.landscapeStroke(label),
  onApplied: (chunks) => { if (chunks.length) { refreshProps(chunks); sim.nature.growth.track(chunks); } sim.nature.cover.dirty = true; covOverlay.invalidateHeights(); landscapeDecor.invalidate(); },
  onState: () => dockRef?.syncLandscape(),
  onRefused: (reason) => toast(reason, 'warn', 'landscape'),
});

// Chimney smoke + animals per frame (camera-relative LOD/culling inside the views).
const smoke = new SmokeView(lighting.nightUniform);
renderer.scene.add(smoke.group);
const snowSpray = new SnowSprayView(lighting.nightUniform);
renderer.scene.add(snowSpray.group);
let smokeSources: SmokeSource[] = [], smokeRebuild = 0;
const _spO = new THREE.Vector3(), _spD = new THREE.Vector3();
/** Where the view is centred in the world: the iso orbit target, or the ride camera. Weather particles / fauna follow it. */
const viewCentre = (): THREE.Vector3 => (renderer.viewMode.isIso ? renderer.controls.target : renderer.rig.camera.position);
const updateNature = (dt: number, cam: THREE.Camera, vh: number): void => {
  const tg = viewCentre();
  const st = seasonYear(game.date);
  { const dw = Math.abs(st - 0.875); natureView.setWinter(Math.max(0, 1 - Math.min(dw, 1 - dw) * 6)); }
  updateVillageDecor(dt);
  updateLandscapeView();
  updateFestival(dt);
  tourVehicles.update(sim.loop.tickCount);
  natureView.update(dt, [...sim.nature.fauna.animals, ...sim.nature.livestock.animals], tg.x, tg.z, vh, renderer.viewMode.mode === 'walk' && walk.active && !walk.riding ? { x: walk.state.x, z: walk.state.z } : null);
  { // snowmaking cannon spray (1 draw call; only running cannons near the view centre)
    const run = new Set(opsRef?.snowmaking.runningIds() ?? []);
    snowSpray.update(dt, vh, { x: tg.x, y: tg.z }, run.size ? buildings.all().filter((b) => b.type === 'snowCannon').map((b) => ({ id: b.id, x: b.x + b.w / 2, y: b.y + b.h / 2 })) : [], run, (id, o, d) => {
      const g = buildingsView.get(id);
      if (!g) return false;
      o.set(0, 0.95, 0.3); g.localToWorld(o);
      _spO.set(0, 0.95, 1.3); g.localToWorld(_spO); _spD.copy(_spO).sub(o);
      const l = Math.hypot(_spD.x, _spD.z) || 1; d.set(_spD.x / l, _spD.z / l);
      return true;
    });
  }
  smokeRebuild -= dt;
  if (smokeRebuild <= 0) { smokeRebuild = 0.5; smokeSources = buildings.all().map((b) => ({ id: b.id, type: b.type, active: b.active, x: b.x, y: b.y, w: b.w, h: b.h })); }
  let lodgeCap = 0;
  for (const b of buildings.all()) { const d = BUILDINGS[b.type]; if (d?.category === 'lodging' && b.active) lodgeCap += d.capacity; }
  const w = weather.current.wind;
  smoke.setWind(w * 0.5, w * 0.25);
  smoke.update(dt, cam, vh, smokeSources, {
    hour: currentHour(), overnight: lodgeCap > 0 ? Math.min(1, guestSim.store.overnightCount / lodgeCap) : 0,
    tempAt: (c) => weather.temperatureAt(cond.altitude(Math.floor(c.cx), Math.floor(c.cy)), currentHour()),
  }, (s, spec, out) => {
    const g = buildingsView.get(s.id);
    if (g) { out.set(spec.x, spec.y, spec.z); g.localToWorld(out); } else out.set(s.x + s.w / 2 + spec.x, 0, s.y + s.h / 2 + spec.z);
  });
};

const announceChanged = (ids: number[]): void => {
  for (const id of ids) {
    const b = buildings.get(id);
    if (b && !b.active) toastRef?.show(sentence(`${displayName(b.type)} inactive: ${b.reason ?? 'dependency lost'}`), 'warn', 3500, { action: { label: 'Go to', run: () => goTo({ x: b.x + b.w / 2 - 0.5, y: b.y + b.h / 2 - 0.5, entityKind: 'building', entityId: b.id }) }, ttlMs: 7000 });
  }
};
/** Inspector info for groomer garages / snowcat outposts (fleet) and reservoirs (water). */
const opsInfo = (id: number, type: string): { kind: 'groomer'; vehicles: number; groomedLast: number; max: number } | { kind: 'reservoir'; level: number; capacity: number; cannons?: number } | { kind: 'cannon'; info: CannonInfo } | { kind: 'patrol'; staff: number; sleds: number; max: number; open: number } | { kind: 'helipad'; helicopters: number; missions: number; state: string } | { kind: 'ranger'; staff: number; max: number; bins: boolean; binsCost: number; preventedMonth: number; savedMonth: number; bearsInRange: number; hazes: number; relocations: number; ready: number } | EnergyOps | undefined => {
  const gi = sim.energy.info(id);
  if (gi) return { kind: 'energy', lines: generatorLines(gi, sim.energy.last, sim.energy.stock) };
  if (type === 'treeNursery' || type === 'recyclingCentre') return { kind: 'energy', lines: greenLines(type, sim.energy, { felled: props.treesFelled, planted: props.treesPlanted }) };
  if (!opsRef) return undefined;
  if (safetyRef && type === 'patrolHub') return { kind: 'patrol', staff: safetyRef.patrol.staffOf(id), sleds: safetyRef.patrol.sledsOf(id), max: 6, open: safetyRef.incidents.open.length };
  if (safetyRef && type === 'rangerStation') { const r = safetyRef.wildlife.stationStats(id); return { kind: 'ranger', staff: r.staff, max: WILD.ranger.maxStaff, bins: r.bins, binsCost: WILD.ranger.binsCost, preventedMonth: r.preventedMonth, savedMonth: r.savedMonth, bearsInRange: r.bearsInRange, hazes: r.hazes, relocations: r.relocations, ready: r.ready }; }
  if (safetyRef && type === 'helipad') { const h = safetyRef.heli.helis.find((q) => q.padId === id); return { kind: 'helipad', helicopters: h ? 1 : 0, missions: h?.missions ?? 0, state: h?.state ?? 'idle' }; }
  if (type === 'groomerGarage' || type === 'snowcatOutpost') return { kind: 'groomer', vehicles: opsRef.grooming.vehiclesOf(id, type), groomedLast: opsRef.grooming.groomedLastNight(id), max: GROOM.maxFleet };
  if (type === 'reservoir') {
    const r = opsRef.reservoirs.levelOf(id), rb = buildings.get(id);
    return r && { kind: 'reservoir', level: r.level, capacity: r.capacity, cannons: rb ? coverage.sources('snowmaking').filter((s) => Math.hypot(s.cx - (rb.x + rb.w / 2), s.cy - (rb.y + rb.h / 2)) <= (BUILDINGS.reservoir?.serviceRadius ?? 0)).length : 0 };
  }
  if (type === 'snowCannon') {
    const cb = buildings.get(id);
    if (!cb) return undefined;
    const alt = cond.altitude(Math.floor(cb.x + cb.w / 2), Math.floor(cb.y + cb.h / 2));
    return { kind: 'cannon', info: cannonInfo(cb, { sm: opsRef.snowmaking, reservoirs: opsRef.reservoirs, reservoirCentres: buildings.all().filter((q) => q.type === 'reservoir' && q.active).map((q) => ({ x: q.x + q.w / 2, y: q.y + q.h / 2 })), pipeRange: BUILDINGS.reservoir?.serviceRadius ?? 24, altM: altitudeMetres(alt), tempNow: weather.temperatureAt(alt, currentHour()), snowlineM: snowlineNow(), highNow: weather.temperatureAt(alt, 15) }) };
  }
  return undefined;
};
/** 'Runs' overlay labels: small DOM tags at the middle of each run (zero-size host, pointer-events none: never blocks the map). */
const runLabelHost = (() => { const d = document.createElement('div'); d.id = 'run-labels'; d.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:21'; document.body.appendChild(d); return d; })();
let runLabelKey = '';
const updateRunLabels = (): void => {
  if (overlayMode !== 'runs') { if (runLabelHost.childElementCount) { runLabelHost.replaceChildren(); runLabelKey = ''; } return; }
  const labels = sim.runLabels().slice(0, 60), cam = renderer.controls.camera, dom = renderer.webgl.domElement, r = dom.getBoundingClientRect();
  const key = labels.map((l) => `${l.id}:${l.name}`).join('|');
  if (key !== runLabelKey) {
    runLabelKey = key;
    runLabelHost.replaceChildren(...labels.map((l) => { const e = document.createElement('div'); e.textContent = l.name; e.style.cssText = 'position:absolute;transform:translate(-50%,-50%);font:700 11px Nunito,sans-serif;color:#fff;background:#000a;padding:1px 6px;border-radius:8px;white-space:nowrap'; return e; }));
  }
  labels.forEach((l, i) => {
    const e = runLabelHost.children[i] as HTMLElement | undefined;
    if (!e) return;
    const v = new THREE.Vector3(l.x, surfaceHeight(grid, l.x, l.y) + 0.4, l.y).project(cam);
    const on = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
    e.style.display = on ? '' : 'none';
    if (on) { e.style.left = `${r.left + ((v.x + 1) / 2) * r.width}px`; e.style.top = `${r.top + ((1 - v.y) / 2) * r.height}px`; }
  });
};
const refreshUi = (): void => {
  dockRef?.refresh();
  const b = selectedId === null ? undefined : buildings.get(selectedId);
  if (!pisteInspectorRef?.busy) showPisteInspector();
  inspectorRef?.show(b ? { id: b.id, type: b.type, name: sim.names.buildingName(b.id), rot: b.rot, active: b.active, reason: b.reason ? sentence(b.reason) : b.reason, refund: refundValue(b.type), onFoot: !DEMO && sim.networks.suppliedOnFootOnly(b.id), conditions: openStatusRef?.buildingStatus(b.id), school: schoolInfoRef?.(b.id, b.type), ops: opsInfo(b.id, b.type), attraction: (() => { const a = attractionsRef?.refreshOpen(b.id), i = a?.info(); if (i && a?.spec.beds) i.beds = { total: a.spec.beds, used: attractionsRef!.beds.occupied(b.id), sold: a.stats.nights }; if (i && a?.spec.kind === 'toilet') i.toilet = { usesToday: attractionsRef!.usesToday(a), perDay: TOILET_USES_PER_DAY }; return i; })() } : null);
};
const showPisteInspector = (): void => {
  if (!pisteInspectorRef) return;
  const r = selectedPiste ? sim.pisteReportAt(selectedPiste.x, selectedPiste.y) : null;
  if (!r) { selectedPiste = null; pisteInspectorRef.show(null); pisteHl.clear(); return; }
  if (selectedId !== null) { pisteInspectorRef.show(null); pisteHl.clear(); return; }
  pisteInspectorRef.show({ ...r, highlighted: pisteHighlightOn });
  if (pisteHighlightOn) pisteHl.set(grid, r.tileIdx); else pisteHl.clear();
};
const select = (id: number | null): void => { selectedId = id; if (id !== null) { selectedPiste = null; tutorialRef?.engine.notify('select:building'); } refreshUi(); };
const selectPiste = (x: number, y: number): void => { selectedId = null; selectedPiste = { x, y }; refreshUi(); };
{ const id = window.setInterval(() => { if (selectedPiste && !pisteInspectorRef?.busy) showPisteInspector(); }, 1000); demoBag.add(() => window.clearInterval(id)); }
/** Shared undo stack: last 10 placements / bulldozes of the same in-game day (not saved). Path / piste strokes keep their own Ctrl+Z history. */
const undo = new Undo(sim);
const onPlaced = (out: PlaceOutcome): void => {
  buildingsView.sync();
  if (out.touchedChunks.length) refreshProps(out.touchedChunks);
  covOverlay.invalidateHeights();
  refreshCoverage(out.building, out.changed.length > 0);
  announceChanged(out.changed);
  refreshUi();
};

// One active tool at a time. 'select' is the neutral default (never edits); terraform is opt-in via the Terrain drawer.
const tools = new ToolManager('select');
let bulldozing = false;
tools.register({ id: 'select', label: 'Select', enable: () => {}, disable: () => {} });
tools.register({ id: 'terraform', label: 'Terraform', enable: () => terraform.enable(), disable: () => terraform.disable() });
tools.register({ id: 'plant', label: 'Plant trees', enable: () => plantTool.enable(), disable: () => plantTool.disable() });
tools.register({ id: 'landscape', label: 'Landscape', enable: () => landscapeTool.enable(), disable: () => landscapeTool.disable() });
tools.register({
  id: 'bulldoze', label: 'Bulldoze',
  enable: () => { bulldozing = true; },
  disable: () => { bulldozing = false; },
});
tools.register({ id: 'placement', label: 'Build', enable: () => {}, disable: () => placement.cancel() });
tools.register({ id: 'lift', label: 'Lift', enable: () => {}, disable: () => liftToolsRef?.tool.cancel() });
tools.register({ id: 'network', label: 'Paths & pistes', enable: () => {}, disable: () => netTools?.cancel() });
renderer.webgl.domElement.setAttribute('role', 'application'); renderer.webgl.domElement.setAttribute('aria-label', 'Ski resort map. Drag to pan, scroll or pinch to zoom, Q and E or a two-finger twist to rotate.');
tools.onChange(() => touchWire.toolChanged());
if (!tools.start()) { console.error('[startup] default tool failed to start'); startupErrors.push('Default (select) tool failed to start'); }
const setBulldoze = (v: boolean): void => { tools.activate(v ? 'bulldoze' : 'select'); };
activeTool = () => tools.current;
const mapToolsIdle = (): boolean => tools.current === 'select' || tools.current === 'bulldoze';
/** After a demolish: ONE toast with an Undo action, plus the same offer in the (otherwise empty) inspector. */
const offerUndo = (label: string, refund?: number): void => {
  const text = `Demolished ${label}`;
  toastRef?.show(refund ? `${text} (+$${refund})` : text, 'info', 3500, { action: { label: 'Undo', run: () => performUndo() }, ttlMs: 6000, key: 'demolished' });
  inspectorRef?.offerUndo(text, () => performUndo());
};
/** Ctrl/Cmd+Z, the Undo buttons and the toast action: revert the newest recorded placement / bulldoze (see build/UndoStack). */
const applyUndoReport = (r: ReturnType<Undo['undo']>, msg: (r: ReturnType<Undo['undo']>) => string): boolean => {
  if (!r.ok) { toast(msg(r), 'warn'); return false; }
  const a = r.applied;
  if (a.touchedChunks.length) refreshProps(a.touchedChunks);
  if (a.kind === 'building') { buildingsView.sync(); if (selectedId !== null && !buildings.get(selectedId)) selectedId = null; refreshCoverage(undefined, true); announceChanged(a.changed); }
  else if (a.kind === 'lift') { liftToolsRef?.syncView(); refreshCoverage(undefined, true); }
  else if (a.kind === 'terrain') { sim.nature.growth.track(a.touchedChunks); sim.nature.cover.dirty = true; netTools?.refreshChunks(a.touchedChunks); landscapeDecor.invalidate(); covOverlay.invalidateHeights(); }
  else { netTools?.refresh(); }
  covOverlay.invalidateHeights();
  inspectorRef?.offerUndo(null);
  toast(undoMessage(r));
  refreshUi();
  return true;
};
/** 'Suggest a run': highlight + profile + advice for a snow-safe line on the fall line (nothing is built). Fades after 12 s. */
let suggestTimer = 0;
const suggestRun = (want: number | null): void => {
  const s = suggestPiste(grid, netTools?.networks ?? networks, weather.current.snowline, want === null ? {} : { want });
  if (!s) { toast('No suitable run found on this map', 'warn'); return; }
  const idx = s.line.map((t) => t.y * grid.size + t.x);
  pisteHl.set(grid, idx);
  profileRef?.show({ kind: 'piste', title: 'Suggested run', profile: slopeProfile(grid, s.line, [...(netTools?.networks ?? networks).autoDifficulty(s.line).values()]), snowlineM: snowlineNow(), note: s.message });
  renderer.controls.focusOn(s.line[0]!.x + 0.5, s.line[0]!.y + 0.5);
  toast(s.message, s.snowReliable ? 'info' : 'warn');
  window.clearTimeout(suggestTimer);
  suggestTimer = window.setTimeout(() => { if (!selectedPiste) pisteHl.clear(); profileRef?.show(null); }, 12000);
};
const performUndo = (): boolean => applyUndoReport(undo.undo(), undoMessage);
/** Ctrl+Shift+Z / Ctrl+Y: replay the newest undone action (same day only). */
const performRedo = (): boolean => applyUndoReport(undo.redo(), redoMessage);
const demolish = (id: number): void => {
  const r = undo.bulldozeBuilding(id);
  if (!r.ok || !r.removed) return;
  buildingsView.sync();
  if (selectedId === id) selectedId = null;
  refreshCoverage(r.removed, r.changed.length > 0);
  announceChanged(r.changed.map((c) => c.id));
  refreshUi();
  offerUndo(displayName(r.removed.type), r.refund);
};

const placement = new PlacementTool({
  env, props, meshes: buildingMeshes, scene: renderer.scene, camera: renderer.controls.camera, dom: renderer.webgl.domElement, overlays,
  place: (type, x, y, rot, flatten) => undo.placeBuilding(type, x, y, rot, flatten),
  onPlaced,
  onError: (m) => toast(m, 'error'),
  onCancel: () => tools.release('placement'),
  onState: (st) => { dockRef?.setAutoFlatten(st.autoFlatten); dockRef?.setFlattenPolicy(st.flattenPolicy ?? 'default'); dockRef?.setActive(st.type ? 'buildings' : null, st.type); },
});
/** Why a building cannot be chosen: the Career level lock first, then missing prerequisites. */
const buildingLocks = (type: string): string[] => { const l = sim.progression.locked('building', type); return [...(l ? [l] : []), ...canPlace(type, buildings.depContext()).reasons]; };
const startPlacement = (type: string): void => {
  const lock = buildingLocks(type);
  if (lock.length) { toast(`Locked: ${lock.join(', ')}`, 'error'); return; }
  tools.activate('placement');
  placement.start(type);
  placement.setAutoFlatten(autoFlattenDefault(type)); // per-building default; the dock checkbox shows/overrides it
};

{
  const dom = renderer.webgl.domElement;
  const ray = new THREE.Raycaster();
  dom.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== dom || !mapToolsIdle()) return;
    const r = dom.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), renderer.controls.camera);
    const p = pickHeightfield(grid, ray.ray.origin, ray.ray.direction);
    const b = p ? buildings.at(p.tileX, p.tileY) : undefined;
    const onPiste = !b && !!p && !!sim.pisteReportAt(p.tileX, p.tileY);
    const act = routeMapClick(tools.current, !!b, selectedId !== null || selectedPiste !== null, onPiste);
    if (act === 'bulldoze' && b) demolish(b.id);
    else if (act === 'bulldoze-miss') { if (!(p && netTools?.bulldozeAt(p.tileX, p.tileY))) toast('Nothing to bulldoze here', 'warn'); }
    else if (act === 'select' && b) select(b.id);
    else if (act === 'select-piste' && p) selectPiste(p.tileX, p.tileY);
    else if (act === 'deselect') { selectedPiste = null; select(null); }
  });
  // Select mode: tile highlight only (no cost tooltip, never edits).
  dom.addEventListener('pointermove', (e) => {
    if (tools.current !== 'select' || e.target !== dom) return;
    const r = dom.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), renderer.controls.camera);
    const p = pickHeightfield(grid, ray.ray.origin, ray.ray.direction);
    if (!p) { overlays.hide(); return; }
    overlays.setVertexRect(p.tileX, p.tileY, p.tileX + 1, p.tileY + 1);
    overlays.setColor(0xffee55);
    overlays.setTooltip(null);
  });
  dom.addEventListener('pointerleave', (e) => { if (tools.current === 'select' && e.pointerType !== 'touch') overlays.hide(); }); // touch: lifting the finger fires pointerleave; the long-press hover info must stay (docs/touch.md)
  tools.onChange((id) => { if (id === 'select') overlays.hide(); });
  window.addEventListener('keydown', (e) => {
    const t = ((e.composedPath?.()[0] as HTMLElement | undefined) ?? e.target) as HTMLElement | null; // the real target: events from inputs inside a shadow root are retargeted to the host
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === 'x' || e.key === 'X') setBulldoze(!bulldozing);
    else if (e.key === 'Escape') tools.reset(); // back to the select tool
  });
  // Diagnostics: runs first (capture, window) so it reports even when other handlers swallow the event.
  window.addEventListener('pointerdown', (e) => {
    try {
      const t = e.target;
      let tile: { x: number; y: number } | null = null;
      if (t === dom) {
        const r = dom.getBoundingClientRect();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), renderer.controls.camera);
        const p = pickHeightfield(grid, ray.ray.origin, ray.ray.direction);
        if (p) tile = { x: p.tileX, y: p.tileY };
      }
      const line = formatInputLine({ target: t, onCanvas: t === dom, tool: activeTool(), tile, button: e.button });
      if (import.meta.env.DEV) console.debug(line);
      debugRef?.setInputLine(line);
    } catch (err) { console.error('[input-debug]', err); }
  }, true);
  dom.addEventListener('contextmenu', (e) => { if (bulldozing) { e.preventDefault(); tools.reset(); } });
}

// Meshes for every building in the store, including those createSim placed (starting Base Lodge).
buildingsView.sync();


let lastNetVersion = -1;
let lastQualityVersion = -1;
let lastThreatVersion = -1;
// Chunks holding roads/paths/pistes/buildings/lifts stay full-res in far LOD (see ProtectedChunks). Recomputed when those change (<= 2x/s).
let protSig = '', protTimer = 0;
const refreshProtected = (dt: number): void => {
  protTimer += dt;
  if (protTimer < 0.5) return;
  protTimer = 0;
  const net = netTools?.networks ?? networks;
  const sig = `${net.version}|${buildings.all().length}|${lifts.size}`;
  if (sig === protSig) return;
  protSig = sig;
  terrain.setProtectedChunks(collectProtectedChunks({
    size: MAP_SIZE, netKind: net.kind, netLayers: net.layers,
    buildings: buildings.all(), lifts: lifts.all().map((l) => ({ bottom: l.bottom, top: l.top })),
  }));
};
const renderStateDump = (): string => {
  const cam = renderer.camera;
  const u = terrain.material.uniforms as Record<string, THREE.IUniform>;
  const p = lighting.last;
  const f3 = (n: number): string => n.toFixed(3);
  const c3 = (c: THREE.Color | THREE.Vector3 | number[]): string => (Array.isArray(c) ? c : 'r' in c ? [c.r, c.g, c.b] : [c.x, c.y, c.z]).map(f3).join(',');
  const t = seasonYear(game.date);
  const w = seasonWeights(t);
  return JSON.stringify({
    map: MAP_SIZE, date: { ...game.date }, hour: f3(currentHour()), seasonYear: f3(t), seasonOf: seasonOf(game.date),
    seasonWeights: { spring: f3(w.spring), summer: f3(w.summer), autumn: f3(w.autumn), winter: f3(w.winter) },
    zoom: f3(renderer.controls.zoom), visibleWorldHeight: f3(lodHeightFor(cam)), lodThreshold: TERRAIN_MACRO_VIEW_HEIGHT,
    terrain: terrain.stats(),
    terrainUniforms: { autumn: f3(u.uAutumn!.value as number), springBloom: f3(u.uSpringBloom!.value as number), snowline: f3(u.uSnowline!.value as number), sun: c3(u.uSunColor!.value as THREE.Color), sky: c3(u.uSkyColor!.value as THREE.Color), ground: c3(u.uGroundColor!.value as THREE.Color) },
    lights: { sun: f3(renderer.sun.intensity), sunColor: c3(renderer.sun.color), hemi: f3(renderer.hemi.intensity), hemiSky: c3(renderer.hemi.color), hemiGround: c3(renderer.hemi.groundColor), night: f3(lighting.nightUniform.value), disableNight: lighting.disableNight, shaderSun: p ? c3(p.shaderSun) : null },
    drawCalls: renderer.webgl.info.render.calls, triangles: renderer.webgl.info.render.triangles,
  }, null, 1);
};
const materialGuard = new MaterialGuard(renderer.webgl as unknown as GuardRenderer, renderer.scene);
materialGuard.onProblem = (pr): void => toast(`Shader error in ${pr.material} (${pr.owner})${pr.fallback ? ' - using plain fallback' : ''}`, 'error');
renderer.onFrame = (dt): void => {
  materialGuard.tick();
  if (!ff.active) loop.advance(dt);
  buildingsView.update(dt);
  const hour = currentHour();
  if (game.date.day !== lastLightDay) { lastLightDay = game.date.day; lastHour = -1; }
  if (lastHour < 0 || Math.abs(hour - lastHour) > 0.005) { lastHour = hour; lighting.apply(hour, sunTimes(game.date.day)); buildingMeshes.setNight(lighting.nightUniform.value); NET_NIGHT.value = lighting.nightUniform.value; }
  if (useClock) applySimSeason(dt);
  const cam = renderer.camera;
  const vh = lodHeightFor(cam);
  refreshProtected(dt);
  if (renderer.viewMode.mode === 'walk' && walk.active) terrain.setNearFocus(walk.focus.x, walk.focus.z, RIDE_NEAR_TERRAIN_TILES); // walk: prefetch ahead of the walker
  else if (isPerspective(cam)) terrain.setNearFocus(cam.position.x, cam.position.z, RIDE_NEAR_TERRAIN_TILES); else terrain.setNearFocus(null);
  terrain.setDetailFade(isPerspective(cam) && groundDetail ? 1 : 0);
  terrain.update(terrainLodHeightFor(cam, MAP_SIZE), refreshProps);
  groundMask.update();
  covOverlay.update();
  updateRunLabels();
  const simTps = loop.paused ? 0 : SPEED_MULTIPLIERS[loop.speed]! * TICKS_PER_SECOND * loop.currentWarp * loop.timeScale;
  groomingView?.update(dt, simTps);
  incidentView?.update(dt, 0, simTps);
  if (safetyRef && overlayMode === 'threat' && safetyRef.wildlife.threatVersion !== lastThreatVersion) { lastThreatVersion = safetyRef.wildlife.threatVersion; covOverlay.invalidate(); }
  if (overlayMode === 'traffic' && game.date.tick % 20 === 0) covOverlay.invalidate();
  if (overlayMode === 'snowmaking' && game.date.tick % 20 === 0) covOverlay.invalidate();
  if (opsRef && overlayMode === 'quality' && opsRef.quality.version !== lastQualityVersion) { lastQualityVersion = opsRef.quality.version; covOverlay.invalidate(); }
  if (netTools && netTools.networks.version !== lastNetVersion) { lastNetVersion = netTools.networks.version; covOverlay.invalidate(); }
  water.update(performance.now() / 1000);
  flushSnow(dt);
  updatePrecip(dt);
  trees.update(cam, vh);
  liftToolsRef?.view.updateNear(cam);
  buildingMeshes.setNearHide(isPerspective(cam) ? cam.position : null);
  updateNature(dt, cam, vh);
  rocks.update(cam, vh);
};

// Paths, roads, rail, pistes (own module/palette)
netTools = safely('Paths/roads/pistes', () => registerNetworkTools({ networks,
  grid, buildings, economy, scene: renderer.scene, camera: renderer.controls.camera, dom: renderer.webgl.domElement, uiRoot: null,
  roadEntry: terrainInfo.roadEntry, railEntry: terrainInfo.railEntry, village: terrainInfo.villageAnchor,
  onFrame: (fn) => { const prev = renderer.onFrame; renderer.onFrame = (dt) => { prev?.(dt); fn(); }; },
  toast, announceChanged, refreshUi, bus,
  onActiveChange: (k) => dockRef?.setActive(k ? (k === 'path' || k === 'road' || k === 'rail' ? 'paths' : 'pistes') : null, k),
  onToolActive: (a) => { if (a) tools.activate('network'); else tools.release('network'); },
  onNetworkChanged: () => refreshCoverage(undefined, true),
  undo, performUndo, performRedo, onProfile: (v) => profileRef?.show(v), snowlineM: snowlineNow,
}), (m) => startupErrors.push(m));
covOverlay.invalidate();

// Initial camera: look at the Base Lodge / village at a readable zoom (~36 tiles tall). A loaded save restores its saved camera instead.
if (!bootSave?.env.meta.camera) {
  const lodge = buildings.all().find((b) => b.type === 'baseLodge');
  const c = lodge ? { x: lodge.x + lodge.w / 2, y: lodge.y + lodge.h / 2 } : terrainInfo.villageAnchor;
  const ctl = renderer.controls;
  // Default yaw: one of the four diagonals (snap grid) that makes the map centre lie 'up' on screen, i.e. the village sits at the
  // centre-bottom of the slab and the cliff / void stay behind and below it instead of filling half the view.
  const dx = MAP_SIZE / 2 - c.x, dz = MAP_SIZE / 2 - c.y;
  if (Math.hypot(dx, dz) > MAP_SIZE * 0.08) ctl.yaw = snapYaw(Math.atan2(-dx, -dz), 0);
  const f = panBasis(ctl.yaw).forward; // shift the target a few tiles 'up' so lodge + road sit below the screen centre with terrain above
  const sh = Math.min(8, Math.hypot(dx, dz) * 0.4);
  ctl.target.set(c.x + f[0] * sh, heightAt(grid, c.x, c.y), c.y + f[1] * sh);
  ctl.zoom = (MAP_SIZE * 0.75) / 36;
  ctl.zoomBy(1); // clamps to min/max zoom
}

bootStage('lifts');
const liftTools = liftToolsRef = safely('Lifts', () => registerLiftTools({ lifts,
  grid, props, economy, scene: renderer.scene, camera: renderer.controls.camera, dom: renderer.webgl.domElement, overlays, ui, frame: renderer,
  access: netTools?.networks.access, gate: sim.gate, buildings,
  toast, isBulldozing: () => bulldozing, refreshProps, onPropsCleared: () => { sim.nature.cover.dirty = true; }, bus, liftOps: sim.liftOps, undo, onProfile: (v) => profileRef?.show(v), snowlineM: snowlineNow, onDemolished: (label, refund) => offerUndo(label, refund),
  liftName: (id) => sim.names.liftName(id), renameLift: (id, n) => sim.names.rename('lift', id, n),
  suspendOthers: () => { tools.activate('lift'); },
  resumeOthers: () => tools.release('lift'),
  canSelect: mapToolsIdle, inspectorParent: rightCol,
  onActiveChange: (k) => dockRef?.setActive(k ? 'lifts' : null, k),
  onChanged: () => dockRef?.refresh(),
}), (m) => startupErrors.push(m));

// UI (toolbar, HUD, debug panel)
let maxH = 0;
for (const h of grid.heights) if (h > maxH) maxH = h;
const maxWorld = Math.max(1, Math.ceil(maxH * HEIGHT_UNIT));
terrain.snowline = maxWorld + 1;
const counts = props.countByKind();
const treeCount = TREE_KINDS.reduce((a, k) => a + (counts[k] ?? 0), 0) + (counts[PropKind.Shrub] ?? 0) + (counts[PropKind.Snag] ?? 0);
const rockCount = counts[PropKind.Rock] ?? 0;
const SEASON_START = seasonYear(game.date); // follows the game clock (new games start in winter)
const worldScale = worldScaleFor(MAP_SIZE);
  incidentView = new IncidentView(safety, (x, y) => heightAt(grid, x, y));
  renderer.scene.add(incidentView.group);
  groomingView = new GroomingView(opsRef.grooming, (x, y) => heightAt(grid, x, y), () => { const h = currentHour(); return isNightHour(game.date.day, h); });
  renderer.scene.add(groomingView.group);
schoolInfoRef = (id, type) => {
  if (type !== 'skiSchoolHQ') return undefined;
  const sc = guestSim.families.school(id);
  return { instructors: sc.instructors, capacity: sc.capacity, lessonsToday: sc.lessonsToday, activeKids: sc.activeKids, queuedKids: sc.queuedKids, quality: sc.quality() };
};
const dateMonth = (): { year: number; month: number } => ({ year: game.date.year, month: monthIndex(game.date) });
const lakeNear = new Map<number, Array<{ x: number; y: number }>>();
const activityCache = new Map<number, ActivityView>();
const activityList: ActivityView[] = [];
/** Reused per-frame view objects (no per-frame allocation once the attraction set is stable). */
const activityViews = (): ActivityView[] => {
  activityList.length = 0;
  for (const a of attractions.all()) {
    let v = activityCache.get(a.id);
    if (!v || v.type !== a.b.type || v.x !== a.b.x || v.y !== a.b.y) {
      let lake: ActivityView['lake'];
      if (a.b.type === 'boatRental') {
        lake = lakeNear.get(a.id);
        if (!lake) { lake = buildings.lakeTiles.filter((t) => Math.hypot(t.x - a.b.x, t.y - a.b.y) < 8).slice(0, 24); lakeNear.set(a.id, lake); }
      }
      v = { id: a.id, type: a.b.type, x: a.b.x, y: a.b.y, w: a.b.w, h: a.b.h, users: 0, open: false, lake };
      activityCache.set(a.id, v);
    }
    v.users = a.usersNow; v.open = a.open; v.w = a.b.w; v.h = a.b.h;
    activityList.push(v);
  }
  return activityList;
};
const activity = new AttractionActivity(activityViews, (x, y) => heightAt(grid, x, y));
renderer.scene.add(activity.group);
const guestRenderer = new GuestRenderer(guestSim.store);
const vehicleRenderer = new VehicleRenderer(() => guestSim.spawner.vehicles, (x, y) => heightAt(grid, x, y));
renderer.scene.add(guestRenderer.group, vehicleRenderer.group);
// Rail level crossings (Phase 6 Task 10, docs/crossings.md): barriers / lamps animate from the sim's closed state; the bell is quiet and fades with camera distance.
const crossingsView = new RailCrossingsView(grid, sim.crossings);
renderer.scene.add(crossingsView.group);
crossingsView.onBell = (x, z): void => { const c = renderer.camera.position, d = Math.hypot(c.x - x, c.z - z), g = Math.max(0, 1 - d / 70); if (g > 0.04) audioRef?.sfx.play('crossingBell', { gain: g * g, pan: Math.max(-0.6, Math.min(0.6, (x - c.x) / 60)) }); };
guestRenderer.isKid = (slot) => guestSim.families.isKid(slot);
guestRenderer.usingKind = (slot) => { const ty = buildings.get(guestSim.store.target[slot]!)?.type; return ty === 'iceRink' ? 1 : ty === 'beach' ? 2 : 0; };
{
  const prev = renderer.onFrame;
  renderer.onFrame = (dt): void => {
    prev?.(dt);
    const a = loop.paused || loop.isHidden ? 1 : loop.alpha;
    const cam = renderer.camera;
    const wnt = seasonWeights(seasonYear(game.date)).winter > 0.35;
    guestRenderer.winter = wnt; vehicleRenderer.winter = wnt; vehicleRenderer.night = lighting.nightUniform.value;
    guestRenderer.hideSlot = rideAlong.active && renderer.viewMode.mode === 'ride' ? rideAlong.slot : -1;
    guestRenderer.speedMul = ff.active ? 1000 : loop.paused ? 0 : SPEED_MULTIPLIERS[loop.speed]!; guestRenderer.frameSeconds = dt;
    guestRenderer.update(a, lodHeightFor(cam), cam, loop.tickCount);
    vehicleRenderer.update(a);
    crossingsView.update(dt);
    activity.update(game.date.tick + a, lodHeightFor(cam));
    audioRef?.frame(dt); // throttled to ~10 Hz inside; no-op until the first user gesture unlocks audio
  };
}
// Feedback (M5.1): restrained +$ popups / build puffs / rare confetti (src/render/fx). Render-only: reads the bus, never touches the sim.
const FX_CATEGORY_TYPES: Record<string, string[]> = {
  lifts: ['baseLodge'], passes: ['ticketOffice', 'baseLodge'], lodging: ['chalet', 'apartment'], shops: ['shop'], restaurants: ['lodge', 'cafe', 'mountainHut', 'baseLodge'],
  bars: ['apresBar', 'heatedTerrace'], recreation: ['iceRink', 'stuntPark', 'adventurePark', 'heatedTerrace'], rental: ['rental', 'boatRental'], lessons: ['skiSchoolHQ'], other: ['baseLodge'],
};
const fxRng = renderRng(0x51ec0de);
const fx = new Feedback({
  bus,
  floatText: new FloatText(document.body),
  particles: new Particles(256),
  reducedMotion: () => getReducedMotion(),
  storage: (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } })(),
  locate: (cat) => {
    const types = FX_CATEGORY_TYPES[cat] ?? FX_CATEGORY_TYPES.other!;
    const all = buildings.all();
    for (const t of types) {
      const l = all.filter((b) => b.type === t);
      if (l.length) { const b = l[Math.floor(fxRng() * l.length)]!; const cx = b.x + b.w / 2, cz = b.y + b.h / 2; return { key: b.id, x: cx, y: heightAt(grid, cx, cz) + 2, z: cz }; }
    }
    return null;
  },
  placedAt: (_id, x, y) => ({ x: x + 0.5, y: heightAt(grid, x, y), z: y + 0.5 }),
  focus: () => { const t = viewCentre(); return { x: t.x, y: t.y, z: t.z }; },
  winter: () => seasonWeights(seasonYear(game.date)).winter > 0.35,
  play: (sfx, o) => { audioRef?.sfx.play(sfx, o); },
  kick: () => { renderer.webgl.domElement.animate?.([{ transform: 'translate(0,0)' }, { transform: 'translate(0,2px)' }, { transform: 'translate(0,0)' }], { duration: 140, easing: 'ease-out' }); },
});
fx.floatText.project = (x, y, z) => {
  if (!renderer.viewMode.isIso) return null; // no floating money text at ground level
  return projectToScreen(renderer.camera, x, y, z, renderer.webgl.domElement.getBoundingClientRect());
};
renderer.scene.add(fx.particles.mesh);
// Emotes (M5.1): occasional guest bubbles, one draw call, render-only (reads the guest store).
const wildSight = new WildlifeSight();
let wildSightTick = -1;
const wildSightFor = (tick: number): WildlifeSight => {
  if (tick === wildSightTick) return wildSight;
  wildSightTick = tick;
  const list: Array<{ x: number; y: number; kind: 'bear' | 'deer' }> = [];
  for (const a of sim.nature.fauna.animals) if (a.species === 'deer' && !a.hidden) list.push({ x: a.x, y: a.y, kind: 'deer' });
  for (const a of sim.safety.wildlife.animals) if (a.kind === 'bear' && !a.asleep) list.push({ x: a.x, y: a.y, kind: 'bear' });
  wildSight.set(list);
  return wildSight;
};
const emotes = new Emotes(guestSim.store, {
  wildlife: (slot) => wildSightFor(loop.tickCount).near(guestSim.store.x[slot]!, guestSim.store.y[slot]!),
  policy: () => fx.policy(), reducedMotion: () => getReducedMotion(), day: () => game.date.year * DAYS_PER_YEAR + game.date.day,
  cold: () => coldness(weather.valleyTempAt(hourOfDay(game.date))), anchor: (slot, out) => guestRenderer.anchor(slot, out, loop.paused || loop.isHidden ? 1 : loop.alpha),
});
renderer.scene.add(emotes.mesh);
// Fireworks (M5.4 Task 21): restrained, New Year + festival finales, night only, never with Feedback = Off / reduced motion. Sparks use the shared particle pool.
const fireworks = new Fireworks(fx.particles);
let showKey: string | null = null, showCheck = 0, showAt = { x: 0, y: 0, z: 0 };
const updateFireworks = (dt: number): void => {
  showCheck -= dt;
  if (showCheck <= 0) {
    showCheck = 0.5;
    const e = sim.events.fireworksToday();
    showKey = e ? `${e.id}@${e.start}:${Math.floor(game.date.day)}` : null;
    const w = festivalDressing.layouts[0], a = w?.anchor ?? { x: terrainInfo.villageAnchor.x, y: terrainInfo.villageAnchor.y };
    showAt = { x: a.x, y: surfaceHeight(grid, a.x, a.y), z: a.y };
  }
  fireworks.update(dt, { show: showKey, hour: currentHour(), dark: lighting.nightUniform.value, allowed: fireworksAllowed(fx.policy(), getReducedMotion()), origin: showAt });
};
const fxApi = { emotes, demo: () => fx.demo(), policy: () => fx.policy(), setIntensity: (v: FeedbackIntensity) => fx.setIntensity(v), get intensity() { return fx.intensity; }, stats: fx.stats };
{
  const prev = renderer.onFrame;
  renderer.onFrame = (dt): void => {
    prev?.(dt);
    if (!renderer.viewMode.isIso) { fx.particles.mesh.visible = false; emotes.mesh.visible = false; return; } // popups / puffs / emotes are iso-view effects
    updateFireworks(Math.min(dt, 0.1));
    fx.update(Math.min(dt, 0.1), renderer.camera);
    const ecam = renderer.camera;
    emotes.update(Math.min(dt, 0.1), ecam, loop.tickCount, guestRenderer.far, lodHeightFor(ecam), renderer.webgl.domElement.clientHeight);
  };
}
// Audio (Task 30): all sound is synthesized (Web Audio). Created here so it works even if the UI fails to mount.
let audioRef: AudioApi | null = null;
let settingsRef: StSettings | null = null;
let saveLoadRef: StSaveLoad | null = null;
try {
  if (DEMO) throw new Error('no audio in the title-screen demo');
  let maxH = 1;
  for (let i = 0; i < grid.heights.length; i++) if (grid.heights[i]! * 0.5 > maxH) maxH = grid.heights[i]! * 0.5;
  const cc = renderer.controls;
  audioRef = createAudio({
    bus,
    storage: (() => { try { return window.localStorage; } catch { return null; } })(),
    camera: () => (renderer.viewMode.mode === 'walk' ? { x: renderer.rig.pose.x, z: renderer.rig.pose.z, yaw: renderer.rig.pose.yaw, zoom: AMB.walkZoom } : { x: cc.target.x, z: cc.target.z, yaw: cc.yaw, zoom: cc.camera.top - cc.camera.bottom }), // walk mode: the walker is the listener (near-field ambience)
    probe: {
      grid, maxHeight: maxH, heightAt: (x, y) => heightAt(grid, x, y),
      guests: { count: (x, y, r) => hashCount(guestSim.hash, x, y, r) },
      lifts: () => lifts.all().filter((l) => l.open).map((l) => ({ x: (l.bottom.x + l.top.x) / 2, y: (l.bottom.y + l.top.y) / 2 })),
      buildings: () => buildings.all(),
      cows: () => sim.nature.livestock.animals.filter((a) => a.species === 'cow' && !a.hidden),
      cats: () => (opsRef?.grooming.nightActive ? opsRef.grooming.cats : []),
      helis: () => safetyRef?.heli.helis ?? [],
      trunks: (x, z, r) => countTrunks(props, x, z, r),
      env: () => ({ season: seasonOf(game.date), weather: weather.current.kind, hour: currentHour(), wind: weather.current.wind, ...sunTimes(game.date.day), guests: guestSim.store.count, festival: sim.events.active().length > 0 }),
    },
  });
} catch (err) { if (!DEMO) console.warn('[audio] disabled:', err); }
// Guest inspector (Task 27): click a guest in select mode; small ring under the selected guest.
let guestSelId = 0;
let guestInspEl: StGuestInspector | null = null;
let viewHudEl: StViewHud | null = null;
const selRing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 20), new THREE.MeshBasicMaterial({ color: 0xffd070, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }));
selRing.rotation.x = -Math.PI / 2; selRing.renderOrder = 10; selRing.visible = false;
renderer.scene.add(selRing);
const excursionText = (slot: number): string | null => {
  const p = guestSim.exc.progress(slot);
  if (!p) { const tk = guestSim.trek.get(guestSim.store.id[slot]!); return tk && tk.day === 2 ? 'Sleeping in a mountain hut' : null; }
  const n = MAP_SIZE, eta = Math.round(p.etaHours * 60), tk = guestSim.trek.get(guestSim.store.id[slot]!);
  return `On excursion: ${tk ? 'overnight trek to the hut' : p.kind === 1 ? 'mountain bike descent' : p.phase === 2 ? 'heading back down' : `trail goal (${(p.goal % n)},${Math.floor(p.goal / n)})`} (${Math.round(p.pct * 100)}% · ETA ${Math.floor(eta / 60)}h${String(eta % 60).padStart(2, '0')})`;
};
let guestFollow = false; // inspector 'Follow': keep the camera on the selected guest (stops when the guest leaves or the card closes)
const refreshGuestInfo = (): void => {
  if (!guestSelId && sim.stories.pinned) guestSelId = sim.stories.pinned; // a pinned story guest comes back after the selection ends
  let slot = guestSelId ? guestSim.store.slotOf(guestSelId) : -1;
  if (slot < 0 && sim.stories.pinned && sim.stories.pinned !== guestSelId) { guestSelId = sim.stories.pinned; slot = guestSim.store.slotOf(guestSelId); }
  if (slot < 0) { guestSelId = 0; guestFollow = false; selRing.visible = false; guestInspEl?.show(null); return; }
  const st = guestSim.store;
  const l = st.state[slot] === GState.Queueing ? liftToolsRef?.lifts.all().find((x) => x.id === st.liftId[slot]) : undefined;
  const queueTicks = st.state[slot] === GState.Queueing ? game.date.tick - st.actTick[slot]! : 0;
  const t = (Math.floor(st.y[slot]!) * MAP_SIZE) + Math.floor(st.x[slot]!);
  const fam = guestSim.families.describe(slot);
  if (guestFollow) renderer.controls.focusOn(st.x[slot]!, st.y[slot]!, { duration: 0.5 });
  const story = sim.stories.info(guestSelId);
  guestInspEl?.show(guestInspectorModel(st, slot, {
    story: story ? { ...story, following: guestFollow } : null,
    familyText: fam, excursionText: excursionText(slot), queueLift: l ? `${LIFTS[l.kind]?.name ?? l.kind} ${l.id}` : null,
    ctx: { queueTicks, onIcyPiste: st.act[slot] === Act.SkiDown && opsRef?.quality.at(t) === 4, noKidsVenue: !!fam && fam.includes('no school'), crowded: guestSim.hash.countAt(st.x[slot]!, st.y[slot]!) > 30, sawBear: !!safetyRef?.wildlife.sawBear(st.id[slot]!) },
  }));
};
{
  const dom = renderer.webgl.domElement;
  dom.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== dom || tools.current !== 'select') return;
    const slot = guestRenderer.pick(e.clientX, e.clientY, dom, renderer.controls.camera);
    if (slot >= 0) { guestSelId = guestSim.store.id[slot]!; refreshGuestInfo(); }
  });
  { const id = window.setInterval(refreshGuestInfo, 500); demoBag.add(() => window.clearInterval(id)); }
  const prevFrame = renderer.onFrame;
  renderer.onFrame = (dt): void => {
    prevFrame?.(dt);
    const slot = guestSelId ? guestSim.store.slotOf(guestSelId) : -1;
    if (slot < 0) { selRing.visible = false; return; }
    const st = guestSim.store, a = loop.paused || loop.isHidden ? 1 : loop.alpha;
    const x = st.px[slot]! + (st.x[slot]! - st.px[slot]!) * a, y = st.py[slot]! + (st.y[slot]! - st.py[slot]!) * a, z = st.pz[slot]! + (st.z[slot]! - st.pz[slot]!) * a;
    selRing.position.set(x, z + 0.08, y); selRing.visible = true;
  };
}
// ---- Ground-level ride-along (M5.2): reads the sim only (guest store typed arrays), never mutates it ----
const ridePaths = new Map<number, { nodes: unknown; path: CablePath }>(); // cable paths of the lifts being ridden (rebuilt when a lift's nodes change)
const rideAlong = new RideAlong({
  store: guestSim.store,
  liftFamily: (id) => { const l = liftToolsRef?.lifts.get(id); return l ? LIFTS[l.kind]?.family : undefined; },
  liftSeats: (id) => { const l = liftToolsRef?.lifts.get(id); return l ? LIFTS[l.kind]?.capacityPerCarrier : undefined; },
  cableY: (id, x, z) => {
    const l = liftToolsRef?.lifts.get(id);
    if (!l) return undefined;
    let c = ridePaths.get(id);
    if (!c || c.nodes !== l.nodes) { c = { nodes: l.nodes, path: liftPath(l) }; ridePaths.set(id, c); }
    const p0 = c.path.pts[0]!;
    return samplePath(c.path, (x - p0.x) * c.path.dirX + (z - p0.z) * c.path.dirZ).y;
  },
  ticksPerSecond: () => SPEED_MULTIPLIERS[loop.speed]! * TICKS_PER_SECOND * loop.timeScale,
});
const rideSample: RideSample = { x: 0, y: 0, z: 0, hx: 0, hz: 0, speed: 0, slope: 0, kind: 'foot' };
const RIDE_SLOWMO_KEY = 'slope.ride.slowmo';
let rideSlowMo = true;
try { rideSlowMo = localStorage.getItem(RIDE_SLOWMO_KEY) !== '0'; } catch { /* storage unavailable: default ON */ }
const rideSlowMoApi = {
  get: (): boolean => rideSlowMo,
  set: (v: boolean): void => {
    if (v === rideSlowMo) return;
    rideSlowMo = v; try { localStorage.setItem(RIDE_SLOWMO_KEY, v ? '1' : '0'); } catch { /* ignore */ }
    if (renderer.viewMode.mode === 'ride' && !v) { rideFactor = 1; loop.timeScale = rideSaved.timeScale; }
  },
};
const rideSaved = { overlay: 'off' as OverlayMode, grid: false, timeScale: 1 };
let rideFactor = 1; // live ride slow-mo factor (rideTimeFactor, eased)
let rideHudAt = 0, rideHorizon = -1;
{
  const st = document.createElement('style');
  st.textContent = 'body.view-ride #ui > :not(st-view-hud):not(st-toast):not(st-touch-controls){display:none !important}body.view-ride st-toast{transform:scale(.8);transform-origin:top center;opacity:.92}body.view-ride #app canvas{cursor:grab}';
  document.head.appendChild(st);
}
lighting.onHorizon = (c) => renderer.fog.setColor(c);
lighting.refreshSky();
const exitRide = (): void => {
  if (renderer.viewMode.mode !== 'ride') return;
  rideAlong.stop();
  guestRenderer.hideSlot = -1;
  renderer.exitToIso();
  document.body.classList.remove('view-ride');
  lighting.horizonAt = null; lighting.refreshSky(); rideHorizon = -1;
  setOverlay(rideSaved.overlay); terrain.gridOverlay = rideSaved.grid;
  loop.timeScale = rideSaved.timeScale;
  pisteHl.mesh.visible = true; smoke.group.visible = true; snowSpray.group.visible = true; terrain.setNearFocus(null);
  viewHudEl?.render(null);
};
/** Start (or retarget) a ride-along. `id` omitted = automatic pick (skier, then lift rider, then anyone). Returns the followed guest id or 0. */
const startRide = (id?: number): number => {
  if (DEMO || (renderer.viewMode.mode !== 'ride' && !renderer.viewMode.can('ride'))) return 0;
  const ok = id ? rideAlong.follow(id) : rideAlong.followAuto() !== 0;
  if (!ok) return 0;
  if (renderer.viewMode.mode !== 'ride') {
    renderer.enterGround('ride');
    tools.reset();
    rideSaved.overlay = overlayMode; rideSaved.grid = terrain.gridOverlay;
    setOverlay('off'); terrain.gridOverlay = false;
    rideSaved.timeScale = loop.timeScale; rideFactor = 1; // slow-mo pacing is per frame (see rideTimeFactor; Settings: 'Ride-along slow motion')
    pisteHl.mesh.visible = false; selRing.visible = false; smoke.group.visible = false; snowSpray.group.visible = false;
    document.body.classList.add('view-ride');
  } else renderer.rig.reset();
  renderer.rig.motion = getReducedMotion() ? 0 : 1;
  renderer.rig.smoothReturn = false; renderer.rig.recentre(); renderer.rig.resetFov();
  rideHudAt = 0;
  return rideAlong.targetId;
};
const nextRide = (): void => { if (renderer.viewMode.mode === 'ride' && rideAlong.next()) renderer.rig.reset(); };
/** QA only: [x, y, z, yaw, pitch] free ground camera used while riding (set via __slope.view.freeCam; null = off). */
let debugFreeCam: number[] | null = null;
renderer.preFrame = (dt): void => {
  if (renderer.viewMode.mode === 'photo') { photoFrame(dt); return; }
  if (renderer.viewMode.mode === 'walk') { walkFrame(dt); return; }
  if (renderer.viewMode.mode !== 'ride') return;
  const gone = rideAlong.targetId;
  if (!rideAlong.check()) { exitRide(); toast(`Guest #${gone} left: ride-along ended.`, 'info'); return; }
  const a = loop.paused || loop.isHidden ? 1 : loop.alpha;
  if (rideSlowMo) { // target-speed slow motion: the followed guest never looks faster than RIDE_TARGET_TILES_PER_S
    const want = rideTimeFactor(rideAlong.tilesPerTick, SPEED_MULTIPLIERS[loop.speed]! * TICKS_PER_SECOND * rideSaved.timeScale * loop.currentWarp);
    rideFactor = easeRideFactor(rideFactor, want, dt); loop.timeScale = rideSaved.timeScale * rideFactor;
  }
  if (!rideAlong.sample(a, rideSample)) return;
  const pose = renderer.rig.update(dt, rideSample);
  if (debugFreeCam) { const c = renderer.camera; c.position.set(debugFreeCam[0]!, debugFreeCam[1]!, debugFreeCam[2]!); c.rotation.set(debugFreeCam[4]!, debugFreeCam[3]!, 0, 'YXZ'); c.updateMatrixWorld(true); } // QA only (__slope.view.freeCam)
  const hf = horizonFraction(pose.pitch, renderer.rig.fov);
  if (Math.abs(hf - rideHorizon) > 0.004) { rideHorizon = hf; lighting.horizonAt = hf; lighting.refreshSky(); }
  const now = performance.now();
  if (now >= rideHudAt && viewHudEl) {
    rideHudAt = now + 120;
    const info = rideAlong.info(), alt = altitudeMetres(rideSample.y);
    if (info.kind === 'gondola' && info.id !== gondolaNoted) { gondolaNoted = info.id; ach.note('rideGondola'); }
    viewHudEl.render({
      title: `Guest #${info.id}`, activity: rideActivityLabel(info.kind, info.state), kmh: info.kmh, altitude: alt,
      speed: loop.paused ? 'Paused' : `${SPEED_MULTIPLIERS[loop.speed]}x${rideSlowMo && rideFactor < 0.97 ? ' slow-mo' : ''}`, interior: info.kind === 'gondola' || info.kind === 'cablecar' || info.kind === 'funicular',
    });
  }
};
{ // drag-look surface = the canvas itself; wheel = FOV. Capture phase so the tools / iso camera never see these events while riding.
  const dom = renderer.webgl.domElement;
  let drag: { id: number; x: number; y: number } | null = null;
  const LOOK_RAD_PER_PX = 0.005;
  const onDown = (e: PointerEvent): void => {
    if (renderer.viewMode.mode !== 'ride' || e.target !== dom) return;
    e.stopPropagation();
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { dom.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  };
  const onMove = (e: PointerEvent): void => {
    if (renderer.viewMode.mode !== 'ride') { drag = null; return; }
    if (e.target === dom) e.stopPropagation();
    if (!drag || e.pointerId !== drag.id) return;
    renderer.rig.look(-(e.clientX - drag.x) * LOOK_RAD_PER_PX, -(e.clientY - drag.y) * LOOK_RAD_PER_PX);
    drag.x = e.clientX; drag.y = e.clientY;
  };
  const onUp = (e: PointerEvent): void => { if (drag && e.pointerId === drag.id) drag = null; if (renderer.viewMode.mode === 'ride' && e.target === dom) e.stopPropagation(); };
  const onWheel = (e: WheelEvent): void => {
    if (renderer.viewMode.mode !== 'ride' || e.target !== dom) return;
    e.preventDefault(); e.stopPropagation();
    renderer.rig.addFov(e.deltaY * 0.02);
  };
  const onClick = (e: Event): void => { if (renderer.viewMode.mode === 'ride' && e.target === dom) e.stopPropagation(); };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  for (const t of ['click', 'dblclick', 'contextmenu', 'mousedown', 'mouseup']) window.addEventListener(t, onClick, true);
}
// ---- Achievements (M5.3 Task 16): the engine lives in the sim (pure observer); this wires the profile, quiet toasts, render counters and cosmetics ----
const ach = sim.achievements;
const tutorialBusy = (): boolean => { const st = tutorialRef?.engine.view().status; return TUTORIAL_MODE && (!st || st === 'active' || st === 'blocked') || st === 'active' || st === 'blocked'; };
// ---- Fast-forward ('Skip to...'): the main loop runs sim ticks in time-budget batches (src/core/FastForward.ts); drawing drops to ~10 fps with impostor guests, fx / ambience / music off ----
const FF_DRAW_EVERY = 6;
const ffBlocked = (): string | null => {
  if (DEMO) return 'Not available on the title screen';
  if (tutorialBusy()) return 'Not available during the tutorial';
  if (renderer.viewMode.mode !== 'iso' || drop.active) return 'Not available in ride-along, walk or photo mode';
  if (sim.finance.ended) return 'The game is over';
  if (modalStack.dialogs > 0) return 'Close the open dialog first';
  return null;
};
const ff = new FastForward({ now: () => performance.now(), step: () => { loop.stepOnce(); }, date: () => game.date, blocked: ffBlocked, hidden: () => document.hidden });
for (const name of GAME_EVENT_NAMES) (bus as unknown as { on(n: string, f: (p: never) => void): void }).on(name, ((p: never) => ff.notify(name, p)) as (p: never) => void);
let ffFrames = 0;
ff.onStart(() => {
  ffFrames = 0; audioRef?.settings.setDucked(true); fx.suspend(true); saves?.holdAutosave(true);
});
ff.onStop((st) => {
  audioRef?.settings.setDucked(false); fx.suspend(false); saves?.holdAutosave(false); lastHour = -1;
  const days = Math.round(st.days);
  if (st.reason === 'cancel') toast(`Fast-forward cancelled after ${days} day${days === 1 ? '' : 's'}`, 'info');
  else if (st.reason === 'target') toast(`Skipped ${days} day${days === 1 ? '' : 's'} to the ${FF_LABELS[st.kind].replace('Next ', 'start of the next ')}`.replace('start of the next event', 'next event'), 'info');
  else if (st.reason === 'event') toast(`Fast-forward stopped: ${st.detail}`, 'warn');
  else toast(st.detail ? `${FF_STOP_TEXT[st.reason]}: ${st.detail}` : FF_STOP_TEXT[st.reason], 'warn');
});
renderer.preSim = (): boolean => { if (!ff.active) { ffFrames = 0; return false; } ff.frame(); if (!ff.active) return false; return ++ffFrames % FF_DRAW_EVERY !== 0; };
const startFf = (kind: FfKind): void => { const r = ff.start(kind); if (!r.ok) toast(r.reason, 'warn'); };
// Esc / Space / any click cancels (and is swallowed for keys so Space does not also toggle pause and Esc does not open the pause menu)
window.addEventListener('keydown', (e) => {
  if (!ff.active || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape' || e.key === ' ') { e.stopImmediatePropagation(); e.preventDefault(); ff.cancel(); }
}, true);
window.addEventListener('pointerdown', () => { if (ff.active) ff.cancel(); }, true);
const achAnnouncer = new AchievementAnnouncer({
  show: (d) => { toastRef?.show(`Achievement unlocked: ${d.title}`, 'info', 5000, { key: `ach:${d.id}`, category: 'achievement', icon: d.icon, ttlMs: 5000 }); audioRef?.sfx.play('chimeImportant', { gain: 0.35 }); },
  confetti: () => { fx.milestone(true); }, // the feedback policy still decides (Off / reduced motion: no confetti)
  hold: () => DEMO || tutorialBusy() || !!sim.finance.ended,
  now: () => performance.now(),
});
ach.onUnlock((d) => achAnnouncer.push(d));
window.setInterval(() => achAnnouncer.pump(), 1000);
// Anonymous opt-in analytics: one observer-only subscriber (never the title demo). Reads events, writes nothing into the sim (stateHash unchanged).
if (!DEMO) {
  const a = analytics(), once = onceTracker(a);
  a.track(bootSave ? 'game_load' : 'game_start', { mode: sim.progression.mode, size: MAP_SIZE, ...(bootSave ? {} : { scenario: SCEN?.id ?? 'none', difficulty: CFG.difficulty, season: START_SEASON, tutorial: TUTORIAL_MODE ? 'yes' : 'no' }) });
  attachGameplayAnalytics(bus, a, { stars: () => sim.rating.stars });
  ach.onUnlock((d) => { a.track('achievement', { id: d.id }); });
  renderer.viewMode.onChange((to) => { if (to === 'ride' || to === 'walk' || to === 'photo') once('view_mode_used', { mode: to }); });
  startHeartbeat(a, { visible: () => document.visibilityState === 'visible', setInterval: (f, ms) => window.setInterval(f, ms), clearInterval: (h) => window.clearInterval(h as number) });
}
const applyCosmetics = (): void => {
  buildingMeshes.setPalette(COSMETIC_BY_ID[ach.selected('palette')]?.palette ?? null);
  villageDecor.setFlags(COSMETIC_BY_ID[ach.selected('flags')]?.flags?.colors ?? []);
  const chair = ach.selected('chair');
  liftTools?.view.setChairColor(chair === defaultCosmetic('chair').id ? null : (COSMETIC_BY_ID[chair]?.chair?.body ?? null));
};
ach.onCosmetics(applyCosmetics);
if (!DEMO) {
  const store = profileStore();
  ach.onPersist((d) => { void store.update((p) => { p.achievements = JSON.parse(JSON.stringify(d)) as typeof p.achievements; }); });
  void store.ready.then(() => { ach.loadProfile(store.getProfile().achievements); ach.arm(); applyCosmetics(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') ach.flush(); });
  window.addEventListener('pagehide', () => ach.flush());
}
const achCosmetics = cosmeticsApiFromEngine(ach);
const frameLock = (id: string): string | null => { const c = COSMETIC_BY_ID[`frame:${id}`]; return c && !c.default && !ach.owns(c.id) ? `Unlock: ${cosmeticUnlockedBy(c.id)?.title ?? 'an achievement'}` : null; };
let walkAcc = 0;
let gondolaNoted = 0;
// ---- Photo mode (M5.2): free orbit camera, render-only look controls, local PNG export + gallery. Never touches the sim (stateHash is unchanged) ----
let photoEl: StPhoto | null = null;
const photoStore = PhotoStore.available() ? new PhotoStore() : null;
const photoGround = (x: number, z: number): number => surfaceHeight(grid, x, z);
/** Viewpoint buildings as photo-mode spots (Phase 6 Task 6): centre + the direction the ground falls away (docs/viewpoints.md). */
const viewpointSpots = (): Array<{ x: number; z: number; look: number; reach: number }> => {
  const out: Array<{ x: number; z: number; look: number; reach: number }> = [];
  const alt = (x: number, y: number): number => surfaceHeight(grid, x + 0.5, y + 0.5);
  for (const b of buildings.all()) {
    const vp = BUILDINGS[b.type]?.viewpoint;
    if (!vp || vp.photo === false || !b.active) continue;
    const cx = Math.floor(b.x + b.w / 2), cy = Math.floor(b.y + b.h / 2);
    out.push({ x: b.x + b.w / 2, z: b.y + b.h / 2, look: openDirection(alt, grid.size, cx, cy, vp.radius), reach: Math.max(b.w, b.h) / 2 + 0.8 });
  }
  return out;
};
const photoSample: RideSample = { x: 0, y: 0, z: 0, hx: 0, hz: 0, speed: 0, slope: 0, kind: 'foot' };
const photo = new PhotoMode({
  renderer, lighting, ground: photoGround, mapSize: MAP_SIZE,
  resortName: () => `Resort Year ${game.date.year}`,
  heroFocus: () => { const lodge = buildings.all().find((b) => b.type === 'baseLodge'), a = terrainInfo.villageAnchor; return lodge ? { x: lodge.x + lodge.w / 2, z: lodge.y + lodge.h / 2 } : { x: a.x, z: a.y }; },
  followTarget: () => (rideAlong.active && rideAlong.sample(1, photoSample) ? photoSample : null),
  spots: () => viewpointSpots(),
});
const photoHour = new HourOverride(() => timeOverride, (h) => { timeOverride = h; lastHour = -1; });
const photoPrev = { from: 'iso' as 'iso' | 'ride' | 'walk', overlay: 'off' as OverlayMode, grid: false, pausedBy: false, speed: 1 as 0 | 1 | 2 | 3 };
const canvasBox = (): HTMLElement | null => renderer.webgl.domElement.parentElement;
{
  const st = document.createElement('style');
  st.textContent = 'body.view-photo #ui > :not(st-photo):not(st-toast):not(st-touch-controls){display:none !important}body.view-photo st-toast{transform:scale(.8);transform-origin:top center;opacity:.92}body.view-photo #app canvas{cursor:grab}';
  document.head.appendChild(st);
}
/** Pushes the current photo settings into the render-only state: hour override, precipitation visibility, live filter, optional pause. */
const applyPhotoSettings = (): void => {
  const s = photo.settings;
  photoHour.apply(s.hour);
  precip.group.visible = photo.active ? s.precip : true;
  const box = canvasBox();
  if (box) box.style.filter = photo.active ? filterCss(s.filter) : '';
  if (photo.active) {
    if (s.pauseGame && !loop.paused) { photoPrev.pausedBy = true; photoPrev.speed = loop.speed as typeof photoPrev.speed; loop.setSpeed(0); }
    else if (!s.pauseGame && photoPrev.pausedBy && loop.paused) { photoPrev.pausedBy = false; loop.setSpeed(photoPrev.speed || 1); }
  }
};
const enterPhoto = (): boolean => {
  if (DEMO || photo.active || sim.finance.ended) return false;
  const from = renderer.viewMode.mode;
  if ((from !== 'iso' && from !== 'ride' && from !== 'walk') || !renderer.viewMode.can('photo')) return false;
  photo.begin(from);
  renderer.enterGround('photo');
  photoPrev.from = from; photoPrev.pausedBy = false;
  if (from === 'iso') {
    tools.reset();
    photoPrev.overlay = overlayMode; photoPrev.grid = terrain.gridOverlay;
    setOverlay('off'); terrain.gridOverlay = false;
    pisteHl.mesh.visible = false; selRing.visible = false; smoke.group.visible = false; snowSpray.group.visible = false;
  } else { document.body.classList.remove('view-ride'); document.body.classList.remove('view-walk'); walkInput.setActive(false); }
  photoHour.begin();
  { const f = ach.selected('frame').slice('frame:'.length); photo.settings = sanitizeSettings(photo.settings, { hour: null, ...(f !== 'none' && !frameLock(f) ? { frame: f as import('@/render/view/postfx').FrameId } : {}) }); }
  document.body.classList.add('view-photo');
  applyPhotoSettings();
  photoEl?.open();
  return true;
};
const exitPhoto = (): void => {
  if (!photo.active) return;
  const from = photoPrev.from;
  photo.end();
  photoHour.end();
  precip.group.visible = true;
  const box = canvasBox(); if (box) box.style.filter = '';
  if (photoPrev.pausedBy && loop.paused) loop.setSpeed(photoPrev.speed || 1);
  photoPrev.pausedBy = false;
  document.body.classList.remove('view-photo');
  photoEl?.close();
  lighting.horizonAt = null; rideHorizon = -1;
  if (from === 'walk') {
    renderer.enterGround('walk'); // photo returns to the walker (same spot, same view)
    document.body.classList.add('view-walk'); walkInput.setActive(true); walkHudAt = 0;
    renderer.rig.motion = getReducedMotion() ? 0 : 1;
  } else if (from === 'ride') {
    renderer.enterGround('ride');
    if (rideAlong.check()) { document.body.classList.add('view-ride'); rideHudAt = 0; renderer.rig.motion = getReducedMotion() ? 0 : 1; renderer.rig.recentre(); }
    else { const gone = rideAlong.targetId; exitRide(); toast(`Guest #${gone} left: ride-along ended.`, 'info'); }
  } else {
    renderer.exitToIso();
    setOverlay(photoPrev.overlay); terrain.gridOverlay = photoPrev.grid;
    pisteHl.mesh.visible = true; smoke.group.visible = true; snowSpray.group.visible = true; terrain.setNearFocus(null);
    lighting.refreshSky();
  }
};
let photoClockAt = 0;
const photoFrame = (dt: number): void => {
  const pose = photo.update(dt);
  const hf = photo.horizon();
  if (Math.abs(hf - rideHorizon) > 0.004) { rideHorizon = hf; lighting.horizonAt = hf; lighting.refreshSky(); }
  void pose;
  const now = performance.now();
  if (now >= photoClockAt) { photoClockAt = now + 250; photoEl?.tickClock(); photoEl?.refreshFollow(); }
};
const savePhoto = async (): Promise<void> => {
  const res = await photo.capture();
  const name = photo.fileName();
  downloadBlob(res.png, name);
  audioRef?.sfx.play('shutter');
  ach.note('photos');
  toast('Photo saved');
  photoEl?.say(`Saved ${name} (${res.w}×${res.h}${res.clamped ? ', size limited by this device' : ''})`);
  if (!photoStore) return;
  try {
    const [png, thumb] = await Promise.all([res.png.arrayBuffer(), res.thumb.arrayBuffer()]);
    await photoStore.add({ resort: `Resort Year ${game.date.year}`, w: res.w, h: res.h, filter: photo.settings.filter, frame: photo.settings.frame, thumb: new Uint8Array(thumb), thumbType: 'image/jpeg' }, new Uint8Array(png));
  } catch (e) { photoEl?.say(`Saved to your device; the gallery could not store it (${(e as Error).message})`); }
};
const photoGallery = {
  available: !!photoStore,
  list: async () => (photoStore ? photoStore.list() : []),
  saveAgain: async (id: number): Promise<void> => {
    const bytes = photoStore ? await photoStore.getPng(id) : null, m = photoStore ? (await photoStore.list()).find((x) => x.id === id) : undefined;
    if (bytes && m) downloadBlob(new Blob([bytes as BlobPart], { type: 'image/png' }), photo.fileName(new Date(m.createdAt)));
  },
  full: async (id: number): Promise<string | null> => { const b = photoStore ? await photoStore.getPng(id) : null; return b ? URL.createObjectURL(new Blob([b as BlobPart], { type: 'image/png' })) : null; },
  remove: async (id: number): Promise<void> => { await photoStore?.delete(id); },
  clear: async (): Promise<void> => { await photoStore?.clear(); },
};
photo.attach(window, renderer.webgl.domElement);
// Photo keys (capture phase, BEFORE the ride-along handler and the pause-menu handler): Esc / P exit, P enters from a ride, Enter saves, WASD / QE move the focus;
// every other non-time key is swallowed so tools / overlays never react while the UI is hidden.
window.addEventListener('keydown', (e) => {
  if (DEMO) return;
  const mode = renderer.viewMode.mode, k = e.key.toLowerCase(), mods = e.ctrlKey || e.metaKey || e.altKey;
  const t = e.target as HTMLElement | null;
  if (mode === 'ride' && k === 'p' && !mods) { e.stopImmediatePropagation(); e.preventDefault(); enterPhoto(); return; }
  if (mode !== 'photo') return;
  const inPanel = !!t && t.tagName === 'ST-PHOTO', inner = (photoEl?.shadowRoot?.activeElement as HTMLElement | null) ?? null;
  if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); if (!photoEl?.escape()) exitPhoto(); return; }
  if (k === 'p' && !mods) { e.stopImmediatePropagation(); e.preventDefault(); exitPhoto(); return; }
  if (e.key === 'Enter' && !mods) { e.stopPropagation(); if (!(inPanel && inner && inner.tagName === 'BUTTON')) { e.preventDefault(); photoEl?.saveNow(); } return; }
  if (inPanel && inner && inner.tagName === 'INPUT' && (inner as HTMLInputElement).type === 'range' && e.key.startsWith('Arrow')) { e.stopPropagation(); return; } // arrows adjust the focused slider
  if (photo.keyDown(e)) { e.stopPropagation(); e.preventDefault(); return; }
  if (mods || /^F\d+$/.test(e.key) || speedKeyAction(e) || e.key === 'Tab' || e.key === ' ' && inPanel && inner?.tagName === 'BUTTON') return;
  e.stopPropagation();
}, true);
// ---- Walk mode (Task 12): first-person on foot. READS the sim only (grid, networks, props, buildings, lifts, guests, animals); the walker is not a sim guest and is never saved ----
const WALK_STORAGE = (() => { try { return window.localStorage; } catch { return null; } })();
let walkSettings: WalkSettings = loadWalkSettings(WALK_STORAGE);
const walkWorld = buildWalkWorld(grid, networks, props, (x, z) => surfaceHeightAt(grid, x, z), allDecorItems);
const walkPaths = new Map<number, { nodes: unknown; path: CablePath }>();
let walkRng = 0x9e3779b9; // render-only RNG (footstep pitch jitter): never touches the sim RNG
const walkRand = (): number => { walkRng = (Math.imul(walkRng, 1664525) + 1013904223) >>> 0; return walkRng / 4294967296; };
let walkHudAt = 0, walkHorizon = -1;
const walk: WalkMode = new WalkMode({
  world: walkWorld, rig: renderer.rig, grid, nets: networks,
  buildings: () => buildings.all().map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, label: sim.names.buildingName(b.id) })),
  lifts: () => lifts.all().filter((l) => LIFTS[l.kind]).map((l) => {
    let c = walkPaths.get(l.id);
    if (!c || c.nodes !== l.nodes) { c = { nodes: l.nodes, path: liftPath(l) }; walkPaths.set(l.id, c); }
    return { ...l, open: l.open && l.condOpen !== false, name: sim.names.liftName(l.id), rideTimeS: liftStats(l).rideTimeS, reason: l.opsClosed ? l.opsReason : l.closedReason, closedReason: (l.opsClosed ? l.opsReason : l.closedReason) ?? undefined, path: c.path, family: LIFTS[l.kind]!.family };
  }),
  nearbyPeople: (x, z, r) => {
    const out: Array<{ id: number; x: number; z: number; label: string; kind: 'guest' | 'animal' }> = [];
    const st = guestSim.store, a = loop.paused || loop.isHidden ? 1 : loop.alpha;
    for (let i = 0; i < st.limit; i++) {
      if (!st.alive[i]) continue;
      const gx = st.px[i]! + (st.x[i]! - st.px[i]!) * a, gz = st.py[i]! + (st.y[i]! - st.py[i]!) * a;
      if (Math.abs(gx - x) < r && Math.abs(gz - z) < r) out.push({ id: st.id[i]!, x: gx, z: gz, label: `Guest #${st.id[i]}`, kind: 'guest' });
    }
    for (const an of [...sim.nature.fauna.animals, ...sim.nature.livestock.animals]) if (!an.hidden && Math.abs(an.x - x) < r && Math.abs(an.y - z) < r) out.push({ id: an.id, x: an.x, z: an.y, label: an.species, kind: 'animal' });
    return out;
  },
  info: (kind, id) => {
    if (kind === 'building') {
      const b = buildings.get(id);
      if (!b) return null;
      const cs = openStatusRef?.buildingStatus(id);
      return { title: sim.names.buildingName(id), lines: [b.active ? 'Status: active' : `Status: inactive — ${sentence(b.reason ?? 'unknown')}`, ...(cs ? [cs.open ? 'Conditions: open' : (cs.reason ?? 'Closed')] : [])] };
    }
    if (kind === 'guest') {
      const slot = guestSim.store.slotOf(id), m = slot >= 0 ? guestInspectorModel(guestSim.store, slot, { ctx: { queueTicks: 0, onIcyPiste: false, noKidsVenue: false, crowded: false, sawBear: false } }) : null;
      return m ? { title: m.title, lines: [`${m.type} · ${m.skill}`, m.activity, ...(m.thoughts[0] ? [`“${m.thoughts[0]}”`] : [])] } : null;
    }
    if (kind === 'animal') return { title: 'Animal', lines: ['Best admired from a distance.'] };
    return null;
  },
  describe: (x, z) => { const p = sim.names.describeLocation(Math.floor(x), Math.floor(z)); return p.near.charAt(0).toUpperCase() + p.near.slice(1); },
  footstep: (surf, speed) => {
    const name = ({ snow: 'stepSnow', gravel: 'stepGravel', grass: 'stepGrass', wood: 'stepWood', road: 'stepRoad' } as const)[surf];
    audioRef?.sfx.play(name, { pitch: 0.88 + walkRand() * 0.26, gain: speed > 2.4 ? 1.2 : 1, pan: (walkRand() - 0.5) * 0.12 });
  },
  motion: () => (getReducedMotion() ? 0 : 1),
  toast: (m) => toast(m, 'info'),
});
walk.settings = walkSettings;
const walkInput: WalkInputHandler = new WalkInputHandler({
  onLook: (dy, dp) => walk.look(dy, dp),
  onInteract: () => { walk.interact(); walkHudAt = 0; },
  onExit: () => exitWalk(),
  onPhoto: () => { enterPhoto(); },
});
walk.inputFn = () => walkInput.input();
walkInput.attach(window, renderer.webgl.domElement);
const applyWalkSettings = (p: Partial<WalkSettings>): void => {
  walkSettings = sanitizeWalkSettings({ ...walkSettings, ...p });
  walk.settings = walkSettings; walkInput.sensitivity = walkSettings.sensitivity; walkInput.runToggle = walkSettings.runToggle;
  saveWalkSettings(WALK_STORAGE, walkSettings);
};
applyWalkSettings({});
const walkSaved = { overlay: 'off' as OverlayMode, grid: false };
{
  const st = document.createElement('style');
  st.textContent = 'body.view-walk #ui > :not(st-view-hud):not(st-toast):not(st-touch-controls){display:none !important}body.view-walk st-toast{transform:scale(.8);transform-origin:top center;opacity:.92}body.view-walk #app canvas{cursor:grab}body.view-walk.walk-dragging #app canvas{cursor:none}body.walk-drop #app canvas{cursor:none}';
  document.head.appendChild(st);
}
/** Where the iso camera looks (horizontal unit vector, world x/z): the walker faces the same way after entering. */
const isoViewDir = (): { x: number; z: number } => {
  const d = renderer.controls.camera.getWorldDirection(new THREE.Vector3());
  const l = Math.hypot(d.x, d.z) || 1;
  return { x: d.x / l, z: d.z / l };
};
/** Start walking. No `at`: the default entry = the nearest PATH tile to the view centre (never forest / blocked), facing along the path / at the nearest building. `at.buildingId` = in front of that building; `at.x/z` = that spot (moved to the nearest free one). */
const defaultStart = () => {
  const lodge = buildings.all().find((q) => q.type === 'baseLodge');
  const dir = isoViewDir();
  return chooseStart(walkWorld, {
    focus: { x: renderer.controls.target.x, z: renderer.controls.target.z }, netKind: networks.kind,
    lodge: lodge ? { x: lodge.x, y: lodge.y, w: lodge.w, h: lodge.h } : null, buildings: buildings.all().map((q) => ({ x: q.x, y: q.y, w: q.w, h: q.h })),
    centre: { x: terrainInfo.villageAnchor.x, z: terrainInfo.villageAnchor.y }, fallbackYaw: yawOfHeading(dir.x, dir.z),
  });
};
const enterWalk = (at?: { x: number; z: number; buildingId?: number; yaw?: number; pitch?: number }): boolean => {
  if (DEMO || sim.finance.ended || renderer.viewMode.mode === 'walk') return false;
  const from = renderer.viewMode.mode;
  if (from !== 'iso' || !renderer.viewMode.can('walk')) return false;
  const dir = isoViewDir();
  let yaw = at?.yaw ?? yawOfHeading(dir.x, dir.z), x: number, z: number;
  const b = at?.buildingId ? buildings.get(at.buildingId) : undefined;
  walkWorld.refresh();
  if (b) { // stand in front of the building (looking at it): back off along the view direction
    const ext = Math.max(b.w, b.h) / 2 + 1.6;
    x = b.x + b.w / 2 - dir.x * ext; z = b.y + b.h / 2 - dir.z * ext;
  } else if (at) { x = at.x; z = at.z; } else { const st = defaultStart(); x = st.x; z = st.z; yaw = st.yaw; }
  x = Math.min(grid.size - 1, Math.max(1, x)); z = Math.min(grid.size - 1, Math.max(1, z));
  if (!walk.begin(x, z, yaw)) { toast('No room to stand there', 'warn'); return false; }
  if (at?.pitch !== undefined) walk.state.pitch = at.pitch;
  tools.reset();
  renderer.enterGround('walk');
  walkSaved.overlay = overlayMode; walkSaved.grid = terrain.gridOverlay;
  setOverlay('off'); terrain.gridOverlay = false;
  pisteHl.mesh.visible = false; selRing.visible = false;
  renderer.rig.motion = getReducedMotion() ? 0 : 1; renderer.rig.recentre();
  document.body.classList.add('view-walk');
  walkInput.sensitivity = walkSettings.sensitivity; walkInput.runToggle = walkSettings.runToggle; walkInput.mouseLook = walkSettings.mouseLook;
  walkInput.setActive(true);
  walkHudAt = 0; walkHorizon = -1;
  return true;
};
const exitWalk = (): void => {
  if (renderer.viewMode.mode !== 'walk') return;
  walkInput.setActive(false);
  walk.end();
  renderer.exitToIso(); // restores the exact iso pose saved on entry
  document.body.classList.remove('view-walk');
  lighting.horizonAt = null; lighting.refreshSky(); walkHorizon = -1;
  setOverlay(walkSaved.overlay); terrain.gridOverlay = walkSaved.grid;
  pisteHl.mesh.visible = true; terrain.setNearFocus(null);
  viewHudEl?.renderWalk(null);
};
// ---- Walk 'choose start' (Street-View style drop): a pegman cursor + a ring draped on the terrain (green = walkable, red = blocked, snaps to the nearest free tile) ----
const dropMarker = new WalkDropMarker(); dropMarker.mount(document.body);
const dropRing = new DropRing((x, z) => surfaceHeight(grid, x, z));
renderer.scene.add(dropRing.group);
const drop = { active: false, drag: false, back: null as { x: number; z: number; yaw: number; pitch: number } | null, res: null as DropResult | null, tile: null as { x: number; y: number } | null, px: 0, py: 0, last: 0 };
const dropRay = new THREE.Raycaster();
const dropPick = (cx: number, cy: number) => {
  const dom = renderer.webgl.domElement, r = dom.getBoundingClientRect();
  if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
  dropRay.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), renderer.controls.camera);
  return pickHeightfield(grid, dropRay.ray.origin, dropRay.ray.direction);
};
/** Is the client point over the map (the canvas, or the empty #ui / #app layer above it) and not over a panel? */
const overMap = (cx: number, cy: number): boolean => {
  const el = document.elementFromPoint(cx, cy);
  return !!el && (el === renderer.webgl.domElement || el.id === 'ui' || el.id === 'app' || el === document.body || el === document.documentElement);
};
/** Update the marker / ring for a client point. Returns true when a drop there is possible. */
const dropPreview = (cx: number, cy: number): boolean => {
  drop.px = cx; drop.py = cy;
  const p = drop.active && overMap(cx, cy) ? dropPick(cx, cy) : null;
  if (!p) { dropRing.hide(); drop.res = null; drop.tile = null; dropMarker.move(cx, cy, true, DROP_HINT); return false; }
  walkWorld.refresh();
  const res = resolveDrop(walkWorld, p.tileX + 0.5, p.tileY + 0.5);
  drop.res = res; drop.tile = { x: p.tileX, y: p.tileY };
  dropRing.set(p.tileX, p.tileY, res.ok, res.snapped ? { x: res.x, z: res.z } : null);
  dropMarker.move(cx, cy, res.ok, res.ok ? 'Click to drop in here' : res.valid ? 'Blocked: you will drop at the nearest free spot' : 'No room here');
  return res.valid;
};
const dropEnd = (): void => {
  drop.active = false; drop.drag = false; drop.res = null; drop.tile = null;
  document.body.classList.remove('walk-drop'); dropRing.hide(); dropMarker.hide();
};
/** Open 'choose start' mode (Shift+V, the Walk button, T while walking: bird's-eye drop). From walking it returns to the iso view centred on the walker first; Esc then goes back to the walker. */
const startDrop = (opts: { drag?: boolean } = {}): boolean => {
  if (DEMO || sim.finance.ended || drop.active) return false;
  if (renderer.viewMode.mode === 'walk') {
    const s = walk.state; drop.back = { x: s.x, z: s.z, yaw: s.yaw, pitch: s.pitch };
    exitWalk(); renderer.controls.focusOn(s.x, s.z, { duration: 0.35 });
  }
  if (renderer.viewMode.mode !== 'iso' || !renderer.viewMode.can('walk')) { drop.back = null; return false; }
  tools.reset();
  drop.active = true; drop.drag = !!opts.drag;
  document.body.classList.add('walk-drop');
  dropMarker.show(); dropMarker.move(drop.px || window.innerWidth / 2, drop.py || window.innerHeight / 2, true, DROP_HINT);
  return true;
};
const cancelDrop = (): void => {
  if (!drop.active) return;
  const back = drop.back; drop.back = null; dropEnd();
  if (back) enterWalk({ x: back.x, z: back.z, yaw: back.yaw, pitch: back.pitch });
};
/** Drop in at the previewed tile (`dflt` or nothing previewed: the default path spot). Facing: the previous iso view direction (teleport: the old heading). */
const confirmDrop = (dflt = false): boolean => {
  if (!drop.active) return false;
  const res = dflt ? null : drop.res;
  if (!dflt && !res?.valid) { toast('Pick a spot on the map', 'info'); return false; }
  const back = drop.back; drop.back = null; dropEnd();
  const dir = isoViewDir();
  const ok = res ? enterWalk({ x: res.x, z: res.z, yaw: back ? back.yaw : yawOfHeading(dir.x, dir.z) }) : enterWalk();
  if (ok && res && !res.ok) toast('Dropped at the nearest free spot', 'info');
  return ok;
};
window.addEventListener('pointermove', (e) => {
  if (!drop.active || drop.drag) return;
  const now = performance.now(); drop.px = e.clientX; drop.py = e.clientY;
  dropMarker.move(e.clientX, e.clientY, drop.res ? drop.res.ok : true);
  if (now - drop.last < 20) return; drop.last = now;
  dropPreview(e.clientX, e.clientY);
}, true);
for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) window.addEventListener(t, (e) => {
  if (!drop.active || drop.drag || e.target !== renderer.webgl.domElement || (e as MouseEvent).button !== 0 || (e as MouseEvent).altKey) return;
  e.stopPropagation();
  if (t === 'click') { dropPreview((e as MouseEvent).clientX, (e as MouseEvent).clientY); confirmDrop(); }
}, true);
window.addEventListener('keydown', (e) => {
  if (!drop.active || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') { e.stopImmediatePropagation(); e.preventDefault(); cancelDrop(); } else if (k === 'enter' || k === 'v') { e.stopImmediatePropagation(); e.preventDefault(); confirmDrop(true); }
}, true);
const dropDrag = {
  begin: (): void => { startDrop({ drag: true }); },
  move: (x: number, y: number): void => { if (drop.active) dropPreview(x, y); },
  end: (x: number, y: number): void => {
    if (!drop.active) return;
    if (overMap(x, y) && dropPreview(x, y)) { drop.drag = false; confirmDrop(); } else cancelDrop();
  },
  cancel: (): void => { cancelDrop(); },
};
const walkFrame = (dt: number): void => {
  if (sim.finance.ended) { exitWalk(); return; }
  walk.update(dt);
  if (!walk.riding && walk.state.grounded) { walkAcc += walk.state.speed * dt * TILE_METRES; if (walkAcc >= 20) { ach.note('walkM', walkAcc); walkAcc = 0; } } // render-only counter: never counted headless
  const pose = renderer.rig.pose;
  const hf = horizonFraction(pose.pitch, renderer.rig.fov);
  if (Math.abs(hf - walkHorizon) > 0.004) { walkHorizon = hf; lighting.horizonAt = hf; lighting.refreshSky(); }
  const now = performance.now();
  if (now >= walkHudAt && viewHudEl) {
    walkHudAt = now + 120;
    viewHudEl.renderWalk({
      location: walk.location || 'On foot', altitude: altitudeMetres(walk.eyeHeightY), compass: compassPoint(pose.yaw), prompt: walk.prompt, card: walk.card,
      riding: walk.riding ? { name: walk.rideName, progress: walk.rideProgress } : undefined,
      speed: loop.paused ? 'Paused' : `${SPEED_MULTIPLIERS[loop.speed]}x`,
      hint: touchWire.enabled() ? 'Left stick: walk · drag the view: look · E: interact' : `E interact · Shift run · Space jump · T teleport · P photo · Esc exit · ${mouseHint(walkSettings.mouseLook)}`,
    });
  }
};
// Walk keys that must not leak to the tools / overlays / help (the WalkInputHandler above consumes W A S D arrows Shift Space E P Esc): V exits, time keys (+ - . ,) pass.
window.addEventListener('keydown', (e) => {
  if (renderer.viewMode.mode !== 'walk') return;
  const k = e.key.toLowerCase();
  if (k === 'v' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.stopImmediatePropagation(); e.preventDefault(); exitWalk(); return; }
  if (k === 't' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) { e.stopImmediatePropagation(); e.preventDefault(); startDrop(); return; } // teleport: bird's-eye drop
  if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key) || speedKeyAction(e)) return;
  e.stopPropagation();
}, true);
for (const t of ['click', 'dblclick', 'contextmenu', 'mousedown', 'mouseup']) window.addEventListener(t, (e) => { if (renderer.viewMode.mode === 'walk' && e.target === renderer.webgl.domElement) e.stopPropagation(); }, true);
window.addEventListener('wheel', (e) => { if (renderer.viewMode.mode === 'walk' && e.target === renderer.webgl.domElement) { e.preventDefault(); e.stopPropagation(); } }, { capture: true, passive: false });
const walkApi = {
  get active() { return renderer.viewMode.mode === 'walk'; },
  mode: walk,
  enter: (x?: number, z?: number, yaw?: number): boolean => {
    const ok = enterWalk(x === undefined ? undefined : { x, z: z! });
    if (ok && yaw !== undefined) { walk.state.yaw = yaw; walk.state.pitch = 0; }
    return ok;
  },
  exit: (): void => exitWalk(),
  /** Default entry (nearest path tile to the view centre) or a street-view drop at tile (x, z). */
  start: (x?: number, z?: number): boolean => { if (x === undefined) return enterWalk(); const r = resolveDrop(walkWorld, Math.floor(x) + 0.5, Math.floor(z!) + 0.5); return r.valid ? enterWalk({ x: r.x, z: r.z }) : false; },
  /** Choose-start mode (harness: preview the marker at client px). */
  startDrop: (): boolean => startDrop(), cancelDrop: (): void => cancelDrop(), dropPreview: (cx: number, cy: number): boolean => dropPreview(cx, cy),
  get dropping() { return drop.active; },
  /** Harness: put the drop cursor over tile (tx, ty) (projects it to client px and previews). Returns the preview + client px. */
  dropAtTile: (tx: number, ty: number): { ok: boolean; valid: boolean; x: number; y: number; snapped: boolean } | null => {
    if (!drop.active && !startDrop()) return null;
    const cam = renderer.controls.camera, dom = renderer.webgl.domElement, r = dom.getBoundingClientRect();
    const v = new THREE.Vector3(tx + 0.5, surfaceHeight(grid, tx + 0.5, ty + 0.5), ty + 0.5).project(cam);
    const x = r.left + ((v.x + 1) / 2) * r.width, y = r.top + ((1 - v.y) / 2) * r.height;
    dropPreview(x, y);
    return { ok: !!drop.res?.ok, valid: !!drop.res?.valid, x, y, snapped: !!drop.res?.snapped };
  },
  defaultStart: () => defaultStart(),
  /** Headless harness: drive the pure walker with synthetic input for `seconds` (fixed 1/60 s steps), then render. */
  script: (steps: Array<{ keys?: string; seconds: number; yaw?: number; pitch?: number; run?: boolean; interact?: boolean }>): void => {
    const held = new Set<string>();
    const prev = walk.inputFn;
    for (const st of steps) {
      if (st.yaw !== undefined) walk.state.yaw += (st.yaw * Math.PI) / 180;
      if (st.pitch !== undefined) walk.state.pitch = Math.max(-1.4, Math.min(1.4, walk.state.pitch + (st.pitch * Math.PI) / 180));
      held.clear(); for (const k of st.keys ?? '') held.add(k);
      if (st.run) held.add('shift');
      walk.inputFn = () => ({ fwd: (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0), strafe: (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0), run: held.has('shift'), jump: false });
      for (let t = 0; t < st.seconds; t += 1 / 60) walk.update(1 / 60);
      if (st.interact) walk.interact();
    }
    walk.inputFn = prev; walkHudAt = 0;
  },
};
const viewApi = {
  walk: walkApi,
  get mode() { return renderer.viewMode.mode; },
  rig: renderer.rig, along: rideAlong,
  photo: {
    get active() { return photo.active; }, get settings() { return photo.settings; }, orbit: photo.orbit,
    enter: (): boolean => enterPhoto(), exit: (): void => exitPhoto(),
    set: (p: Parameters<typeof sanitizeSettings>[1]): void => { photo.settings = sanitizeSettings(photo.settings, p); applyPhotoSettings(); photoEl?.sync(); },
    hero: (): void => photo.hero(),
    /** QA: frame the next viewpoint spot (Phase 6 Task 6). */
    spot: (): boolean => photo.nextSpot(),
    /** Headless export: returns the PNG (base64) and how many pixels are not fully opaque (whole image / top quarter after decoding the PNG). */
    capture: async (): Promise<{ w: number; h: number; clamped: boolean; transparentPx: number; rawTransparentPx: number; skyTransparentPx: number; base64: string }> => {
      const r = await photo.capture();
      const bmp = await createImageBitmap(r.png), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(bmp, 0, 0);
      const d = x.getImageData(0, 0, c.width, Math.max(1, Math.floor(c.height / 4))).data; let sky = 0; for (let i = 3; i < d.length; i += 4) if (d[i]! < 255) sky++;
      const buf = new Uint8Array(await r.png.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { w: r.w, h: r.h, clamped: r.clamped, transparentPx: r.transparentPx, rawTransparentPx: r.rawTransparentPx, skyTransparentPx: sky, base64: btoa(bin) };
    },
  },
  /** Ride along with a guest picked automatically (skier > lift rider > anyone). Returns the guest id (0 = nobody to follow). */
  rideAuto: (): number => startRide(),
  /** QA: place the ride camera at (x, y, z) looking along yaw / pitch (radians); call with no args to release. Needs an active ride. */
  freeCam: (x?: number, y?: number, z?: number, yaw = 0, pitch = 0): void => { debugFreeCam = x === undefined ? null : [x, y!, z!, yaw, pitch]; },
  ride: (id: number): number => startRide(id),
  /** Ride along with a guest sitting on a lift of `family` ('chair' by default, then any lift). Returns the guest id (0 = nobody riding). */
  rideLift: (family = 'chair'): number => {
    const s = guestSim.store;
    let best = 0, bestScore = Infinity, any = 0;
    for (let i = 0; i < s.limit; i++) {
      if (!s.alive[i] || s.state[i] !== GState.Riding) continue;
      if (!any) any = s.id[i]!;
      if (rideAlong.familyOf(s.liftId[i]!) !== family) continue;
      const l = liftToolsRef?.lifts.get(s.liftId[i]!);
      const f = l && l.top.ground !== l.bottom.ground ? (s.z[i]! - l.bottom.ground) / (l.top.ground - l.bottom.ground) : 0.5;
      const score = Math.abs(f - 0.5); // prefer a rider half way up the line: cable, towers and valley all in view
      if (score < bestScore) { bestScore = score; best = s.id[i]!; }
    }
    return startRide(best || any);
  },
  /** 0..1 progress of a guest along its lift line (-1 when not riding). */
  liftProgress: (id: number): number => {
    const s = guestSim.store, i = s.slotOf(id);
    if (i < 0 || s.state[i] !== GState.Riding) return -1;
    const l = liftToolsRef?.lifts.get(s.liftId[i]!);
    return l && l.top.ground !== l.bottom.ground ? (s.z[i]! - l.bottom.ground) / (l.top.ground - l.bottom.ground) : 0.5;
  },
  /** Number of guests riding a lift of `family`. */
  liftRiders: (family = 'chair'): number => { const s = guestSim.store; let n = 0; for (let i = 0; i < s.limit; i++) if (s.alive[i] && s.state[i] === GState.Riding && rideAlong.familyOf(s.liftId[i]!) === family) n++; return n; },
  /** Number of guests currently skiing a run (a good auto-pick exists when > 0). */
  skiers: (): number => { const s = guestSim.store; let n = 0; for (let i = 0; i < s.limit; i++) if (s.alive[i] && s.state[i] === GState.Walking && s.act[i] === Act.SkiDown && isSkiMode(s.moveMode[i]!)) n++; return n; },
  /** QA / perf harness: graphics preset ('low' | 'med' | 'high'), live. */
  setQuality: (q: GraphicsQuality): void => applyQualityNow(q),
  exit: (): void => exitRide(),
  next: (): void => nextRide(),
  stats: (): Record<string, unknown> => ({
    mode: renderer.viewMode.mode, fog: renderer.fog.density, drawCalls: renderer.webgl.info.render.calls, triangles: renderer.webgl.info.render.triangles,
    walk: walk.active ? { x: walk.state.x, z: walk.state.z, speed: walk.state.speed, riding: walk.riding, prompt: walk.prompt, location: walk.location } : null,
    pose: { ...renderer.rig.pose }, kind: rideSample.kind, target: rideAlong.targetId, fov: renderer.rig.fov, terrain: terrain.stats(), nearChunks: terrain.nearCount,
  }),
};
/** 'Go to' (news rows + toasts): tween the camera, select the entity (building inspector / guest ring) and pulse a marker ring at the spot. */
const pingMarker = new TutorialMarker((x, y) => heightAt(grid, x, y));
renderer.scene.add(pingMarker.mesh);
let pingUntil = 0;
/** 'Show me' for things that live in a panel, not on the map: open the drawer / HUD panel and highlight the item. */
const showPanel = (p: PanelRef | null | undefined): void => {
  if (!p) { toast(ADVISOR_UI.noTarget, 'info'); return; }
  if (p.drawer === 'rating') { hudRef?.showRating(); return; }
  dockRef?.showPanel(p.drawer, p.item);
};
const goTo = (f: FocusTarget): void => {
  renderer.controls.focusOn(f.x + 0.5, f.y + 0.5);
  if (f.entityKind === 'building' && f.entityId !== undefined && buildings.get(f.entityId)) select(f.entityId);
  else if (f.entityKind === 'guest' && f.entityId !== undefined && guestSim.store.slotOf(f.entityId) >= 0) { guestSelId = f.entityId; refreshGuestInfo(); }
  const b = f.entityKind === 'building' && f.entityId !== undefined ? buildings.get(f.entityId) : undefined;
  pingMarker.set(b ? { x: b.x, y: b.y, w: b.w, h: b.h, ok: false } : f.rect ? { ...f.rect, ok: true } : { x: Math.floor(f.x) - 1, y: Math.floor(f.y) - 1, w: 3, h: 3, ok: false });
  pingUntil = performance.now() + 6000;
};
{ const prev = renderer.onFrame; renderer.onFrame = (dt): void => { prev?.(dt); if (pingMarker.visible) { if (performance.now() > pingUntil) pingMarker.set(null); else pingMarker.update(performance.now() / 1000); } }; }
const precip = new Precipitation();
renderer.scene.add(precip.group);
let renderLine = snowlineHeight(game.date, worldScale); // smoothed snowline shown by terrain/buildings
let renderFreeze = freezeFromTemp(seasonalValleyTemp(game.date));
const snowFlush = new SnowFlush(grid, terrain, { refreshChunks: (l) => trees.refreshChunks(l, true) });
/** Push changed snow chunks to the terrain attribute path (<= 2x/s); props (tree snow tint) refresh every 3 s. */
const flushSnow = (dt: number): void => {
  if (snowFlush.step(dt) && overlayMode === 'snow') covOverlay.invalidate();
};
const updatePrecip = (dt: number): void => {
  const tg = viewCentre();
  const tx = Math.max(0, Math.min(MAP_SIZE, Math.round(tg.x))), ty = Math.max(0, Math.min(MAP_SIZE, Math.round(tg.z)));
  const groundY = grid.getCorner(tx, ty) * HEIGHT_UNIT;
  const w = weather.current;
  const kind = weather.temperatureAt(groundY) <= 0.5 ? 'snow' : 'rain';
  precip.update(dt, tg, { precip: w.intensity > 0 ? kind : 'none', intensity: Math.min(1, 0.1 + w.intensity * 0.8), wind: w.wind });
};
let lastSimT = -1;
const applySimSeason = (dt: number): void => {
  const t = seasonYear(game.date);
  const k = Math.min(1, dt * 1.5);
  renderLine += (weather.current.snowline - renderLine) * k;
  renderFreeze += (freezeFromTemp(weather.current.valleyT) - renderFreeze) * k;
  const st = seasonTerrainSim(t, renderLine);
  terrain.autumn = st.autumn; terrain.springBloom = st.springBloom; terrain.snowline = st.snowline;
  water.freeze = renderFreeze;
  applyBuildingSnow(st.snowline);
  if (lastSimT < 0 || Math.abs(t - lastSimT) > 0.0005) { lastSimT = t; trees.setSeasonYear(t); debugRef?.setSeason(t, { autumn: st.autumn, bloom: st.springBloom, snowline: st.snowline }); }
};
trees.setSeasonYear(SEASON_START);
{ const st0 = seasonTerrainSim(SEASON_START, renderLine); terrain.autumn = st0.autumn; terrain.springBloom = st0.springBloom; terrain.snowline = st0.snowline; water.freeze = renderFreeze; applyBuildingSnow(st0.snowline); }
const applySeason = (t: number): { autumn: number; bloom: number; snowline: number } => {
  trees.setSeasonYear(t);
  const st = seasonTerrain(t, maxWorld);
  terrain.autumn = st.autumn; terrain.springBloom = st.springBloom; terrain.snowline = st.snowline; water.freeze = freezeFromSnowline(st.snowline, maxWorld);
  applyBuildingSnow(st.snowline);
  return { autumn: st.autumn, bloom: st.springBloom, snowline: st.snowline };
};
/** Jump the SIMULATION to a day of year (instant snow/weather settle) and resync every render-side cache to it. */
const jumpSimToDay = (day: number, hour?: number): void => {
  sim.jumpToDay(day, hour);
  snowFlush.flushNow();
  renderLine = weather.current.snowline;
  renderFreeze = freezeFromTemp(weather.current.valleyT);
  lastSimT = -1;
  if (overlayMode === 'snow') covOverlay.invalidate();
  refreshUi();
};
/** Debug season override: the visuals change at once (applySeason); the sim follows (throttled) so snow depth/piste status match. */
let seasonJumpTimer = 0, seasonJumpLast = 0;
const commitSeason = (t: number): void => {
  window.clearTimeout(seasonJumpTimer);
  const wait = Math.max(150, 500 - (performance.now() - seasonJumpLast));
  seasonJumpTimer = window.setTimeout(() => { seasonJumpLast = performance.now(); jumpSimToDay(dayFromSeasonYear(t)); }, wait);
};
// ---- Perf: frame statistics, graphics quality, scripted in-browser benchmark (debug panel 'Perf' section) ----
const frameStats = new FrameStats(600);
let fpsNow = 0;
let groundDetail = true;
let applyQualityNow: (q: GraphicsQuality) => void = () => {};
const storedQuality = ((): GraphicsQuality | null => { try { const v = window.localStorage.getItem('slope.quality'); return (GRAPHICS_QUALITIES as readonly string[]).includes(v ?? '') ? (v as GraphicsQuality) : null; } catch { return null; } })();
let quality: GraphicsQuality = storedQuality ?? defaultQuality(MAP_SIZE, window.devicePixelRatio || 1);
{
  const apply = (q: GraphicsQuality): void => {
    quality = q;
    const p = QUALITY_PRESETS[q];
    renderer.setQuality(q);
    trees.setQuality(p.lodScale, p.treeDensity);
    rocks.setQuality(p.lodScale);
    setGroundCaps({ nearTiles: p.ground.nearTiles, figures: p.ground.nearFigures });
    trees.setNearCap(p.ground.nearTreesPerCell); rocks.setNearCap(p.ground.nearRocksPerCell);
    renderer.setGroundFogScale(p.ground.fogRangeScale); groundDetail = p.ground.detailTexture;
    guestRenderer.farScale = p.guestFarScale;
    activity.farScale = p.guestFarScale;
    precip.densityScale = p.particles;
    try { window.localStorage.setItem('slope.quality', q); } catch { /* storage unavailable */ }
  };
  applyQualityNow = apply;
  apply(quality);
}
const bench = {
  run: null as PerfBench | null, fill: false, saved: null as { speed: 0 | 1 | 2 | 3; zoom: number; tx: number; tz: number } | null,
  last: ((): { table: string; json: string; when: string } | null => { try { const v = window.localStorage.getItem('slope.perf.last'); return v ? (JSON.parse(v) as { table: string; json: string; when: string }) : null; } catch { return null; } })(),
};
const benchDriver: BenchDriver = {
  setSpeed: (sp) => loop.setSpeed(sp),
  setView: (view: BenchView, progress: number) => {
    const ctl = renderer.controls, size = MAP_SIZE;
    const lodge = buildings.all().find((b) => b.type === 'baseLodge');
    const a = lodge ? { x: lodge.x + lodge.w / 2, y: lodge.y + lodge.h / 2 } : terrainInfo.villageAnchor;
    const tall = view === 'near' ? 36 : view === 'mid' ? 96 : Infinity; // visible world height (tiles)
    ctl.zoom = tall === Infinity ? ctl.minZoom : Math.max(ctl.minZoom, Math.min(ctl.maxZoom, (size * 0.75) / tall));
    // glide from the village towards the middle of the map (and back for the far view) so terrain chunks / props stream in
    const k = view === 'far' ? 0.5 : progress;
    ctl.target.set(a.x + (size / 2 - a.x) * k, 0, a.y + (size * 0.35 - a.y) * k);
    ctl.clampTarget();
  },
  restore: () => {
    const sv = bench.saved;
    if (sv) { loop.setSpeed(sv.speed); renderer.controls.zoom = sv.zoom; renderer.controls.target.set(sv.tx, 0, sv.tz); renderer.controls.clampTarget(); }
    bench.saved = null;
    const r = bench.run;
    if (r && r.results.length) {
      r.meta = { mapSize: MAP_SIZE, seed: SEED, quality, dpr: window.devicePixelRatio, filledGuests: bench.fill, ua: navigator.userAgent, guests: guestSim.store.count };
      bench.last = { table: r.table(), json: r.json(), when: new Date().toLocaleString() };
      console.log(`[perf] benchmark (map ${MAP_SIZE}, seed ${SEED}, graphics ${quality}, dpr ${window.devicePixelRatio}):\n${bench.last.table}`);
      console.log('[perf] JSON (copy into docs/perf.md):\n' + bench.last.json);
      try {
        window.localStorage.setItem('slope.perf.last', JSON.stringify(bench.last));
        const hist = JSON.parse(window.localStorage.getItem('slope.perf.history') ?? '[]') as unknown[];
        hist.push(JSON.parse(bench.last.json)); while (hist.length > 10) hist.shift();
        window.localStorage.setItem('slope.perf.history', JSON.stringify(hist));
      } catch { /* storage unavailable */ }
    }
  },
  sample: () => {
    const info = renderer.webgl.info, ts = registry.tickStats(), mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, tickAvgMs: ts.avgMs, tickP95Ms: ts.p95Ms, guests: guestSim.store.count, heapMB: mem ? mem.usedJSHeapSize / 1048576 : 0 };
  },
};
{
  let last = performance.now(), frames = 0, lastFps = last;
  const tick = (): void => {
    const now = performance.now();
    frameStats.push(now - last);
    frames++;
    if (now - lastFps >= 500) { fpsNow = nextFps(frames, now - lastFps); frames = 0; lastFps = now; }
    if (bench.run?.active) {
      if (bench.fill && !loop.paused) {
        const hr = game.date.minute / 60;
        if (hr >= 7.5 && hr <= 16.5) guestSim.spawner.benchFill(game, GUEST_CAP[MAP_SIZE], 120);
      }
      bench.run.frame(now, now - last);
    }
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
const perfApi = {
  live: (): PerfLive => {
    const f = frameStats.summary(), info = renderer.webgl.info, ts = registry.tickStats(), mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      fps: f.fps, fpsLow1: f.fpsLow1, frameMs: f.avgMs, frameMaxMs: f.maxMs,
      calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
      tickAvgMs: ts.avgMs, tickP95Ms: ts.p95Ms, top: registry.topSystems(5).map((t) => ({ id: t.id, avgMs: t.avgMs, p95Ms: t.p95Ms })),
      heapMB: mem ? mem.usedJSHeapSize / 1048576 : null, guests: guestSim.store.count, quality,
    };
  },
  startBenchmark: (o: { fillGuests: boolean }): void => {
    if (bench.run?.active) return;
    bench.fill = o.fillGuests;
    bench.saved = { speed: loop.speed, zoom: renderer.controls.zoom, tx: renderer.controls.target.x, tz: renderer.controls.target.z };
    bench.run = new PerfBench(benchDriver);
    bench.run.start(performance.now());
  },
  cancelBenchmark: (): void => { bench.run?.cancel(); },
  status: (): { running: boolean; progress: number; label: string } => ({ running: !!bench.run?.active, progress: bench.run?.progress ?? 0, label: bench.run?.label ?? '' }),
  result: (): { table: string; json: string; when: string } | null => bench.last,
};
// ---- Debug tools (F3 'Debug tools'; also `__slope.populateDemo/findBear/spawnBear`): cheats for demos and quick verification ----
const populateDemo = (level: DemoLevel): DemoReport => {
  const r = buildDemoResort(sim, level);
  buildingsView.sync();
  for (const l of sim.lifts.all()) if (liftToolsRef && !liftToolsRef.view.has(l.id)) liftToolsRef.view.add(l);
  refreshProps(Array.from({ length: grid.chunksPerRow * grid.chunksPerRow }, (_, i) => i));
  covOverlay.invalidateHeights();
  refreshCoverage(undefined, true);
  refreshUi();
  console.info(`[debug] populateDemo(${level}): lifts=${r.lifts.length} placed=${JSON.stringify(r.placed)} failures=${JSON.stringify(r.failures)}`);
  return r;
};
let debugSpawnCount = 0, bearCursor = -1, animalCursor = -1;
const focusMarker = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 28), new THREE.MeshBasicMaterial({ color: 0xff5030, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
focusMarker.rotation.x = -Math.PI / 2; focusMarker.renderOrder = 12; focusMarker.visible = false;
renderer.scene.add(focusMarker);
let markerT = 0;
{ const prev = renderer.onFrame; renderer.onFrame = (dt): void => { prev?.(dt); if (markerT > 0) { markerT -= dt; const k = 1 + 0.35 * Math.sin(markerT * 9); focusMarker.scale.set(k, k, k); if (markerT <= 0) focusMarker.visible = false; } }; }
const focusOn = (x: number, y: number, label: string): void => {
  const c = renderer.controls;
  c.target.set(x, heightAt(grid, x, y), y);
  c.clampTarget();
  c.zoom = Math.max(c.zoom, Math.min(c.maxZoom, 4)); c.zoomBy(1);
  focusMarker.position.set(x, heightAt(grid, x, y) + 0.5, y);
  focusMarker.visible = true; markerT = 8;
  console.info(`[debug] ${label}`);
};
const findBearDebug = (): string => {
  const r = dbgFindBear(sim.safety.wildlife, bearCursor);
  if (!r) return 'No bears on this map (try Spawn bear)';
  bearCursor = r.cursor;
  focusOn(r.focus.x, r.focus.y, r.focus.message);
  return r.focus.message;
};
const spawnBearDebug = (near: boolean): string => {
  const c = renderer.controls;
  const r = dbgSpawnBear(sim.safety.wildlife, SEED, debugSpawnCount++, near ? { x: c.target.x, y: c.target.z } : undefined);
  if (r.ok) { bearCursor = bearsList().indexOf(r.bear.id) - 1; focusOn(r.bear.x, r.bear.y, r.message); }
  return r.message;
};
const bearsList = (): number[] => sim.safety.wildlife.animals.filter((a) => a.kind === 'bear').map((a) => a.id).sort((p, q) => p - q);
const findAnimalDebug = (species: string | null): string => {
  const c = renderer.controls;
  const list = sim.nature.fauna.findNearest(species as never, c.target.x, c.target.z);
  if (!list.length) return `No ${species ?? 'animals'} on the map`;
  animalCursor = (animalCursor + 1) % list.length;
  const a = list[animalCursor]!;
  focusOn(a.x, a.y, `${a.species} ${animalCursor + 1}/${list.length}`);
  return `${a.species} ${animalCursor + 1}/${list.length}`;
};
const populateTown = (id?: string, seed?: number): TownReport => {
  const pick = !id || id === 'random' ? TOWNS[Math.floor(uiRand() * TOWNS.length)]!.id : id;
  const sd = seed ?? ((TOWN_SEEDS[pick as keyof typeof TOWN_SEEDS]?.[MAP_SIZE as 64 | 128 | 256] ?? [SEED])[Math.floor(uiRand() * 6)] ?? SEED);
  const r = buildTown(sim, pick, sd);
  buildingsView.sync();
  for (const l of sim.lifts.all()) if (liftToolsRef && !liftToolsRef.view.has(l.id)) liftToolsRef.view.add(l);
  refreshProps(Array.from({ length: grid.chunksPerRow * grid.chunksPerRow }, (_, i) => i));
  covOverlay.invalidateHeights();
  refreshCoverage(undefined, true);
  refreshUi();
  console.info(`[debug] populateTown(${pick}, ${sd}): lifts=${r.lifts.length} placed=${JSON.stringify(r.placed)} failures=${JSON.stringify(r.failures)} score=${r.score}`);
  return r;
};
const debugToolsApi = {
  populate: populateDemo,
  town: {
    list: TOWNS.map((t) => ({ id: t.id, name: t.name, tagline: t.tagline })),
    mapSize: MAP_SIZE, seed: SEED,
    quickSeeds: (id: string): readonly number[] => TOWN_SEEDS[id as keyof typeof TOWN_SEEDS]?.[MAP_SIZE as 64 | 128 | 256] ?? [],
    build: populateTown,
    reset: (): void => { window.location.reload(); },
  },
  spawnGuests: (n: number, mix: 'mixed' | 'skiers' | 'hikers') => spawnGuests(sim, n, mix, ++debugSpawnCount),
  findBear: findBearDebug, spawnBear: spawnBearDebug, findAnimal: findAnimalDebug,
};


if (ui && !DEMO) {
  registerComponents();
  const topbar = el('st-topbar');
  const hud = el('st-hud');
  const debug = el('st-debug');
  debugRef = debug;
  topbar.bind({
    rotate: (d) => renderer.controls.rotateSnap(d),
    help: () => helpRef?.toggle(),
    settings: () => settingsRef?.toggle(),
    ...(saves ? { saveLoad: () => saveLoadRef?.open('save'), continueLast: () => { void saves.continueLast(); } } : {}),
    menu: () => { openGameMenu(); },
    photo: () => { if (photo.active) exitPhoto(); else enterPhoto(); },
    stats: () => { if (!DEMO) statsRef?.toggle(); },
    walk: () => { if (renderer.viewMode.mode === 'walk') exitWalk(); else startDrop(); },
    walkDrag: dropDrag,
    quality: { get: () => quality, set: (q) => applyQualityNow(q as GraphicsQuality), options: GRAPHICS_QUALITIES },
  });
  hud.bind(bus, () => game.money);
  hud.bindRating(() => ({ breakdown: rating.breakdown(), happiness: (() => { const st = guestSim.store; let n = 0, h = 0; for (let i = 0; i < st.limit; i++) if (st.alive[i]) { n++; h += st.happiness[i]!; } return n ? h / n : 0.5; })(), market: { share: sim.rivals.share, rank: sim.rivals.rank, of: sim.rivals.rivals.length + 1 } }));
  hud.bindLevel(bus, () => { const v = sim.progression.view(); return v.mode === 'sandbox' ? `${MODE_INFO.sandbox.label}: everything is unlocked \u00B7 ${regionNameOf(SEED)}` : `${MODE_INFO.career.label} \u00B7 Level ${v.level} \u00B7 ${v.name} \u00B7 ${regionNameOf(SEED)}`; });
  hud.bindDate(bus, () => game.date);
  hud.bindGuests(() => ({ count: guestSim.store.count, message: guestSim.spawner.status().text }));
  hud.bindWeather(bus, () => ({
    season: SEASON_LABELS[seasonOf(game.date)], kind: weather.current.kind, tempC: weather.valleyTempAt(hourOfDay(game.date)),
    snowlineM: altitudeMetres(weather.current.snowline), summerDiscount: isSummer(game.date),
    daylight: ((t) => `Sunrise ${fmtClock(t.sunrise)} · sunset ${fmtClock(t.sunset)} (${(t.sunset - t.sunrise).toFixed(1)} h of daylight)`)(sunTimes(game.date.day)),
    progress: formatSeasonProgress(((p) => ({ ...p, season: SEASON_LABELS[p.season], next: SEASON_LABELS[p.next] }))(seasonProgress(game.date))),
  }));
  const speedEl = el('st-speed-control');
  speedEl.bind({ bus, getSpeed: () => loop.speed, setSpeed: (sp) => loop.setSpeed(sp), getDate: () => game.date, fastNights: fastNightsApi,
    skip: {
      options: FF_KINDS.map((k) => ({ id: k, label: FF_LABELS[k], hint: k === 'month' ? 'K · to the 1st of next month' : k === 'season' ? 'to the start of the next season' : 'until something important happens' })),
      start: (id) => { const r = ff.start(id as FfKind); return r.ok ? null : r.reason; }, cancel: () => ff.cancel(), canStart: () => ff.canStart(), active: () => ff.active,
      progress: () => { const p = ff.progress(); return p ? { label: FF_LABELS[p.kind].replace('Next ', 'next '), fraction: p.fraction, daysLeft: p.daysLeft, etaSeconds: p.etaSeconds, daysPerSecond: p.daysPerSecond } : null; },
    } });
  const logEl = el('st-event-log');
  logEl.bind(eventLog);
  const perfEl = el('st-perf');
  perfEl.bind(perfApi);
  debug.addSection(perfEl, () => perfEl.refresh());
  debug.addSection(logEl, () => logEl.refresh());
  debug.addSection(buildDebugTools(debugToolsApi));
  debug.bind({
    fastNights: { get: fastNightsApi.get, set: fastNightsApi.set },
    stats: () => ({
      fps: fpsNow, calls: renderer.webgl.info.render.calls,
      meshes: terrain.countVisible(renderer.controls.camera), genMs, trees: treeCount, rocks: rockCount,
    }),
    snowline: { min: 0, max: maxWorld + 1, value: maxWorld + 1, set: (v) => { terrain.snowline = v; water.freeze = freezeFromSnowline(v, maxWorld); } },
    bloom: { value: 0, set: (v) => { terrain.springBloom = v; } },
    autumn: { value: 0, set: (v) => { terrain.autumn = v; } },
    season: {
      value: SEASON_START,
      set: applySeason,
      commit: commitSeason,
    },
    jumpToDay: (day) => { jumpSimToDay(day); debugRef?.setUseClock(true); useClock = true; },
    useClock: { value: true, set: (v) => { useClock = v; lastSimT = -1; } },
    time: { get: currentHour, set: (h) => { timeOverride = h; lastHour = -1; } },
    render: {
      forceFullRes: { get: () => terrain.forceFullRes, set: (v) => { terrain.forceFullRes = v; } },
      lodColours: { get: () => terrain.showLodColours, set: (v) => { terrain.showLodColours = v; } },
      disableNight: { get: () => lighting.disableNight, set: (v) => { lighting.disableNight = v; lastHour = -1; } },
      dump: renderStateDump,
    },
    renderProblems: () => materialGuard.summary(),
    profile: () => `ticks ${loop.tickCount} (dropped ${loop.droppedBacklog})\n` + registry.stats().map((st) => `${st.id.padEnd(11)} avg ${st.avgMs.toFixed(3)} p95 ${st.p95Ms.toFixed(3)}ms${st.overBudget ? ' OVER' : ''}`).join('\n'),
  });
  const dock = el('st-dock');
  const inspector = el('st-inspector');
  const pisteInspector = el('st-piste-inspector');
  pisteInspectorRef = pisteInspector;
  pisteInspector.bind({
    rename: (name) => { if (selectedPiste) sim.renamePisteAt(selectedPiste.x, selectedPiste.y, name); refreshUi(); },
    highlight: (on) => { pisteHighlightOn = on; showPisteInspector(); },
    setClosed: (closed) => { const r = selectedPiste ? sim.pisteReportAt(selectedPiste.x, selectedPiste.y) : null; if (r) sim.setRunClosed(r.id, closed); refreshUi(); },
    setGroom: (mode) => { const r = selectedPiste ? sim.pisteReportAt(selectedPiste.x, selectedPiste.y) : null; if (r) sim.setRunGroomMode(r.id, mode); refreshUi(); },
  });
  const toastEl = el('st-toast');
  const profileEl = el('st-profile');
  profileRef = profileEl;
  hudRef = hud as unknown as { showRating(): void }; dockRef = dock; inspectorRef = inspector; toastRef = toastEl; globalToast = toastEl;
  const thumbs = new Thumbnails(buildingMeshes);
  const setFlatten = (v: boolean): void => { placement.setAutoFlatten(v); if (liftToolsRef) liftToolsRef.tool.setAutoFlatten(v); };
  const getFlatten = (): boolean => (tools.current === 'lift' && liftToolsRef ? liftToolsRef.tool.autoFlatten : placement.autoFlatten);
  if (liftToolsRef) buildings.liftClearance = (c) => liftClearanceViolations(grid, liftToolsRef!.lifts, c);
  if (liftToolsRef) liftToolsRef.tool.setAutoFlatten(true); // lifts default ON; buildings take their per-type default on pick
  const seenYears = new Set<number>(sim.yearReports.all().map((r) => r.year)); // reports from a loaded save were seen before
  const yearEl = el('st-year-report');
  (yearEl as unknown as { region: string }).region = regionNameOf(SEED);
  const finPanel = el('st-finance');
  const loanPanel = el('st-loans');
  finPanel.bind({
    economy, debt: () => loans.totalDebt(),
    status: () => ({ status: finance.status, negDays: finance.negDays }),
    declare: () => { finance.declareBankruptcy(); },
    reports: {
      list: () => sim.yearReports.all().map((r) => ({ year: r.year, headline: r.headline.title, profit: r.totals.profit, guests: r.totals.guests, rating: r.totals.ratingEnd, ...(r.cover ? { cover: r.cover } : {}), isNew: !seenYears.has(r.year) })),
      open: (year) => { const r = sim.yearReports.get(year); if (r) yearEl.show(r, (how) => { if (how === 'continue') seenYears.add(year); finPanel.requestRefresh(); }); },
    },
  });
  const mktPanel = el('st-marketing');
  const evPanel = el('st-events');
  evPanel.bind({
    view: () => buildEventsView(sim.events, game.date.year * DAYS_PER_YEAR + game.date.day, game.money),
    book: (id, start) => { const why = sim.events.blocker(id as FestivalId, start); if (why) return why; sim.events.book(id as FestivalId, start); analytics().track('festival_booked', { id }); toast(`${FESTIVAL_BY_ID[id as FestivalId].name} booked.`); refreshUi(); return null; },
    cancel: (id, start) => { if (!sim.events.cancel(id as FestivalId, start)) return 'Cannot cancel'; refreshUi(); return null; },
  });
  mktPanel.bind({
    view: () => buildMarketingView(sim.marketing, game.money), start: (id) => sim.marketing.start(id),
    // 'Show me' on an unmet campaign prerequisite (Task 50): the building in the Buildings drawer, the Train Station on the map, or the Events calendar below the cards
    showMe: (q) => {
      if (q.show === 'station') { const st = buildings.all().find((b) => b.type === 'trainStation'); if (st) goTo({ x: st.x, y: st.y, entityKind: 'building', entityId: st.id }); else showPanel({ drawer: 'buildings', item: 'trainStation' }); }
      else if (q.show === 'events') evPanel.scrollIntoView?.({ block: 'nearest' });
      else if (q.build) showPanel({ drawer: 'buildings', item: q.build });
    },
  });
  const pricePanel = el('st-pricing');
  pricePanel.bind({ pricing: sim.pricing, ...sim.priceApi });
  const opsPanel = el('st-operations');
  const liftName = (kind: string, id: number): string => `${LIFTS[kind as keyof typeof LIFTS]?.name ?? kind} ${id}`;
  opsPanel.bind({
    runs: {
      rows: () => sim.runList().map((r) => ({ id: r.id, name: r.name, difficultyLabel: r.difficultyLabel, difficultyColor: r.difficultyColor, lengthM: r.lengthM, dropM: r.dropM, passesToday: r.passesToday, passesWeek: r.passesWeek, quality: r.avgQuality, open: r.open, reason: r.reason, closedByPlayer: r.closedByPlayer, groomMode: r.groomMode, groomedDaysAgo: r.groomedDaysAgo })),
      setClosed: (id, closed) => { sim.setRunClosed(id, closed); covOverlay.invalidate(); refreshUi(); },
      setGroom: (id, m) => { sim.setRunGroomMode(id, m); refreshUi(); },
      focus: (id) => { const r = sim.runList().find((x) => x.id === id); if (!r) return; selectedId = null; selectedPiste = { x: Math.floor(r.x), y: Math.floor(r.y) }; pisteHighlightOn = true; renderer.controls.focusOn(r.x, r.y); refreshUi(); },
    },
    rows: () => sim.liftOps.scheduleTable().map((r) => {
      const l = lifts.get(r.id)!, s = sim.liftOps.status(r.id)!;
      return { id: r.id, name: liftName(r.kind, r.id).replace(/ \d+$/, ''), kind: r.kind, mode: r.mode, daylight: r.daylight, from: r.from, to: r.to, eco: r.eco, seasons: r.seasons, energyPerDay: r.energyPerDay, carriesBikes: LIFTS[l.kind].carriesBikes, condition: s.condition, status: l.open ? 'open' : (l.closedReason ?? s.hold ?? 'closed') };
    }),
    setMode: (id, m) => sim.liftOps.setMode(id, m), setHours: (id, f, t) => sim.liftOps.setHours(id, f, t), setDaylight: (id, v) => sim.liftOps.setDaylight(id, v), daylightText: () => { const t = sunTimes(game.date.day); return `${fmtClock(t.sunrise)}–${fmtClock(t.sunset)}`; }, setEco: (id, v) => sim.liftOps.setEco(id, v),
    setSeason: (id, p, v) => sim.liftOps.setSeason(id, p, v),
    keepOnly: (p, ids) => sim.liftOps.keepOnly(p, new Set(ids)),
    projected: (p) => sim.liftOps.projectedDailyEnergy(p),
    maint: {
      policy: () => sim.liftOps.getPolicy(), setPolicy: (p) => { sim.liftOps.setPolicy(p); refreshUi(); },
      rows: () => lifts.all().slice().sort((a, b) => a.id - b.id).map((l) => {
        const v = sim.liftOps.serviceStatus(l);
        return { id: l.id, name: liftName(l.kind, l.id).replace(/ \d+$/, ''), state: v.state, window: v.windowAuto ? 'auto' : String(v.windowMonth), autoMonth: v.autoMonth, nextLabel: v.nextDay === null ? null : maintDate(v.nextDay), lastLabel: v.lastDay === null ? null : maintDate(v.lastDay), sinceDays: v.sinceDays, days: v.plan.days, cost: v.plan.cost, riskMult: v.riskMult, canServiceNow: sim.liftOps.canServiceNow(l.id), servicing: v.inServiceHours > 0 };
      }),
      setWindow: (id, m) => sim.liftOps.setServiceWindow(id, m), scheduleAll: (m) => sim.liftOps.scheduleAll(m),
      serviceNow: (id) => { const ok = sim.liftOps.serviceNow(id); if (!ok) toast('Cannot service now: the lift must be empty and not broken', 'warn'); refreshUi(); return ok; },
      projected: () => sim.liftOps.projectedServiceCost(30),
    },
    snow: {
      mode: () => sim.ops.snowmaking.mode,
      setMode: (m) => { sim.ops.snowmaking.setMode(m); covOverlay.invalidate(); refreshUi(); },
      summary: () => {
        const ids = buildings.all().filter((b) => b.type === 'snowCannon').map((b) => b.id), sm = sim.ops.snowmaking;
        let running = 0, paused = 0, off = 0;
        for (const id of ids) { if (sm.isMothballed(id)) off++; else { const st = sm.statsOf(id)?.state; if (st === 'running') running++; else if (st === 'paused') paused++; } }
        return { total: ids.length, running, paused, off, snowlineM: snowlineNow() };
      },
      setAll: (on) => { sim.ops.snowmaking.setAll(buildings.all().filter((b) => b.type === 'snowCannon').map((b) => b.id), on); covOverlay.invalidate(); refreshUi(); },
    },
    staff: {
      pools: () => { const n = sim.staff.needs(true); return STAFF_POOLS.map((id) => ({ id, label: POOL_INFO[id].label, icon: POOL_INFO[id].icon, auto: sim.staff.isAuto(id), count: sim.staff.headcount(id), need: n[id], fill: sim.staff.fill(id), slows: POOL_INFO[id].slows })); },
      setAuto: (id, v) => sim.staff.setAuto(id, v), setCount: (id, n) => sim.staff.setCount(id, n),
      wage: () => sim.staff.wage, setWage: (w) => sim.staff.setWage(w),
      morale: () => ({ value: sim.staff.morale, label: sim.staff.moraleLabel(), breakdownFactor: sim.staff.breakdownFactor() }),
      billPerDay: () => (sim.attractions.all().reduce((t, x) => t + x.staff, 0) * STAFF_WAGE_PER_DAY * sim.difficulty.wages + sim.staff.extraWagesPerDay()) * sim.staff.wageMult() + sim.staffUpgrades.upkeepPerDay(),
      upgrades: () => sim.staffUpgrades.views().map((v) => ({ id: v.def.id, name: v.def.name, icon: v.def.icon, effect: v.def.effect, cost: v.def.cost, days: v.def.days, upkeep: v.def.upkeep, state: v.state, daysLeft: v.daysLeft, reason: v.reason })),
      train: (id) => { const why = sim.staffUpgrades.blocker(id); if (why) { toast(why, 'error'); return why; } sim.staffUpgrades.start(id); analytics().track('staff_upgrade', { id }); toast(`Training started: ${UPGRADE_BY_ID[id]?.name ?? id}`); refreshUi(); return null; },
    },
  });
  loanPanel.bind({
    offers: () => loans.offers(creditCtx()),
    active: () => loans.active(),
    take: (id) => { const r = loans.take(id, creditCtx(), dateMonth()); if (r.ok) toast(`Loan taken: ${formatMoney(r.loan.principal / 100)}`); return r.ok ? null : r.reason; },
    repay: (id) => loans.repay(id),
    creditLabel: () => creditLetter(creditScore(creditCtx(), loans.totalDebt())),
    maxDebt: () => debtCap(creditCtx()),
    debt: () => loans.totalDebt(),
  });
  dock.bind({
    funds: () => game.money,
    season: () => seasonOf(game.date),
    finance: { panels: () => [finPanel, loanPanel], refresh: () => { finPanel.requestRefresh(); loanPanel.requestRefresh(); } },
    operations: { panels: () => [opsPanel], refresh: () => opsPanel.requestRefresh() },
    marketing: { panels: () => [mktPanel, evPanel], refresh: () => { mktPanel.requestRefresh(); evPanel.requestRefresh(); }, highlight: (id) => (mktPanel as unknown as { highlight(id: string | null): void }).highlight(id) },
    pricing: { panels: () => [pricePanel], refresh: () => pricePanel.requestRefresh() },
    buildings: {
      locked: (t) => buildingLocks(t),
      cost: (t) => (BUILDINGS[t]?.cost ?? 0) * economy.constructionMultiplier(),
      multiplier: () => economy.constructionMultiplier(),
      select: startPlacement,
    },
    lifts: {
      select: (k) => { const l = sim.progression.locked('lift', k); if (l) { toast(`Locked: ${l}`, 'error'); return; } liftToolsRef?.start(k); },
      locked: (k) => { const l = sim.progression.locked('lift', k); return l ? [l] : []; },
      costPer100m: (k) => LIFTS[k].costPerMetre * 100 * economy.constructionMultiplier(),
    },
    undoAction: {
      run: () => { performUndo(); }, next: () => { const n = undo.next(); return n ? `${verbIng(n.verb)} ${n.label}` : null; },
      redo: () => { performRedo(); }, nextRedo: () => { const n = undo.nextRedo(); return n ? `${verbIng(n.verb)} ${n.label}` : null; },
    },
    network: {
      start: (k) => netTools?.startTool(k),
      setOverride: (d) => netTools?.setOverride(d),
      setBrush: (n) => netTools?.setBrush(n),
      setErase: (on) => netTools?.setErase(on),
      setOverRail: (on) => netTools?.setOverRail(on),
      undo: () => netTools?.undo() ?? false,
      redo: () => netTools?.redo() ?? false,
      suggest: (w) => suggestRun(w),
      pruneOrphans: (l) => netTools?.pruneOrphans(l) ?? 0,
    },
    terraform: {
      setMode: (m) => terraform.setMode(m), setTarget: (t) => terraform.setTarget(t), setBrush: (n) => terraform.setBrush(n),
      setMaxEdgeDelta: (d) => terraform.setMaxEdgeDelta(d),
      state: () => ({ mode: terraform.mode, brush: terraform.brush, target: terraform.target, maxEdgeDelta: terraform.maxEdgeDelta }),
    },
    landscape: {
      activate: (m) => { tools.activate('landscape'); if (m) landscapeTool.setMode(m); dockRef?.syncLandscape(); },
      setMode: (m) => { tools.activate('landscape'); landscapeTool.setMode(m); }, setDecor: (k) => { tools.activate('landscape'); landscapeTool.setDecor(k); },
      setBrush: (n) => landscapeTool.setBrush(n), setRot: (r) => landscapeTool.setRot(r), state: () => landscapeTool.state(),
      pondLocked: () => sim.gate.locked('landscape', 'pond'), multiplier: () => economy.constructionMultiplier(),
    },
    nature: {
      setMode: (m) => { tools.activate('plant'); plantTool.setMode(m); }, setGroup: (g) => plantTool.setGroup(g as PlantGroup),
      setBrush: (n) => plantTool.setBrush(n), setDensity: (d) => plantTool.setDensity(d), state: () => plantTool.state(),
      groups: PLANT_GROUP_IDS.map((id) => ({ id, label: PLANT_GROUPS[id].label })),
    },
    setBulldoze,
    activateTerraform: () => { tools.activate('terraform'); },
    resetTool: () => tools.reset(),
    view: {
      overlay: () => overlayMode, setOverlay,
      toggleGrid: () => { terrain.gridOverlay = !terrain.gridOverlay; },
      photo: () => { enterPhoto(); },
      walk: () => { enterWalk(); },
      ride: () => { if (!startRide()) toast('No guest to ride with yet.', 'info'); },
      rotate: (d) => renderer.controls.rotateSnap(d),
      zoom: (f) => renderer.controls.zoomBy(f),
      gridOn: () => terrain.gridOverlay,
      setSeason: (t) => { const r = applySeason(t); debugRef?.setSeason(t, r); commitSeason(t); },
    },
    autoFlatten: { get: getFlatten, set: setFlatten },
    clearLane: { get: () => liftToolsRef?.tool.clearLane ?? true, set: (v) => liftToolsRef?.tool.setClearLane(v) },
    rotate: (dir) => placement.rotate(dir),
    thumb: (kind, id, size) => thumbs.peek(kind, id, size),
    flattenCost: () => {
      if (tools.current === 'lift') { const c = liftToolsRef?.tool.lastCheck; return c && c.flatten ? c.flattenCost : null; }
      return placement.ghostInfo()?.flattenCost ?? null;
    },
  });
  inspector.bindWalk((id) => { enterWalk({ x: 0, z: 0, buildingId: id }); });
  inspector.bindRotate((id, dir) => {
    const out = rotateBuilding(env, props, id, dir);
    if (!out.ok || !out.building) return out.reasons.join(', ') || 'blocked';
    buildingsView.sync();
    if (out.touchedChunks.length) refreshProps(out.touchedChunks);
    covOverlay.invalidateHeights();
    refreshCoverage(out.building, out.changed.length > 0);
    announceChanged(out.changed);
    refreshUi();
    return null;
  });
  inspector.bindRename((id, name) => { sim.names.rename('building', id, name); refreshUi(); });
  inspector.bind(demolish, (id, d) => { const sc = guestSim.families.school(id); sc.setInstructors(sc.instructors + d); refreshUi(); });
  inspector.bindOps((id, d) => { const b = buildings.get(id); if (b && safetyRef && b.type === 'rangerStation') { safetyRef.wildlife.setStaff(id, safetyRef.wildlife.staffOf(id) + d); refreshUi(); return; } if (b && safetyRef && b.type === 'patrolHub') { safetyRef.patrol.setStaff(id, safetyRef.patrol.staffOf(id) + d); safetyRef.resync(); refreshUi(); return; } if (b && opsRef) { opsRef.grooming.setVehicles(id, opsRef.grooming.vehiclesOf(id, b.type) + d); refreshUi(); } });
  inspector.bindCannon((id, on) => { sim.ops.snowmaking.setCannon(id, on); covOverlay.invalidate(); refreshUi(); });
  inspector.bindBins((id) => { if (safetyRef) { safetyRef.wildlife.setBins(id, !safetyRef.wildlife.binsOf(id)); refreshUi(); } });
  inspector.bindAttraction({
    setPrice: (id, p) => { sim.priceApi.setForBuilding(id, p); refreshUi(); },
    adjustStaff: (id, d) => { const a = attractions.get(id); if (a) { a.setStaff(a.staff + d); refreshUi(); } },
  });
  // Pre-render thumbnails during idle time (after the first frame); the dock fills placeholders as they arrive.
  {
    const items = [
      ...Object.keys(BUILDINGS).flatMap((id) => [96, 160].map((size) => ({ kind: 'building' as const, id, size }))),
      ...Object.keys(LIFTS).flatMap((id) => [96, 160].map((size) => ({ kind: 'lift' as const, id, size }))),
    ];
    let pending = false;
    window.setTimeout(() => thumbs.prewarm(items, () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; dock.refreshThumbs(); });
    }), 500);
  }
  // Auto-flatten checkbox follows the game via events (no polling): tool switches and the lift tool's F key.
  const syncFlatten = (): void => dock.setAutoFlatten(getFlatten());
  tools.onChange(syncFlatten);
  window.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') window.setTimeout(syncFlatten, 0); if (e.key === 'l' || e.key === 'L') window.setTimeout(() => dock.setClearLane(liftToolsRef?.tool.clearLane ?? true), 0); });
  bus.on('money:changed', () => dock.refresh());
  bus.on('day:changed', () => dock.seasonChanged());
  bus.on('season:changed', () => dock.seasonChanged());
  hud.bindFinance({
    tip: () => `This month: ${formatSigned(economy.monthNet())} · Today: ${formatSigned(economy.dayNet())} · Debt ${formatMoney(loans.totalDebt())}\nClick for finances`,
    open: () => dock.show('finance'),
  });
  // Bankruptcy end screen: shown only when the player declares bankruptcy (Finance drawer) or the very long auto limit hits. Negative cash alone never ends the game.
  // Uses the shared dialog frame (src/ui/modal.ts): centred, above everything, removed from the DOM once dismissed.
  let arrivals = 0;
  bus.on('guest:arrived', () => { arrivals++; });
  bus.on('finance:bankrupt', (e) => {
    loop.setSpeed(0);
    const rs = economy.reports(), d = game.date;
    const text = [
      `Cash: ${formatMoney(e.money)} · Debt: ${formatMoney(loans.totalDebt())}`,
      `Played: year ${d.year}, day ${d.day + 1} · Months closed: ${rs.length}`,
      `Lifetime income ${formatMoney(economy.lifetimeIncome())} · expenses ${formatMoney(economy.lifetimeExpense())}`,
      `Guests welcomed: ${arrivals} · Rating: ${rating.stars}★`,
      `Lifts: ${lifts.size} · Buildings: ${buildings.all().length}`,
    ].join('\n');
    showModal(ui, {
      title: finance.endedBy === 'auto' ? 'The bank has foreclosed!' : 'You declared bankruptcy', icon: '💸', size: 'sm', body: text, backdropClose: false, closable: false,
      actions: [
        { label: 'Keep looking at the resort (read-only)', kind: 'ghost', id: 'keep', run: () => { tools.reset(); finance.continueAfterBankruptcy(); toast('Read-only: building is disabled and the clock stays stopped.', 'warn'); } },
        { label: 'Start new game', kind: 'primary', id: 'new', run: () => { window.location.search = 'menu=1'; return false; } },
      ],
    });
  });
  const status = document.createElement('div');
  status.id = 'tool-status';
  const showTool = (): void => { status.innerHTML = `Tool: <b>${tools.label()}</b>${tools.isDefault() ? '' : ' (Esc to cancel)'} · ? help`; };
  tools.onChange(showTool);
  tools.onChange((id) => dockRef?.syncTool(id));
  showTool();
  const help = el('st-help');
  helpRef = help;
  const guestInsp = el('st-guest-inspector');
  guestInsp.bind(() => { if (sim.stories.pinned === guestSelId) sim.stories.pin(0); guestSelId = 0; guestFollow = false; refreshGuestInfo(); }, (id) => { startRide(id); }, {
    pin: () => { sim.stories.pin(sim.stories.pinned === guestSelId ? 0 : guestSelId); refreshGuestInfo(); },
    follow: () => { guestFollow = !guestFollow; refreshGuestInfo(); },
  });
  guestInspEl = guestInsp;
  const news = el('st-news');
  // Review text names the spot. Wired here (not in createSim): Names assigns 'Blue Run N' numbers on first mention, which is saved state.
  guestSim.reviewPlace = (x, y) => { const p = sim.names.describeLocation(x | 0, y | 0); return { name: p.name, on: p.on }; };
  // Debug (M5.1): `__slope.reviews.demo()` injects sample reviews into the Reviews tab; `.director` toggles/tunes the real source.
  const reviewsDebug = { director: guestSim.reviews, demo: () => { for (const [stars, text, tone, driver] of [[5, 'Well-prepared pistes today. Smooth snow from top to bottom.', 'plain', 'piste'], [2, 'Long waits for the lifts today. I spent more time in line than skiing.', 'plain', 'queue'], [4, 'Hot chocolate fixed everything. Highly recommend.', 'light', 'hunger'], [1, 'Took a fall near Blue Run 1 and had to end my day early. Hoping for a quick recovery.', 'plain', 'injury'], [3, 'It was fine, but I expected more.', 'plain', 'general'], [5, 'Fresh snow and blue sky. Hard to complain, though I tried.', 'light', 'weather']] as const) news.addReview({ guestId: 1, stars, text, tone, driver, x: 20, y: 20 }); } };
  setTimeout(() => { (window as unknown as { __slope: Record<string, unknown> }).__slope.reviews = reviewsDebug; }, 0); // __slope is created further down
  news.bind(bus, {
    ctx: { locate: (kind, id) => { if (kind === 'lift') { const l = liftToolsRef?.lifts.get(id); return l ? { x: l.bottom.x, y: l.bottom.y } : null; } const b = buildings.get(id); return b ? { x: b.x + b.w / 2 - 0.5, y: b.y + b.h / 2 - 0.5 } : null; }, liftName: (id) => (liftToolsRef?.lifts.get(id) ? sim.names.liftName(id) : undefined), money: (n) => formatMoney(n), where: (x, y) => { const p = sim.names.describeLocation(x, y); return { name: p.name, on: p.on, near: p.near }; } },
    date: () => game.date,
    // The news feed is the single source of toasts: only critical + important rows toast (muted categories excluded; per-key cooldown in the limiter).
    onItem: (it) => { audioRef?.news(it); const f = it.focus; toastEl.show(it.text, it.severity === 'bad' ? 'error' : it.severity === 'warn' ? 'warn' : 'info', 3500, { key: it.key, category: it.category, severity: it.severity, tier: it.tier, ...(f ? { action: { label: 'Go to', run: () => goTo(f) }, ttlMs: 7000 } : {}) }); },
    stamp: () => `${formatGameDate(game.date).short} ${String(Math.floor(game.date.minute / 60)).padStart(2, '0')}:${String(game.date.minute % 60).padStart(2, '0')}`,
    goTo: (f) => goTo(f),
    focus: (x, y) => goTo({ x, y }),
    muted: () => toastEl.mutedCategories(), setMuted: (c, on) => toastEl.setMuted(c, on),
  });
  // Resort goals card (M5.1): right column under the HUD; hidden + paused while the tutorial runs.
  const goalsEl = el('st-goals');
  goalsEl.bind(bus, { view: () => sim.goals.view(), progress: () => sim.progression.view(), show: (id) => { const p = sim.goals.focusOf(id); if (p) goTo({ x: p.x, y: p.y }); else showPanel(sim.goals.panelOf(id)); } });
  const setGoalsHidden = (on: boolean): void => { sim.goals.paused = on; goalsEl.suppress(on); };
  // ---- Scenario (M5.3 Task 15): the scenario card REPLACES the goal card; win / lose dialog; results go to the local profile (IndexedDB `slope-profile`) ----
  const scen = sim.scenario;
  const scenCard = el('st-scenario-card');
  const scenResult = el('st-scenario-result');
  if (scen) {
    const profile = profileStore();
    goalsEl.suppress(true);
    scenCard.bind(bus, { view: () => scen.view(), finish: () => { scen.finishNow(); }, results: () => showScenarioResult(profile.record(scen.def.id)) });
    const showScenarioResult = (prev: Readonly<ScenarioRecord>): void => { const f = scen.finished; if (f) scenResult.show(scen.def.name, f, prev); };
    scenResult.bind({
      continueSandbox: () => { scen.continueSandbox(); sim.progression.unlockAll = true; sim.goals.paused = false; sim.goals.silentSync(); goalsEl.suppress(false); scenCard.refresh(); if (loop.speed === 0 && !sim.finance.ended) loop.setSpeed(1); },
      retry: () => { window.location.search = `?${scenarioQuery(scen.def.id)}`; },
      menu: () => { void goToMenu(); },
    });
    if (scen.sandbox) goalsEl.suppress(false);
    if (!bootSave && !DEMO) void profile.recordStart(scen.def.id);
    bus.on('scenario:finished', (e) => {
      loop.setSpeed(0); // auto-pause
      void profile.ready.then(() => {
        const prev = { ...profile.record(e.id) };
        void profile.recordResult(e.id, { result: e.result, medal: e.medal, score: e.score, days: scen.finished?.days ?? 0 });
        requestAnimationFrame(() => showScenarioResult(prev));
      });
    });
  }
  if (TUTORIAL_MODE) setGoalsHidden(true);
  // Welcome-back recap + month-end card (M5.1): one transient card, never a dialog; the month card can be switched off in Settings (Gameplay).
  const buildRecap = (): RecapModel => {
    const sm = sim.session.get(), gv = sim.goals.view();
    return formatRecap({
      date: game.date, season: seasonOf(game.date), cash: game.money, stars: rating.stars,
      ...(sm ? { monthStartMoney: sm.monthStartMoney, monthStartStars: sm.monthStartStars, last: sm.last } : {}),
      goals: gv.active.map((g) => ({ title: g.title, progress: g.progress })),
      advice: sim.advisor.top().map((a) => ({ title: a.title })),
      issues: sessionIssues(sim),
    });
  };
  const recapEl = el('st-recap');
  recapEl.bind({ openFinance: () => dock.show('finance'), showItem: (k, id) => dock.showItem(k, id) });
  // Level-up (M5.3): one small card listing what is new (the confetti burst + news row come from the major `milestone` the sim emits).
  sim.progression.onLevelUp((u) => { recapEl.showUnlock({ level: u.level, name: u.name, items: u.unlocked.map((x) => ({ kind: x.kind, id: x.id, name: unlockName(x.kind, x.id), icon: unlockIcon(x.kind, x.id) })) }); });
  recapEl.suppress(TUTORIAL_MODE);
  const MONTH_CARD_KEY = 'slopetycoon.monthSummary';
  let monthCardOn = true;
  try { monthCardOn = window.localStorage.getItem(MONTH_CARD_KEY) !== '0'; } catch { /* private mode */ }
  wireMonthCard(bus, { enabled: () => monthCardOn && !DEMO, report: () => economy.lastReport(), ratingDelta: () => sim.session.get()?.last?.ratingDelta, show: (m, key) => recapEl.showMonth(m, key), yearReportReady: (y) => !!sim.yearReports.get(y) });
  // ---- Resort of the Year report (M5.3, Task 17): modal at the year boundary (auto-pause + resume), cover from the current camera, local PNG only (D8: no sharing) ----
  const YEAR_REPORT_KEY = 'slopetycoon.yearReport';
  let yearReportOn = true;
  try { yearReportOn = window.localStorage.getItem(YEAR_REPORT_KEY) !== '0'; } catch { /* private mode */ }
  const tutorialRunning = (): boolean => { const st = tutorialRef?.engine.view().status; return TUTORIAL_MODE && (!st || st === 'active' || st === 'blocked') || st === 'active' || st === 'blocked'; };
  const yearGate = new YearReportGate({
    getSpeed: () => loop.speed, setSpeed: (sp) => loop.setSpeed(sp), enabled: () => yearReportOn, demo: () => DEMO, ended: () => sim.finance.ended, tutorialActive: tutorialRunning,
    dialogsOpen: () => modalStack.dialogs,
    show: (year) => { const r = sim.yearReports.get(year); if (!r) { yearGate.closed(); return; } yearEl.show(r, (how) => { if (how === 'continue') seenYears.add(year); finPanel.requestRefresh(); yearGate.closed(); yearGate.pump(); }); },
  });
  yearEl.bind({
    saveImage: async (r) => {
      let cover: { source: CanvasImageSource; width: number; height: number } | null = null;
      if (r.cover) {
        const img = new Image();
        await new Promise<void>((res) => { img.onload = () => res(); img.onerror = () => res(); img.src = r.cover!; });
        if (img.naturalWidth) cover = { source: img, width: img.naturalWidth, height: img.naturalHeight };
      }
      const c = composeYearCanvas(r, cover);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
      if (blob) downloadBlob(blob, yearImageName(r));
    },
  });
  /** Hero cover of the current iso camera (a few ms, skipped without WebGL / outside the iso view) stored in the report. */
  const attachCover = (year: number): void => { if (DEMO || photo.active || renderer.viewMode.mode !== 'iso') return; const u = photo.captureCover(); if (u) sim.yearReports.setCover(year, u); };
  const quietYears = new Set<number>(); // debug-generated reports never open the dialog by themselves
  bus.on('year:report', (e) => { requestAnimationFrame(() => { if (quietYears.has(e.year)) { quietYears.delete(e.year); finPanel.requestRefresh(); return; } attachCover(e.year); yearGate.onReport(e.year); finPanel.requestRefresh(); }); });
  window.setInterval(() => yearGate.pump(), 1000);
  ui.append(yearEl, ...(scen ? [scenResult] : []));
  window.setTimeout(() => {
    const dbg = (window as unknown as { __slope: Record<string, unknown> }).__slope;
    dbg.yearReport = { show: (year?: number, cover = true) => { const r = year === undefined ? sim.yearReports.latest() : sim.yearReports.get(year); if (!r) return false; if (cover) { const prev = renderer.viewMode.mode; if (prev === 'iso') attachCover(r.year); } yearEl.show(r); return true; }, gate: yearGate, el: yearEl };
    /** Debug / QA: `__slope.scenario.forceResult('won' | 'lost')` ends the running scenario now (shows the real dialog). */
    dbg.scenario = { runner: sim.scenario, view: () => sim.scenario?.view() ?? null, forceResult: (r: 'won' | 'lost') => { sim.scenario?.forceResult(r); }, el: scenResult, card: scenCard };
    dbg.stats = { history: sim.stats, demoYear: (endYear = Math.max(2, game.date.year - 1)) => { fillDemoStats(sim.stats, endYear); sim.yearReports.reset(); for (const y of [endYear - 1, endYear]) { quietYears.add(y); sim.yearReports.generate(y); } finPanel.requestRefresh(); return sim.yearReports.latest(); } };
  }, 0);
  rightCol.append(hud, speedEl, status, goalsEl, ...(scen ? [scenCard] : []), inspector, pisteInspector, guestInsp);
  const statsEl = el('st-stats');
  statsRef = statsEl; statsEl.bind({ history: () => sim.stats, guestTypes: () => guestTypeBreakdown(sim.guestSim.store) });
  { const open = statsEl.open.bind(statsEl); let first = true; statsEl.open = (): void => { open(); if (first) { first = false; analytics().track('feature_first_use', { feature: 'stats' }); } }; }
  const trophiesEl = el('st-trophies');
  trophiesEl.bind(trophiesApiFromProfile(profileStore(), { run: () => ach.serializeRun(), runKind: () => (sim.scenario && !sim.scenario.sandbox ? 'scenario' : sim.progression.mode) }));
  // Dialogs that pause the game (Settings, Help, Save & load, Trophies, About, confirms): see ui/modalPauseGate.ts
  modalPause.attach({ getSpeed: () => loop.speed, setSpeed: (s) => loop.setSpeed(s as 0 | 1 | 2 | 3), cancelFastForward: () => ff.cancel(), exempt: () => DEMO, ended: () => sim.finance.ended });
  const settingsEl = el('st-settings');
  settingsRef = settingsEl;
  if (audioRef) {
    const audio = audioRef;
    settingsEl.bind(audioRef.settings, audioRef.engine, [{ label: 'Trophies', title: 'Open the trophy shelf', run: () => trophiesEl.open() }], {
      music: { next: () => audio.music.next(), now: () => { const t = audio.music.currentTrack; return t ? THEMES[t].name : ''; } },
      profile: { cosmetics: achCosmetics, reset: async () => { ach.resetProfile(); await profileStore().resetProfile(); } },
      quality: { get: () => quality, set: (q) => applyQualityNow(q as GraphicsQuality), options: GRAPHICS_QUALITIES },
      fastNights: { get: fastNightsApi.get, set: fastNightsApi.set },
      rideSlowMo: rideSlowMoApi,
      walk: { get: () => ({ ...walkSettings }), set: (p) => { applyWalkSettings(p); } },
      feedback: { get: () => fx.intensity, set: (v) => fx.setIntensity(v as FeedbackIntensity), options: FEEDBACK_INTENSITIES },
      hints: { title: tr('ui.hintsToggle'), get: () => !!tutorialRef?.hints?.enabled, set: (on) => { const h = tutorialRef?.hints; if (!h) return; h.setEnabled(on); toast(tr(on ? 'ui.hintsOn' : 'ui.hintsOff')); } },
      replayTutorial: () => { window.location.search = TUTORIAL_QUERY; },
      monthSummary: { get: () => monthCardOn, set: (on) => { monthCardOn = on; if (!on && recapEl.currentMode === 'month') recapEl.dismiss(); try { window.localStorage.setItem(MONTH_CARD_KEY, on ? '1' : '0'); } catch { /* private mode */ } } },
      yearReport: { get: () => yearReportOn, set: (on) => { yearReportOn = on; try { window.localStorage.setItem(YEAR_REPORT_KEY, on ? '1' : '0'); } catch { /* private mode */ } } },
      privacy: settingsPrivacy(),
      unmuteNews: () => { for (const c of [...toastEl.mutedCategories()]) toastEl.setMuted(c, false); },
    });
  }
  const viewHud = el('st-view-hud');
  viewHud.bind({ exit: () => { if (renderer.viewMode.mode === 'walk') exitWalk(); else exitRide(); }, next: () => nextRide() });
  viewHudEl = viewHud;
  {
    const pe = el('st-photo');
    pe.bind({
      settings: () => photo.settings,
      set: (p) => { if (p.frame && frameLock(p.frame)) return; photo.settings = sanitizeSettings(photo.settings, p); applyPhotoSettings(); },
      frameLock: (id) => frameLock(id),
      hourNow: () => currentHour(),
      spotCount: () => photo.spotCount(), spot: () => { photo.nextSpot(); },
      hero: () => photo.hero(), canFollow: () => photoPrev.from === 'ride' && rideAlong.active, following: () => photo.follow, follow: (on) => photo.followGuest(on),
      save: () => savePhoto(), exit: () => exitPhoto(), gallery: photoGallery,
    });
    photoEl = pe;
    ui.append(pe);
  }
  ui.append(topbar, debug, recapEl, dock, toastEl, profileEl, help, news, settingsEl, trophiesEl, statsEl, viewHud);
  { const touchBar = el('st-touch-controls'); touchWire.bindBar(touchBar); ui.append(touchBar); }
  {
    const pause = el('st-pause-menu');
    pauseRef = pause;
    pause.bind({
      save: () => saveLoadRef?.open('save'), load: () => saveLoadRef?.open('load'), settings: () => settingsRef?.open(), help: () => helpRef?.open(),
      mainMenu: () => { void goToMenu(); }, trophies: () => trophiesEl.open(), stats: () => statsEl.open(),
    });
    ui.append(pause);
  }
  if (saves) {
    const saveEl = el('st-save-load');
    saveLoadRef = saveEl;
    saveEl.bind({
      list: () => saves.list(), save: async (id, name) => { await saves.save(id ?? undefined, name); }, load: async (id) => { await saves.load(id); },
      remove: (id) => saves.delete(id), rename: (id, n) => saves.rename(id, n), exportSlot: async (id) => { await saves.exportSlot(id); }, importFile: async (f) => { await saves.importFile(f); },
      autosave: { get: () => saves.autosaveEnabled, set: (on) => { void saves.setAutosave(on); } }, backendKind: saves.backendKind, onChange: (fn) => saves.onChange(fn), lastSaved: () => saves.lastSavedAt,
    });
    ui.append(saveEl);
    saves.onChange(() => topbar.setLastSaved(saves.lastSavedAt));
    window.setInterval(() => topbar.refreshSaveTip(), 20000);
    void saves.loadSettings();
    saves.attach(bus, document, window);
    if (!bootSave) void saves.hasContinue().then((has) => topbar.showContinue(has));
  }
  for (const w of bootWarnings.splice(0)) toastEl.show(w, 'warn', 8000);
  if (bootSave) toastEl.show(`Loaded “${bootSave.env.meta.name}”`, 'info', 3500);
  for (const msg of startupErrors.splice(0)) toastEl.show(msg, 'error', 8000);
  // ---- PWA (Task 34): production-only service worker, update toast, offline pill, install button ----
  void registerSW({
    prod: import.meta.env.PROD, navigator, protocol: location.protocol, hostname: location.hostname, cachesApi: typeof caches !== 'undefined' ? caches : undefined,
    // Reload boots a NEW game unless we continue: save first, then come back with ?continue=1. No save possible => veto (the toast tells why).
    beforeApply: async () => {
      if (!saves || !sim || sim.finance.ended) return true;
      const rec = await saves.autosave('manual');
      if (!rec) { toast('Update paused: autosave is off or failed. Save your game (💾), then press Reload again.', 'warn'); return false; }
      return true;
    },
    reload: () => { window.location.search = saves ? 'continue=1' : ''; },
    onUpdate: (apply) => toastEl.show('Update available — reload', 'info', 0, { key: 'pwa:update', severity: 'good', tier: 'important', ttlMs: 10 * 60 * 1000, action: { label: 'Reload', run: () => { void apply(); } } }),
  }).catch(() => { /* registration failures must never affect the game */ });
  watchOnline(window, () => navigator.onLine, (off) => topbar.setOffline(off));
  watchInstall(window, (install) => topbar.setInstall(install ? () => { void install(); } : null));
  // ---- Tutorial assistant + contextual hints (Task 34a) ----
  safely('Tutorial', () => {
    const assistant = el('st-assistant');
    const spotlight = el('st-spotlight');
    const marker = new TutorialMarker((x, y) => heightAt(grid, x, y));
    renderer.scene.add(marker.mesh);
    { const prev = renderer.onFrame; renderer.onFrame = (dt): void => { prev?.(dt); marker.update(performance.now() / 1000); }; }
    /** Mirror assisted world changes in the views (the real tools do this themselves while the player builds). */
    const resync = (c: { chunks?: number[]; lift?: Parameters<NonNullable<typeof liftToolsRef>['view']['add']>[0] }): void => {
      buildingsView.sync();
      if (c.lift) liftToolsRef?.view.add(c.lift);
      if (c.chunks && c.chunks.length) refreshProps(c.chunks);
      covOverlay.invalidateHeights();
      refreshCoverage(undefined, true);
      refreshUi();
    };
    const ctl = renderer.controls;
    const tut = tutorialRef = createTutorial({
      sim, pollMs: 500,
      storage: (() => { try { return window.localStorage; } catch { return null; } })(),
      deliver: (h) => assistant.hint(h.text),
      host: {
        changed: resync,
        camera: () => ({ x: ctl.target.x, y: ctl.target.z, yaw: ctl.yaw, zoom: ctl.zoom }),
        jumpToDay: (d) => jumpSimToDay(d),
        save: () => { void saves?.quickSave().catch(() => {}); },
        setSpeed: (sp) => loop.setSpeed(sp),
        setOverlay: (m) => setOverlay(m as OverlayMode),
      },
    });
    const eng = tut.engine;
    assistant.bind({
      show: () => { eng.showMe(); }, doIt: () => { eng.doItForMe(); }, skip: () => eng.skip(), next: () => eng.next(), prev: () => eng.previous(),
      minimise: (v) => eng.setMinimised(v), exit: () => eng.exit(),
    });
    spotlight.bind({ resolve: (chain) => resolveChain(chain) });
    // Ranger Rudi's advice (M5.1): the advisor is paused while the tutorial runs (tutorial has priority); "Show me" reuses the ping marker + camera focus.
    assistant.bindAdvice({
      show: (id) => { const adv = sim.advisor.ranked().find((a) => a.id === id), tg = adv?.target; const st = adv?.action?.site, def = adv?.action ? BUILDINGS[adv.action.building] : undefined; if (tg) goTo({ x: tg.x, y: tg.y, ...(st && def ? { rect: { x: st.x, y: st.y, w: st.rot % 2 ? def.h : def.w, h: st.rot % 2 ? def.w : def.h } } : {}), ...(tg.kind === 'building' && tg.id !== undefined ? { entityKind: 'building' as const, entityId: tg.id } : {}) }); else if (adv?.panel) showPanel(adv.panel); else toast(ADVISOR_UI.noTarget, 'info'); },
      dismiss: (id) => sim.advisor.dismiss(id),
    });
    sim.advisor.onChange(() => assistant.renderAdvice({ items: sim.advisor.top().map((a) => ({ id: a.id, severity: a.severity, title: a.title, why: a.why, ...(a.friendly ? { friendly: a.friendly } : {}) })), count: sim.advisor.count() }));
    const setAdvisorPaused = (on: boolean): void => { if (sim.advisor.paused === on) return; sim.advisor.paused = on; if (!on) sim.advisor.evaluate(true); sim.advisor.refresh(); };
    eng.onChange(() => { const v = eng.view(); assistant.render(v); spotlight.setTarget(v.ui); marker.set(v.map); setGoalsHidden(v.status === 'active' || v.status === 'blocked'); recapEl.suppress(v.status === 'active' || v.status === 'blocked'); setAdvisorPaused(v.status === 'active' || v.status === 'blocked'); });
    if (TUTORIAL_MODE) sim.advisor.paused = true; else sim.advisor.evaluate(true);
    { const st = eng.view().status; if (shouldShowRecap({ loadedSave: !!bootSave, demo: DEMO, tutorialMode: TUTORIAL_MODE, tutorialActive: st === 'active' || st === 'blocked' })) recapEl.showRecap(buildRecap()); }
    ui.append(spotlight, assistant);
    helpRef?.bindTutorial(() => { window.location.search = TUTORIAL_QUERY; });
    saves?.onChange(() => eng.notify('game:saved'));
    if (!sim.config.hints && !TUTORIAL_MODE) tut.hints.setEnabled(false);
    tut.hints.start();
    if (TUTORIAL_MODE && !bootSave) {
      const q = new URLSearchParams(window.location.search); q.delete('tutorial');
      window.history.replaceState(null, '', window.location.pathname + (q.toString() ? `?${q}` : ''));
      eng.start({ fresh: true });
    }
    (window as unknown as { __tutorial?: unknown }).__tutorial = tut; // debugging
  }, (m) => startupErrors.push(m));
}

// Esc pause menu: CAPTURE phase so it sees the state from BEFORE the tools / dock handle the same Esc (a tool or drawer cancel never opens it).
// Ride-along keys (capture phase, registered BEFORE the pause-menu handler): Esc exits, N next guest, C recentres; every other non-time key is swallowed
// so the tools / overlays / help never react to keys while the UI is hidden. Time keys (Space + - . ,) and modified keys fall through.
window.addEventListener('keydown', (e) => {
  if (renderer.viewMode.mode !== 'ride') return;
  if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); exitRide(); return; }
  const k = e.key.toLowerCase();
  if (k === 'n' && !e.ctrlKey && !e.metaKey) { e.stopImmediatePropagation(); nextRide(); return; }
  if (k === 'c' && !e.ctrlKey && !e.metaKey) { e.stopImmediatePropagation(); renderer.rig.recentre(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key) || speedKeyAction(e)) return;
  e.stopPropagation();
}, true);
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey || !pauseRef) return;
  if (modalStack.size) return; // the modal stack (src/ui/modal.ts, registered first) already closed the top-most dialog
  if (gameMenuHandle) { closeGameMenu(); e.stopPropagation(); return; }
  const t = ((e.composedPath?.()[0] as HTMLElement | undefined) ?? e.target) as HTMLElement | null; // the real target: events from inputs inside a shadow root are retargeted to the host
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const busy = !tools.isDefault() || dockRef?.drawerOpen || sim.finance.ended;
  if (!busy) pauseRef.open();
}, true);

window.addEventListener('keydown', (e) => {
  const t = ((e.composedPath?.()[0] as HTMLElement | undefined) ?? e.target) as HTMLElement | null; // the real target: events from inputs inside a shadow root are retargeted to the host
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (saves && (e.key === 'F5' || e.key === 'F9') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (e.key === 'F5') void saves.quickSave().catch(() => {}); else void saves.quickLoad(); return; }
  // Ctrl/Cmd+Z undoes, Ctrl+Shift+Z / Ctrl+Y redoes: ONE shared stack for every build action (placements, lifts, strokes, terraform, planting, bulldozes).
  if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.altKey) { e.preventDefault(); if (e.shiftKey) performRedo(); else performUndo(); return; }
  if ((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) { e.preventDefault(); performRedo(); return; }
  if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey) && !e.altKey) { e.preventDefault(); if (saves && !sim.finance.ended) saveLoadRef?.open('save'); return; }
  if ((e.key === 'k' || e.key === 'K') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !modalStack.size) { e.preventDefault(); startFf('month'); return; } // Skip to next month
  const speedAct = speedKeyAction(e);
  if (speedAct) {
    e.preventDefault();
    if (speedAct === 'toggle') loop.togglePause(); else loop.changeSpeed(speedAct === 'faster' ? 1 : -1);
  }
  if (e.key === '?' || e.key === 'h' || e.key === 'H') helpRef?.toggle();
  if ((e.key === 'g' || e.key === 'G') && activeTool() !== 'plant') terrain.gridOverlay = !terrain.gridOverlay;
  if (e.key === 'b' || e.key === 'B') toggleGallery(); // debug: building gallery
  if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey && !modalStack.size && !drop.active) { if (e.shiftKey) startDrop(); else enterWalk(); } // walk mode: V = default path spot, Shift+V = choose start (while walking the walk key handler takes V first)
  if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey && !modalStack.size) enterPhoto(); // photo mode (from a ride-along the capture handler above takes P)
  if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey && !e.altKey && !drop.active && renderer.viewMode.mode === 'iso' && !DEMO && (!modalStack.size || statsRef?.isOpen)) statsRef?.toggle(); // statistics (Esc closes it through the modal stack)
  if (e.key === 'o' || e.key === 'O') setOverlay(OVERLAY_MODES[(OVERLAY_MODES.indexOf(overlayMode) + 1) % OVERLAY_MODES.length]!);
});

(window as unknown as { __slope: unknown }).__slope = { select, selectPiste, setOverlay, startPlacement, refreshProps, debugPlace: (type: string, x: number, y: number, rot = 0, flatten = true) => { const o = debugPlaceBuilding(sim.env, props, type, x, y, rot, flatten, false); if (o.ok && o.building) { sim.refreshCoverage(o.building, true); sim.buildings.reevaluate(); sim.refreshCoverage(undefined, true); } return o; }, sim, trees, rocks, villageDecor, landscapeTool, landscapeDecor, landscapeDebug: { /* visual-QA harness: place without the mouse */ find: (extent = 5, from = 0) => { const env = sim.landscapeEnv(); let n = 0; for (let y = 8; y < grid.size - 8; y++) for (let x = 8; x < grid.size - 8; x++) if (planPond(env, pondRectAround(x, y, extent)).ok && n++ >= from) return { x, y }; return null; }, dig: (x: number, y: number, extent = 5) => { const env = sim.landscapeEnv(), plan = planPond(env, pondRectAround(x, y, extent)); if (plan.ok) { const r = applyPond(env, sim.landscape, plan); refreshProps(r.touchedChunks); } return plan.ok ? plan.cost : plan.reason; }, decor: (kind: Parameters<typeof planDecor>[3], x: number, y: number, rot: 0 | 1 = 0) => { const p = planDecor(sim.landscapeEnv(), x, y, kind); if (p.ok) applyDecor(sim.landscape, x, y, kind, rot); return p.ok ? 'ok' : p.reason; }, rocks: (x: number, y: number, brush = 3) => { const p = planRocks(sim.landscapeEnv(), x, y, brush, 0); refreshProps(applyRocks(props, p)); return p.rocks.length; } }, festivalDressing, fireworks, natureView, materialGuard, setHour: (h: number | null) => { timeOverride = h; lastHour = -1; }, perf: perfApi, game, loop, registry, eventLog, lighting, bus, buildingMeshes, buildingsView, renderer, terrain, water, terrainInfo, grid, props, terraform, overlays, buildings, economy, placement, coverage, covOverlay, liftTools, weather, snow, cond, openStatus, precip, guestSim, guestRenderer, get safety() { return safetyRef; }, get saves() { return saves; } };
bootStage('frame');
hideSplash();

/** Debug / QA (docs/festivals.md): `__slope.events.start('almabtrieb')` runs an event from today (news + dressing); `.jump()` jumps the date to 3 days before the Almabtrieb (announcement), `.jump(0)` to its first day. */
(window as unknown as { __slope: Record<string, unknown> }).__slope.events = {
  start: (id: string, days?: number) => { const ok = sim.events.debugStart(id as FestivalId, days); festivalCheck = 0; return ok; },
  jump: (before = 3) => { jumpSimToDay(almabtriebWindow().first - before, 9); sim.tick(2); festivalCheck = 0; return sim.events.active().map((e) => e.id); },
  active: () => sim.events.active().map((e) => e.id), upcoming: () => sim.events.upcoming().map((u) => `${u.id}+${u.daysAway}`),
};
Object.assign((window as unknown as { __slope: Record<string, unknown> }).__slope, {
  fx: fxApi, view: viewApi, ff, startFf,
  /** QA (touch e2e): the ToolManager and the touch wire (controller / gestures state). */
  tools, touch: touchWire, selection: () => ({ building: selectedId, piste: selectedPiste }),
  /** Debug / QA: `achievements.unlock('first-lift')` (forced, toasts like a real unlock), `.engine`, `.announcer`, `.trophies()` opens the shelf. */
  achievements: { engine: ach, announcer: achAnnouncer, unlock: (id: string) => ach.unlock(id, true), select: (k: 'palette' | 'flags' | 'frame' | 'chair', id: string) => ach.select(k, id), trophies: () => { const t = document.querySelector('st-trophies') as (HTMLElement & { open(): void }) | null; t?.open(); return !!t; } },
  populateDemo, populateTown, findBear: findBearDebug, spawnBear: spawnBearDebug, findAnimal: findAnimalDebug, spawnGuests: (n: number, mix: 'mixed' | 'skiers' | 'hikers' = 'mixed') => spawnGuests(sim, n, mix, ++debugSpawnCount),
  demoReport, jumpSimToDay,
  /** Debug only (screenshots / QA): `setLevel(n)` raises the Career level as if earned (fires the normal level-up: confetti, news, card). */
  progression: { setLevel: (n: number) => sim.progression.setLevel(n), view: () => sim.progression.view(), mode: () => sim.progression.mode, unlockAll: (on: boolean) => { sim.progression.unlockAll = on; } },
});

if (DEMO) {
  sim.tick(20); // settle: guests start skiing, lifts load (hooks like refreshUi exist by now)
  // ---- Title-screen demo: real sim + real renderer, a camera director, ~100 s days, winter <-> summer every ~3 min ----
  const dom = renderer.webgl.domElement;
  dom.style.pointerEvents = 'none'; // decoration only: no picking / camera input behind the menu
  demoBag.add(() => { dom.style.pointerEvents = ''; });
  loop.setSpeed(1); loop.fastNights = false; loop.timeScale = demoTimeScale();
  const lodgeB = buildings.all().find((b) => b.type === 'baseLodge');
  const lc = lodgeB ? { x: lodgeB.x + lodgeB.w / 2, z: lodgeB.y + lodgeB.h / 2 } : { x: terrainInfo.villageAnchor.x, z: terrainInfo.villageAnchor.y };
  const zr = (wide: number, close: number): [number, number] => [(MAP_SIZE * 0.75) / wide, (MAP_SIZE * 0.75) / close]; // zoom range from visible tiles (tall)
  const pois: Poi[] = [{ kind: 'village', id: 'village', at: () => lc, zoom: zr(30, 17), weight: 2 }];
  for (const l of lifts.all()) {
    pois.push({ kind: 'lift', id: `lift-b${l.id}`, at: () => ({ x: l.bottom.x + 1, z: l.bottom.y + 1 }), zoom: zr(18, 11) });
    pois.push({ kind: 'lift', id: `lift-t${l.id}`, at: () => ({ x: l.top.x + 1, z: l.top.y + 1 }), zoom: zr(18, 11) });
    pois.push({
      kind: 'carrier', id: `carrier${l.id}`, follow: true, zoom: zr(14, 9), weight: 1.5,
      at: () => { if (!l.open || !liftToolsRef) return null; const cs = carrierStates(l, liftToolsRef.view.phaseOf(l.id)); const c = cs[(l.id * 3) % Math.max(1, cs.length)]; return c ? { x: c.x, z: c.z } : null; },
    });
  }
  (demoReport?.pisteMids ?? []).forEach((m, i) => pois.push({ kind: 'piste', id: `piste${i}`, at: () => ({ x: m.x, z: m.y }), zoom: zr(22, 13), weight: 1.5 }));
  terrainInfo.lakes.forEach((lk, i) => {
    let sx = 0, sy = 0;
    for (const t of lk.tileIdx) { sx += t % MAP_SIZE; sy += (t / MAP_SIZE) | 0; }
    const n = Math.max(1, lk.tileIdx.length);
    pois.push({ kind: 'lake', id: `lake${i}`, at: () => ({ x: sx / n, z: sy / n }), zoom: zr(26, 16), weight: poiFocus(DEMO_TOWN.id, 'lake') });
  });
  const station = buildings.all().find((b) => b.type === 'trainStation');
  if (station) pois.push({ kind: 'train', id: 'train', at: () => ({ x: station.x + station.w / 2, z: station.y + station.h / 2 }), zoom: zr(18, 11), weight: 1.5 });
  pois.push({ kind: 'cat', id: 'cat', follow: true, zoom: zr(16, 10), weight: 3, at: () => { const c = ops.grooming.cats.find((q) => !q.done && q.route.length > 0); return c ? { x: c.x, z: c.y } : null; } });
  let skierSlot = -1, skierId = 0;
  pois.push({
    kind: 'skier', id: 'skier', follow: true, zoom: zr(14, 9), weight: 2.5,
    at: () => {
      const st = guestSim.store;
      const ok = (i: number): boolean => i >= 0 && st.alive[i] === 1 && st.id[i] === skierId && isSkiMode(st.moveMode[i]!);
      if (!ok(skierSlot)) {
        skierSlot = -1;
        for (let k = 0; k < st.limit; k++) { const i = (k * 11 + loop.tickCount * 7) % st.limit; if (st.alive[i] === 1 && isSkiMode(st.moveMode[i]!) && st.state[i] === 0) { skierSlot = i; skierId = st.id[i]!; break; } }
      }
      return skierSlot >= 0 ? { x: st.x[skierSlot]!, z: st.y[skierSlot]! } : null;
    },
  });
  pois.push({ kind: 'animal', id: 'animal', weight: poiFocus(DEMO_TOWN.id, 'animal'), zoom: zr(18, 12), at: () => { const a = sim.nature.fauna.findNearest(null, lc.x, lc.z).find((q) => q.species !== 'eagle'); return a ? { x: a.x, z: a.y } : null; } });
  { // the Alpine Farm: the herd grazing on the pastures (summer / spring / autumn: null while the cows are in the barn, so winter never picks it)
    const farmB = buildings.all().find((b) => b.type === 'alpineFarm');
    if (farmB) {
      pois.push({
        kind: 'farm', id: 'farm', weight: 2.5, zoom: zr(18, 11),
        at: () => {
          const vis = sim.nature.livestock.animals.filter((a) => !a.hidden && a.farm === farmB.id);
          if (!vis.length) return null;
          return { x: vis.reduce((t, a) => t + a.x, 0) / vis.length, z: vis.reduce((t, a) => t + a.y, 0) / vis.length };
        },
      });
    }
  }
  for (const sp of townPoiSpecs(DEMO_TOWN.id, demoReport?.sites ?? {})) if (sp.kind !== 'train' && sp.kind !== 'farm') pois.push({ kind: sp.kind, id: sp.id, at: () => sp.at, zoom: zr(sp.view[0], sp.view[1]), weight: sp.weight }); // farm + station POIs exist above
  const scene = new DemoScene({
    controls: renderer.controls, size: MAP_SIZE, aspect: () => renderer.webgl.domElement.clientWidth / Math.max(1, renderer.webgl.domElement.clientHeight),
    pois: () => pois, groundY: (x, z) => heightAt(grid, x, z),
    jumpSeason: (s) => jumpSimToDay(s === 'summer' ? DEMO_SUMMER_DAY : DEMO_WINTER_DAY, 8),
    reducedMotion: !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, container: document.body, blur: !params.has('nomenu'),
  }, SEED);
  scene.seasonsEnabled = !!townOf(DEMO_TOWN.id)?.seasonLoop && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; // summer towns stay summer; reduced motion: no season flashes
  { const c = renderer.controls; c.yaw = 0.9; c.zoom = (MAP_SIZE * 0.75) / 24; c.target.set(lc.x, heightAt(grid, lc.x, lc.z), lc.z); c.zoomBy(1); }
  // Morning top-up: the guests leave at closing time like in a real game; every morning ~8:30 the car park refills (own RNG stream)
  const DEMO_GUESTS = demoGuestCap();
  let lastTopUp = -1;
  const topUp = (): void => {
    const hr = game.date.minute / 60, abs = game.date.year * DAYS_PER_YEAR + game.date.day;
    if (hr < 8.5 || hr > 12 || abs === lastTopUp) return;
    lastTopUp = abs;
    const deficit = DEMO_GUESTS - guestSim.store.count;
    if (deficit > 15) spawnGuests(sim, deficit, townOf(DEMO_TOWN.id)!.guests, ++debugSpawnCount);
  };
  lastTopUp = game.date.year * DAYS_PER_YEAR + game.date.day; // today's crowd is the initial spawn
  (window as unknown as { __slope: Record<string, unknown> }).__slope.demoTopUp = topUp;
  { const prev = renderer.onFrame; renderer.onFrame = (dt): void => { prev?.(dt); topUp(); scene.update(dt); }; }
  if (!params.has('nomenu')) { // caption + Shuffle: store the next pick, fade out, reload (a fresh sim + renderer: nothing can leak)
    const shuffle = (): void => {
      const next = pickTitleTown({ rand: uiRand, last: townKey(DEMO_TOWN), deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory });
      try { window.localStorage.setItem('slope.title.next', `${next.id}:${next.seed}:${next.size}`); } catch { /* ignore */ }
      const fade = document.createElement('div');
      fade.style.cssText = 'position:fixed;inset:0;z-index:60;background:#06090f;opacity:0;transition:opacity .25s';
      document.body.appendChild(fade);
      requestAnimationFrame(() => { fade.style.opacity = '1'; });
      window.setTimeout(() => { demoBag.dispose(); window.location.search = ''; if (!window.location.search) window.location.reload(); }, 280);
    };
    const cap = mountTownCaption(document, `${townCaption(DEMO_TOWN)} \u00B7 ${regionNameOf(DEMO_TOWN.seed)}`, shuffle);
    demoBag.add(() => cap.dispose());
  }
  demoBag.add(() => { scene.dispose(); });
  demoBag.add(() => { renderer.onFrame = null; });
  demoBag.add(() => { loop.dispose(); });
  demoBag.add(() => { disposeTree(renderer.scene); renderer.scene.clear(); renderer.dispose(); });
  demoHandle = { dispose: () => { demoBag.dispose(); } };
  Object.assign((window as unknown as { __slope: Record<string, unknown> }).__slope, { demo: scene, demoPois: pois });
}

renderer.start();
}
