import type { ProfileView } from '../ui/components/StProfile';
import { liftProfile } from '../sim/PisteStats';
import * as THREE from 'three';
import { LIFTS, type LiftKind } from '../config/lifts';
import { LIFT_STATION_SIZE } from '../config/balance';
import { pickHeightfield, type PickResult } from '../render/Picking';
import type { Overlays } from '../render/Overlays';
import type { LiftView } from '../render/meshes/lifts';
import { placeLift, stationAnchor, validateLift, type LiftCheck, type LiftEnv, type LiftPlaceOutcome, type StationSite } from '../sim/Lift';
import { routeFacts, snapLift, validKinds, whyNot } from '../sim/LiftAssist';
import type { PropStore } from '../world/Props';
import { formatMoney } from '../ui/format';

export interface LiftToolOptions {
  env: LiftEnv;
  props?: PropStore;
  view: LiftView;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  dom: HTMLElement;
  overlays: Overlays;
  /** Replaces `placeLift` (main wires the undo recorder in here). */
  place?(kind: LiftKind, bottom: StationSite, top: StationSite, autoFlatten: boolean, clearLane: boolean): LiftPlaceOutcome;
  onPlaced(out: LiftPlaceOutcome): void;
  onError(msg: string): void;
  onCancel(): void;
  /** Ground profile under the ghost lift line (null = hide). */
  onProfile?(v: ProfileView | null): void;
  /** Current snowline altitude (m) for the chart marker. */
  snowlineM?(): number | undefined;
}

/** Two-click lift tool: bottom station, then top station (ghost cable + towers while moving). Esc/right-click cancels. */
export class LiftTool {
  kind: LiftKind | null = null;
  autoFlatten = true;
  /** 'Clear forest lane': cut the trees a cable cannot clear with towers (default ON). */
  clearLane = true;
  private bottom: StationSite | null = null;
  private pick: PickResult | null = null;
  private preview: { group: THREE.Group; dispose(): void } | null = null;
  private last: LiftCheck | null = null;
  /** Top station the click would actually use (the hovered one, or the auto-nudged one when that was invalid). */
  private resolvedTop: StationSite | null = null;
  private cache: { key: string; chk: LiftCheck; top: StationSite; snapped: boolean; valid: LiftKind[] } | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly disposers: Array<() => void> = [];

