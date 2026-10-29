import * as THREE from 'three';
import { LIFTS, type LiftKind } from '../config/lifts';
import type { Grid } from '../world/Grid';
import type { PropStore } from '../world/Props';
import type { Economy } from '../sim/Economy';
import { LiftStore, type LiftEnv, demolishLift, liftStats, midCount, rayDistanceToLift, upkeepPerDay, type LiftData, type LiftPlaceOutcome } from '../sim/Lift';
import { LIFT_MAX_STATIONS } from '../config/balance';
import { LiftView } from '../render/meshes/lifts';
import { pickHeightfield } from '../render/Picking';
import type { Overlays } from '../render/Overlays';
import type { GameBus } from '../core/events';
import { LiftTool } from './LiftTool';
import { registerComponents } from '../ui';
import type { StLiftInspector } from '../ui/components/StLiftInspector';
import type { LiftOps } from '../sim/ops/LiftOps';
import { maintDate } from '../ui/maintFormat';
import type { Undo } from './UndoActions';

export interface LiftToolsDeps {
  /** Ground profile chart under the ghost lift line + snowline marker. */
  onProfile?(v: import('../ui/components/StProfile').ProfileView | null): void;
  snowlineM?(): number | undefined;
  grid: Grid;
  props?: PropStore;
  /** Buildings under the cable (roof clearance). */
  buildings?: LiftEnv['buildings'];
  economy: Economy;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  dom: HTMLElement;
  overlays: Overlays;
  ui: HTMLElement | null;
  /** Network facts for the lift 'Not connected' warnings. */
  access?: LiftEnv['access'];
  /** Career unlock gate: locked lift kinds are refused by the validator (ghost tip) and by `placeLift` itself. */
  gate?: LiftEnv['gate'];
  /** The renderer; its onFrame is wrapped (call after main assigned onFrame). */
  frame: { onFrame: ((dt: number) => void) | null };
  toast(msg: string, kind?: 'info' | 'error' | 'warn'): void;
  isBulldozing(): boolean;
  /** Called when a lift tool starts (cancel other tools/terraform) and ends (restore). */
  suspendOthers(): void;
  resumeOthers(): void;
  refreshProps(chunks: number[]): void;
  /** Lane clearing / station pads removed trees: forest cover must be recomputed. */
  onPropsCleared?(): void;
  /** When false (another tool is active) clicks on lifts are ignored instead of selecting them. */
  canSelect?(): boolean;
  /** Where the inspector goes (default: ui). */
  inspectorParent?: HTMLElement | null;
  /** Active lift kind changed (null = none). Used by the tool dock (lift menu now lives in the dock drawer). */
  onActiveChange?(kind: LiftKind | null): void;
  /** Called after lifts change (money/menu refresh). */
  onChanged?(): void;
  /** Pre-built sim-side store (createSim). */
  lifts?: LiftStore;
  /** Gameplay events (lift:built). */
  bus?: Pick<GameBus, 'emit'>;
  /** Lift operations (schedule, inspections, repairs); enables the extended inspector. */
  liftOps?: LiftOps;
  /** Display name / rename hooks (sim Names). */
  liftName?(id: number): string;
  renameLift?(id: number, name: string): void;
  /** Records lift placements / demolitions for undo. */
  undo?: Undo;
  /** Guests queueing for / riding a lift (mid-station changes are refused while > 0). */
  guestsAtLift?(id: number): number;
  /** A lift got / lost a mid-station (lets the host refresh runs / nav / tips). */
  onMidChanged?(out: import('../sim/Lift').MidChangeOutcome): void;
  /** A lift was demolished through the inspector / bulldozer (lets the UI offer 'Undo'). */
  onDemolished?(label: string, refund: number): void;
}

export interface LiftTools {
  lifts: LiftStore;
  view: LiftView;
  tool: LiftTool;
  /** Advance carriers (call from renderer frame). */
  update(dt: number): void;
  demolish(id: number): void;
  /** Start placing a lift of this kind (suspends other tools). */
  start(kind: LiftKind): void;
  /** Re-sync meshes + inspector with the store after an undo. */
  syncView(): void;
}

const PICK_RADIUS = 0.5;

