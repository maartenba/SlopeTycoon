import * as THREE from 'three';
import { GState, type GuestStore } from '@/sim/guests/Guest';
import { clusterKey, clusterRepresentatives, EMOTES, pickEmote, wildlifeAllowed, type EmoteCandidate, type EmoteKind, type EmoteMemo, type EmoteNeeds } from './emotePick';
import type { FeedbackPolicy } from './feedbackPolicy';
import { renderRng } from './Particles';

/** Seconds an emote lives. */
export const EMOTE_LIFE_S = 1.5;
/** Rise in world units over the lifetime (0 with reduced motion). */
export const EMOTE_RISE = 0.7;
/** On-screen size in px (clamped) and peak opacity: small and calm. */
export const EMOTE_PX = 24;
export const EMOTE_OPACITY = 0.9;
/** Queue-cluster cell (world tiles). */
export const EMOTE_CELL = 5;
const CELL_PX = 64, COLS = 4, ROWS = 2;

const rr = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void => { c.beginPath(); c.roundRect(x, y, w, h, r); };
/** Draw the seven vector glyphs into an atlas canvas (4 x 2 cells of 64 px). No emoji / font dependency. */
export function drawEmoteAtlas(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, CELL_PX * COLS, CELL_PX * ROWS);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const colours: Record<EmoteKind, string> = { hungry: '#f0b45a', cold: '#8fd0f5', tired: '#b9a8e8', happy: '#ffd36b', angry: '#ff7a6a', scared: '#e8e2b8', wildlife: '#9fd89a' };
  EMOTES.forEach((k, i) => {
    const ox = (i % COLS) * CELL_PX, oy = Math.floor(i / COLS) * CELL_PX, cx = ox + 32, cy = oy + 32;
    ctx.fillStyle = 'rgba(24,36,50,0.86)'; ctx.beginPath(); ctx.arc(cx, cy, 28, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = colours[k]; ctx.fillStyle = colours[k]; ctx.lineWidth = 5;
    ctx.beginPath();
    switch (k) {
      case 'hungry': ctx.moveTo(cx - 8, cy - 14); ctx.lineTo(cx - 8, cy + 14); ctx.moveTo(cx - 14, cy - 14); ctx.lineTo(cx - 14, cy - 4); ctx.moveTo(cx - 2, cy - 14); ctx.lineTo(cx - 2, cy - 4); ctx.moveTo(cx - 14, cy - 4); ctx.quadraticCurveTo(cx - 8, cy + 2, cx - 2, cy - 4); ctx.moveTo(cx + 10, cy + 14); ctx.lineTo(cx + 10, cy - 14); ctx.stroke(); break;
      case 'cold': for (let a = 0; a < 3; a++) { const t = (a * Math.PI) / 3; ctx.moveTo(cx - Math.cos(t) * 16, cy - Math.sin(t) * 16); ctx.lineTo(cx + Math.cos(t) * 16, cy + Math.sin(t) * 16); } ctx.stroke(); break;
      case 'tired': ctx.moveTo(cx - 12, cy - 10); ctx.lineTo(cx + 8, cy - 10); ctx.lineTo(cx - 12, cy + 12); ctx.lineTo(cx + 8, cy + 12); ctx.stroke(); break;
      case 'happy': ctx.arc(cx, cy + 1, 15, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); ctx.beginPath(); ctx.arc(cx - 8, cy - 8, 3.2, 0, 7); ctx.arc(cx + 8, cy - 8, 3.2, 0, 7); ctx.fill(); break;
      case 'angry': ctx.moveTo(cx, cy - 15); ctx.lineTo(cx, cy + 3); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy + 13, 3.4, 0, 7); ctx.fill(); break;
      case 'wildlife': // paw print: pad + four toes
        ctx.ellipse(cx, cy + 7, 10, 8, 0, 0, 7); ctx.fill(); ctx.beginPath();
        for (const [dx, dy, r] of [[-12, -4, 4.2], [-4.5, -12, 4.4], [4.5, -12, 4.4], [12, -4, 4.2]] as const) { ctx.moveTo(cx + dx + r, cy + dy); ctx.arc(cx + dx, cy + dy, r, 0, 7); }
        ctx.fill(); break;
      case 'scared': ctx.arc(cx - 8, cy - 5, 5, 0, 7); ctx.arc(cx + 8, cy - 5, 5, 0, 7); ctx.lineWidth = 3.5; ctx.stroke(); ctx.beginPath(); rr(ctx, cx - 6, cy + 6, 12, 10, 5); ctx.stroke(); break;
    }
  });
}

