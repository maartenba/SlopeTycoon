import * as THREE from 'three';
import { FARM_WORK as F } from '../config/farmWork';
import type { WeatherKind } from '../core/events';
import { farmPhase, headingAt, hk, lerpAngle, loadOf, mayDepart, mustBeHome, newRunner, patchLevel, planHome, planTrip, posAt, rowProgress, stepRunner, type FarmSite, type Runner, type TripPlan, type WorkWorld } from './farmWorkPlan';
import { baleGeometry, LIVERY_COUNT, loafGeometry, TRACTOR, tractorGeometry, trailerGeometry } from './meshes/tractor';
import { SMOKE_FRAG, SMOKE_VERT } from './Smoke';

/**
 * Summer farm vehicles (docs/farm-work.md): tractors with a hay trailer work the pastures around every Alpine Farm. VIEW ONLY: reads the farm list, the season / hour / weather, the camera;
 * writes nothing into the sim, saves nothing, never draws a sim Rng number. Every trip is a stable hash of (seed, day, farm, tractor, trip) planned by the pure module `farmWork.ts`.
 * Draw calls (only while a tractor is visible): tractors, trailers, bales + hay loads, mown stripes, exhaust (Medium / High). Motion reads the accumulated frame `dt` only (frame-step safe).
 */
export interface FarmSource { id: number; site: FarmSite }
export interface FarmWorkCtx {
  day: number; hour: number; weather: WeatherKind;
  /** Tractors per farm (`tractorCap`); 0 = none. */
  cap: number; reduced: boolean; /** Game speed 10x / fast-forward: no new trips. */ fast: boolean;
  viewHeight: number; focus: { x: number; z: number }; exhaust: boolean; night?: number;
}
export type ForceAt = number | 'mowA' | 'mowB' | 'home' | 'gate' | 'unload';
export interface ForceOpts { day?: number; hour?: number; weather?: WeatherKind; at?: ForceAt | ForceAt[] }

interface Patch { id: number; plan: TripPlan; runner: Runner | null; mown: [number, number]; bales: number[]; doneAt: number; born: number }
interface TState {
  farm: number; idx: number; presence: number; runner: Runner | null; wait: number; trips: number; day: number; parkYaw: number; patch: Patch | null;
  x: number; y: number; yaw: number; trYaw: number; trX: number; trY: number; load: number; moving: boolean; nextPuff: number; ring: number; site: FarmSite; forceDone: boolean;
}

