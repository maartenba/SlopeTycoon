import * as THREE from 'three';
import { BUILDINGS } from '@/config/buildings';
import { PartBuilder } from './common';
import type { BuilderEntry, BuiltParts, BuildFn } from './common';
import { C, flagstoneFoundation, hash01 } from './common';
import { createWoodTexture } from '../textures/wood';
import { createRoofTexture } from '../textures/roof';
import { createStoneTexture } from '../textures/stone';
import { createSignTexture } from '../textures/sign';
import * as S from './buildings/services';
import * as K from './buildings/kidsSafety';
import * as O from './buildings/ops';
import * as R from './buildings/outdoor';
import * as T from './buildings/transport';
import * as M from './buildings/mountain';
import * as F from './buildings/farm';
import * as W from './buildings/ranger';
import * as G from './buildings/energy';
import * as Q from './buildings/tours';
import { crag } from './buildings/climbing';
import { raftingBase, canyoningBase } from './buildings/waterTours';
import { TURBINE_HUB } from './buildings/energy';
import { campground, campfireGlowGeometry } from './campground';
import { pettingZoo } from './pettingZoo';
import { viewpoint } from './viewpoint';
import { treehouse } from './treehouse';
import { tackleHut } from './tackleHut';
import { fishingPier } from './fishingPier';
import { hotelSmall } from './hotelSmall';
import { hotelLuxury, poolWaterGeometry } from './hotelLuxury';

const e = (build: BuildFn, foundation = true, rooted = false): BuilderEntry => ({ build, foundation, ...(rooted ? { rooted } : {}) });

/** Registry keyed by BuildingDef.meshBuilder. */
export const BUILDING_BUILDERS: Record<string, BuilderEntry> = {
  baseLodge: e(S.baseLodge), lodge: e(S.lodge), cafe: e(S.cafe), apresBar: e(S.apresBar), mountainHut: e(M.mountainHut), shop: e(S.shop), rental: e(S.rental),
  chalet: e(S.chalet), apartment: e(S.apartment), skiSchoolHQ: e(S.skiSchoolHQ),
  magicCarpet: e(K.magicCarpet, false), kidsGround: e(K.kidsGround, false), playground: e(K.playground, false),
  patrolHub: e(K.patrolHub), rangerStation: e(W.rangerStation), firstAid: e(K.firstAid), warningSign: e(K.warningSign, false), ticketOffice: e(K.ticketOffice), toilets: e(K.toilets, false), quadBase: e(Q.quadBase, false), crag: e(crag, false), raftingBase: e(raftingBase, false), canyoningBase: e(canyoningBase, false),
  helipad: e(O.helipad), groomerGarage: e(O.groomerGarage), liftWorkshop: e(O.liftWorkshop), snowcatOutpost: e(O.snowcatOutpost), reservoir: e(O.reservoir),
  snowCannon: e(O.snowCannon, false), shuttleDepot: e(O.shuttleDepot),
  boatRental: e(R.boatRental, false), beach: e(R.beach, false), iceRink: e(R.iceRink), heatedTerrace: e(R.heatedTerrace),
  stuntPark: e(R.stuntPark, false), adventurePark: e(R.adventurePark, false),
  alpineFarm: e(F.alpineFarm, false), trainStation: e(T.trainStation), altiport: e(T.altiport), parking: e(T.parking, false),
  solarArray: e(G.solarArray, false), solarPlant: e(G.solarPlant, false), windTurbine: e(G.windTurbine), windTurbineRotor: e(G.windRotor, false),
  campground: e(campground, false), pettingZoo: e(pettingZoo, false), viewpoint: e(viewpoint, false), treehouse: e(treehouse, false, true),
  tackleHut: e(tackleHut, false), fishingPier: e(fishingPier, false),
  smallHotel: e(hotelSmall), luxuryHotel: e(hotelLuxury, false),
  smallHydro: e(G.smallHydro), biomassHeating: e(G.biomassHeating), treeNursery: e(G.treeNursery, false), recyclingCentre: e(G.recyclingCentre), ecoCentre: e(G.ecoCentre),
};

export const DEFAULT_FOUNDATION = 0.4;

/** Pure geometry (no textures, no WebGL): footprint w×h tiles; plinth extends `foundationDepth` below ground. */
export function buildParts(id: string, w: number, h: number, foundationDepth = DEFAULT_FOUNDATION): BuiltParts {
  const entry = BUILDING_BUILDERS[id];
  if (!entry) throw new Error(`No mesh builder for '${id}'`);
  const b = new PartBuilder(w, h);
  if (entry.foundation && foundationDepth > 0) flagstoneFoundation(b, w, h, foundationDepth);
  else if (!entry.rooted && foundationDepth > DEFAULT_FOUNDATION + 1e-6) b.box(0, -foundationDepth, 0, w - 0.06, foundationDepth - 0.03, h - 0.06, C.stone, 'stone'); // plain retaining skirt on slopes
  entry.build(b, w, h, foundationDepth);
  return b.finish();
}