const VS = /* glsl */ `
attribute vec2 iCell; attribute float iAlpha; varying vec2 vUv; varying float vA;
void main() { vUv = (uv + iCell) / vec2(${COLS}.0, ${ROWS}.0); vA = iAlpha; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const FS = /* glsl */ `
uniform sampler2D uAtlas; varying vec2 vUv; varying float vA;
void main() { vec4 c = texture2D(uAtlas, vUv); gl_FragColor = linearToOutputTexel(vec4(c.rgb, c.a * vA)); }`;

export interface EmoteDeps {
  /** Effective feedback policy (intensity + reduced-motion clamp). */
  policy: () => FeedbackPolicy;
  reducedMotion: () => boolean;
  /** Current in-game day number (monotonic). */
  day: () => number;
  /** 0..1 coldness for now (see `coldness`). */
  cold: () => number;
  /** First sight of wildlife for this guest (optional). */
  sighting?: (slot: number) => boolean;
  /** A bear / deer is within sight of this guest (see `WildlifeSight`). */
  wildlife?: (slot: number) => boolean;
  /** Where the emote floats: x, y (up), z. Return false when the guest isn't drawn. */
  anchor: (slot: number, out: THREE.Vector3) => boolean;
  rng?: () => number;
}

interface Live { slot: number; id: number; kind: number; age: number; key: number; ox: number }

/**
 * Occasional guest emotes: tiny vector-glyph bubbles that rise and fade over 1.5 s. ONE InstancedMesh (one draw call), a canvas-drawn atlas.
 * Reads sim state only (store arrays), keeps its own per-guest memory and uses the render RNG, so the sim is untouched with emotes on or off.
 */
export class Emotes {
  readonly mesh: THREE.InstancedMesh;
  private live: Live[] = [];
  private readonly cap: number;
  private prev: EmoteNeeds[];
  private prevRuns: Int32Array; private prevId: Int32Array; private memoDay: Int32Array; private memoCount: Uint8Array;
  private lastTick = -1;
  private lastWildlifeTick = -1e9;
  private cellAttr: THREE.InstancedBufferAttribute; private alphaAttr: THREE.InstancedBufferAttribute;
  private rng: () => number;
  private v = new THREE.Vector3(); private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private sc = new THREE.Vector3();
  readonly stats = { spawned: 0 };
  /** QA only: stretch the lifetime so a screenshot can catch them. */
  lifeScale = 1;

  constructor(private store: GuestStore, private d: EmoteDeps, maxCap = 24) {
    this.cap = maxCap; this.rng = d.rng ?? renderRng(0xe307e5);
    const n = store.capacity;
    this.prev = Array.from({ length: n }, () => blank());
    this.prevRuns = new Int32Array(n); this.prevId = new Int32Array(n); this.memoDay = new Int32Array(n).fill(-1); this.memoCount = new Uint8Array(n);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(maxCap * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(maxCap), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iCell', this.cellAttr); geo.setAttribute('iAlpha', this.alphaAttr);
    const tex = makeAtlas();
    const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { uAtlas: { value: tex } }, transparent: true, depthWrite: false, depthTest: true });
    mat.name = 'emotes';
    this.mesh = new THREE.InstancedMesh(geo, mat, maxCap);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 10; this.mesh.count = 0; this.mesh.visible = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  get count(): number { return this.live.length; }
  /** Kinds currently alive (tests / QA). */
  kinds(): EmoteKind[] { return this.live.map((l) => EMOTES[l.kind]!); }
  clear(): void { this.live.length = 0; this.mesh.count = 0; this.mesh.visible = false; }

  /** QA scene: one emote per queue cell (cycling kinds) up to the policy cap, held for 20 s. Same gates as the real thing. */
  demo(): number {
    this.lifeScale = 60;
    const seen = new Set<number>(), kinds = EMOTES; let k = 0, n = 0;
    for (let i = 0; i < this.store.limit; i++) {
      if (!this.store.alive[i]) continue;
      const key = clusterKey(this.store.x[i]!, this.store.y[i]!, EMOTE_CELL);
      if (seen.has(key)) continue;
      seen.add(key);
      if (this.spawn(i, kinds[k++ % kinds.length]!)) { n++; this.live[this.live.length - 1]!.age = EMOTE_LIFE_S * this.lifeScale * 0.35; }
    }
    return n;
  }

  /** Force one emote now (QA scene); honours the policy cap and Off. */
  spawn(slot: number, kind: EmoteKind): boolean {
    const p = this.d.policy();
    if (p.maxEmotes <= 0 || this.live.length >= Math.min(p.maxEmotes, this.cap) || !this.store.alive[slot]) return false;
    this.live.push({ slot, id: this.store.id[slot]!, kind: EMOTES.indexOf(kind), age: 0, key: -1, ox: (this.rng() - 0.5) * 0.3 });
    this.stats.spawned++;
    return true;
  }

  /**
   * Per rendered frame. `tick` = sim tick (new candidates are only evaluated once per tick), `far` = guests drawn as impostors (no emotes then),
   * `viewHeight` = camera top - bottom, `screenH` = canvas height in px (sets a constant on-screen size).
   */
  update(dt: number, camera: THREE.Camera, tick: number, far: boolean, viewHeight: number, screenH: number): void {
    const p = this.d.policy(), cap = Math.min(p.maxEmotes, this.cap);
    if (cap <= 0) { if (this.live.length || this.mesh.visible) this.clear(); this.lastTick = tick; return; }
    if (tick !== this.lastTick) { this.lastTick = tick; this.scan(p, cap, camera, far); }
    if (far) { this.mesh.count = 0; this.mesh.visible = false; return; }
    const reduced = this.d.reducedMotion(), size = Math.min(1.2, Math.max(0.35, (viewHeight * EMOTE_PX) / Math.max(1, screenH)));
    camera.getWorldQuaternion(this.q);
    let n = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i]!;
      e.age += dt;
      if (e.age >= EMOTE_LIFE_S * this.lifeScale || !this.store.alive[e.slot] || this.store.id[e.slot] !== e.id) { this.live.splice(i, 1); continue; }
    }
    for (const e of this.live) {
      if (!this.d.anchor(e.slot, this.v)) continue;
      const t = e.age / (EMOTE_LIFE_S * this.lifeScale);
      const fade = Math.min(1, t / 0.15, (1 - t) / 0.4);
      const rise = reduced ? 0 : EMOTE_RISE * (1 - (1 - t) * (1 - t));
      this.v.y += rise; this.v.x += e.ox;
      this.sc.set(size, size, 1);
      this.m.compose(this.v, this.q, this.sc);
      this.m.toArray(this.mesh.instanceMatrix.array as Float32Array, n * 16);
      this.cellAttr.setXY(n, e.kind % COLS, ROWS - 1 - Math.floor(e.kind / COLS));
      this.alphaAttr.setX(n, Math.max(0, fade) * EMOTE_OPACITY);
      n++;
    }
    this.mesh.count = n; this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true; this.cellAttr.needsUpdate = true; this.alphaAttr.needsUpdate = true;
  }

  private scan(p: FeedbackPolicy, cap: number, camera: THREE.Camera, far: boolean): void {
    const s = this.store, day = this.d.day(), cold = this.d.cold(), tick = this.lastTick;
    const cands: EmoteCandidate[] = [];
    camera.updateMatrixWorld();
    for (let i = 0; i < s.limit; i++) {
      if (!s.alive[i]) continue;
      const id = s.id[i]!, st = s.state[i]!;
      const now: EmoteNeeds = this.prev[i]!;
      const old: EmoteNeeds = tmpPrev;
      if (this.prevId[i] !== id) { // new guest in this slot: no crossing on the first look
        this.prevId[i] = id; this.prevRuns[i] = s.runs[i]!; this.memoDay[i] = -1; this.memoCount[i] = 0;
        fill(now, day, s, i, cold, 0, false, false, false); continue;
      }
      Object.assign(old, now);
      fill(now, day, s, i, cold, st === GState.Queueing ? (tick - s.actTick[i]!) * 0.25 : 0, s.runs[i]! > this.prevRuns[i]!, this.d.sighting?.(i) ?? false, this.d.wildlife?.(i) ?? false);
      this.prevRuns[i] = s.runs[i]!;
      if (far || st === GState.Sleeping || st === GState.Leaving) continue;
      this.v.set(s.x[i]!, s.z[i]! + 0.3, s.y[i]!).project(camera);
      if (Math.abs(this.v.x) > 1 || Math.abs(this.v.y) > 1) continue; // only guests on screen
      memo.day = this.memoDay[i]!; memo.count = this.memoCount[i]!;
      const kind = pickEmote(now, old, memo, p);
      // wildlife paw: rare + quiet (one global cooldown, one dice roll per first sighting); other kinds are not affected
      if (kind === 'wildlife' && !wildlifeAllowed(tick, this.lastWildlifeTick, this.rng())) continue;
      if (kind) cands.push({ slot: i, x: s.x[i]!, z: s.y[i]!, kind });
    }
    if (!cands.length) return;
    const busy = new Set<number>();
    for (const e of this.live) { if (e.key === -1) e.key = this.keyOf(e.slot); busy.add(e.key); }
    const room = cap - this.live.length;
    if (room <= 0) return;
    for (const c of clusterRepresentatives(cands, EMOTE_CELL, busy, room)) {
      const i = c.slot;
      if (this.memoDay[i] !== day) { this.memoDay[i] = day; this.memoCount[i] = 0; }
      this.memoCount[i]!++;
      this.live.push({ slot: i, id: s.id[i]!, kind: EMOTES.indexOf(c.kind), age: 0, key: clusterKey(c.x, c.z, EMOTE_CELL), ox: (this.rng() - 0.5) * 0.3 });
      this.stats.spawned++;
      if (c.kind === 'wildlife') this.lastWildlifeTick = tick;
    }
  }
  private keyOf(slot: number): number { return clusterKey(this.store.x[slot]!, this.store.y[slot]!, EMOTE_CELL); }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.ShaderMaterial).uniforms.uAtlas!.value.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

const blank = (): EmoteNeeds => ({ day: 0, hunger: 0, fatigue: 0, happiness: 0, queueMin: 0, cold: 0, runDone: false, sighting: false, wildlife: false });
const tmpPrev = blank();
const memo: EmoteMemo = { day: -1, count: 0 };
function fill(o: EmoteNeeds, day: number, s: GuestStore, i: number, cold: number, queueMin: number, runDone: boolean, sighting: boolean, wildlife = false): void {
  o.day = day; o.hunger = s.hunger[i]!; o.fatigue = s.fatigue[i]!; o.happiness = s.happiness[i]!; o.queueMin = queueMin; o.cold = cold; o.runDone = runDone; o.sighting = sighting; o.wildlife = wildlife;
}
function makeAtlas(): THREE.Texture {
  const tex = new THREE.CanvasTexture(typeof document !== 'undefined' ? document.createElement('canvas') : (undefined as unknown as HTMLCanvasElement));
  const cv = tex.image as HTMLCanvasElement | undefined;
  if (cv && cv.getContext) {
    cv.width = CELL_PX * COLS; cv.height = CELL_PX * ROWS;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = cv.getContext('2d'); } catch { ctx = null; }
    if (ctx) { drawEmoteAtlas(ctx); tex.needsUpdate = true; }
  }
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  return tex;
}
