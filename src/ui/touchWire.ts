import { TouchController } from '@/render/TouchController';
import type { CameraController } from '@/render/CameraController';
import { TOUCH_MIN_TARGET_PX, resolveTouchEnabled, toolKindOf } from '@/render/touch';
import { accessibility, type TouchSetting } from './accessibility';
import type { StTouchControls } from './components/StTouchControls';
import { installTouchTips } from './touchTips';

export interface TouchWireOptions {
  dom: HTMLElement;
  camera: CameraController;
  toolId(): string;
  /** Called by the Cancel buttons (ToolManager.reset). */
  cancelTool(): void;
  confirmPlacement(): boolean;
  ghostText?(): string;
  rotateGhost(dir: 1 | -1): void;
  undo(): void;
  togglePause?(): void;
}
export interface TouchWire {
  controller: TouchController;
  /** Hold-for-tooltip (tests tune `holdMs`). */
  tips: { holdMs: number };
  /** Touch input on right now (setting + media query + `?touch=`)? */
  enabled(): boolean;
  /** Attach the on-screen bar. */
  bindBar(bar: StTouchControls): void;
  /** Call on every tool change. */
  toolChanged(): void;
  dispose(): void;
}

/** `?touch=1|0` (harness / debugging) wins over the setting. */
export function touchOverride(search: string): TouchSetting | null {
  const v = new URLSearchParams(search).get('touch');
  return v === '1' || v === 'on' ? 'on' : v === '0' || v === 'off' ? 'off' : null;
}

/** Glue: Settings > Touch controls (Auto / On / Off) + `(pointer: coarse)` -> controller + `data-touch` / `--touch-min-root` on <html> (>= 44 px targets in every component). */
export function wireTouch(o: TouchWireOptions): TouchWire {
  const a11y = accessibility();
  const mq = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
  const override = touchOverride(typeof location !== 'undefined' ? location.search : '');
  let on = false;
  let bar: StTouchControls | null = null;
  let drawerHidden = false;
  const dockEl = (): HTMLElement | null => document.querySelector('#ui > st-dock');
  /** Touch devices: the open drawer would cover the middle of the map you paint on (the drawers are as tall as a phone / tablet map), so choosing a card or touching the map tucks it away; the tool options button / a dock tap bring it back. (Was: short landscape screens only.) */
  const shortScreen = (): boolean => true;
  /** Tools that tuck the open drawer away at once: the ghost tools (the ghost needs the map). Paint tools on a short screen tuck it when a card is chosen or the map is touched (the drawer itself activates Terrain: it must not vanish the moment it opens). */
  const wantsHidden = (tool: string): boolean => on && (tool === 'placement' || tool === 'lift');
  const setDrawerHidden = (v: boolean): void => { drawerHidden = v; dockEl()?.classList.toggle('peek', v); bar?.setState({ drawerHidden: v }); };
  const enabled = (): boolean => on;
  // Registered BEFORE the controller: its window-capture handler stops touch pointerdowns on the canvas, so this one would never run after it.
  const mapTap = (e: PointerEvent): void => { if (on && e.pointerType === 'touch' && e.target === o.dom && !drawerHidden && shortScreen() && o.toolId() !== 'select') setDrawerHidden(true); };
  window.addEventListener('pointerdown', mapTap, true);
  const controller: TouchController = new TouchController({
    dom: o.dom, camera: o.camera, toolId: o.toolId, enabled,
    confirmPlacement: o.confirmPlacement, ghostText: o.ghostText,
    onState: (s) => bar?.setState({ mode: s.mode, confirming: s.confirming, hint: s.hint, tool: o.toolId(), kind: toolKindOf(o.toolId()) }),
  });
  const apply = (): void => {
    on = resolveTouchEnabled(override ?? a11y.get().touch, !!mq?.matches);
    const r = document.documentElement;
    if (on) { r.setAttribute('data-touch', ''); r.style.setProperty('--touch-min-root', `${TOUCH_MIN_TARGET_PX}px`); } else { r.removeAttribute('data-touch'); r.style.removeProperty('--touch-min-root'); }
    if (!on) controller.reset();
    bar?.setState({ enabled: on, tool: o.toolId(), kind: toolKindOf(o.toolId()), mode: controller.mode, confirming: controller.confirming });
  };
  const tips = installTouchTips({ enabled });
  const hold = Number(new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('touchhold')); // harness: `?touchhold=ms` (emulated devices are slow: a 100 ms tap arrives 500 ms long)
  if (hold > 0) tips.holdMs = hold;
  // Tapping a dock button (opening / switching a drawer) brings the drawer back: the user asked for it.
  const dockTap = (e: PointerEvent): void => { if (e.pointerType === 'touch' && drawerHidden && e.composedPath().some((n) => (n as HTMLElement).classList?.contains('dock'))) setDrawerHidden(false); };
  window.addEventListener('pointerdown', dockTap, true);
  // Short screen: choosing a card (another brush, another piste kind) tucks the drawer away again so the map is free to paint on.
  const cardTap = (e: Event): void => { if (on && shortScreen() && e.composedPath().some((n) => (n as HTMLElement).classList?.contains('card') && !(n as HTMLElement).classList.contains('locked'))) window.setTimeout(() => { if (o.toolId() !== 'select') setDrawerHidden(true); }, 150); };
  window.addEventListener('click', cardTap, true);
  const un = a11y.subscribe(apply);
  mq?.addEventListener?.('change', apply);
  apply();
  return {
    controller, enabled, tips,
    bindBar(b) {
      bar = b;
      b.bind({
        setMode: (m) => controller.setMode(m), confirm: () => { controller.confirm(); }, cancelTool: () => o.cancelTool(), undo: () => o.undo(),
        rotateView: (d) => o.camera.rotateSnap(d), rotateGhost: (d) => o.rotateGhost(d), togglePause: o.togglePause, toggleDrawer: () => setDrawerHidden(!drawerHidden),
      });
      apply();
    },
    toolChanged() {
      controller.toolChanged();
      setDrawerHidden(wantsHidden(o.toolId()));
      bar?.setState({ tool: o.toolId(), kind: toolKindOf(o.toolId()) });
    },
    dispose() { un(); tips.dispose(); window.removeEventListener('pointerdown', dockTap, true); window.removeEventListener('click', cardTap, true); window.removeEventListener('pointerdown', mapTap, true); mq?.removeEventListener?.('change', apply); controller.dispose(); },
  };
}