/** Per-instance tint palette (RGB multipliers): neutral, warm, cool, faded. */
const TINTS: ReadonlyArray<readonly [number, number, number]> = [[1, 1, 1], [1, 0.95, 0.89], [0.9, 0.95, 1], [0.95, 0.97, 0.93]];
/** Deterministic tint variant 0..3 from a building id/seed (0 for seed 0 = untinted). */
export function tintVariant(seed: number | string): number {
  return seed === 0 ? 0 : Math.floor(hash01(seed, 77) * TINTS.length);
}

/** District roof hues (RGB multipliers on the muted roof vertex colours): terracotta, slate, moss, ochre, plum, charcoal. */
const ROOF_HUES: ReadonlyArray<readonly [number, number, number]> = [[1.14, 0.9, 0.8], [0.8, 0.9, 1.14], [0.85, 1.1, 0.85], [1.12, 1.04, 0.78], [1.02, 0.84, 1.08], [0.78, 0.78, 0.84]];
/** Which 3 hues a village uses (seeded) + the neutral variant: a district reads as coherent, not as a rainbow. */
export function districtHues(seed: number): number[] {
  const order = ROOF_HUES.map((_, i) => i).sort((a, b) => hash01(seed * 31 + a, 5) - hash01(seed * 31 + b, 5));
  return order.slice(0, 3);
}
/** Roof material variant for a building: 'n<k>' = neutral tint k, 'h<k>' = district hue k. Seed 0 (gallery) stays neutral. */
export function roofVariant(seed: number | string, district: number | null): string {
  if (district === null || seed === 0) return `n${tintVariant(seed)}`;
  const r = hash01(seed, 91);
  if (r < 0.32) return `n${tintVariant(seed)}`;
  const hues = districtHues(district);
  return `h${hues[Math.min(2, Math.floor((r - 0.32) / 0.68 * 3))]!}`;
}

export interface SnowUniform { value: number }

/** Window glass colour as stored in the vertex colours (linear working space). Pixels with this vertex colour glow warm at night. */
const GLASS = new THREE.Color(C.glass);

/** Roof snow tint noise: SMOOTH value noise (bilinear, smoothstep weights) in world space, 0..1, low frequency (~1 cell per 1.6 tiles).
 * The old version used `floor()`-quantised hashes (hard 1/3 and 1/7 tile squares: blocky mottling that crawled under camera motion). Mirrored on the CPU in snowNoise.ts for tests. */
