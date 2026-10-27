/** Per-tile occupancy: entity id + flag bits. Typed arrays only. */
export const OccFlag = {
  Building: 1,
  Lift: 2,
  Path: 4,
  Piste: 8,
  Road: 16,
  /** Lake or stream tile: never buildable / terraformable. */
  Water: 32,
  /** Player-placed garden decor (Landscape drawer): bench, lamp, hedge, fence, wall, flower bed, fountain. Blocks buildings / paths / lifts like any other occupant. */
  Decor: 64,
} as const;

export class Occupancy {
  readonly size: number;
  readonly entityId: Uint32Array;
  readonly flags: Uint8Array;

  constructor(size: number) {
    this.size = size;
    this.entityId = new Uint32Array(size * size);
    this.flags = new Uint8Array(size * size);
  }

  index(x: number, y: number): number {
    return y * this.size + x;
  }

  has(x: number, y: number, flag: number): boolean {
    return (this.flags[this.index(x, y)]! & flag) !== 0;
  }

  set(x: number, y: number, flag: number, entityId = 0): void {
    const i = this.index(x, y);
    this.flags[i]! |= flag;
    if (entityId) this.entityId[i] = entityId;
  }

  clear(x: number, y: number, flag: number): void {
    const i = this.index(x, y);
    this.flags[i]! &= ~flag & 0xff;
    // A building's id lives in entityId: drop it with the Building flag even when a rail tile keeps its own flag (Train Station on the rail).
    if (this.flags[i] === 0 || (flag & OccFlag.Building)) this.entityId[i] = 0;
  }

  isFree(x: number, y: number): boolean {
    return this.flags[this.index(x, y)] === 0;
  }

  byteLength(): number {
    return this.entityId.byteLength + this.flags.byteLength;
  }
}