  constructor(private o: LiftToolOptions) {
    const on = (el: HTMLElement | Window, t: string, fn: (e: never) => void, capture = false): void => {
      el.addEventListener(t, fn as EventListener, capture);
      this.disposers.push(() => el.removeEventListener(t, fn as EventListener, capture));
    };
    on(o.dom, 'pointermove', (e: PointerEvent) => this.onMove(e));
    on(window, 'pointerdown', (e: PointerEvent) => this.onDown(e), true);
    on(o.dom, 'contextmenu', (e: Event) => { if (this.kind) { e.preventDefault(); this.cancel(); } });
    on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e));
  }

  get active(): boolean { return this.kind !== null; }
  get stage(): 'bottom' | 'top' | null { return this.kind ? (this.bottom ? 'top' : 'bottom') : null; }
  get lastCheck(): LiftCheck | null { return this.last; }

  start(kind: LiftKind): void {
    this.clearPreview();
    this.kind = kind;
    this.bottom = null;
    this.last = null;
    this.resolvedTop = null;
    this.cache = null;
  }

  cancel(): void {
    if (!this.kind) return;
    this.kind = null;
    this.bottom = null;
    this.clearPreview();
    this.o.overlays.hide();
    this.o.onCancel();
  }

  setAutoFlatten(v: boolean): void { this.autoFlatten = v; }
  setClearLane(v: boolean): void { this.clearLane = v; this.cache = null; }
  dispose(): void { this.clearPreview(); for (const d of this.disposers) d(); }

  private clearPreview(): void {
    this.o.onProfile?.(null);
    if (this.preview) { this.o.scene.remove(this.preview.group); this.preview.dispose(); this.preview = null; }
  }

  private doPick(e: PointerEvent): PickResult | null {
    const r = this.o.dom.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.o.camera);
    return pickHeightfield(this.o.env.grid, this.ray.ray.origin, this.ray.ray.direction);
  }

  private site(): StationSite | null {
    const p = this.pick;
    return p ? stationAnchor(this.o.env.grid, p.point.x, p.point.z) : null;
  }

  private refresh(e?: { clientX: number; clientY: number }): void {
    const kind = this.kind, s = this.site();
    const ov = this.o.overlays;
    this.clearPreview();
    if (!kind || !s) { ov.hide(); return; }
    const x = e?.clientX ?? 0, y = e?.clientY ?? 0;
    if (!this.bottom) {
      ov.setVertexRect(s.x, s.y, s.x + LIFT_STATION_SIZE, s.y + LIFT_STATION_SIZE);
      ov.setColor(0xffee55);
      ov.setTooltip({ cost: 0, blocked: false, text: `${LIFTS[kind].name}: click to place the bottom station`, x, y });
      return;
    }
    const key = `${kind}|${this.bottom.x},${this.bottom.y}|${s.x},${s.y}|${this.autoFlatten}|${this.clearLane}`;
    if (!this.cache || this.cache.key !== key) {
      const opts = { autoFlatten: this.autoFlatten, skipFunds: true, clearLane: this.clearLane };
      // Valid as hovered -> use it. Otherwise nudge the top station (<= 3 tiles) to the best valid nearby site.
      const base = validateLift(this.o.env, kind, this.bottom, s, opts);
      const valid = base.ok ? [] : validKinds(this.o.env, this.bottom, s, opts);
      const snap = base.ok ? null : snapLift(this.o.env, kind, this.bottom, s, { ...opts, adjust: 'top' });
      this.cache = snap?.moved
        ? { key, chk: snap.check, top: snap.top, snapped: true, valid }
        : { key, chk: base, top: s, snapped: false, valid };
    }
    const { chk, top, snapped, valid } = this.cache;
    this.last = chk;
    this.resolvedTop = chk.ok ? top : null;
    if (chk.data) {
      this.preview = this.o.view.createPreview({ ...chk.data, id: -1 }, chk.ok);
      this.o.scene.add(this.preview.group);
      if (this.o.onProfile && this.bottom) {
        const h = LIFT_STATION_SIZE / 2, b = chk.data.bottom, t = chk.data.top;
        this.o.onProfile({ kind: 'lift', title: `${LIFTS[kind].name} line (ground profile)`, profile: liftProfile(this.o.env.grid, { x: b.x + h, y: b.y + h }, { x: t.x + h, y: t.y + h }), snowlineM: this.o.snowlineM?.(), note: chk.ok ? undefined : 'Not valid as drawn' });
      }
    }
    ov.setVertexRect(top.x, top.y, top.x + LIFT_STATION_SIZE, top.y + LIFT_STATION_SIZE);
    // green = valid as hovered; amber = valid after nudging the top station / has warnings; red = invalid.
    ov.setColor(!chk.ok ? 0xff5555 : snapped || chk.warnings.length ? 0xffbb33 : 0x66ff66);
    const st = chk.stats, facts = routeFacts(chk);
    const info = st && facts
      ? `${Math.round(facts.lengthM)} m \u00b7 drop ${Math.round(facts.dropM)} m \u00b7 avg ${Math.round(facts.avgGradient * 100)}% / max ${Math.round(LIFTS[kind].maxGradient * 100)}%`
      : '';
    let text: string;
    if (chk.ok && st) {
      const flat = chk.flattenCost > 0 ? ` (incl. ${formatMoney(chk.flattenCost)} levelling)` : '';
      const lane = chk.lane && chk.lane.count > 0 ? ` \u00b7 Clears ${chk.lane.count} tree${chk.lane.count === 1 ? '' : 's'} under the line (${formatMoney(chk.lane.laneCost)})` : '';
      text = `${snapped ? 'Snapped to nearest valid site \u00b7 ' : ''}${formatMoney(chk.cost + chk.flattenCost)}${flat}${lane} \u00b7 ${info} \u00b7 ride ${Math.round(st.rideTimeS)} s \u00b7 ${Math.round(st.throughputPerHour)}/h`;
    } else {
      text = `${whyNot(kind, chk, valid)}${info ? ` [${info}]` : ''}`;
    }
    const text2 = chk.warnings.length ? `${text} \u26a0 ${chk.warnings.join(', ')}` : text;
    ov.setTooltip({ cost: chk.cost + chk.flattenCost, blocked: !chk.ok, text: text2, x, y });
  }

  private onMove(e: PointerEvent): void {
    if (!this.kind || e.target !== this.o.dom) return;
    this.pick = this.doPick(e);
    this.refresh(e);
  }

  private onDown(e: PointerEvent): void {
    if (!this.kind || e.button !== 0 || e.target !== this.o.dom) return;
    e.stopImmediatePropagation();
    this.pick = this.doPick(e);
    const s = this.site();
    if (!s) return;
    if (!this.bottom) { this.bottom = s; this.refresh(e); return; }
    this.refresh(e);
    this.build(s);
  }

  /** Build between the bottom station and the top one (the snapped site when the hovered one was invalid but a nearby one works). */
  private build(s: StationSite): boolean {
    if (!this.kind || !this.bottom) return false;
    const top = this.resolvedTop ?? s;
    const out = this.o.place ? this.o.place(this.kind, this.bottom, top, this.autoFlatten, this.clearLane) : placeLift(this.o.env, this.o.props, this.kind, this.bottom, top, this.autoFlatten, this.clearLane);
    if (!out.ok) { this.o.onError(out.reasons.join(', ')); return false; }
    this.o.onPlaced(out);
    this.cancel();
    return true;
  }

  /** Touch (docs/touch.md): commit the previewed station (the Place button / second tap): the bottom one first, then build at the top one. False when nothing is aimed yet. */
  confirm(): boolean {
    if (!this.kind) return false;
    const s = this.site();
    if (!s) return false;
    if (!this.bottom) { this.bottom = s; this.refresh(); return true; } // first stage: the previewed bottom station
    return this.build(s);
  }

  /** Touch bar text: what the next tap does / what the previewed line costs or why it is not valid. */
  touchHint(): string {
    const kind = this.kind;
    if (!kind) return '';
    if (!this.bottom) return `${LIFTS[kind].name}: tap the map for the bottom station`;
    const c = this.last;
    if (!c || !this.pick) return 'Tap the map to aim the top station';
    return c.ok ? `${formatMoney(c.cost + c.flattenCost)} \u00b7 tap again or \u2713 to build` : `\u2716 ${c.reasons[0] ?? 'not valid here'}`;
  }

  private onKey(e: KeyboardEvent): void {
    const t = ((e.composedPath?.()[0] as HTMLElement | undefined) ?? e.target) as HTMLElement | null; // the real target: events from inputs inside a shadow root are retargeted to the host
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!this.kind) return;
    if (e.key === 'Escape') this.cancel();
    else if (e.key === 'f' || e.key === 'F') { this.autoFlatten = !this.autoFlatten; this.refresh(); }
    else if (e.key === 'l' || e.key === 'L') { this.setClearLane(!this.clearLane); this.refresh(); }
  }
}