export const SNOW_NOISE_GLSL = `
float snHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float snowRoofNoise(vec2 p) {
  vec2 q = p * 0.6, i = floor(q), f = q - i; f = f * f * (3.0 - 2.0 * f);
  return mix(mix(snHash(i), snHash(i + vec2(1.0, 0.0)), f.x), mix(snHash(i + vec2(0.0, 1.0)), snHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

function patchSnow(mat: THREE.MeshLambertMaterial, snow: SnowUniform, key: string, night: SnowUniform, nearHide?: { value: THREE.Vector4 }): void {
  mat.onBeforeCompile = (sh): void => {
    sh.uniforms.uSnow = snow;
    if (nearHide) sh.uniforms.uNearHide = nearHide;
    sh.uniforms.uNight = night;
    sh.uniforms.uGlass = { value: new THREE.Vector3(GLASS.r, GLASS.g, GLASS.b) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vUp;\nvarying float vLY;\nvarying vec3 vSnP;' + (nearHide ? '\nvarying vec3 vNHW;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLY = transformed.y;\nvUp = normalize(mat3(modelMatrix) * objectNormal).y;\nvSnP = (modelMatrix * vec4(transformed, 1.0)).xyz;' + (nearHide ? '\nvNHW = (modelMatrix * vec4(transformed, 1.0)).xyz;' : ''));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnow;\nuniform float uNight;\nuniform vec3 uGlass;\nfloat gGlass;\nvarying float vUp;\nvarying float vLY;\nvarying vec3 vSnP;' + SNOW_NOISE_GLSL + (nearHide ? '\nvarying vec3 vNHW;\nuniform vec4 uNearHide;' : ''))
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + (nearHide ? NEAR_HIDE_GLSL : ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance += vec3(1.0, 0.56, 0.18) * gGlass * smoothstep(0.04, 0.55, uNight) * 1.25;\n#endif')
      .replace('#include <color_fragment>', '#include <color_fragment>\ngGlass = 0.0;\n#ifdef USE_COLOR\ngGlass = 1.0 - step(0.05, length(vColor.rgb - uGlass));\n#endif\ndiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.38, 0.26, 0.16), gGlass * smoothstep(0.04, 0.5, uNight));\ndiffuseColor.rgb *= mix(0.8, 1.0, smoothstep(0.0, 0.32, vLY)) * mix(0.93, 1.0, smoothstep(0.0, 1.2, vLY)); // soft ambient-occlusion gradient at the wall base (no extra draw calls)\nfloat snN = snowRoofNoise(vSnP.xz);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.98, 1.0) * (0.93 + 0.05 * snN), smoothstep(0.55, 0.8, vUp) * uSnow);');
  };
  mat.customProgramCacheKey = (): string => key;
}

/** Roofs above a ground camera dither away within the radius (uNearHide = camera xyz + radius, 0 = off / iso). Same maths as the lift station material. */
const NEAR_HIDE_GLSL = `
  if (uNearHide.w > 0.0 && vNHW.y - uNearHide.y > 0.15) {
    float nhD = length(vNHW.xz - uNearHide.xz);
    float nhK = 1.0 - smoothstep(uNearHide.w * 0.55, uNearHide.w, nhD);
    float nhN = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (nhN < nhK) discard;
  }`;

/** Roof / canopy fade radius (tiles) around the ground camera. */
export const BUILDING_ROOF_HIDE_RADIUS = 3;

/** Creates building Groups with shared cached geometry/materials; one snow uniform drives all roofs. */
export class BuildingMeshes {
  readonly snow: SnowUniform = { value: 0 };
  /** 0..1 night factor (bind to Lighting.nightUniform.value each frame via setNight) -> warm window glow. */
  readonly night: SnowUniform = { value: 0 };
  private geoCache = new Map<string, BuiltParts>();
  private mats = new Map<string, THREE.Material>();
  /** Cosmetic palette (M5.3 Task 16): RGB multipliers for the roof / wood layers on top of the per-instance tint. Neutral = unchanged output. */
  private palette: { roof: readonly [number, number, number]; wood: readonly [number, number, number] } = { roof: [1, 1, 1], wood: [1, 1, 1] };
  private textures: THREE.Texture[] = [];
  /** Village seed for per-district roof hues (null = off: neutral tints only). */
  private district: number | null = null;
  setDistrict(seed: number | null): void { this.district = seed; }
  /** Camera-near roof fade: xyz = camera, w = radius (0 = off, always in iso). */
  private readonly nearHide = { value: new THREE.Vector4(0, 0, 0, 0) };

  /** Ground cameras: dither building roofs within the radius of `p`; null = off (iso). */
  setNearHide(p: { x: number; y: number; z: number } | null, radius = BUILDING_ROOF_HIDE_RADIUS): void {
    if (p) this.nearHide.value.set(p.x, p.y, p.z, radius); else this.nearHide.value.w = 0;
  }

  /** Campfire glow (additive, world-space radial falloff baked in vertex colours: no noise, flicker-safe): shared by every campground, opacity follows the night factor. */
  private fireGlowGeo: THREE.BufferGeometry | null = null;
  private readonly fireGlowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false });
  /** Luxury Hotel pool water (Phase 6 Task 27): ONE flat unlit grid with static vertex colours, shared by every hotel (a stock MeshBasicMaterial: no custom shader to fail, nothing animated, flicker-safe); pool lights make it a little brighter at night than the dusk-dimmed day tone. */
  private poolGeo: THREE.BufferGeometry | null = null;
  private readonly poolMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, name: 'poolWater' });
  /** 0..1 snow cover on upward-facing roof surfaces. */
  setNight(v: number): void { this.night.value = Math.min(1, Math.max(0, v)); this.fireGlowMat.opacity = this.night.value * 0.95; const k = 1 - 0.28 * this.night.value; this.poolMat.color.setRGB(k, k, 1 - 0.1 * this.night.value); }
  setSnow(amount: number): void { this.snow.value = Math.min(1, Math.max(0, amount)); }

  private mat(layer: 'wood' | 'stone' | 'roof', variant: number | string = 0): THREE.Material {
    const mk = `${layer}#${variant}`;
    let m = this.mats.get(mk);
    if (!m) {
      const tex = layer === 'wood' ? createWoodTexture() : layer === 'stone' ? createStoneTexture() : createRoofTexture();
      if (tex) this.textures.push(tex);
      const lm = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
      this.paint(lm, layer, variant); // subtle per-instance tint x cosmetic palette (multiplies vertex colours; glass detection is unaffected)
      patchSnow(lm, this.snow, layer === 'roof' ? 'bldg-roof-nh' : `bldg-${layer}`, this.night, layer === 'roof' ? this.nearHide : undefined);
      m = lm;
      this.mats.set(mk, m);
    }
    return m;
  }

  private paint(m: THREE.MeshLambertMaterial, layer: 'wood' | 'stone' | 'roof', variant: number | string): void {
    const vs = String(variant), t = (vs[0] === 'h' ? ROOF_HUES[Number(vs.slice(1))] : TINTS[Number(vs[0] === 'n' ? vs.slice(1) : vs)]) ?? TINTS[0]!, p = layer === 'roof' ? this.palette.roof : layer === 'wood' ? this.palette.wood : ([1, 1, 1] as const);
    m.color.setRGB(t[0] * p[0], t[1] * p[1], t[2] * p[2]);
  }

  /**
   * Cosmetic building palette: re-tints every existing material in place (no mesh rebuild, no restart) and applies to materials created later.
   * `null` = the default look (identical colours to a build without palettes).
   */
  setPalette(p: { roof: readonly [number, number, number]; wood: readonly [number, number, number] } | null): void {
    this.palette = p ?? { roof: [1, 1, 1], wood: [1, 1, 1] };
    for (const [k, m] of this.mats) {
      const mm = /^(wood|stone|roof)#([nh]?\d+)$/.exec(k);
      if (mm) this.paint(m as THREE.MeshLambertMaterial, mm[1] as 'wood' | 'stone' | 'roof', mm[2]!);
    }
  }
  /** The current palette multipliers (tests). */
  get paletteValue(): { roof: readonly [number, number, number]; wood: readonly [number, number, number] } { return this.palette; }

  private signMat(text: string, bg: string, fg: string): THREE.Material {
    const key = `sign|${text}|${bg}|${fg}`;
    let m = this.mats.get(key);
    if (!m) {
      const tex = createSignTexture(text, bg, fg);
      if (tex) this.textures.push(tex);
      m = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
      this.mats.set(key, m);
    }
    return m;
  }

  parts(id: string, w: number, h: number, depth = DEFAULT_FOUNDATION): BuiltParts {
    const key = `${id}|${w}|${h}|${depth}`;
    let p = this.geoCache.get(key);
    if (!p) { p = buildParts(id, w, h, depth); this.geoCache.set(key, p); }
    return p;
  }

  /** Group with ≤4 meshes, origin at footprint centre at ground level. Rotate the group in 90° steps for placement. */
  create(id: string, foundationDepth = DEFAULT_FOUNDATION, tintSeed: number | string = 0): THREE.Group {
    const def = BUILDINGS[id];
    if (!def) throw new Error(`Unknown building '${id}'`);
    const p = this.parts(def.meshBuilder, def.w, def.h, foundationDepth);
    const variant = tintVariant(tintSeed), rv = roofVariant(tintSeed, this.district);
    const g = new THREE.Group();
    g.name = `building:${id}`;
    for (const l of ['wood', 'stone', 'roof'] as const) {
      const geo = p[l];
      if (geo) g.add(new THREE.Mesh(geo, this.mat(l, l === 'roof' ? rv : variant)));
    }
    if (p.sign) g.add(new THREE.Mesh(p.sign.geometry, this.signMat(p.sign.text, p.sign.bg, p.sign.fg)));
    if (id === 'windTurbine') {
      // the blades are their own group so the view can spin them about the rotor axis (BuildingsView: `rotor`)
      const rp = this.parts('windTurbineRotor', 1, 1, 0), rotor = new THREE.Group();
      rotor.name = 'rotor';
      rotor.position.set(0, TURBINE_HUB.y, TURBINE_HUB.z);
      if (rp.stone) rotor.add(new THREE.Mesh(rp.stone, this.mat('stone', variant)));
      g.add(rotor);
    }
    if (id === 'campground') {
      const glow = new THREE.Mesh(this.fireGlowGeo ??= campfireGlowGeometry(), this.fireGlowMat);
      glow.name = 'fireGlow'; glow.renderOrder = 4;
      g.add(glow);
    }
    if (id === 'luxuryHotel') {
      const water = new THREE.Mesh(this.poolGeo ??= poolWaterGeometry(), this.poolMat);
      water.name = 'poolWater'; water.renderOrder = 1;
      g.add(water);
    }
    return g;
  }

  dispose(): void {
    this.fireGlowGeo?.dispose(); this.fireGlowMat.dispose(); this.poolGeo?.dispose(); this.poolMat.dispose();
    for (const p of this.geoCache.values()) { p.wood?.dispose(); p.stone?.dispose(); p.roof?.dispose(); p.sign?.geometry.dispose(); }
    for (const m of this.mats.values()) m.dispose();
    for (const t of this.textures) t.dispose();
    this.geoCache.clear(); this.mats.clear(); this.textures = [];
  }
}
