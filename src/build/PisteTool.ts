import { Difficulty, PISTE_WATER_MSG, interpolateStroke, Layer, PISTE_COST_PER_TILE, sweepBrush, type LayerBit } from '../world/Networks';
import type { Pt } from '../sim/Dependencies';
import { slopeProfile } from '../sim/PisteStats';
import { buildTrailStroke, describeExtras, planTrailStroke, type CrossMode } from '../world/StrokePlan';
import { DragTool, ghostOf, type DragToolOptions, type Evaluation } from './PathTool';

export const DIFFICULTY_NAMES = ['green', 'blue', 'red', 'black'] as const;
export const TRAIL_ORPHAN_MSG = 'Trails must connect to a path, building or another trail';

/**
 * Freehand painting of ski piste / MTB trail / hiking trail. Pointer samples are interpolated into a 4-connected
 * stroke (fast mouse movement never skips tiles); ski pistes sweep the brush footprint along it, trails are 1 tile wide
 * and must attach to a network tile, building or existing trail. Shift-drag (or erase mode) erases with the same interpolation.
 * Difficulty auto from 3x3-smoothed slope unless overridden.
 */
export class PisteTool extends DragTool {
  readonly group = 'piste';
  protected override readonly canErase = true;
  layer: LayerBit = Layer.Ski;
  /** null = auto from slope. */
  override: number | null = null;
  brush = 1;
  private samples: Pt[] = [];
  /** Rail crossing choice for trails (dock toggle 'Cross rails'). */
  crossMode: CrossMode = 'level';
  private get trail(): 'hike' | 'mtb' | null { return this.layer === Layer.Hike ? 'hike' : this.layer === Layer.Mtb ? 'mtb' : null; }

  constructor(o: DragToolOptions) { super(o); }

  startTool(layer: LayerBit, override: number | null = null): void {
    this.layer = layer; this.override = override;
    this.begin_();
  }
  setOverride(d: number | null): void { this.override = d === null ? null : Math.max(Difficulty.Green, Math.min(Difficulty.Black, d)); }
  setErase(on: boolean): void { this.eraseMode = on; }

  /** Brush size in effect: trails are always a 1-tile line. */
  get effectiveBrush(): number { return this.layer === Layer.Ski ? this.brush : 1; }

  protected begin(p: Pt): void { this.samples = [p]; }
  protected sample(p: Pt): void {
    const l = this.samples[this.samples.length - 1];
    if (!l || l.x !== p.x || l.y !== p.y) this.samples.push(p);
  }

  /** The interpolated centre-line of the stroke so far (4-connected). */
  strokeLine(): Pt[] {
    const line = interpolateStroke(this.samples);
    if (this.erasing || this.trail) return line; // trails carry on over a lake: the planner turns it into a bridge (docs/bridges.md)
    // A stroke that hits water stops at the bank (everything after the first water tile is dropped).
    const net = this.o.networks;
    const cut = line.findIndex((t) => net.canPaint(t.x, t.y, this.layer).reason === PISTE_WATER_MSG);
    this.hitWater = cut >= 0;
    return cut >= 0 ? line.slice(0, cut) : line;
  }
  private hitWater = false;

  protected hoverTiles(p: Pt): Pt[] { return sweepBrush([p], this.effectiveBrush, this.o.grid.size); }

  protected tiles(): Pt[] {
    if (this.trail && !this.erasing && this.start) { // the stroke line without the bridge spans (banks and crossing tiles included); the plan decides what is built
      const plan = planTrailStroke(this.o.networks, this.o.grid, this.trail, this.strokeLine(), this.o.multiplier(), this.crossMode);
      return plan.ok ? plan.line : this.strokeLine();
    }
    const swept = sweepBrush(this.strokeLine(), this.effectiveBrush, this.o.grid.size);
    const net = this.o.networks;
    if (this.erasing) return swept.filter((t) => (net.layers[t.y * net.size + t.x]! & this.layer) !== 0);
    return swept.filter((t) => net.canPaint(t.x, t.y, this.layer).ok);
  }

