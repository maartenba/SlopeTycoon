/**
 * Command-pattern undo / redo for every build action (buildings, lifts, network strokes + bulldozes, terraform, planting). Pure (no DOM / three).
 *
 *  - Only the last UNDO_LIMIT (10) actions are kept; a command is valid the SAME in-game day only (older ones are dropped when touched).
 *  - `cost` is the signed money flow of UNDOING it: positive = the player gets that much back (undoing a placement refunds 100%),
 *    negative = the player has to pay it (undoing a bulldoze gives the 50% refund back).
 *  - `check()` returns a plain-language refusal reason (guests inside, terrain changed, tile occupied...) or null.
 *  - Not persisted: a saved/loaded game starts with an empty stack.
 *  - Redo (Ctrl+Shift+Z / Ctrl+Y) replays the newest undone command; any new action empties the redo list. Redo is bound to the same day too.
 *  - A day boundary REFUSES both with a clear message ('too late: the day has ended') instead of silently reverting yesterday's work.
 */
export const UNDO_LIMIT = 10;

export interface UndoApplied {
  /** Terrain chunks whose heights/props changed (renderers refresh these). */
  touchedChunks: number[];
  /** Building ids whose active/inactive status changed. */
  changed: number[];
  /** What the renderers must refresh. */
  kind: 'building' | 'lift' | 'network' | 'terrain';
}

export interface UndoCommand {
  /** Display name of the thing, e.g. 'Café', 'Chairlift', 'Footpath'. */
  label: string;
  /** What happened: undoing says 'Undid: <verb> <label>'. */
  verb: 'placed' | 'bulldozed' | 'painted' | 'terraformed' | 'planted' | 'landscaped';
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
  /** Refusal reason for REDO (the world must still look as it did right after undo) or null. */
  checkRedo(): string | null;
  /** Replay it; returns null when it could not happen (nothing changed). Money: the player pays `cost` (undo's refund) / gets back `-cost`. */
  redo(): UndoApplied | { fail: string };
}

export interface UndoContext {
  /** Current absolute in-game day. */
  day: number;
  canAfford(amount: number): boolean;
}

export type UndoReport =
  | { ok: true; label: string; verb: UndoCommand['verb']; applied: UndoApplied; refunded: number; redo?: boolean }
  | { ok: false; reason: string; label?: string };

/** Shown when the day changed: the undo window is the in-game day the action happened on. */
export const DAY_REFUSAL = 'it was built on an earlier day, undo only works within the same day';

export class UndoStack {
  private stack: UndoCommand[] = [];
  private redoList: UndoCommand[] = [];
  constructor(readonly limit = UNDO_LIMIT) {}

  get size(): number { return this.stack.length; }
  get redoSize(): number { return this.redoList.length; }
  peek(): UndoCommand | undefined { return this.stack[this.stack.length - 1]; }
  peekRedo(): UndoCommand | undefined { return this.redoList[this.redoList.length - 1]; }
  clear(): void { this.stack = []; this.redoList = []; }

  /** Record an action that has ALREADY happened (a new action empties the redo list). */
  push(c: UndoCommand): void {
    this.redoList = [];
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
      this.stack = []; this.redoList = [];
      return { ok: false, reason: DAY_REFUSAL, label: c.label };
    }
    const why = c.check();
    if (why) return { ok: false, reason: why, label: c.label };
    if (c.cost < 0 && !ctx.canAfford(-c.cost)) return { ok: false, reason: 'Not enough funds to undo', label: c.label };
    this.stack.pop();
    const applied = c.undo();
    this.redoList.push(c);
    return { ok: true, label: c.label, verb: c.verb, applied, refunded: c.cost };
  }

  /** Redo the newest undone command (same day only; fails with a reason when the world changed or funds are short). */
  redo(ctx: UndoContext): UndoReport {
    const c = this.redoList[this.redoList.length - 1];
    if (!c) return { ok: false, reason: 'Nothing to redo' };
    if (c.day !== ctx.day) { this.redoList = []; return { ok: false, reason: DAY_REFUSAL, label: c.label }; }
    const why = c.checkRedo();
    if (why) return { ok: false, reason: why, label: c.label };
    if (c.cost > 0 && !ctx.canAfford(c.cost)) return { ok: false, reason: 'Not enough funds to redo', label: c.label };
    const r = c.redo();
    if ('fail' in r) return { ok: false, reason: r.fail, label: c.label };
    this.redoList.pop();
    this.stack.push(c);
    return { ok: true, label: c.label, verb: c.verb, applied: r, refunded: -c.cost, redo: true };
  }
}
