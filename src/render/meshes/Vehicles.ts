import * as THREE from 'three';
import { VEHICLE_SPEED, VehicleKind, vehiclePose, type Vehicle } from '@/sim/guests/Arrivals';
import { buildBus, buildCar, buildPlane, buildTrain, CAR_COLORS, SPORT_COLORS, TWO_TONE_ROOFS, type ModelParts } from './VehicleModels';
import { bumpBob, newSuspension, stepSuspension, type Suspension } from '../vehicleMotion';

/** Shared snow cover 0..1 of the vehicle roofs (set by `VehicleRenderer`): up-facing vertices above the wheels blend to snow white in the vertex shader (no extra draw call, no texture). */
const SNOW = { value: 0 };
/** Direct control of the roof snow (visual QA and tests): 0..1. */
export const setVehicleSnow = (v: number): void => { SNOW.value = v; };
const BODY_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
BODY_MAT.onBeforeCompile = (sh): void => {
  sh.uniforms.uCarSnow = SNOW;
  sh.vertexShader = sh.vertexShader.replace('void main() {', 'uniform float uCarSnow;\nvoid main() {')
    .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\n  vColor.rgb = mix(vColor.rgb, vec3(0.93, 0.95, 0.98), uCarSnow * smoothstep(0.6, 0.85, normal.y) * step(0.19, position.y));\n#endif');
};
BODY_MAT.customProgramCacheKey = (): string => 'vehicleSnow';
const LIGHT_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
/** Same unlit lights, with the red tail lights pushed to a hot brake glow (the material is swapped per vehicle: still the same draw count). */
const BRAKE_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
BRAKE_MAT.onBeforeCompile = (sh): void => {
  sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\n  if (vColor.r > 0.7 && vColor.g < 0.2) vColor.rgb = vec3(1.0, 0.3, 0.22) * 2.2;\n#endif');
};
BRAKE_MAT.customProgramCacheKey = (): string => 'vehicleBrake';
const PROP_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

/** Deterministic look of a vehicle: style / colour / roof gear from its id (VIP cars are sports cars). */
/** Styles drawn for ordinary cars (weights by repetition): hatchback, sedan, SUV, van, pickup, estate, camper. VIP cars are sports cars (style 4). */
export const CAR_MIX = [0, 0, 1, 1, 2, 2, 3, 5, 6, 6, 7] as const;
export function vehicleLook(kind: number, id: number, vip: boolean): { style: number; color: number; rack: number; /** 0 = single colour, else the two-tone roof colour. */ roof: number; /** Roof gear kind 0 none, 1 = skis / bikes by season, 2 = ski box. */ gear: number } {
  const h = (Math.imul(id + 1, 0x9e3779b1) ^ 0x5bd1e995) >>> 0, h2 = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  const style = kind !== VehicleKind.Car ? 0 : vip ? 4 : CAR_MIX[(h >>> 3) % CAR_MIX.length]!;
  const color = vip ? SPORT_COLORS[(h >>> 7) % SPORT_COLORS.length]! : CAR_COLORS[(h >>> 9) % CAR_COLORS.length]!;
  const roofC = TWO_TONE_ROOFS[(h2 >>> 6) % TWO_TONE_ROOFS.length]!;
  const roof = !vip && style !== 7 && (h2 >>> 3) % 4 === 0 && roofC !== color ? roofC : 0;
  const hasGear = (h >>> 13) % 10 < 4;
  return { style, color, rack: hasGear ? 1 : 0, roof, gear: hasGear && (h2 >>> 11) % 3 === 0 ? 2 : hasGear ? 1 : 0 };
}

const cache = new Map<string, ModelParts>();
function parts(key: string, make: () => ModelParts): ModelParts {
  let p = cache.get(key);
  if (!p) { p = make(); cache.set(key, p); }
  return p;
}
export interface VehicleModel { group: THREE.Group; prop: THREE.Object3D | null }

/** Vehicle model (forward = +z, origin at ground level). Geometries are shared/cached per look; materials are shared. */
export function createVehicleMesh(kind: number, variant = 0, winter = false, vip = false, low = false): VehicleModel {
  const g = new THREE.Group();
  let p: ModelParts, prop: THREE.Object3D | null = null;
  switch (kind) {
    case VehicleKind.Bus: {
      const mini = variant % 3 === 0, col = [0x3a78c2, 0xd83a34, 0x3fa34d, 0xe8b93a][variant % 4]!;
      p = parts(`bus${mini}${col}${low}`, () => buildBus(mini, col, low));
      break;
    }
    case VehicleKind.Train: p = parts('train', buildTrain); break;
    case VehicleKind.Plane: p = parts('plane', buildPlane); break;
    default: {
      const l = vehicleLook(kind, variant, vip), rack = l.gear === 2 ? 3 : l.rack ? (winter ? 1 : 2) : 0;
      p = parts(`car${l.style}-${l.color}-${rack}-${l.roof}-${low}`, () => buildCar(l.style, l.color, rack, { roof: l.roof || undefined, low }));
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
  private meshes = new Map<number, VehicleModel & { kind: number; susp: Suspension; lights: THREE.Mesh; brake: boolean }>();
  private pose = { x: 0, y: 0, heading: 0 };
  /** Roof gear season (skis in winter, bikes in summer) for newly appearing cars. */
  winter = false;
  /** 0..1 night factor: head/tail lights glow. */
  night = 0;
  /** Snow on the roofs: 0 = none, 1 = winter (eased toward the target a little every frame). */
  snowTarget = 0;
  /** Low quality: simpler car / bus variants for newly appearing vehicles. */
  low = false;
  private time = 0;

  constructor(private vehicles: () => readonly Vehicle[], private groundAt: (x: number, y: number) => number) {}

  update(alpha: number): void {
    this.time += 1;
    const live = new Set<number>();
    LIGHT_MAT.color.setScalar(0.62 + 1.1 * this.night); BRAKE_MAT.color.setScalar(0.62 + 1.1 * this.night);
    SNOW.value += (this.snowTarget - SNOW.value) * 0.05;
    for (const v of this.vehicles()) {
      live.add(v.id);
      let m = this.meshes.get(v.id);
      if (!m) {
        const mod = createVehicleMesh(v.kind, v.id, this.winter, v.riders.includes(3), this.low);
        m = { ...mod, kind: v.kind, susp: newSuspension(), lights: mod.group.children[1] as THREE.Mesh, brake: false };
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
        if (v.kind === VehicleKind.Car || v.kind === VehicleKind.Bus) { // suspension: lean in turns, nose dive when braking; brake lights from the same signal
          const sp = stepSuspension(m.susp, h, v.speed, VEHICLE_SPEED[v.kind]!);
          m.group.rotation.x += sp.pitch; m.group.rotation.z = sp.roll; m.group.position.y += bumpBob(d, v.id, v.speed);
          if (sp.braking !== m.brake) { m.brake = sp.braking; m.lights.material = sp.braking ? BRAKE_MAT : LIGHT_MAT; }
        }
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
