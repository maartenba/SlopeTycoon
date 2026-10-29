import type { ProfileView } from '../ui/components/StProfile';
import { liftProfile } from '../sim/PisteStats';
import * as THREE from 'three';
import { LIFTS, type LiftKind } from '../config/lifts';
import { LIFT_STATION_SIZE } from '../config/balance';
import { pickHeightfield, type PickResult } from '../render/Picking';
import type { Overlays } from '../render/Overlays';
import type { LiftView } from '../render/meshes/lifts';
import { LIFT_MAX_STATIONS } from '../config/balance';
import { liftStations, midSiteOnLine, placeLift, previewMids, setMidStations, stationAnchor, validateLift, type LiftCheck, type LiftEnv, type LiftPlaceOutcome, type MidChangeOutcome, type StationSite } from '../sim/Lift';
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
  /** Replaces `setMidStations` (main wires the undo recorder in here). */
  placeMids?(id: number, mids: StationSite[], autoFlatten: boolean, clearLane: boolean): MidChangeOutcome;
  /** A mid-station was added / removed through the tool or `removeMid` (Task 39). */
  onMidChanged?(out: MidChangeOutcome): void;
  /** True while guests queue for / ride the lift (the change is refused: close it and let it empty). */
  liftBusy?(id: number): boolean;
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
  /** 'Add mid-station' pick mode: the lift being extended (docs/mid-stations.md). */
  private midLift: number | null = null;
  private midSite: StationSite | null = null;
  private midCheck: (LiftCheck & { charge: number }) | null = null;
  /** Last candidate search (the search validates up to 9 sites; cached per hovered grid cell like the lift cache). */
  private midCache: { key: string; value: { site: StationSite; chk: LiftCheck & { charge: number }; snapped: boolean } | null } | null = null;
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
    on(o.dom, 'contextmenu', (e: Event) => { if (this.active) { e.preventDefault(); this.cancel(); } });
    on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e));
  }

  get active(): boolean { return this.kind !== null || this.midLift !== null; }
  /** The lift id whose mid-station is being picked (null = not in that mode). */
  get midMode(): number | null { return this.midLift; }
  get midPreview(): (LiftCheck & { charge: number }) | null { return this.midCheck; }
  get stage(): 'bottom' | 'top' | null { return this.midLift !== null ? 'top' : this.kind ? (this.bottom ? 'top' : 'bottom') : null; }
  get lastCheck(): LiftCheck | null { return this.last; }

  start(kind: LiftKind): void {
    this.clearPreview();
    this.kind = kind;
    this.bottom = null;
    this.last = null;
    this.resolvedTop = null;
    this.cache = null;
  }

  /** Start picking a mid-station point on the line of lift `id` (inspector button). False (+ error toast) when the lift cannot have one. */
  startMid(id: number): boolean {
    const l = this.o.env.lifts.get(id);
    if (!l) return false;
    if (!LIFTS[l.kind].midStations) { this.o.onError(`A ${LIFTS[l.kind].name} cannot have mid-stations (gondolas, cable cars and detachable chairs only)`); return false; }
    if (liftStations(l).length >= LIFT_MAX_STATIONS) { this.o.onError(`At most ${LIFT_MAX_STATIONS - 2} mid-stations per lift`); return false; }
    if (this.o.liftBusy?.(id)) { this.o.onError('Guests are queueing for or riding this lift: close it and let it empty first'); return false; }
    this.clearPreview();
    this.kind = null; this.bottom = null;
    this.midLift = id; this.midSite = null; this.midCheck = null; this.midCache = null;
    return true;
  }

  /** Remove mid-station `index` (1-based among all stations: 1..n-2) of lift `id`. */
  removeMid(id: number, index: number): boolean {
    const l = this.o.env.lifts.get(id);
    if (!l?.stations || index < 1 || index > l.stations.length - 2) return false;
    if (this.o.liftBusy?.(id)) { this.o.onError('Guests are queueing for or riding this lift: close it and let it empty first'); return false; }
    const keep = l.stations.slice(1, -1).filter((_, i) => i + 1 !== index).map((m) => ({ x: m.x, y: m.y }));
    const out = this.o.placeMids ? this.o.placeMids(id, keep, this.autoFlatten, this.clearLane) : setMidStations(this.o.env, this.o.props, id, keep, this.autoFlatten, this.clearLane);
    if (!out.ok) { this.o.onError(out.reasons.join(', ')); return false; }
    this.o.onMidChanged?.(out);
    return true;
  }

  /** The best valid spot for a mid-station near the hovered point: the point itself, else the nearest valid one along the line (<= 4 tiles). */
  private midCandidate(): { site: StationSite; chk: LiftCheck & { charge: number }; snapped: boolean } | null {
    const l = this.midLift === null ? undefined : this.o.env.lifts.get(this.midLift), p = this.pick;
    if (!l || !p) return null;
    const bottom = { x: l.bottom.x, y: l.bottom.y }, top = { x: l.top.x, y: l.top.y };
    const have = (l.stations ?? []).slice(1, -1).map((m) => ({ x: m.x, y: m.y }));
    const hovered = midSiteOnLine(this.o.env.grid, bottom, top, p.point.x, p.point.z);
    const key = `${l.id}|${hovered.x},${hovered.y}|${this.autoFlatten}|${this.clearLane}|${have.length}|${l.tiles.length}`;
    if (this.midCache?.key === key) return this.midCache.value;
    const dx = top.x - bottom.x, dy = top.y - bottom.y, len = Math.hypot(dx, dy) || 1;
    const opts = { autoFlatten: this.autoFlatten, clearLane: this.clearLane };
    let first: { site: StationSite; chk: LiftCheck & { charge: number } } | null = null;
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const site = k === 0 ? hovered : stationAnchor(this.o.env.grid, hovered.x + LIFT_STATION_SIZE / 2 + (dx / len) * k, hovered.y + LIFT_STATION_SIZE / 2 + (dy / len) * k);
      const chk = previewMids(this.o.env, l.id, [...have, site], opts);
      if (!first) first = { site, chk };
      if (chk.ok) return (this.midCache = { key, value: { site, chk, snapped: k !== 0 } }).value;
    }
    return (this.midCache = { key, value: first ? { ...first, snapped: false } : null }).value;
  }

  cancel(): void {
    if (this.midLift !== null) { this.midLift = null; this.midSite = null; this.midCheck = null; this.midCache = null; this.clearPreview(); this.o.overlays.hide(); this.o.onCancel(); return; }
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

  private refreshMid(e?: { clientX: number; clientY: number }): void {
    const ov = this.o.overlays, l = this.midLift === null ? undefined : this.o.env.lifts.get(this.midLift);
    this.clearPreview();
    const x = e?.clientX ?? 0, y = e?.clientY ?? 0;
    if (!l) { ov.hide(); return; }
    const c = this.midCandidate();
    if (!c) { ov.setTooltip({ cost: 0, blocked: false, text: `${LIFTS[l.kind].name}: move along the line to place a mid-station`, x, y }); ov.setColor(0xffee55); return; }
    this.midSite = c.site; this.midCheck = c.chk;
    if (c.chk.data) {
      this.preview = this.o.view.createPreview({ ...c.chk.data, id: -1 }, c.chk.ok);
      this.o.scene.add(this.preview.group);
    }
    ov.setVertexRect(c.site.x, c.site.y, c.site.x + LIFT_STATION_SIZE, c.site.y + LIFT_STATION_SIZE);
    ov.setColor(!c.chk.ok ? 0xff5555 : c.snapped || c.chk.warnings.length ? 0xffbb33 : 0x66ff66);
    const st = c.chk.stats;
    const text = c.chk.ok && st
      ? `${c.snapped ? 'Snapped to the nearest valid spot \u00b7 ' : ''}Mid-station ${formatMoney(c.chk.charge)} \u00b7 ${liftStations(l).length + 1} stations \u00b7 ride ${Math.round(st.rideTimeS)} s \u00b7 click to build`
      : c.chk.reasons.slice(0, 3).join(' \u00b7 ');
    ov.setTooltip({ cost: c.chk.charge, blocked: !c.chk.ok, text: text + (c.chk.warnings.length ? ` \u26a0 ${c.chk.warnings.join(', ')}` : ''), x, y });
  }

  private refresh(e?: { clientX: number; clientY: number }): void {
    if (this.midLift !== null) { this.refreshMid(e); return; }
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
    if (!this.active || e.target !== this.o.dom) return;
    this.pick = this.doPick(e);
    this.refresh(e);
  }

  private onDown(e: PointerEvent): void {
    if (!this.active || e.button !== 0 || e.target !== this.o.dom) return;
    e.stopImmediatePropagation();
    this.pick = this.doPick(e);
    if (this.midLift !== null) { this.refresh(e); this.buildMid(); return; }
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

  /** Build the previewed mid-station (stays in the mode on failure so the player can aim again; leaves it on success). */
  private buildMid(): boolean {
    const id = this.midLift, site = this.midSite, chk = this.midCheck;
    const l = id === null ? undefined : this.o.env.lifts.get(id);
    if (!l || !site || !chk) return false;
    if (!chk.ok) { this.o.onError(chk.reasons.slice(0, 2).join(', ')); return false; }
    const mids = [...(l.stations ?? []).slice(1, -1).map((m) => ({ x: m.x, y: m.y })), site];
    const out = this.o.placeMids ? this.o.placeMids(l.id, mids, this.autoFlatten, this.clearLane) : setMidStations(this.o.env, this.o.props, l.id, mids, this.autoFlatten, this.clearLane);
    if (!out.ok) { this.o.onError(out.reasons.join(', ')); return false; }
    this.o.onMidChanged?.(out);
    this.cancel();
    return true;
  }

  /** Touch (docs/touch.md): commit the previewed station (the Place button / second tap): the bottom one first, then build at the top one. False when nothing is aimed yet. */
  confirm(): boolean {
    if (this.midLift !== null) return this.pick ? this.buildMid() : false;
    if (!this.kind) return false;
    const s = this.site();
    if (!s) return false;
    if (!this.bottom) { this.bottom = s; this.refresh(); return true; } // first stage: the previewed bottom station
    return this.build(s);
  }

  /** Touch bar text: what the next tap does / what the previewed line costs or why it is not valid. */
  touchHint(): string {
    if (this.midLift !== null) { const c = this.midCheck; return !c ? 'Tap the line to aim the mid-station' : c.ok ? `${formatMoney(c.charge)} \u00b7 tap again or \u2713 to build the mid-station` : `\u2716 ${c.reasons[0] ?? 'not valid here'}`; }
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
    if (!this.active) return;
    if (e.key === 'Escape') this.cancel();
    else if (e.key === 'f' || e.key === 'F') { this.autoFlatten = !this.autoFlatten; this.refresh(); }
    else if (e.key === 'l' || e.key === 'L') { this.setClearLane(!this.clearLane); this.refresh(); }
  }
}
