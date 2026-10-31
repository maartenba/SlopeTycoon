import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FESTIVAL_BY_ID, type FestivalId } from '../../config/festivals';
import { ATLAS_ROWS, bannerBoards, paintAtlas, type BannerPlacement } from '../meshes/festival/banner';
import { bannerPostsGeometry, buntingGeometry, finishArchGeometry, grandstandGeometry, poleGeometry, POLE_H, stallGeometry } from '../meshes/festival/parts';
import { placeDressing, propCount, type DressingLayout, type DressingWorld } from './placeDressing';
import { concertLightsGeometry, crowdGeometry, makeLightMaterial, stageGeometry, STAGE_H, type LightUniforms } from '../meshes/festival/stage';
import { Procession, type ProcessionKind } from './Procession';

export interface DressedEvent { id: FestivalId; start: number }
/** Draw calls the dressing may add: solid props, banner boards, procession figures, and (Mountain Concert, Task 41) one additive light mesh (cones + glows). The concert adds 1 to the original 3. */
export const FESTIVAL_DRAW_CALLS = 4;

/** Banner boards hang this high above the ground (tiles). */
const BANNER_TOP = 1.1;

/**
 * Visible set dressing of the running festivals (M5.4 Task 21): bunting, flags, banners with the festival name, market stalls, a grandstand and
 * finish arch (World Cup) and a procession. View only: nothing is written to Occupancy / pathing / the sim. All props of all running events share
 * 3 draw calls (one merged solid mesh, one textured banner mesh, one procession instance mesh). With no running event every mesh is empty and
 * `propCount()` is 0.
 */
export class FestivalDressing {
  readonly group = new THREE.Group();
  readonly solid: THREE.Mesh;
  readonly banners: THREE.Mesh;
  readonly procession: Procession;
  /** Additive light cones + lamp / heater glows of a concert stage (1 draw call, empty otherwise). */
  readonly lights: THREE.Mesh;
  private lightU: LightUniforms;
  private lightMat: THREE.MeshBasicMaterial;
  private time = 0;
  private lightDark = 0;
  private reduced = false;
  private bannerMat = new THREE.MeshLambertMaterial({ side: THREE.FrontSide });
  private atlas: THREE.CanvasTexture | null = null;
  layouts: DressingLayout[] = [];
  private key = '';

  constructor(private ground: (x: number, z: number) => number, private world: () => DressingWorld, private seed: number) {
    this.solid = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.banners = new THREE.Mesh(new THREE.BufferGeometry(), this.bannerMat);
    const lm = makeLightMaterial();
    this.lightMat = lm.material; this.lightU = lm.uniforms;
    this.lights = new THREE.Mesh(new THREE.BufferGeometry(), this.lightMat);
    this.lights.renderOrder = 3; this.lights.name = 'festival:lights';
    for (const m of [this.solid, this.banners, this.lights]) { m.frustumCulled = false; m.visible = false; this.group.add(m); }
    this.procession = new Procession(ground);
    this.group.add(this.procession.group);
    this.group.name = 'festivalDressing';
    this.solid.name = 'festival:solid'; this.banners.name = 'festival:banners';
  }

  /** Total props currently standing (0 when no festival runs). */
  propCount(): number { return this.layouts.reduce((n, l) => n + propCount(l), 0); }
  /** Banner labels currently on the atlas. */
  labels: string[] = [];

  /** Set the running events. Rebuilds only when the set (or `worldKey`, e.g. the building count) changes. */
  setEvents(events: readonly DressedEvent[], worldKey = ''): boolean {
    const key = events.map((e) => `${e.id}@${e.start}`).sort().join(',') + `|${worldKey}`;
    if (key === this.key) return false;
    this.key = key;
    this.build(events);
    return true;
  }

