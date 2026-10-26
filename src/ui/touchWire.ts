import { TouchController } from '@/render/TouchController';
import type { CameraController } from '@/render/CameraController';
import { TOUCH_MIN_TARGET_PX, resolveTouchEnabled, toolKindOf } from '@/render/touch';
import { accessibility, type TouchSetting } from './accessibility';
import type { StTouchControls } from './components/StTouchControls';

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
}
export interface TouchWire {
  controller: TouchController;
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
  const enabled = (): boolean => on;
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
  const un = a11y.subscribe(apply);
  mq?.addEventListener?.('change', apply);
  apply();
  return {
    controller, enabled,
    bindBar(b) {
      bar = b;
      b.bind({
        setMode: (m) => controller.setMode(m), confirm: () => { controller.confirm(); }, cancelTool: () => o.cancelTool(), undo: () => o.undo(),
        rotateView: (d) => o.camera.rotateSnap(d), rotateGhost: (d) => o.rotateGhost(d),
      });
      apply();
    },
    toolChanged() {
      controller.toolChanged();
      document.querySelector('#ui > st-dock')?.classList.toggle('peek', on && o.toolId() === 'placement'); bar?.setState({ tool: o.toolId(), kind: toolKindOf(o.toolId()) }); },
    dispose() { un(); mq?.removeEventListener?.('change', apply); controller.dispose(); },
  };
}
