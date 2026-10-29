import * as THREE from 'three';
import { LIFTS, normalizeLiftKind } from '../../../config/lifts';
import { LIFT_ECO_FACTOR, LIFT_STATION_SIZE } from '../../../config/balance';
import { LIFT_PARAMS, carrierStates, liftPath, liftStations, type CablePath, type LiftData } from '../../../sim/Lift';
import { buildMidStationParts, buildStationParts } from './Station';
import { buildTowerGeometry } from './Tower';
import { buildCableGeometry, buildCableNearGeometry } from './Cable';
import { isPerspective } from '../../view/cameraMath';
import { nearLod, type NearBand } from '../../lod/nearLod';
import { buildChairGeometry } from './Chair';
import { buildGondolaGeometry } from './Gondola';
import { buildTramGeometry } from './Tram';
import { buildTBarGeometry } from './TBar';
import { buildFunicularCarGeometry, buildTrackGeometry } from './Funicular';
import { createSignTexture } from '../../textures/sign';
import { glassGroups, liftGlassMaterial, liftMaterial } from './geo';
import type { LiftKind } from '../../../config/lifts';
import type { StationParts } from './Station';

export function buildCarrierGeometry(kind: LiftKind, near = false, chairBody?: number): THREE.BufferGeometry {
  const d = LIFTS[normalizeLiftKind(kind)];
  switch (d.family) {
    case 'tbar': return buildTBarGeometry();
    case 'chair': return buildChairGeometry(d.capacityPerCarrier, d.bubble, d.detachable, near, chairBody ?? (d.id === 'chair6d' ? 0x1f7a6a : undefined), d.id === 'chair6d');
    case 'gondola': return buildGondolaGeometry(d.capacityPerCarrier, near);
    case 'cablecar': return buildTramGeometry(near);
    case 'funicular': return buildFunicularCarGeometry(near);
  }
}

interface Entry {
  group: THREE.Group;
  lift: LiftData;
  path: CablePath;
  carriers: THREE.InstancedMesh;
  /** Cable travel distance (tiles), integrated by update(). */
  phase: number;
  geos: THREE.BufferGeometry[];
  /** Close-up (ground camera) state: xz polyline of the stations + towers, tower meshes with their base geometry, the lazily built near cable. */
  poly: Float32Array;
  towers: { mesh: THREE.Mesh; base: THREE.BufferGeometry; near: THREE.BufferGeometry | null; h: number }[];
  cable: THREE.Mesh | null;
  cableNear: THREE.Mesh | null;
  band: NearBand;
}