/** Wires lift store, view, tool, menu and inspector. Single entry point used by main.ts. */
export function registerLiftTools(d: LiftToolsDeps): LiftTools {
  const lifts = d.lifts ?? new LiftStore(d.grid.occupancy);
  const view = new LiftView();
  for (const l of lifts.all()) view.add(l); // lifts that already exist (loaded save)
  d.scene.add(view.group);
  let selected: number | null = null;
  let inspEl: StLiftInspector | null = null;

  const ops = d.liftOps;
  const opsInfo = (l: LiftData): NonNullable<Parameters<StLiftInspector['show']>[0]>['ops'] => {
    const s = ops!.status(l.id)!, o = ops!.ops(l);
    return {
      mode: o.mode, daylight: !!o.daylight, from: o.from, to: o.to, eco: o.eco, seasons: { ...o.seasons }, inspection: o.inspection, condition: s.condition, hold: s.hold,
      fault: s.fault ? { kind: s.fault.kind, rushed: s.fault.rushed } : null, repairEtaHours: s.repairEtaHours, stranded: s.stranded,
      lastInspectionDaysAgo: s.lastInspectionDaysAgo, nextInspectionDays: s.nextInspectionDays, riskPerDay: s.breakdownRiskPerDay, hasWorkshop: s.hasWorkshop,
      energyPerHour: ops!.energyPerHour(l), queue: 0,
      service: ((): NonNullable<NonNullable<ReturnType<typeof opsInfo>>['service']> => {
        const v = s.service;
        return {
          state: v.state, policy: v.policy, lastLabel: v.lastDay === null ? null : maintDate(v.lastDay), nextLabel: v.nextDay === null ? null : maintDate(v.nextDay), sinceDays: v.sinceDays,
          window: v.windowAuto ? 'auto' : String(v.windowMonth), autoMonth: v.autoMonth, plan: { days: v.plan.days, cost: v.plan.cost, level: v.plan.level },
          riskMult: v.riskMult, skipRiskMult: v.skipRiskMult, inServiceHours: v.inServiceHours, canServiceNow: ops!.canServiceNow(l.id),
        };
      })(),
    };
  };
  const showInspector = (): void => {
    const l = selected === null ? undefined : lifts.get(selected);
    if (!l) { inspEl?.show(null); return; }
    const st = liftStats(l);
    inspEl?.show({
      id: l.id, kind: l.kind, name: d.liftName?.(l.id), open: l.open, speed: l.speed, lengthM: st.lengthM, rideTimeS: st.rideTimeS,
      throughputPerHour: st.throughputPerHour, upkeepPerDay: upkeepPerDay(l), refund: Math.round(l.cost * 0.5),
      activeMode: l.activeMode, closedReason: l.closedReason,
      mids: LIFTS[l.kind].midStations ? { count: midCount(l), max: LIFT_MAX_STATIONS - 2, picking: tool.midMode === l.id } : undefined,
      ops: ops ? opsInfo(l) : undefined,
    });
  };
  const demolish = (id: number): void => {
    const r = d.undo ? d.undo.demolishLift(id) : demolishLift(lifts, d.economy, id);
    if (!r.ok) return;
    view.remove(id);
    if (selected === id) selected = null;
    if (d.onDemolished) d.onDemolished('lift', r.refund); else d.toast(`Demolished lift (+$${r.refund})`);
    showInspector();
    d.onChanged?.();
  };

  const lenv = (): LiftEnv => ({ grid: d.grid, lifts, economy: d.economy, access: d.access, gate: d.gate, props: d.props, buildings: d.buildings });
  const tool: LiftTool = new LiftTool({
    liftBusy: d.guestsAtLift ? (id) => d.guestsAtLift!(id) > 0 : undefined,
    placeMids: d.undo ? (id, mids, autoFlatten, clearLane) => d.undo!.setLiftMids(lenv(), d.props, id, mids, autoFlatten, clearLane) : undefined,
    onMidChanged: (out) => {
      if (out.lift) view.add(out.lift);
      if (out.touchedChunks.length) { d.refreshProps(out.touchedChunks); d.onPropsCleared?.(); }
      const n = out.lift ? midCount(out.lift) : 0;
      d.toast(out.charged > 0 ? `Mid-station built (-$${out.charged}); the lift now has ${n + 2} stations` : `Mid-station removed (+$${out.refunded}); the lift has ${n + 2} stations`);
      d.onMidChanged?.(out);
      showInspector();
      d.onChanged?.();
    },
    env: { grid: d.grid, lifts, economy: d.economy, access: d.access, gate: d.gate, props: d.props, buildings: d.buildings }, props: d.props, view,
    place: d.undo ? (kind, bottom, top, autoFlatten, clearLane) => d.undo!.placeLift({ grid: d.grid, lifts, economy: d.economy, access: d.access, gate: d.gate, props: d.props, buildings: d.buildings }, d.props, kind, bottom, top, autoFlatten, clearLane) : undefined, scene: d.scene, camera: d.camera, dom: d.dom, overlays: d.overlays,
    onPlaced: (out: LiftPlaceOutcome) => {
      if (out.lift) view.add(out.lift);
      if (out.touchedChunks.length) { d.refreshProps(out.touchedChunks); d.onPropsCleared?.(); }
      d.bus?.emit('lift:built', { id: out.lift!.id, kind: out.lift!.kind });
      d.toast(`${LIFTS[out.lift!.kind].name} built (-$${Math.round(out.cost)})`);
      d.onChanged?.();
    },
    onProfile: d.onProfile, snowlineM: d.snowlineM,
    onError: (m) => d.toast(m, 'error'),
    onCancel: () => { d.onActiveChange?.(null); if (!d.isBulldozing()) d.resumeOthers(); },
  });

  const start = (kind: LiftKind): void => {
    d.suspendOthers();
    tool.start(kind);
    d.onActiveChange?.(kind);
  };

  // Pick/select/bulldoze lifts. Capture on window so it runs before main's tile-picking handler.
  const ray = new THREE.Raycaster();
  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== d.dom || tool.active || (d.canSelect && !d.canSelect())) return;
    const r = d.dom.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), d.camera);
    const p = pickHeightfield(d.grid, ray.ray.origin, ray.ray.direction);
    let hit: LiftData | undefined = p ? lifts.at(p.tileX, p.tileY) : undefined;
    if (!hit) {
      let best = PICK_RADIUS;
      for (const l of lifts.all()) {
        const dist = rayDistanceToLift(l, ray.ray.origin, ray.ray.direction);
        if (dist < best) { best = dist; hit = l; }
      }
    }
    if (!hit) { if (selected !== null) { selected = null; showInspector(); } return; }
    e.stopImmediatePropagation();
    if (d.isBulldozing()) demolish(hit.id);
    else { selected = hit.id; showInspector(); }
  }, true);

  if (d.ui) {
    registerComponents();
    inspEl = document.createElement('st-lift-inspector') as StLiftInspector;
    inspEl.bind({
      setOpen: (id, o) => { lifts.setOpen(id, o); d.bus?.emit('lift:opened', { id, open: o }); showInspector(); },
      setSpeed: (id, v) => { lifts.setSpeed(id, v); showInspector(); },
      demolish,
      addMid: (id) => { if (tool.midMode === id) { tool.cancel(); showInspector(); return; } d.suspendOthers(); if (tool.startMid(id)) { d.onActiveChange?.(null); d.toast('Pick a point on the line (Esc cancels)'); } else d.resumeOthers(); showInspector(); },
      removeMid: (id, index) => { tool.removeMid(id, index); },
      setMode: (id, m) => { ops?.setMode(id, m); showInspector(); d.onChanged?.(); },
      setHours: (id, f, t) => { ops?.setHours(id, f, t); showInspector(); },
      setDaylight: (id, v) => { ops?.setDaylight(id, v); showInspector(); },
      setEco: (id, v) => { ops?.setEco(id, v); showInspector(); },
      setSeason: (id, p, v) => { ops?.setSeason(id, p, v); showInspector(); },
      setInspection: (id, lv) => { ops?.setInspection(id, lv); showInspector(); },
      setServiceWindow: (id, m) => { ops?.setServiceWindow(id, m); showInspector(); d.onChanged?.(); },
      serviceNow: (id) => { if (!ops?.serviceNow(id)) d.toast('Cannot service now: the lift must be empty and not broken', 'warn'); showInspector(); d.onChanged?.(); },
      inspectNow: (id) => { if (!ops?.inspectNow(id, 'basic')) d.toast('Cannot inspect right now', 'warn'); showInspector(); },
      rename: d.renameLift ? (id, n) => { d.renameLift?.(id, n); showInspector(); d.onChanged?.(); } : undefined,
      repair: (id) => { if (!ops?.repairNow(id)) d.toast('Nothing to repair right now', 'warn'); showInspector(); },
    });
    if (ops) window.setInterval(() => { if (selected !== null && !inspEl?.busy) showInspector(); }, 1000);
    (d.inspectorParent ?? d.ui).append(inspEl);
  }
  const prevFrame = d.frame.onFrame;
  d.frame.onFrame = (dt): void => { prevFrame?.(dt); view.update(dt); };

  const syncView = (): void => {
    for (const l of lifts.all()) if (!view.has(l.id) || view.dataOf(l.id) !== l) view.add(l); // (an undone mid-station change brings back another record)
    for (const id of view.ids()) if (!lifts.get(id)) view.remove(id);
    if (selected !== null && !lifts.get(selected)) selected = null;
    showInspector();
    d.onChanged?.();
  };
  return { lifts, view, tool, update: (dt) => view.update(dt), demolish, start, syncView };
}
