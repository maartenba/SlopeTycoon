import type * as THREE from 'three';
import type { GameBus } from '../core/events';
import type { Grid } from '../world/Grid';
import { OccFlag } from '../world/Occupancy';
import { Layer, Networks, PISTE_COST_PER_TILE } from '../world/Networks';
import type { Buildings } from '../sim/Buildings';
import type { Economy } from '../sim/Economy';
import type { Pt } from '../sim/Dependencies';
import { NetworkMeshes } from '../render/meshes/Paths';
import { PathTool, type DragToolOptions } from './PathTool';
import { RoadTool, RailTool } from './RoadTool';
import { PisteTool } from './PisteTool';
import { BridgeTool } from './BridgeTool';
import type { BridgeKind } from '../config/bridges';
import { StrokeHistory } from './StrokeHistory';
import type { Undo } from './UndoActions';

export interface NetworkToolsCtx {
  grid: Grid;
  buildings: Buildings;
  economy: Economy;
  scene: THREE.Scene;
  camera: THREE.Camera;
  dom: HTMLElement;
  /** Container for the tool palette (e.g. #ui). */
  uiRoot: HTMLElement | null;
  roadEntry: Pt;
  railEntry: Pt;
  village: Pt;
  /** Frame hook registrar (called every frame). */
  onFrame: (fn: () => void) => void;
  toast: (text: string, kind?: 'info' | 'error' | 'warn') => void;
  /** Building statuses changed (ids): toast + UI refresh. */
  announceChanged: (ids: number[]) => void;
  refreshUi: () => void;
  /** Pistes/paths/roads changed (overlay refresh). */
  onNetworkChanged?: () => void;
  /** Pre-built sim-side Networks (createSim). When given, no new instance / stubs are created. */
  networks?: Networks;
  /** Gameplay events (path:drawn / piste:painted). */
  bus?: Pick<GameBus, 'emit'>;
  /** Active palette key changed (null = none). Used by the tool dock. */
  onActiveChange?: (key: string | null) => void;
  /** true while a network tool is active: caller should suspend terraform/placement/bulldoze. */
  onToolActive: (active: boolean) => void;
  /** Records tile-level bulldozes of paths/roads/rail/pistes for the shared undo stack (strokes keep their own StrokeHistory). */
  undo?: Undo;
  /** Runs the shared Ctrl+Z / Ctrl+Y (host applies refreshes + toast); returns false when nothing happened. Given together with `undo`. */
  performUndo?: () => boolean;
  performRedo?: () => boolean;
  /** Slope profile chart for the piste stroke being dragged + the snowline marker. */
  onProfile?: (v: import('../ui/components/StProfile').ProfileView | null) => void;
  snowlineM?: () => number | undefined;
}

export interface NetworkTools {
  networks: Networks;
  meshes: NetworkMeshes;
  /** Terrain chunks changed: rebuild drapes. */
  refreshChunks(ids: number[]): void;
  /** Bulldoze network/piste at tile; true if something was removed. */
  bulldozeAt(x: number, y: number): boolean;
  isConnected(buildingId: number): boolean;
  cancel(): void;
  /** Start a tool by palette key; starting the active one stops it. */
  startTool(key: 'path' | 'road' | 'rail' | 'ski' | 'mtb' | 'hike'): void;
  setOverride(d: number | null): void;
  setBrush(n: number): void;
  /** Toggle erase mode for piste/trail tools (Shift-drag also erases). */
  setErase(on: boolean): void;
  /** Start the bridge tool (drag bank to bank) for a bridge kind; starting it again stops it. */
  startBridge(kind: BridgeKind): void;
  /** Footpath strokes over a rail line become footbridges (no waiting) instead of level crossings. */
  setOverRail(on: boolean): void;
  /** Undo the latest stroke (of the active tool's group, else any); false if nothing to undo. */
  undo(): boolean;
  /** Redo the latest undone action (shared stack); false if nothing to redo. */
  redo(): boolean;
  /** Re-evaluate buildings / refresh overlays after the shared undo stack changed network tiles. */
  refresh(): void;
  /** Remove unattached piste/trail fragments of a layer; returns tiles removed. */
  pruneOrphans(layer: 1 | 2 | 4): number;
}

const REFUND = 0.5;

