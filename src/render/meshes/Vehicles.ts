import * as THREE from 'three';
import { VehicleKind, vehiclePose, type Vehicle } from '@/sim/guests/Arrivals';
import { buildBus, buildCar, buildPlane, buildTrain, CAR_COLORS, SPORT_COLORS, type ModelParts } from './VehicleModels';

const BODY_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const LIGHT_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
const PROP_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

/** Deterministic look of a vehicle: style / colour / roof gear from its id (VIP cars are sports cars). */
export function vehicleLook(kind: number, id: number, vip: boolean): { style: number; color: number; rack: number } {
  const h = (Math.imul(id + 1, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
  const style = kind !== VehicleKind.Car ? 0 : vip ? 4 : (h >>> 3) % 4;
  const color = vip ? SPORT_COLORS[(h >>> 7) % SPORT_COLORS.length]! : CAR_COLORS[(h >>> 9) % CAR_COLORS.length]!;
  return { style, color, rack: (h >>> 13) % 10 < 4 ? 1 : 0 };
}

const cache = new Map<string, ModelParts>();
function parts(key: string, make: () => ModelParts): ModelParts {
  let p = cache.get(key);
  if (!p) { p = make(); cache.set(key, p); }
  return p;
}
export interface VehicleModel { group: THREE.Group; prop: THREE.Object3D | null }

/** Vehicle model (forward = +z, origin at ground level). Geometries are shared/cached per look; materials are shared. */
export function createVehicleMesh(kind: number, variant = 0, winter = false, vip = false): VehicleModel {
  const g = new THREE.Group();
  let p: ModelParts, prop: THREE.Object3D | null = null;
  switch (kind) {
    case VehicleKind.Bus: {
      const mini = variant % 3 === 0, col = [0x3a78c2, 0xd83a34, 0x3fa34d, 0xe8b93a][variant % 4]!;
      p = parts(`bus${mini}${col}`, () => buildBus(mini, col));
      break;
    }
    case VehicleKind.Train: p = parts('train', buildTrain); break;
    case VehicleKind.Plane: p = parts('plane', buildPlane); break;
    default: {
      const l = vehicleLook(kind, variant, vip), rack = l.rack ? (winter ? 1 : 2) : 0;
      p = parts(`car${l.style}-${l.color}-${rack}`, () => buildCar(l.style, l.color, rack));
    }
  }
  g.add(new THREE.Mesh(p.body, BODY_MAT), new THREE.Mesh(p.lights, LIGHT_MAT));
  if (p.prop && p.propPivot) {
    const pm = new THREE.Mesh(p.prop, PROP_MAT);
    pm.position.set(...p.propPivot);
    g.add(pm); prop = pm;
  }
  return { group: g, prop };
}

/** Pools one model per live vehicle; positions interpolated by the tick alpha, pitched to the terrain with a gentle suspension bob. */
export class VehicleRenderer {
  readonly group = new THREE.Group();
  private meshes = new Map<number, VehicleModel & { kind: number }>();
  private pose = { x: 0, y: 0, heading: 0 };
  /** Roof gear season (skis in winter, bikes in summer) for newly appearing cars. */
  winter = false;
  /** 0..1 night factor: head/tail lights glow. */
  night = 0;
  private time = 0;

  constructor(private vehicles: () => readonly Vehicle[], private groundAt: (x: number, y: number) => number) {}

  update(alpha: number): void {
    this.time += 1;
    const live = new Set<number>();
    LIGHT_MAT.color.setScalar(0.62 + 1.1 * this.night);
    for (const v of this.vehicles()) {
      live.add(v.id);
      let m = this.meshes.get(v.id);
      if (!m) {
        m = { ...createVehicleMesh(v.kind, v.id, this.winter, v.riders.includes(3)), kind: v.kind };
        this.meshes.set(v.id, m); this.group.add(m.group);
      }
      const d = v.dist + v.speed * alpha;
      const p = vehiclePose(v, d, this.pose);
      const total = v.cum[v.cum.length - 1]!;
      const lift = v.kind === VehicleKind.Plane ? Math.max(0, v.alt * (1 - d / Math.max(0.001, total))) : 0;
      const x = p.x, y = p.y, h = p.heading;
      const g = this.groundAt(x, y);
      m.group.position.set(x, g + 0.05 + lift, y);
      m.group.rotation.order = 'YXZ';
      m.group.rotation.y = h;
      if (v.kind !== VehicleKind.Plane) {
        const half = v.kind === VehicleKind.Train ? 1.2 : 0.4, sx = Math.sin(h) * half, cz = Math.cos(h) * half;
        const rise = this.groundAt(x + sx, y + cz) - this.groundAt(x - sx, y - cz);
        m.group.rotation.x = -Math.atan2(rise, half * 2);
        if (v.kind !== VehicleKind.Train && v.speed > 0.001) m.group.position.y += 0.004 * Math.sin(d * 3 + v.id);
      } else m.group.rotation.x = lift > 0.05 ? -0.06 : 0;
      if (m.prop) m.prop.rotation.z = this.time * 0.9;
    }
    for (const [id, m] of this.meshes) {
      if (live.has(id)) continue;
      this.group.remove(m.group); // geometries + materials are shared (cached): nothing to dispose per vehicle
      this.meshes.delete(id);
    }
  }

  dispose(): void { this.vehicles = () => []; this.update(0); }
}
