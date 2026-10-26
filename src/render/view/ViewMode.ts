/**
 * View mode state machine (M5.2). Pure: no three / DOM.
 * `iso` is the default builder camera, `ride` the ground-level ride-along, `photo` the free photo camera (Task 10).
 * `walk` (Task 12, user-approved): first-person on foot. Legal: iso <-> walk and walk <-> photo (photo returns to walk). ride <-> walk is illegal (leave the ride first).
 */
export type ViewMode = 'iso' | 'ride' | 'photo' | 'walk';

export const IMPLEMENTED_VIEW_MODES: readonly ViewMode[] = ['iso', 'ride', 'photo', 'walk'];

/** Legal transitions. Every ground-level mode returns to `iso` first or switches directly (ride <-> photo); `walk` is reachable from iso / photo. */
const LEGAL: Record<ViewMode, readonly ViewMode[]> = {
  iso: ['ride', 'photo', 'walk'],
  ride: ['iso', 'photo'],
  photo: ['iso', 'ride', 'walk'],
  walk: ['iso', 'photo'],
};

export function canTransition(from: ViewMode, to: ViewMode): boolean {
  return LEGAL[from].includes(to);
}

export type ViewModeListener = (to: ViewMode, from: ViewMode) => void;

export class ViewModeMachine {
  private _mode: ViewMode = 'iso';
  private listeners: ViewModeListener[] = [];

  get mode(): ViewMode { return this._mode; }
  get isIso(): boolean { return this._mode === 'iso'; }
  /** True for every mode that renders through the perspective camera. */
  get isGround(): boolean { return this._mode !== 'iso'; }

  can(to: ViewMode): boolean { return canTransition(this._mode, to); }

  /** Switch mode; returns false (and changes nothing) for an illegal or no-op transition. */
  set(to: ViewMode): boolean {
    if (to === this._mode || !canTransition(this._mode, to)) return false;
    const from = this._mode;
    this._mode = to;
    for (const l of [...this.listeners]) l(to, from);
    return true;
  }

  onChange(l: ViewModeListener): () => void {
    this.listeners.push(l);
    return () => { this.listeners = this.listeners.filter((x) => x !== l); };
  }
}
