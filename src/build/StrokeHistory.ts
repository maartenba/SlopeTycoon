import type { TileSnap } from '../world/Networks';

export interface StrokeEntry {
  /** Tool group: 'path' | 'road' | 'rail' | 'piste'. */
  group: string;
  /** Pre-stroke tile snapshots. */
  diff: TileSnap[];
  /** Money charged for the stroke (refunded in full on undo). */
  cost: number;
}

/** Per-session stack of completed strokes (paths, roads, rail, pistes) for Ctrl+Z / Undo last stroke. */
export class StrokeHistory {
  private stack: StrokeEntry[] = [];
  constructor(private limit = 50) {}
  push(e: StrokeEntry): void {
    this.stack.push(e);
    if (this.stack.length > this.limit) this.stack.shift();
  }
  /** Pop the latest entry of `group` (or the latest of any group when omitted). */
  pop(group?: string): StrokeEntry | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (!group || this.stack[i]!.group === group) return this.stack.splice(i, 1)[0];
    }
    return undefined;
  }
  get size(): number { return this.stack.length; }
  clear(): void { this.stack = []; }
}
