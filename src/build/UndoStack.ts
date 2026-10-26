/**
 * Command-pattern undo for the last placements / bulldozes (buildings, lifts, network tiles). Pure (no DOM / three).
 *
 *  - Only the last UNDO_LIMIT (10) actions are kept; a command is valid the SAME in-game day only (older ones are dropped when touched).
 *  - `cost` is the signed money flow of UNDOING it: positive = the player gets that much back (undoing a placement refunds 100%),
 *    negative = the player has to pay it (undoing a bulldoze gives the 50% refund back).
 *  - `check()` returns a plain-language refusal reason (guests inside, terrain changed, tile occupied...) or null.
 *  - Not persisted: a saved/loaded game starts with an empty stack.
 *  - Path / piste strokes keep their own StrokeHistory (Ctrl+Z while a path tool is active); this stack never touches it.
 */
export const UNDO_LIMIT = 10;

export interface UndoApplied {
  /** Terrain chunks whose heights/props changed (renderers refresh these). */
  touchedChunks: number[];
  /** Building ids whose active/inactive status changed. */
  changed: number[];
  /** What the renderers must refresh. */
  kind: 'building' | 'lift' | 'network';
}

export interface UndoCommand {
  /** Display name of the thing, e.g. 'Café', 'Chairlift', 'Footpath'. */
  label: string;
  /** What happened: undoing says 'Undid: <verb> <label>'. */
  verb: 'placed' | 'bulldozed';
  /** Absolute in-game day the action happened on. */
  day: number;
  /** Signed money flow of the undo (see above). */
  cost: number;
  /** Re-run the action (the stack's `execute`). Returns false when it did not happen (nothing is recorded). */
  do(): boolean;
  /** Refusal reason or null. Funds and day are checked by the stack. */
  check(): string | null;
  /** Revert it (only called after `check()` returned null). */
  undo(): UndoApplied;
}

export interface UndoContext {
  /** Current absolute in-game day. */
  day: number;
  canAfford(amount: number): boolean;
}

export type UndoReport =
  | { ok: true; label: string; verb: UndoCommand['verb']; applied: UndoApplied; refunded: number }
  | { ok: false; reason: string; label?: string };

export class UndoStack {
  private stack: UndoCommand[] = [];
  constructor(readonly limit = UNDO_LIMIT) {}

  get size(): number { return this.stack.length; }
  peek(): UndoCommand | undefined { return this.stack[this.stack.length - 1]; }
  clear(): void { this.stack = []; }

  /** Record an action that has ALREADY happened. */
  push(c: UndoCommand): void {
    this.stack.push(c);
    while (this.stack.length > this.limit) this.stack.shift();
  }

  /** Run the command's `do` and record it when it succeeded. */
  execute(c: UndoCommand): boolean {
    if (!c.do()) return false;
    this.push(c);
    return true;
  }

  /** Undo the newest command, or explain why not (the command stays on the stack unless it can never become valid again). */
  undo(ctx: UndoContext): UndoReport {
    const c = this.stack[this.stack.length - 1];
    if (!c) return { ok: false, reason: 'Nothing to undo' };
    if (c.day !== ctx.day) {
      // Day changed: nothing recorded earlier can be valid either (days only go forward).
      this.stack = [];
      return { ok: false, reason: 'Can only undo on the same day', label: c.label };
    }
    const why = c.check();
    if (why) return { ok: false, reason: why, label: c.label };
    if (c.cost < 0 && !ctx.canAfford(-c.cost)) return { ok: false, reason: 'Not enough funds to undo', label: c.label };
    this.stack.pop();
    const applied = c.undo();
    return { ok: true, label: c.label, verb: c.verb, applied, refunded: c.cost };
  }
}