  private build(events: readonly DressedEvent[]): void {
    const w = this.world(), taken = new Set<number>(), layouts: DressingLayout[] = [];
    const sorted = [...events].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (const e of sorted) {
      const l = placeDressing(w, e.id, this.seed ^ (e.start * 2654435761), taken);
      if (!l) continue;
      for (const t of l.tiles) taken.add(t);
      layouts.push(l);
    }
    this.layouts = layouts;
    const solid: THREE.BufferGeometry[] = [], boards: BannerPlacement[] = [], labels: string[] = [];
    const g = this.ground;
    const labelRow = (text: string): number => { let i = labels.indexOf(text); if (i < 0 && labels.length < ATLAS_ROWS) { labels.push(text); i = labels.length - 1; } return Math.max(0, i); };
    let proc: { kind: ProcessionKind; layout: DressingLayout } | null = null;
    for (const l of layouts) {
      const spec = FESTIVAL_BY_ID[l.festival].dressing!, name = FESTIVAL_BY_ID[l.festival].name;
      // poles, flags and bunting
      const tops: THREE.Vector3[] = [];
      l.poles.forEach((p) => {
        const y = g(p.x, p.z);
        solid.push(...poleGeometry(p.x, y, p.z, p.flag >= 0 ? spec.palette[p.flag % spec.palette.length]! : null, 1, 0));
        tops.push(new THREE.Vector3(p.x, y + POLE_H, p.z));
      });
      let k = 0;
      for (const [a, b] of l.strings) { const A = tops[a]!, B = tops[b]!; solid.push(...buntingGeometry(A.x, A.y, A.z, B.x, B.y, B.z, spec.palette, k)); k += 5; }
      for (const s of l.stalls) solid.push(stallGeometry(s.x, g(s.x, s.z), s.z, s.ry, spec.palette[s.color % spec.palette.length]!));
      if (l.grandstand) solid.push(grandstandGeometry(l.grandstand.x, g(l.grandstand.x, l.grandstand.z), l.grandstand.z, l.grandstand.ry));
      const row = labelRow(name);
      for (const b of l.banners) {
        const y = g(b.x, b.z);
        solid.push(bannerPostsGeometry(b.x, y, b.z, b.ry, b.w, b.h, BANNER_TOP));
        boards.push({ x: b.x, y: y + BANNER_TOP - b.h / 2, z: b.z, ry: b.ry, w: b.w, h: b.h, row });
      }
      if (l.finish) {
        const f = l.finish, y = g(f.x, f.z), ry = l.loop.length >= 2 ? Math.atan2(l.loop.at(-1)!.x - l.loop.at(-2)!.x, l.loop.at(-1)!.y - l.loop.at(-2)!.y) : f.ry;
        solid.push(finishArchGeometry(f.x, y, f.z, ry));
        boards.push({ x: f.x, y: y + 1.05 + 0.2, z: f.z, ry, w: 1.7, h: 0.36, row: labelRow('FINISH') });
      }
      if (spec.procession && l.figures > 0) proc = { kind: spec.procession.kind, layout: l };
    }
    this.labels = labels;
    const lightGeos: THREE.BufferGeometry[] = [];
    for (const l of layouts) {
      if (!l.stage) continue;
      const st = l.stage, spec = FESTIVAL_BY_ID[l.festival].dressing!, y = g(st.x, st.z);
      solid.push(stageGeometry(st.x, y, st.z, st.ry, st.edition, spec.palette));
      const people = crowdGeometry(st.crowd, g, spec.palette, st.edition);
      if (people) solid.push(people);
      const b = st.banner, by = y + STAGE_H.floor + STAGE_H.truss - 0.3;
      boards.push({ x: b.x, y: by - b.h / 2 + 0.17, z: b.z, ry: b.ry, w: b.w, h: b.h, row: labelRow(FESTIVAL_BY_ID[l.festival].name) });
      lightGeos.push(concertLightsGeometry({ x: st.x, y, z: st.z, ry: st.ry, edition: st.edition }));
    }
    this.lights.geometry.dispose(); this.lights.geometry = lightGeos.length ? mergeGeometries(lightGeos, false) : new THREE.BufferGeometry(); this.lights.visible = lightGeos.length > 0;
    for (const lg of lightGeos) lg.dispose();
    this.applyLight();
    const swap = (m: THREE.Mesh, geo: THREE.BufferGeometry | null): void => { m.geometry.dispose(); m.geometry = geo ?? new THREE.BufferGeometry(); m.visible = !!geo; };
    swap(this.solid, solid.length ? mergeGeometries(solid, false) : null);
    swap(this.banners, boards.length ? bannerBoards(boards) : null);
    this.atlas?.dispose(); this.atlas = null; this.bannerMat.map = null;
    if (boards.length) {
      const canvas = paintAtlas(labels);
      if (canvas) { this.atlas = new THREE.CanvasTexture(canvas); this.atlas.colorSpace = THREE.SRGBColorSpace; this.atlas.anisotropy = 4; this.bannerMat.map = this.atlas; }
      else this.bannerMat.color.set(0xb04030); // no canvas (tests): plain cloth
      this.bannerMat.needsUpdate = true;
    }
    if (proc) this.procession.set(proc.kind, proc.layout.loop, proc.layout.figures, this.seed);
    else this.procession.set(null, [], 0);
  }

  /** Night factor 0..1 (the lights show at dusk and night) and reduced motion (static cones). */
  setLight(dark: number, reducedMotion = false): void { this.lightDark = dark; this.reduced = reducedMotion; this.applyLight(); }
  private applyLight(): void {
    this.lightMat.opacity = 0.05 + 0.4 * Math.max(0, Math.min(1, this.lightDark));
    this.lightU.uMotion.value = this.reduced ? 0 : 1;
  }

  /** Per frame: the procession walks (daytime only); the light cones sway gently (static with reduced motion). */
  update(dt: number, hour: number): void { this.procession.update(dt, hour); this.time += dt; this.lightU.uTime.value = this.time; }

  dispose(): void {
    this.solid.geometry.dispose(); (this.solid.material as THREE.Material).dispose();
    this.lights.geometry.dispose(); this.lightMat.dispose();
    this.banners.geometry.dispose(); this.bannerMat.dispose(); this.atlas?.dispose();
    this.procession.dispose();
  }
}