export function registerNetworkTools(ctx: NetworkToolsCtx): NetworkTools {
  const { grid, buildings, economy } = ctx;
  const networks = ctx.networks ?? new Networks(grid, buildings);
  if (!ctx.networks) buildings.setNetwork({ pathDistance: networks.pathDistance, roadConnected: networks.roadConnected, access: networks.access });
  const meshes = new NetworkMeshes(grid, networks);
  ctx.scene.add(meshes.group);

  // Free starter infrastructure: lodge-adjacent road + rail stub.
  const lodge = buildings.all().find((b) => b.type === 'baseLodge');
  if (!ctx.networks) { networks.placeInitialStubs(ctx.roadEntry, ctx.railEntry, ctx.village, lodge); buildings.reevaluate(); }
  ctx.onFrame(() => meshes.update());

  const history = new StrokeHistory();
  let wasDisconnected = new Set<number>(buildings.all().filter((b) => networks.accessProblem(b.id) !== null).map((b) => b.id));
  const afterChange = (): void => {
    const changed = buildings.reevaluate();
    ctx.announceChanged(changed);
    const now = new Set(buildings.all().filter((b) => networks.accessProblem(b.id) !== null).map((b) => b.id));
    for (const id of now) if (!wasDisconnected.has(id)) ctx.toast('A building lost the access it needs (select it to see what it needs)', 'warn');
    wasDisconnected = now;
    const stray = networks.pisteComponents().filter((c) => c.disconnected).length;
    if (stray > lastStray) ctx.toast('Disconnected piste: connect it to the main run or a lift station', 'warn');
    lastStray = stray;
    ctx.refreshUi();
    ctx.onNetworkChanged?.();
  };
  let lastStray = 0;

  const opts: DragToolOptions = {
    grid, networks, camera: ctx.camera, dom: ctx.dom, scene: ctx.scene,
    charge: (c) => economy.charge(c),
    multiplier: () => economy.constructionMultiplier(),
    onChanged: afterChange,
    onStroke: (group, tiles, erase, layer) => {
      if (group === 'piste') ctx.bus?.emit('piste:painted', { layer: layer === Layer.Mtb ? 'mtb' : layer === Layer.Hike ? 'hike' : 'ski', tiles, erase });
      else if (group === 'path' || group === 'road' || group === 'rail') ctx.bus?.emit('path:drawn', { kind: group, tiles, erase });
    },
    onError: (m) => ctx.toast(m, 'error'),
    history, refund: (n) => economy.refund(n), onInfo: (m) => ctx.toast(m, 'info'),
    record: ctx.undo ? (group, diff, cost, erase) => ctx.undo!.recordNetwork(group === 'piste' ? 'Piste' : group === 'road' ? 'Road' : group === 'rail' ? 'Rail' : group === 'bridge' ? 'Bridge' : 'Footpath', erase ? 'bulldozed' : 'painted', diff, cost) : undefined,
    onProfile: ctx.onProfile,
    onDone: () => { ctx.onToolActive(false); setActive(null); },
  };
  const path = new PathTool(opts), road = new RoadTool(opts), rail = new RailTool(opts), piste = new PisteTool(opts), bridge = new BridgeTool(opts);
  piste.snowlineM = ctx.snowlineM;

  // Palette
  const buttons = new Map<string, HTMLButtonElement>();
  let activeKey: string | null = null;
  const setActive = (k: string | null): void => {
    activeKey = k;
    ctx.onActiveChange?.(k);
    for (const [key, b] of buttons) b.classList.toggle('active', key === k);
  };
  const stopAll = (): void => { path.stop(); road.stop(); rail.stop(); piste.stop(); bridge.stop(); };
  const start = (key: string, fn: () => void): void => {
    if (activeKey === key) { stopAll(); return; }
    stopAll();
    ctx.onToolActive(true);
    fn();
    setActive(key);
  };
  let eraseOn = false;
  const undo = (): boolean => {
    if (ctx.undo && ctx.performUndo) return ctx.performUndo();
    const group = activeKey === null ? undefined : activeKey === 'ski' || activeKey === 'mtb' || activeKey === 'hike' ? 'piste' : activeKey;
    const e = history.pop(group);
    if (!e) { ctx.toast('Nothing to undo', 'info'); return false; }
    networks.restore(e.diff);
    economy.refund(e.cost);
    afterChange();
    return true;
  };
  const diffSel = { value: 'auto' };
  const run = {
    path: () => path.startTool(), road: () => road.startTool(), rail: () => rail.startTool(),
    ski: () => piste.startTool(Layer.Ski, overrideValue()),
    mtb: () => piste.startTool(Layer.Mtb, overrideValue()),
    hike: () => piste.startTool(Layer.Hike, overrideValue()),
  } as const;
  const overrideValue = (): number | null => (diffSel.value === 'auto' ? null : Number(diffSel.value));

  if (ctx.uiRoot && typeof document !== 'undefined') {
    const bar = document.createElement('div');
    bar.id = 'network-tools';
    bar.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:6px;background:#000a;border-radius:6px;font:12px sans-serif;color:#fff;pointer-events:auto';
    const title = document.createElement('div');
    title.textContent = 'Paths, roads & pistes (R flips corner)';
    bar.appendChild(title);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;max-width:300px';
    const defs: Array<[keyof typeof run, string, string]> = [
      ['path', 'Footpath', '$20/tile'], ['road', 'Road', '$60/tile'], ['rail', 'Rail', '$100/tile'],
      ['ski', 'Ski piste', `$${PISTE_COST_PER_TILE}/tile`], ['mtb', 'MTB trail', `$${PISTE_COST_PER_TILE}/tile`], ['hike', 'Hiking trail', `$${PISTE_COST_PER_TILE}/tile`],
    ];
    for (const [key, label, cost] of defs) {
      const b = document.createElement('button');
      b.textContent = `${label} ${cost}`;
      b.dataset.tool = key;
      b.addEventListener('click', () => start(key, run[key]));
      buttons.set(key, b);
      row.appendChild(b);
    }
    const sel = document.createElement('select');
    for (const [v, t] of [['auto', 'Difficulty: auto'], ['0', 'Green'], ['1', 'Blue'], ['2', 'Red'], ['3', 'Black']]) sel.add(new Option(t, v));
    sel.addEventListener('change', () => { diffSel.value = sel.value; piste.setOverride(overrideValue()); });
    const brush = document.createElement('select');
    for (const n of [1, 2, 3]) brush.add(new Option(`Brush ${n}`, String(n)));
    brush.addEventListener('change', () => { piste.brush = Number(brush.value); });
    const erase = document.createElement('button');
    erase.textContent = 'Erase (or Shift-drag)';
    erase.addEventListener('click', () => { eraseOn = !eraseOn; piste.setErase(eraseOn); erase.classList.toggle('active', eraseOn); });
    const undoBtn = document.createElement('button');
    undoBtn.textContent = 'Undo last stroke (Ctrl+Z)';
    undoBtn.addEventListener('click', () => { undo(); });
    bar.append(row, sel, brush, erase, undoBtn);
    ctx.uiRoot.appendChild(bar);
  }

  const bulldozeAt = (x: number, y: number): boolean => {
    if (!grid.inBounds(x, y)) return false;
    if (grid.occupancy.has(x, y, OccFlag.Building)) return false; // rail under a station stays until the station goes
    const br = networks.bridgeAt(x, y); // a player-built bridge goes whole and refunds half of what it cost
    networks.beginJournal();
    const k = networks.unbuild(x, y);
    if (k) {
      const refund = Math.round((br ? br.cost : networks.costOf(k)) * REFUND);
      economy.refund(refund);
      ctx.undo?.recordNetworkBulldoze(br ? 'Bridge' : k === 1 ? 'Footpath' : k === 2 ? 'Road' : 'Rail', networks.endJournal(), refund);
      afterChange();
      return true;
    }
    if (networks.clearLayers(x, y)) {
      const refund = Math.round((br ? br.cost : PISTE_COST_PER_TILE) * REFUND);
      economy.refund(refund);
      ctx.undo?.recordNetworkBulldoze(br ? 'Bridge' : 'Piste', networks.endJournal(), refund);
      afterChange();
      return true;
    }
    networks.endJournal();
    return false;
  };

  return {
    networks, meshes,
    refreshChunks: (ids) => meshes.refreshChunks(ids),
    bulldozeAt,
    isConnected: (id) => networks.isConnected(id),
    cancel: stopAll,
    startTool: (key) => start(key, run[key]),
    setOverride: (d) => { diffSel.value = d === null ? 'auto' : String(d); piste.setOverride(d); },
    setBrush: (n) => { piste.brush = n; },
    setErase: (on) => { eraseOn = on; piste.setErase(on); },
    setOverRail: (on) => { path.overRail = on; },
    startBridge: (kind) => { const key = `bridge:${kind}`; if (activeKey === key) { stopAll(); return; } stopAll(); ctx.onToolActive(true); bridge.startTool(kind); setActive(key); },
    undo,
    redo: () => ctx.performRedo?.() ?? false,
    refresh: afterChange,
    pruneOrphans: (layer) => { const n = networks.pruneOrphans(layer); if (n) { afterChange(); ctx.toast(`Removed ${n} stray tiles`, 'info'); } return n; },
  };
}