/** Closest horizontal distance (tiles) from (x, z) to a polyline stored as [x0, z0, x1, z1, ...]. Allocation-free. */
export function distToPolyline(poly: ArrayLike<number>, x: number, z: number): number {
  const n = poly.length / 2;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const ax = poly[i * 2]!, az = poly[i * 2 + 1]!;
    const bx = i + 1 < n ? poly[i * 2 + 2]! : ax, bz = i + 1 < n ? poly[i * 2 + 3]! : az;
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    let t = l2 > 1e-9 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - x, ez = az + dz * t - z, d2 = ex * ex + ez * ez;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** Roof / canopy fade radius (tiles) around the ground camera for station meshes. */
export const STATION_ROOF_HIDE_RADIUS = 3;

export const CABLE_COLOR = 0x5b616b; // mid steel grey (was near-black hairlines)

/** Builds and animates lift meshes. Rendering is unverified in headless tests (no WebGL); data-level positions are tested. */
export class LiftView {
  readonly group = new THREE.Group();
  private entries = new Map<number, Entry>();
  private readonly mat = liftMaterial();
  private readonly cableMat = new THREE.MeshBasicMaterial({ color: CABLE_COLOR });
  /** Near cable: lit, vertex-coloured round tube (ground cameras only). */
  private readonly cableNearMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  /** Station material: the lift material + a camera-near roof fade (uNearHide = camera xyz + radius; radius 0 = off, always in iso). */
  private readonly nearHide = { value: new THREE.Vector4(0, 0, 0, 0) };
  private readonly stationMat = liftMaterial();
  private nearActive = false;
  private readonly dummy = new THREE.Object3D();
  private readonly cache = new Map<string, THREE.BufferGeometry>();
  private readonly glassMat = liftGlassMaterial();
  private readonly stationCache = new Map<string, StationParts>();
  private readonly signMats = new Map<string, { mat: THREE.Material; tex: THREE.Texture | null }>();
  /** Cosmetic chair body colour (M5.3 Task 16); undefined = the default red / grey-blue chairs. */
  private chairBody: number | undefined;

  constructor() {
    const u = this.nearHide;
    this.stationMat.name = 'lift-station';
    this.stationMat.onBeforeCompile = (sh): void => {
      sh.uniforms.uNearHide = u;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vNHW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNHW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vNHW;\nuniform vec4 uNearHide;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (uNearHide.w > 0.0 && vNHW.y - uNearHide.y > 0.15) { // roofs / canopies / snow caps above the ground camera dither away within the radius
    float nhD = length(vNHW.xz - uNearHide.xz);
    float nhK = 1.0 - smoothstep(uNearHide.w * 0.55, uNearHide.w, nhD);
    float nhN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (nhN < nhK) discard;
  }`);
    };
    this.stationMat.customProgramCacheKey = (): string => 'lift-station-nearhide';
  }

  /** Cosmetic chair colour (chairs only, gondolas / cabins untouched). Rebuilds the carrier geometries and re-assigns them: no lift rebuild, no restart. `null` = default. */
  setChairColor(body: number | null): void {
    const next = body ?? undefined;
    if (next === this.chairBody) return;
    this.chairBody = next;
    for (const k of [...this.cache.keys()]) if (k.startsWith('carrier:')) { this.cache.get(k)!.dispose(); this.cache.delete(k); }
    for (const e of this.entries.values()) {
      const kind = e.lift.kind, near = e.band === 'near';
      e.carriers.geometry = near ? this.cached(`carrier:${kind}:near`, () => buildCarrierGeometry(kind, true, this.chairBody)) : this.cached(`carrier:${kind}`, () => buildCarrierGeometry(kind, false, this.chairBody));
    }
  }
  get chairColor(): number | undefined { return this.chairBody; }

  private station(kind: LiftKind, isTop: boolean): StationParts {
    const key = `${kind}:${isTop}`;
    let p = this.stationCache.get(key);
    if (!p) { p = buildStationParts(kind, isTop); this.stationCache.set(key, p); }
    return p;
  }

  private midStation(kind: LiftKind): StationParts {
    const key = `${kind}:mid`;
    let p = this.stationCache.get(key);
    if (!p) { p = buildMidStationParts(kind); this.stationCache.set(key, p); }
    return p;
  }

  private signMat(text: string, bg: string, fg: string): THREE.Material {
    const key = `${text}|${bg}|${fg}`;
    let e = this.signMats.get(key);
    if (!e) {
      const tex = createSignTexture(text, bg, fg);
      e = { tex, mat: new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }) };
      this.signMats.set(key, e);
    }
    return e.mat;
  }

  private cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.cache.get(key);
    if (!g) { g = make(); this.cache.set(key, g); }
    return g;
  }

  /** Static + carrier meshes for lift data into a group (origin world). */
  private build(lift: LiftData, mat: THREE.Material, cableMat: THREE.Material, withSign = true, glass: THREE.Material = this.glassMat): Entry {
    const g = new THREE.Group();
    const path = liftPath(lift);
    const geos: THREE.BufferGeometry[] = [];
    const yaw = Math.atan2(path.dirX, path.dirZ);
    const stations = liftStations(lift);
    stations.forEach((st, si) => {
      const mid = si > 0 && si < stations.length - 1; // pass-through mid-station of an N-station lift
      const isTop = si === stations.length - 1;
      const parts = mid ? this.midStation(lift.kind) : this.station(lift.kind, isTop);
      const sm = new THREE.Group();
      sm.position.set(st.x + LIFT_STATION_SIZE / 2, st.ground, st.y + LIFT_STATION_SIZE / 2);
      sm.rotation.y = yaw;
      sm.add(new THREE.Mesh(parts.geometry, mat === this.mat ? this.stationMat : mat));
      if (parts.sign && withSign) sm.add(new THREE.Mesh(parts.sign.geometry, this.signMat(parts.sign.text, parts.sign.bg, parts.sign.fg)));
      g.add(sm);
    });
    const towers: Entry['towers'] = [];
    const polyPts: number[] = [lift.bottom.x + LIFT_STATION_SIZE / 2, lift.bottom.y + LIFT_STATION_SIZE / 2];
    for (const t of lift.towers) {
      const h = Math.max(0.1, t.headY - t.groundY);
      const geo = buildTowerGeometry(h, lift.kind);
      geos.push(geo);
      polyPts.push(t.x, t.z);
      const m = new THREE.Mesh(geo, mat);
      towers.push({ mesh: m, base: geo, near: null, h });
      m.position.set(t.x, t.groundY, t.z);
      m.rotation.y = yaw;
      g.add(m);
    }
    polyPts.push(lift.top.x + LIFT_STATION_SIZE / 2, lift.top.y + LIFT_STATION_SIZE / 2);
    let cable: THREE.Mesh | null = null;
    if (lift.kind === 'funicular') {
      const geo = buildTrackGeometry(path);
      geos.push(geo);
      g.add(new THREE.Mesh(geo, mat));
    } else {
      const geo = buildCableGeometry(path);
      geos.push(geo);
      cable = new THREE.Mesh(geo, cableMat);
      g.add(cable);
    }
    const cg = this.cached(`carrier:${lift.kind}`, () => buildCarrierGeometry(lift.kind, false, this.chairBody));
    const count = carrierStates(lift, 0, path).length;
    const inst = new THREE.InstancedMesh(cg, glassGroups(cg) ? [mat, glass] : mat, count);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.frustumCulled = false;
    g.add(inst);
    const e: Entry = { group: g, lift, path, carriers: inst, phase: 0, geos, poly: new Float32Array(polyPts), towers, cable, cableNear: null, band: 'base' };
    this.pose(e);
    return e;
  }

  add(lift: LiftData): void {
    this.remove(lift.id);
    const e = this.build(lift, this.mat, this.cableMat);
    this.entries.set(lift.id, e);
    this.group.add(e.group);
  }

  remove(id: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.group.remove(e.group);
    for (const g of e.geos) g.dispose();
    e.carriers.dispose();
    this.entries.delete(id);
  }

  /** Semi-transparent coloured preview (not tracked; caller removes via dispose handle). */
  createPreview(lift: LiftData, ok: boolean): { group: THREE.Group; dispose(): void } {
    const color = ok ? 0x66ff66 : 0xff5555;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.65, emissive: ok ? 0x114411 : 0x551111 });
    const cableMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const e = this.build(lift, mat, cableMat, false, mat);
    return {
      group: e.group,
      dispose: () => { for (const g of e.geos) g.dispose(); e.carriers.dispose(); mat.dispose(); cableMat.dispose(); },
    };
  }

  /**
   * Ground cameras (ride / photo): lifts within NEAR_TILES of the camera swap to their near variants (chairs / cabins with interiors, towers with sheave
   * assemblies, a round striped cable) and station roofs dither away around the camera. Orthographic cameras: everything stays at the base level
   * (nearLod('ortho') = 'base'). Hysteresis in nearLod; no allocation per frame.
   */
  updateNear(camera: THREE.Camera): void {
    const persp = isPerspective(camera);
    if (!persp) {
      if (this.nearActive) { this.nearActive = false; this.nearHide.value.w = 0; for (const e of this.entries.values()) this.applyBand(e, 'base'); }
      return;
    }
    this.nearActive = true;
    const p = camera.position;
    this.nearHide.value.set(p.x, p.y, p.z, STATION_ROOF_HIDE_RADIUS);
    for (const e of this.entries.values()) {
      const d = distToPolyline(e.poly, p.x, p.z);
      this.applyBand(e, nearLod('perspective', d, e.band === 'base' ? undefined : e.band));
    }
  }

  /** Current close-up band of a lift ('base' in iso). */
  bandOf(id: number): NearBand { return this.entries.get(id)?.band ?? 'base'; }

  private applyBand(e: Entry, band: NearBand): void {
    if (band === e.band) return;
    const wasNear = e.band === 'near', isNear = band === 'near';
    e.band = band;
    if (wasNear === isNear) return;
    const kind = e.lift.kind;
    e.carriers.geometry = isNear ? this.cached(`carrier:${kind}:near`, () => buildCarrierGeometry(kind, true, this.chairBody)) : this.cached(`carrier:${kind}`, () => buildCarrierGeometry(kind, false, this.chairBody));
    for (const t of e.towers) {
      if (isNear && !t.near) { t.near = buildTowerGeometry(t.h, kind, 0.3, true); e.geos.push(t.near); }
      t.mesh.geometry = isNear ? t.near! : t.base;
    }
    if (e.cable) {
      if (isNear && !e.cableNear) { const g = buildCableNearGeometry(e.path); e.geos.push(g); e.cableNear = new THREE.Mesh(g, this.cableNearMat); e.group.add(e.cableNear); }
      e.cable.visible = !isNear;
      if (e.cableNear) e.cableNear.visible = isNear;
    }
  }

  private pose(e: Entry): void {
    const params = LIFT_PARAMS[e.lift.kind];
    const states = carrierStates(e.lift, e.phase, e.path);
    const d = this.dummy;
    states.forEach((s, i) => {
      // Down-strand carriers face down the line (yaw + PI); funicular cars pitch with the track.
      const yaw = s.yaw + (s.strand === 1 ? Math.PI : 0);
      d.position.set(s.x, s.y, s.z);
      d.rotation.set(e.lift.kind === 'funicular' ? (s.strand === 1 ? -s.pitch : s.pitch) : 0, yaw, 0, 'YXZ');
      void params;
      d.updateMatrix();
      e.carriers.setMatrixAt(i, d.matrix);
    });
    e.carriers.instanceMatrix.needsUpdate = true;
  }

  /** Advance animation (renderer frame delta for now; sim tick later). Closed lifts hold still. */
  update(dt: number): void {
    for (const e of this.entries.values()) {
      if (!e.lift.open) continue;
      e.phase += dt * LIFTS[e.lift.kind].speed * e.lift.speed * (e.lift.ecoActive ? LIFT_ECO_FACTOR : 1);
      this.pose(e);
    }
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
    for (const g of this.cache.values()) g.dispose();
    for (const p of this.stationCache.values()) { p.geometry.dispose(); p.sign?.geometry.dispose(); }
    for (const s of this.signMats.values()) { s.mat.dispose(); s.tex?.dispose(); }
    this.mat.dispose(); this.stationMat.dispose(); this.cableMat.dispose(); this.cableNearMat.dispose(); this.glassMat.dispose();
    this.cache.clear(); this.stationCache.clear(); this.signMats.clear();
  }

  phaseOf(id: number): number { return this.entries.get(id)?.phase ?? 0; }
  has(id: number): boolean { return this.entries.has(id); }
  /** The lift record the mesh was built from (identity check after undo / redo). */
  dataOf(id: number): LiftData | undefined { return this.entries.get(id)?.lift; }
  /** Ids of the lifts that currently have meshes. */
  ids(): number[] { return [...this.entries.keys()]; }
}
