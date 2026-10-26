/**
 * ModalPauseGate: dialogs flagged `pausesGame` (Settings, Help, Save & load, Trophies, About, confirm dialogs) pause the running game while
 * they are open and put the previous speed back when the LAST of them closes.
 *
 * - Nesting: a depth counter; only the first `enter()` pauses, only the last `leave()` restores.
 * - Already paused (player pause, year report, pause menu, scenario dialog, bankruptcy) -> nothing to restore: the game stays paused.
 * - If anything changed the speed while the dialog was open (speed > 0 again at the end) the gate leaves it alone.
 * - Fast-forward is cancelled when the first dialog opens.
 * - `exempt()` (title-screen demo) makes the gate a no-op; `ended()` (bankrupt) never resumes a finished game.
 */
export interface PauseHost {
  getSpeed(): number;
  setSpeed(s: number): void;
  /** Cancel a running fast-forward (called when the first dialog opens). */
  cancelFastForward?(): void;
  /** True where dialogs must not pause (title-screen demo). */
  exempt?(): boolean;
  /** True when the game is over: never resume. */
  ended?(): boolean;
}

export class ModalPauseGate {
  private host: PauseHost | null = null;
  private depth = 0;
  private restore: number | null = null;
  private exemptNow = false;
  private subs = new Set<() => void>();

  /** Attach the game (call once the sim exists). Without a host the gate does nothing (title screen, unit tests of dialogs). */
  attach(host: PauseHost | null): void { this.host = host; this.depth = 0; this.restore = null; this.exemptNow = false; this.emit(); }

  /** A pausing dialog opened. */
  enter(): void {
    this.depth++;
    if (this.depth !== 1) { this.emit(); return; }
    const h = this.host;
    this.exemptNow = !h || !!h.exempt?.();
    if (h && !this.exemptNow) {
      h.cancelFastForward?.();
      const s = h.getSpeed();
      if (s > 0) { this.restore = s; h.setSpeed(0); } else this.restore = null;
    }
    this.emit();
  }

  /** A pausing dialog closed. */
  leave(): void {
    if (this.depth <= 0) return;
    this.depth--;
    if (this.depth === 0) {
      const h = this.host, prev = this.restore;
      this.restore = null;
      if (h && prev !== null && !this.exemptNow && h.getSpeed() === 0 && !h.ended?.()) h.setSpeed(prev);
      this.exemptNow = false;
    }
    this.emit();
  }

  /** Number of open pausing dialogs. */
  get open(): number { return this.depth; }
  /** True while a pausing dialog holds the game (drives the 'Paused' badge). */
  get active(): boolean { return this.depth > 0 && !this.exemptNow && !!this.host; }
  /** Speed that will be restored when the last dialog closes (null = stays paused). */
  get pending(): number | null { return this.restore; }

  subscribe(f: () => void): () => void { this.subs.add(f); return () => { this.subs.delete(f); }; }
  private emit(): void { for (const f of [...this.subs]) f(); }
}

export const modalPause = new ModalPauseGate();