const STRIPE_VERT = `
attribute float aAlpha; varying float vA; varying vec2 vUv;
void main(){ vA = aAlpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const STRIPE_FRAG = `
uniform float uNight; varying float vA; varying vec2 vUv;
void main(){
  float e = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.78, 1.0, vUv.y));
  vec3 straw = mix(vec3(0.82, 0.76, 0.44), vec3(0.74, 0.68, 0.38), vUv.y);
  gl_FragColor = vec4(straw * (1.0 - 0.55 * uNight), vA * 0.9 * e);
}`;

const ease = (p: number): number => p * p * (3 - 2 * p);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const V = new THREE.Vector3();

export class FarmWorkView {
  /** Shadow casters (flagged `shadowDynamic` by the caller): tractors, trailers, bales and hay loads. */
  readonly group = new THREE.Group();
  /** No shadows: mown stripes + exhaust. */
  readonly fx = new THREE.Group();
  /** `tractors` = livery 0 (red); `liveries` = all three meshes (red, green, blue: one per farm hash). */
  readonly tractors: THREE.InstancedMesh; readonly liveries: THREE.InstancedMesh[]; readonly loaves: THREE.InstancedMesh; readonly trailers: THREE.InstancedMesh; readonly bales: THREE.InstancedMesh; readonly stripes: THREE.InstancedMesh; readonly exhaust: THREE.Mesh;
  /** Render clock: the accumulated frame seconds, the only time source. */
  clock = 0;
  private states = new Map<string, TState>();
  private patches: Patch[] = [];
  private nextPatch = 1;
  private farmList: FarmSource[] = [];
  private farmAt = -99;
  private world: WorkWorld | null = null; private worldAt = -99;
  private forced: ForceOpts | null = null;
  private shown = false;
  private o = new THREE.Object3D(); private m4 = new THREE.Matrix4(); private m5 = new THREE.Matrix4();
  private alpha: Float32Array;
  private puffO: Float32Array; private puffB: Float32Array; private puffS: Float32Array; private puffW: Float32Array;
  private puffGeo = new THREE.InstancedBufferGeometry();
  private puffMat: THREE.ShaderMaterial; private stripeMat: THREE.ShaderMaterial;
  /** Counts of the last frame (tests / debug). */
  stats = { tractors: 0, trailers: 0, bales: 0, stripes: 0, puffs: 0, trips: 0, noSpot: 0 };

  constructor(private ground: (x: number, z: number) => number, private farms: () => FarmSource[], private worldOf: () => WorkWorld | null, private seed: number, nightUniform: { value: number } = { value: 0 }) {
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true });
    const cap = F.caps.tractors;
    const mk = (g: THREE.BufferGeometry, n: number, name: string): THREE.InstancedMesh => { const m = new THREE.InstancedMesh(g, lit, n); m.count = 0; m.frustumCulled = false; m.name = name; this.group.add(m); return m; };
    this.liveries = Array.from({ length: LIVERY_COUNT }, (_, i) => mk(tractorGeometry(i), cap, i ? `farm:tractors${i}` : 'farm:tractors'));
    this.tractors = this.liveries[0]!;
    this.loaves = mk(loafGeometry(), cap, 'farm:loaves');
    this.trailers = mk(trailerGeometry(), cap, 'farm:trailers');
    this.bales = mk(baleGeometry(), F.caps.patches * F.bales.perPatch + cap, 'farm:bales');
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.alpha = new Float32Array(F.caps.stripes);
    this.stripeMat = new THREE.ShaderMaterial({ vertexShader: STRIPE_VERT, fragmentShader: STRIPE_FRAG, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, uniforms: { uNight: nightUniform } });
    this.stripes = new THREE.InstancedMesh(plane, this.stripeMat, F.caps.stripes);
    this.stripes.count = 0; this.stripes.frustumCulled = false; this.stripes.renderOrder = 3; this.stripes.name = 'farm:stripes';
    // the per-instance alpha lives on the geometry as an instanced attribute
    plane.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.fx.add(this.stripes);
    const n = F.caps.tractors * F.exhaust.pool;
    this.puffO = new Float32Array(n * 3); this.puffB = new Float32Array(n).fill(-1); this.puffS = new Float32Array(n); this.puffW = new Float32Array(n).fill(0.4);
    for (let i = 0; i < n; i++) this.puffS[i] = (i * 0.6180339) % 1;
    const quad = new THREE.PlaneGeometry(1, 1);
    this.puffGeo.index = quad.index; this.puffGeo.setAttribute('position', quad.getAttribute('position'));
    this.puffGeo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(this.puffO, 3).setUsage(THREE.DynamicDrawUsage));
    this.puffGeo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(this.puffB, 1).setUsage(THREE.DynamicDrawUsage));
    this.puffGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(this.puffS, 1));
    this.puffGeo.setAttribute('aWide', new THREE.InstancedBufferAttribute(this.puffW, 1));
    this.puffGeo.instanceCount = n;
    this.puffMat = new THREE.ShaderMaterial({ vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.3, 0.15) }, uLife: { value: F.exhaust.life }, uScale: { value: 0.2 }, uColor: { value: new THREE.Color(0.5, 0.52, 0.56) }, uNight: nightUniform } });
    this.exhaust = new THREE.Mesh(this.puffGeo, this.puffMat); this.exhaust.frustumCulled = false; this.exhaust.renderOrder = 5; this.exhaust.visible = false; this.exhaust.name = 'farm:exhaust';
    this.fx.add(this.exhaust);
    this.group.name = 'farmWork'; this.fx.name = 'farmWorkFx';
    this.group.visible = false; this.fx.visible = false;
  }

  /** QA hook (`__slope.farmWork.force`): place the tractors mid-trip for a shot. Pass null to release. */
  force(o: ForceOpts | null): number {
    this.forced = o;
    for (const s of this.states.values()) { s.forceDone = false; this.detach(s); s.runner = null; if (o) s.presence = 1; } // restart every tractor parked: the forced trip is planned on the next frame
    return this.states.size;
  }
  /** Working tractors (moving, not parked) for the audio probe and tests: world x, y (tile units). */
  working(): Array<{ x: number; y: number }> { const out: Array<{ x: number; y: number }> = []; for (const s of this.states.values()) if (s.runner && s.presence >= 1) out.push({ x: s.x, y: s.y }); return out; }
  /** Tractor states (tests / debug). */
  snapshot(): Array<{ farm: number; idx: number; x: number; y: number; yaw: number; load: number; onTrip: boolean; presence: number }> { return [...this.states.values()].map((s) => ({ farm: s.farm, idx: s.idx, x: s.x, y: s.y, yaw: s.yaw, load: s.load, onTrip: !!s.runner, presence: s.presence })); }

  private yawFor(site: FarmSite, idx: number): number { const p = site.park[idx % site.park.length]!; return Math.atan2(p.y - site.gates[0]!.y, p.x - site.gates[0]!.x); }
  private getWorld(): WorkWorld | null { if (!this.world || this.clock - this.worldAt > 20) { this.world = this.worldOf(); this.worldAt = this.clock; } return this.world; }

  private detach(st: TState): void { if (st.patch) { st.patch.runner = null; st.patch.doneAt = this.clock; st.patch = null; } }

  private startTrip(st: TState, ctx: FarmWorkCtx, tag: number, at?: ForceAt): boolean {
    const w = this.getWorld(); if (!w) return false;
    const avoid = this.patches.filter((p) => p.doneAt < 0 || this.clock - p.doneAt < F.patchHold).map((p) => ({ x: p.plan.cx, y: p.plan.cy }));
    const plan = planTrip(w, st.site, st.idx, Math.floor(hk(this.seed, ctx.day, st.farm, st.idx, tag) * 1e9), avoid);
    if (!plan) { this.stats.noSpot++; return false; }
    const r = newRunner(plan);
    const patch: Patch = { id: this.nextPatch++, plan, runner: r, mown: [0, 0], bales: plan.bales.map(() => 0), doneAt: -1, born: this.clock };
    this.patches.push(patch);
    if (this.patches.length > F.caps.patches) { const old = this.patches.findIndex((p) => p.doneAt >= 0); this.patches.splice(old >= 0 ? old : 0, 1); }
    this.detach(st); st.patch = patch; st.runner = r; st.trips++; this.stats.trips++;
    if (at !== undefined) this.advanceTo(r, at);
    return true;
  }
  private advanceTo(r: Runner, at: ForceAt): void {
    const p = r.plan, rows = p.rows;
    let target = typeof at === 'number' ? at * p.total : at === 'mowA' ? rows[0]!.s0 + (rows[0]!.s1 - rows[0]!.s0) * 0.6 : at === 'mowB' ? rows[1]!.s0 + (rows[1]!.s1 - rows[1]!.s0) * 0.75 : at === 'gate' ? 4 : at === 'unload' ? p.total : rows[1]!.s1 + (p.total - rows[1]!.s1) * 0.4;
    target = Math.min(p.total, Math.max(0, target));
    for (let g = 0; g < 4000 && r.s < target - 1e-6 && !r.done; g++) stepRunner(r, 0.1);
    if (at === 'unload') for (let g = 0; g < 8; g++) stepRunner(r, 0.2);
  }

  update(dt: number, c: FarmWorkCtx): void {
    this.clock += Math.min(dt, 0.1);
    const fo = this.forced, day = fo?.day ?? c.day, hour = fo?.hour ?? c.hour, weather = fo?.weather ?? c.weather;
    const phase = farmPhase(day), cap = Math.min(c.cap, F.caps.tractors);
    // farm list (nearest to the camera target first), refreshed twice a second
    if (this.clock - this.farmAt > 0.5) {
      this.farmAt = this.clock;
      this.farmList = this.farms().sort((a, b) => Math.hypot(a.site.gates[0]!.x - c.focus.x, a.site.gates[0]!.y - c.focus.z) - Math.hypot(b.site.gates[0]!.x - c.focus.x, b.site.gates[0]!.y - c.focus.z)).slice(0, F.maxFarms);
    }
    const near = c.viewHeight < (this.shown ? F.view.far * 1.05 : F.view.far);
    const want = new Set<string>();
    if (phase !== 'off' && cap > 0) for (const f of this.farmList) for (let i = 0; i < cap && i < f.site.park.length; i++) want.add(`${f.id}:${i}`);
    for (const f of this.farmList) for (let i = 0; i < cap && i < f.site.park.length && want.has(`${f.id}:${i}`); i++) {
      const key = `${f.id}:${i}`; let st = this.states.get(key);
      if (!st) { const p = f.site.park[i]!; st = { farm: f.id, idx: i, presence: fo ? 1 : 0, runner: null, wait: i * 2 + hk(this.seed, f.id, i) * F.jitter, trips: 0, day, parkYaw: this.yawFor(f.site, i), patch: null, x: p.x, y: p.y, yaw: this.yawFor(f.site, i), trYaw: 0, trX: 0, trY: 0, load: 0, moving: false, nextPuff: 0, ring: 0, site: f.site, forceDone: false }; this.states.set(key, st); }
      st.site = f.site;
    }
    let tn = 0;
    for (const [key, st] of this.states) {
      const wanted = want.has(key);
      const home = !wanted || mustBeHome(hour, weather) || (phase !== 'work' && !fo) || !near;
      if (st.day !== day) { st.day = day; st.trips = 0; }
      if (st.runner) {
        if (!st.runner.plan.home && home && !fo) { const w = this.getWorld(); if (w) { const keep = st.runner; this.detach(st); st.runner = newRunner(planHome(w, st.site, st.idx, { x: st.x, y: st.y }, loadOf(keep))); } }
        stepRunner(st.runner, dt > 0.1 ? 0.1 : dt);
        if (st.runner.done) { st.parkYaw = headingAt(st.runner.plan, st.runner.plan.total); this.detach(st); st.runner = null; st.wait = F.rest + hk(this.seed, st.farm, st.idx, st.trips) * F.jitter; st.load = 0; }
      } else if (wanted && st.presence >= 1) {
        if (fo && !st.forceDone) {
          st.forceDone = true;
          const at = Array.isArray(fo.at) ? fo.at[st.idx % fo.at.length] : fo.at;
          if (at !== undefined || fo.hour !== undefined || fo.day !== undefined) this.startTrip(st, c, 100 + st.idx, at ?? (['mowA', 'mowB'] as const)[st.idx % 2]);
        } else if (!fo) {
          st.wait -= dt;
          if (st.wait <= 0 && phase === 'work' && !c.fast && !c.reduced && !home && mayDepart(hour, st.idx, hk(this.seed, st.farm, st.idx, day)) && near) { if (!this.startTrip(st, c, st.trips)) st.wait = 40; }
        }
      }
      st.presence = clamp01(st.presence + ((wanted ? 1 : -1) * dt) / 1.6);
      if (!wanted && !st.runner && st.presence <= 0) { this.states.delete(key); continue; }
      tn++;
    }
    this.stats.tractors = tn;
    this.shown = near && this.states.size > 0;
    this.group.visible = this.shown; this.fx.visible = this.shown;
    if (!this.shown) { for (const m of this.liveries) m.count = 0; this.loaves.count = this.trailers.count = this.bales.count = this.stripes.count = 0; this.stats.trailers = this.stats.bales = this.stats.stripes = this.stats.puffs = 0; this.exhaust.visible = false; return; }
    this.write(c);
  }

  private write(c: FarmWorkCtx): void {
    const o = this.o; let nt = 0, nb = 0, nl = 0; const vn = this.liveries.map(() => 0);
    o.rotation.order = 'YZX';
    const A = TRACTOR.trailerAxle, H = TRACTOR.hitch;
    for (const st of this.states.values()) {
      if (nt >= F.caps.tractors) break;
      let x: number, y: number, yaw: number, load = 0, moving = false, trx: number, try_: number, tryaw: number;
      const r = st.runner;
      if (r) {
        const p = posAt(r.plan, r.s); x = p.x; y = p.y;
        yaw = headingAt(r.plan, r.s);
        if (r.s < 1e-6 && r.dwellIdx === 1 && r.dwellTotal > 0 && !r.plan.home) yaw = lerpAngle(st.parkYaw, yaw, ease(1 - r.dwellLeft / r.dwellTotal));
        else if (r.s < 1e-6 && r.dwellIdx === 0 && !r.plan.home) yaw = st.parkYaw;
        load = loadOf(r); moving = r.dwellLeft <= 0 && !r.done;
        if (r.s >= H + A) { const h = posAt(r.plan, r.s - H), b = posAt(r.plan, r.s - H - A); trx = h.x; try_ = h.y; tryaw = Math.atan2(h.y - b.y, h.x - b.x); }
        else { trx = x - Math.cos(yaw) * H; try_ = y - Math.sin(yaw) * H; tryaw = yaw; }
        // patch progress
        const pa = st.patch; if (pa) { pa.mown[0] = rowProgress(r.plan, r.s, 0); pa.mown[1] = rowProgress(r.plan, r.s, 1); r.plan.bales.forEach((b, i) => { pa.bales[i] = clamp01((r.s - b.s) / (F.speed.mow * F.bales.popSec)); }); }
      } else { const pk = st.site.park[st.idx % st.site.park.length]!; x = pk.x; y = pk.y; yaw = st.parkYaw; trx = x - Math.cos(yaw) * H; try_ = y - Math.sin(yaw) * H; tryaw = yaw; }
      st.x = x; st.y = y; st.yaw = yaw; st.load = load; st.moving = moving; st.trX = trx; st.trY = try_; st.trYaw = tryaw;
      const sc = ease(st.presence); if (sc <= 0.001) continue;
      // tractor
      const g = this.ground(x, y), gf = this.ground(x + Math.cos(yaw) * 0.2, y + Math.sin(yaw) * 0.2), gb = this.ground(x - Math.cos(yaw) * 0.2, y - Math.sin(yaw) * 0.2);
      o.position.set(x, Math.max(g, (gf + gb) / 2), y); o.rotation.set(0, -yaw, Math.atan2(gf - gb, 0.4)); o.scale.setScalar(sc); o.updateMatrix();
      const lv = Math.floor(hk(this.seed, st.farm, 77) * LIVERY_COUNT) % LIVERY_COUNT; this.liveries[lv]!.setMatrixAt(vn[lv]!++, o.matrix);
      const tm = this.m4.copy(o.matrix);
      // exhaust (Medium / High, moving or working only)
      if (c.exhaust && r && !r.done && this.clock >= st.nextPuff) {
        st.nextPuff = this.clock + F.exhaust.every * (moving ? 1 : 1.8);
        V.set(TRACTOR.stack[0], TRACTOR.stack[1], TRACTOR.stack[2]).applyMatrix4(tm);
        const slot = (nt * F.exhaust.pool + (st.ring++ % F.exhaust.pool)) * 3, si = slot / 3;
        this.puffO[slot] = V.x; this.puffO[slot + 1] = V.y; this.puffO[slot + 2] = V.z; this.puffB[si] = this.clock;
      }
      // trailer
      const tg = this.ground(trx, try_), tf = this.ground(trx + Math.cos(tryaw) * 0.3, try_ + Math.sin(tryaw) * 0.3), tb = this.ground(trx - Math.cos(tryaw) * 0.6, try_ - Math.sin(tryaw) * 0.6);
      o.position.set(trx, Math.max(tg, (tf + tb) / 2), try_); o.rotation.set(0, -tryaw, Math.atan2(tf - tb, 0.9)); o.updateMatrix();
      this.trailers.setMatrixAt(nt, o.matrix);
      // hay load: a long loaf on the deck that grows with the load
      if (load > 0.02 && nl < this.loaves.instanceMatrix.count) {
        const f = load / F.load.max, hh = F.load.height * (0.25 + 0.75 * f) * 0.5;
        this.m5.compose(V.set(-A, 0.15, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Vector3(F.load.width * (0.4 + 0.6 * f) * 0.5, hh * 1.6, F.load.length * 0.5));
        this.m5.premultiply(o.matrix); this.loaves.setMatrixAt(nl++, this.m5);
      }
      nt++;
    }
    // field bales + stripes
    let ns = 0;
    const patchAge = (p: Patch): number => (p.doneAt < 0 ? 0 : this.clock - p.doneAt);
    this.patches = this.patches.filter((p) => p.doneAt < 0 || patchLevel(patchAge(p)) > 0);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
    for (const p of this.patches) {
      const lvl = patchLevel(patchAge(p));
      p.plan.bales.forEach((b, i) => {
        const pop = p.bales[i]!; if (pop <= 0.01 || nb >= this.bales.instanceMatrix.count) return;
        const s = ease(pop) * lvl, rr = F.bales.radius * s, ww = F.bales.width * s;
        e.set(0, hk(p.id, i) * Math.PI, 0); q.setFromEuler(e);
        this.m5.compose(pv.set(b.x, this.ground(b.x, b.y) + rr * 0.95, b.y), q, sv.set(rr, rr, ww)); this.bales.setMatrixAt(nb++, this.m5);
      });
      for (let ri = 0; ri < 2; ri++) {
        const row = p.plan.rows[ri]!, mown = p.mown[ri]!; if (mown <= 0.01) continue;
        const dx = row.x1 - row.x0, dy = row.y1 - row.y0, len = Math.hypot(dx, dy), pieces = Math.ceil(len), step = len / pieces, yaw = Math.atan2(dy, dx);
        for (let k = 0; k < pieces; k++) {
          const cover = clamp01((mown * len - k * step) / step); if (cover < 0.03 || ns >= F.caps.stripes) continue;
          const l = step * cover, u0 = (k * step) / len, u1 = (k * step + l) / len;
          const x0 = row.x0 + dx * u0, y0 = row.y0 + dy * u0, x1 = row.x0 + dx * u1, y1 = row.y0 + dy * u1, h0 = this.ground(x0, y0), h1 = this.ground(x1, y1), hm = this.ground((x0 + x1) / 2, (y0 + y1) / 2);
          e.set(0, -yaw, Math.atan2(h1 - h0, l)); q.setFromEuler(e);
          this.m5.compose(pv.set((x0 + x1) / 2, (h0 + h1) / 2 + Math.max(0, hm - (h0 + h1) / 2) + 0.03, (y0 + y1) / 2), q, sv.set(l, 1, F.patch.rowWidth));
          this.stripes.setMatrixAt(ns, this.m5); this.alpha[ns] = lvl * ease(cover); ns++;
        }
      }
    }
    this.liveries.forEach((m, i) => { m.count = vn[i]!; m.visible = m.count > 0; m.instanceMatrix.needsUpdate = true; }); this.loaves.count = nl; this.loaves.instanceMatrix.needsUpdate = true; this.trailers.count = nt; this.bales.count = nb; this.stripes.count = ns;
    this.trailers.instanceMatrix.needsUpdate = this.bales.instanceMatrix.needsUpdate = this.stripes.instanceMatrix.needsUpdate = true;
    (this.stripes.geometry.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    this.stats.trailers = nt; this.stats.bales = nb; this.stats.stripes = ns;
    // exhaust uniforms
    this.puffMat.uniforms.uTime!.value = this.clock;
    this.puffMat.uniforms.uScale!.value = Math.max(0.5, Math.min(1.5, c.viewHeight / 50)) * 0.27;
    this.exhaust.visible = c.exhaust && nt > 0;
    (this.puffGeo.getAttribute('aOrigin') as THREE.BufferAttribute).needsUpdate = true; (this.puffGeo.getAttribute('aBirth') as THREE.BufferAttribute).needsUpdate = true;
    let puffs = 0; for (let i = 0; i < this.puffB.length; i++) if (this.puffB[i]! >= 0 && this.clock - this.puffB[i]! < F.exhaust.life) puffs++;
    this.stats.puffs = puffs;
  }
  dispose(): void { for (const m of [...this.liveries, this.loaves, this.trailers, this.bales, this.stripes]) m.geometry.dispose(); this.puffGeo.dispose(); this.puffMat.dispose(); this.stripeMat.dispose(); }
}
