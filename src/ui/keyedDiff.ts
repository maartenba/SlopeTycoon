/** Pure helpers for incremental (keyed) DOM updates: only touch what changed. */

/** Returns the keys whose value differs between prev and next (new keys count as changed). */
export function changedKeys<V>(prev: ReadonlyMap<string, V>, next: ReadonlyMap<string, V>): string[] {
  const out: string[] = [];
  for (const [k, v] of next) if (!prev.has(k) || prev.get(k) !== v) out.push(k);
  return out;
}

/** Remembers the last value per key; `set` returns true only when the value actually changed. */
export class ChangeGate<V> {
  private last = new Map<string, V>();
  set(key: string, v: V): boolean {
    if (this.last.has(key) && this.last.get(key) === v) return false;
    this.last.set(key, v);
    return true;
  }
  clear(): void { this.last.clear(); }
}
