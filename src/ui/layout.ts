/**
 * Panel anchor zones. Every always-visible HUD component sits in exactly ONE zone; two always-visible components never share a zone
 * (tests/ui/layout.test.ts) and the zone rectangles (computed from the same constants the CSS uses) never overlap at 1280x800, 1920x1080
 * or 1000x700 - including the *open* states of the debug panel and the news feed, and the dock drawer. Transient panels (modals, toasts)
 * use their own zone and are allowed to cover the rest.
 * If you move a component in CSS, update its row + zoneRect here.
 *
 *   top-left      st-topbar                       (8,8) 520x36
 *   left-under    st-settings audio hint          (8,50) 40x28
 *   left-debug    st-debug when OPEN              (8,80) 300 x max(140, vh-540)   [collapsed: bottom-left]
 *   bottom-left   st-debug button (collapsed)     (8, vh-8-30) 110x30
 *   left-assist   st-assistant                    (8, vh-84-h) 340 x 360 (wide) / 56x56 badge (< 1100 px)
 *   bottom-center st-dock row (752 wide, centred)
 *   bottom-drawer the build drawer: one row of cards, <= 190 px tall, above the dock row, between the assistant column (left 352) and the news column (right 252); 72/80 px insets under 1100 px (badges); max 1200 wide
 *   top-center    st-toast                        below the top bar
 *   top-card      st-recap (hidden unless shown)  (vw/2-160, 216) 320x280 recap / 320x150 month card / 320x168 level-up card; transient, below the 4-toast stack (56 + 4 x 38), left of the right column, above the drawer; never blocks input (host pointer-events none)
 *   top-right     #right-col: HUD + speed + tool status (+ inspectors, which stack below)

 *   right-goals   st-goals                        (vw-268, 214) 260x140 expanded / 260x32 collapsed; a child of #right-col (order 1, under the HUD block), hidden while the tutorial runs
 *   right-news    st-news                         (vw-252, vh-84-h) 244 x (28 collapsed / ~360 open); a 64 px badge when collapsed under 1100 px
 *   bottom-right  st-help ? button
 */
export type Zone =
  | 'top-left' | 'left-under' | 'left-debug' | 'bottom-left' | 'left-assist' | 'top-center' | 'top-right' | 'right-goals' | 'top-card' | 'right-news'
  | 'bottom-center' | 'bottom-drawer' | 'bottom-right' | 'modal';

export interface PanelAnchor { tag: string; zone: Zone; alwaysVisible: boolean; /** zone while expanded (debug panel, news) */ openZone?: Zone; note?: string }

export const PANELS: readonly PanelAnchor[] = [
  { tag: 'st-topbar', zone: 'top-left', alwaysVisible: true },
  { tag: 'st-settings', zone: 'left-under', alwaysVisible: false, note: 'only the audio-locked hint; the card is a modal' },
  { tag: 'st-toast', zone: 'top-center', alwaysVisible: true },
  { tag: '#right-col', zone: 'top-right', alwaysVisible: true, note: 'flex column: st-hud, st-speed-control (speed buttons + fast nights + Skip-to menu button; its fast-forward pill is position:fixed bottom-centre above the dock and the menu is a fixed popup, so the column footprint is unchanged), tool status, then inspectors (stacked, no overlap by construction)' },
  { tag: 'st-dock', zone: 'bottom-center', openZone: 'bottom-drawer', alwaysVisible: true, note: 'dock row (always) + low-profile drawer between the assistant column and the news column (open)' },
  { tag: 'st-debug', zone: 'bottom-left', openZone: 'left-debug', alwaysVisible: true, note: 'collapsed button bottom-left; opens top-left under the top bar (F3)' },
  { tag: 'st-assistant', zone: 'left-assist', alwaysVisible: false, note: 'tutorial / hints; a 56 px badge under 1100 px wide. Advice mode (Ranger Rudi, M5.1): the same 340x214 box + avatar row with a small Advice badge; hidden while the tutorial runs; under 1100 px the card is a transient overlay the player opens (closes on Show me)' },
  { tag: 'st-recap', zone: 'top-card', alwaysVisible: false, note: 'Welcome-back recap (~20 s) / month-end card (~8 s) / level-up card (M5.3, 320x168, ~14 s, \'New: ...\' + Show me); one at a time, one click dismisses; hidden during the tutorial' },
  { tag: 'st-goals', zone: 'right-goals', alwaysVisible: true, note: 'resort goal chain card (collapsible, 3 goals); a level chip in its header swaps the body for the level progress (same footprint); hidden while the tutorial runs' },
  { tag: 'st-scenario-card', zone: 'right-goals', alwaysVisible: false, note: 'scenario games only: REPLACES st-goals in the same zone (objective list scrolls inside the 260x140 footprint); hidden after "Continue playing (sandbox mode)"' },
  { tag: 'st-trophies', zone: 'modal', alwaysVisible: false, note: 'trophy shelf dialog (shared modal frame, lg): achievements, tiers, scenario medals' },
  { tag: 'st-scenarios', zone: 'modal', alwaysVisible: false, note: 'scenario picker dialog (shared modal frame)' },
  { tag: 'st-scenario-result', zone: 'modal', alwaysVisible: false, note: 'win / lose dialog (shared modal frame), the game is paused while it is open' },
  { tag: 'st-news', zone: 'right-news', alwaysVisible: true, note: 'collapsed = header button; opens upwards' },
  { tag: 'st-help', zone: 'bottom-right', alwaysVisible: true, note: 'small ? button' },
  { tag: 'st-view-hud', zone: 'bottom-center', alwaysVisible: false, note: 'ride-along HUD card (bottom centre, replaces the dock: body.view-ride hides every other #ui child except toasts); a pointer-events:none cabin frame layer; never blocks the canvas' },
  { tag: 'st-photo', zone: 'left-assist', alwaysVisible: false, note: 'photo-mode panel (left column, 286 px wide, collapsible; a bottom sheet under 700 px); body.view-photo hides every other #ui child except toasts, so it never overlaps another panel; its preview layer is pointer-events:none' },
  { tag: 'st-main-menu', zone: 'modal', alwaysVisible: false }, { tag: 'st-new-game', zone: 'modal', alwaysVisible: false },
  { tag: 'st-pause-menu', zone: 'modal', alwaysVisible: false }, { tag: 'st-save-load', zone: 'modal', alwaysVisible: false }, { tag: 'st-modal', zone: 'modal', alwaysVisible: false, note: 'About / confirm / bankrupt: shared dialog frame, z >= 100 (src/ui/modal.ts)' },
];

