/** Contract for anything that owns pointer/keyboard input on the map. */
export interface ManagedTool {
  readonly id: string;
  /** Take over input. Must be idempotent. */
  enable(): void;
  /** Release input and cancel any in-progress operation silently. Must be idempotent. */
  disable(): void;
  /** Short label for the UI ("Lift", "Footpath"...). */
  label?: string;
}

/**
 * Keeps exactly one tool active. The default tool ('select': neutral, never edits anything) is active whenever nothing else is.
 * Re-entrancy: `current` is updated BEFORE the outgoing tool is disabled, so the outgoing tool's own
 * cancel callback calling `release(itsId)` is a harmless no-op.
 */
export class ToolManager {
  private tools = new Map<string, ManagedTool>();
  private cur: string;
  private listeners: Array<(id: string, prev: string) => void> = [];

  constructor(readonly defaultId: string) { this.cur = defaultId; }

  register(tool: ManagedTool): void { this.tools.set(tool.id, tool); }
  get current(): string { return this.cur; }
  get ids(): string[] { return [...this.tools.keys()]; }
  isDefault(): boolean { return this.cur === this.defaultId; }
  label(id = this.cur): string { return this.tools.get(id)?.label ?? id; }
  onChange(fn: (id: string, prev: string) => void): void { this.listeners.push(fn); }

  /** Make `id` the only active tool (also (re)enables the default tool). */
  activate(id: string): boolean {
    const next = this.tools.get(id);
    if (!next) return false;
    if (id === this.cur) { next.enable(); return true; }
    const prev = this.cur;
    this.cur = id;
    this.tools.get(prev)?.disable();
    next.enable();
    for (const l of this.listeners) l(id, prev);
    return true;
  }

  /** Enable the default tool after all tools are registered. Returns false if the default tool is missing/not current (a wiring bug). */
  start(): boolean {
    const t = this.tools.get(this.defaultId);
    if (!t || this.cur !== this.defaultId) return false;
    t.enable();
    return true;
  }

  /** A tool finished/cancelled by itself: fall back to the default tool (ignored if it is no longer current). */
  release(id: string): void {
    if (id !== this.cur || id === this.defaultId) return;
    this.activate(this.defaultId);
  }

  /** Esc: back to the default (select) tool. */
  reset(): void {
    if (this.cur !== this.defaultId) this.activate(this.defaultId);
  }
}
