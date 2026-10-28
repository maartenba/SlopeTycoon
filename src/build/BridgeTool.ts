import { BRIDGES, BRIDGE_MSG, type BridgeKind } from '../config/bridges';
import { planBridge } from '../world/Bridges';
import type { Pt } from '../sim/Dependencies';
import { DragTool, type DragToolOptions, type Evaluation } from './PathTool';

/**
 * Bridge tool (Phase 6 Task 45, docs/bridges.md): drag from a bank tile straight across water or a gap to the opposite bank. The preview paints the
 * line (green = valid, red = refused) and the tooltip shows the span, the deck rise and the price, or the exact reason. One undo step per bridge
 * (the shared stack); pointer-type agnostic (the TouchController feeds the same synthetic mouse events).
 */
export class BridgeTool extends DragTool {
  readonly group = 'bridge';
  kind: BridgeKind = 'footbridge';
  constructor(o: DragToolOptions) { super(o); }
  startTool(kind?: BridgeKind): void { if (kind) this.kind = kind; this.begin_(); }

  /** The straight line from the drag start to the pointer along the dominant axis (so the preview never shows an illegal bend). */
  protected tiles(): Pt[] {
    const a = this.start, b = this.cur;
    if (!a || !b) return [];
    const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const end: Pt = horizontal ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    const out: Pt[] = [];
    const dx = Math.sign(end.x - a.x), dy = Math.sign(end.y - a.y), n = Math.abs(end.x - a.x) + Math.abs(end.y - a.y);
    for (let i = 0; i <= n; i++) out.push({ x: a.x + dx * i, y: a.y + dy * i });
    return out;
  }

  protected evaluate(tiles: Pt[]): Evaluation {
    const spec = BRIDGES[this.kind];
    if (tiles.length < 2) return { ok: false, cost: 0, text: `${spec.label}: drag from one bank across the water or gap to the other (max span ${spec.maxSpan})` };
    const plan = planBridge(this.o.networks, this.o.grid, this.kind, tiles[0]!, tiles[tiles.length - 1]!, this.o.multiplier());
    if (!plan.ok) return { ok: false, cost: 0, text: `Blocked: ${plan.reason ?? BRIDGE_MSG.nothing}` };
    return { ok: true, cost: plan.cost, text: `${spec.label}: span ${plan.span.length}, deck +${plan.rise} half-steps, ${plan.supports.length} supports, $${Math.round(plan.cost)}` };
  }

  protected commit(tiles: Pt[]): void {
    if (tiles.length < 2) return;
    const plan = planBridge(this.o.networks, this.o.grid, this.kind, tiles[0]!, tiles[tiles.length - 1]!, this.o.multiplier());
    if (plan.ok) this.o.networks.buildBridge(plan);
  }
}
