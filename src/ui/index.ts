import { StTopBar } from './components/StTopBar';
import { StDock } from './components/StDock';
import { StHud } from './components/StHud';
import { StDebug } from './components/StDebug';
import { StInspector } from './components/StInspector';
import { StToast } from './components/StToast';
import { StLiftInspector } from './components/StLiftInspector';
import { StHelp } from './components/StHelp';
import { StSpeedControl } from './components/StSpeedControl';
import { StEventLog } from './components/StEventLog';
import { StFinance } from './components/StFinance';
import { StLoans } from './components/StLoans';
import { StProfile } from './components/StProfile';
import { StNews } from './components/StNews';
import { StGuestInspector } from './components/StGuestInspector';
import { StRating } from './components/StRating';
import { StPerf } from './components/StPerf';
import { StOperations } from './components/StOperations';
import { StPisteInspector } from './components/StPisteInspector';
import { StRouteInspector } from './components/StRouteInspector';
import { StMarketing } from './components/StMarketing';
import { StPricing } from './components/StPricing';
import { StSettings } from './components/StSettings';
import { StSaveLoad } from './components/StSaveLoad';
import { StAssistant } from './components/StAssistant';
import { StSpotlight } from './components/StSpotlight';
import { StMainMenu } from './components/StMainMenu';
import { StNewGame } from './components/StNewGame';
import { StPauseMenu } from './components/StPauseMenu';
import { StSelect } from './components/StSelect';
import { StModal } from './components/StModal';
import { StGoals } from './components/StGoals';
import { StEvents } from './components/StEvents';
import { StRecap } from './components/StRecap';
import { StWhatsNew } from './components/StWhatsNew';
import { StViewHud } from './components/StViewHud';
import { StPhoto } from './components/StPhoto';
import { StYearReport } from './components/StYearReport';
import { StScenarios } from './components/StScenarios';
import { StTrophies } from './components/StTrophies';
import { StStats } from './components/StStats';
import { StScenarioCard } from './components/StScenarioCard';
import { StScenarioResult } from './components/StScenarioResult';
import { StTouchControls } from './components/StTouchControls';

/** Every custom element: tag -> constructor. The single source of truth (registerComponents, typed helpers, DOM tests). */
export const COMPONENTS = {
  'st-topbar': StTopBar,
  'st-dock': StDock,
  'st-hud': StHud,
  'st-debug': StDebug,
  'st-inspector': StInspector,
  'st-toast': StToast,
  'st-lift-inspector': StLiftInspector,
  'st-help': StHelp,
  'st-speed-control': StSpeedControl,
  'st-event-log': StEventLog,
  'st-finance': StFinance,
  'st-loans': StLoans,
  'st-profile': StProfile,
  'st-news': StNews,
  'st-guest-inspector': StGuestInspector,
  'st-rating': StRating,
  'st-perf': StPerf,
  'st-operations': StOperations,
  'st-piste-inspector': StPisteInspector,
  'st-route-inspector': StRouteInspector,
  'st-marketing': StMarketing,
  'st-events': StEvents,
  'st-pricing': StPricing,
  'st-settings': StSettings,
  'st-save-load': StSaveLoad,
  'st-assistant': StAssistant,
  'st-spotlight': StSpotlight,
  'st-main-menu': StMainMenu,
  'st-new-game': StNewGame,
  'st-pause-menu': StPauseMenu,
  'st-select': StSelect,
  'st-modal': StModal,
  'st-goals': StGoals,
  'st-recap': StRecap,
  'st-whats-new': StWhatsNew,
  'st-view-hud': StViewHud,
  'st-photo': StPhoto,
  'st-year-report': StYearReport,
  'st-scenarios': StScenarios,
  'st-trophies': StTrophies,
  'st-stats': StStats,
  'st-scenario-card': StScenarioCard,
  'st-scenario-result': StScenarioResult,
  'st-touch-controls': StTouchControls,
} as const;

export type StTagMap = { [K in keyof typeof COMPONENTS]: InstanceType<(typeof COMPONENTS)[K]> };
export const ALL_COMPONENT_TAGS = Object.keys(COMPONENTS) as Array<keyof StTagMap>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface HTMLElementTagNameMap extends StTagMap {}
}

/** Typed element factory: API mismatches against the component classes become compile errors. */
export function el<K extends keyof StTagMap>(tag: K): StTagMap[K] { return document.createElement(tag); }

export function registerComponents(): void {
  for (const tag of ALL_COMPONENT_TAGS) if (!customElements.get(tag)) customElements.define(tag, COMPONENTS[tag]);
}
export { StPerf, StTopBar, StDock, StHud, StDebug, StInspector, StToast, StHelp, StSpeedControl, StEventLog, StFinance, StLoans, StProfile, StNews, StGuestInspector, StRating, StLiftInspector, StOperations, StPisteInspector, StRouteInspector, StSettings, StSaveLoad, StAssistant, StSpotlight, StMainMenu, StNewGame, StPauseMenu, StSelect, StModal, StGoals, StRecap, StWhatsNew, StViewHud, StPhoto };
