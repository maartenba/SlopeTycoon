import type { GameBus, GameEventName } from './events';
import { GAME_EVENT_NAMES } from './events';

export interface LoggedEvent { seq: number; type: GameEventName; payload: unknown }

/** Ring buffer of the last N bus events (debug). */
export class EventLog {
  private buf: LoggedEvent[] = [];
  private seq = 0;
  paused = false;
  private unsubs: Array<() => void> = [];

  constructor(bus: GameBus, readonly capacity = 200) {
    for (const name of GAME_EVENT_NAMES) {
      this.unsubs.push(bus.on(name, (p: unknown) => this.push(name, p)));
    }
  }

  private push(type: GameEventName, payload: unknown): void {
    if (this.paused) return;
    this.buf.push({ seq: ++this.seq, type, payload });
    if (this.buf.length > this.capacity) this.buf.splice(0, this.buf.length - this.capacity);
  }

  /** Entries (oldest first), optionally restricted to a type prefix (e.g. 'guest:'). */
  entries(prefix = ''): LoggedEvent[] { return prefix ? this.buf.filter((e) => e.type.startsWith(prefix)) : [...this.buf]; }
  clear(): void { this.buf = []; }
  get size(): number { return this.buf.length; }
  dispose(): void { for (const u of this.unsubs) u(); this.unsubs = []; }
}