export interface Rect { x: number; y: number; w: number; h: number }
export const M = 8;
export const DOCK_ROW_H = 77;
/** Top of the transient recap / month-end card: right under a full stack of four toasts (they start at y=56, ~38 px each). */
export const TOP_CARD_Y = 216;
/** Goals card: expanded footprint (header + three goals). Fits between the HUD block (ends y=208) and the open news feed at 1280x800. */
export const GOALS_CARD_H = 140;
/** Narrow-window breakpoint: assistant + news collapse into badges below this width. */
export const NARROW_PX = 1100;
export const DOCK_W = 752;
/** Build drawer: max height / width and the side insets that keep it clear of the assistant (left) and the news feed (right). */
export const DRAWER_MAX_H = 190;
/** Panel-style drawers (Finance / Operations / Marketing / Pricing) may be taller but share the same x-range (between the side columns). */
export const DRAWER_PANEL_MAX_H = 380;
export const DRAWER_MAX_W = 1200;
export const DRAWER_INSET_WIDE = { left: 352, right: 252 };
export const DRAWER_INSET_NARROW = { left: 72, right: 80 };
export const DRAWER_MIN_W = 420;
export function drawerBox(vw: number, vh: number): Rect {
  const ins = vw < NARROW_PX ? DRAWER_INSET_NARROW : DRAWER_INSET_WIDE;
  const avail = Math.max(DRAWER_MIN_W, vw - ins.left - ins.right), w = Math.min(DRAWER_MAX_W, avail);
  return { x: ins.left + (avail - w) / 2, y: vh - DOCK_ROW_H - 6 - DRAWER_MAX_H, w, h: DRAWER_MAX_H };
}
/** Zone rectangles (px) for a viewport, from the CSS constants (sizes are the maximum footprint of the state). */
export function zoneRect(zone: Zone, vw: number, vh: number, expanded = false): Rect | null {
  switch (zone) {
    case 'top-left': return { x: M, y: M, w: 520, h: 36 };
    case 'left-under': return { x: M, y: 50, w: 40, h: 28 };
    case 'left-debug': return { x: M, y: 80, w: 300, h: Math.max(140, vh - 540) };
    case 'top-center': return { x: vw / 2 - 160, y: 56, w: 320, h: 80 };
    case 'top-right': return { x: vw - 260 - M, y: M, w: 260, h: 200 };
    case 'top-card': return { x: vw / 2 - 160, y: TOP_CARD_Y, w: 320, h: 280 };
    case 'right-goals': return { x: vw - 260 - M, y: M + 200 + 6, w: 260, h: GOALS_CARD_H };
    case 'bottom-center': return { x: vw / 2 - DOCK_W / 2, y: vh - M - DOCK_ROW_H + 8, w: DOCK_W, h: DOCK_ROW_H - 8 };
    case 'bottom-drawer': { const d = drawerBox(vw, vh); return d; }
    case 'bottom-left': return { x: M, y: vh - M - 30, w: 110, h: 30 };
    case 'left-assist': return vw < NARROW_PX ? { x: M, y: vh - 84 - 56, w: 56, h: 56 } : { x: M, y: vh - 84 - 360, w: 340, h: 360 };
    case 'right-news': { const h = expanded ? 360 : 28, w = expanded || vw >= NARROW_PX ? 244 : 64; return { x: vw - w - M, y: vh - 84 - h, w, h }; }
    case 'bottom-right': return { x: vw - M - 30, y: vh - M - 30, w: 30, h: 30 };
    default: return null;
  }
}
export const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