  protected evaluate(tiles: Pt[]): Evaluation {
    if (!tiles.length && this.hitWater && !this.erasing) return { ok: false, cost: 0, text: PISTE_WATER_MSG };
    if (!tiles.length) return { ok: false, cost: 0, text: this.erasing ? 'Nothing to erase here' : 'Blocked: nothing to paint here' };
    if (this.erasing) return { ok: true, cost: 0, text: `Erase ${tiles.length} tiles` };
    const net = this.o.networks;
    if (this.trail && this.start) { // bridges over lakes and rail crossings are part of the stroke
      const plan = planTrailStroke(net, this.o.grid, this.trail, this.strokeLine(), this.o.multiplier(), this.crossMode);
      if (!plan.ok) return { ok: false, cost: 0, text: plan.reason === TRAIL_ORPHAN_MSG ? TRAIL_ORPHAN_MSG : `Blocked: ${plan.reason}` };
      const a = net.autoDifficulty(plan.newTiles), dd = this.override ?? [...a.values()][0] ?? 0, extras = describeExtras(plan);
      this.emitProfile();
      return { ok: true, cost: plan.cost, text: `${DIFFICULTY_NAMES[dd]}${this.override === null ? ' (auto)' : ''} — ${plan.newTiles.length} tiles${extras ? ` + ${extras}` : ''}, $${Math.round(plan.cost)}`, ghost: ghostOf(plan) };
    }
    if (this.layer !== Layer.Ski && !net.strokeAnchored(tiles, this.layer)) return { ok: false, cost: 0, text: TRAIL_ORPHAN_MSG };
    const auto = net.autoDifficulty(tiles);
    const d = this.override ?? [...auto.values()][0] ?? 0;
    this.emitProfile();
    const cost = tiles.length * PISTE_COST_PER_TILE * this.o.multiplier();
    return { ok: true, cost, text: `${DIFFICULTY_NAMES[d]}${this.override === null ? ' (auto)' : ''} — ${tiles.length} tiles, $${Math.round(cost)}` };
  }

  /** Slope profile of the centre-line being dragged (coloured by the difficulty each tile will get). */
  private emitProfile(): void {
    if (!this.o.onProfile) return;
    if (!this.start || this.erasing || this.samples.length < 1) { this.o.onProfile(null); return; }
    const line = this.strokeLine();
    if (line.length < 2) { this.o.onProfile(null); return; }
    const auto = this.override !== null ? this.override : [...this.o.networks.autoDifficulty(line).values()];
    const label = this.layer === Layer.Ski ? 'Ski piste' : this.layer === Layer.Mtb ? 'MTB trail' : 'Hiking trail';
    const profile = slopeProfile(this.o.grid, line, auto), snowline = this.snowlineM?.();
    // Building is never season-bound; only opening is. Say so when this line currently lies below the snowline (bare ground).
    const bare = this.layer === Layer.Ski && snowline !== undefined && Math.max(profile.startAltM, profile.endAltM) < snowline;
    this.o.onProfile({ kind: 'piste', title: `${label} profile${this.override === null ? ' (auto grade)' : ''}`, profile, snowlineM: snowline, note: bare ? 'No snow here right now: you can build it, but skiers only use it once snow covers it.' : undefined });
  }
  /** Current snowline altitude (m); set by the host. */
  snowlineM?: () => number | undefined;
  protected override strokeEnded(): void { this.o.onProfile?.(null); }

  protected override strokeLayer(): number { return this.layer; }

  protected commit(tiles: Pt[]): void {
    const net = this.o.networks;
    if (!this.erasing && this.hitWater) this.o.onInfo?.(PISTE_WATER_MSG);
    if (this.erasing) {
      for (const t of tiles) net.unpaint(this.layer, t.x, t.y);
    } else if (this.trail) {
      const plan = planTrailStroke(net, this.o.grid, this.trail, this.strokeLine(), this.o.multiplier(), this.crossMode);
      if (plan.ok) buildTrailStroke(net, this.trail, plan, this.override ?? undefined);
    } else {
      net.paint(this.layer, tiles, this.override ?? undefined);
      if (this.layer === Layer.Ski) {
        const n = net.cleanupPiste();
        if (n) this.o.onInfo?.(`Removed ${n} stray tiles`);
      }
    }
    this.samples = [];
  }

  cancelStroke(): void { this.samples = []; super.cancelStroke(); }
}
