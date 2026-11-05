import * as THREE from 'three';

/**
 * Apres-ski music notes (docs/audio.md "Music", docs/schirmbar.md): a few small notes drift up from an OPEN Apres-Ski Bar / Schirmbar and fade, popping slightly on a ~125 bpm beat.
 * A visual cue that the music comes from the bar; it does not depend on the music being audible. ONE shared instanced layer for all bars = one draw call.
 * Render-only: reads the open state, never the sim's RNG or state; deterministic per building id and the layer's own render clock (accumulated `dt`), no `Math.random`,
 * world-space motion only, no `gl_FragCoord`. Reduced motion: three still notes, no drift, no pulse. Closed bar: none (fades out over `fade` s). Quality: `notesForQuality`.
 * Every number is in `APRES_NOTES`; the maths is pure (`noteState`, `beatPulse`, `stepLevel`, `viewFade`) and unit-tested (tests/render/apresNotes.test.ts).
 */
export const APRES_NOTES = {
  /** Beat of the pulse (the bar songs sit around 120-130 bpm). */
  bpm: 125,
  /** Notes per bar at full quality (Low quality shows `notesForQuality`: 2, Medium 4, High 6). */
  perBar: 6,
  /** Seconds a note lives (rise + fade), tiles it rises, sideways sway (tiles), note size (tiles). */
  life: 3.6, rise: 1.3, sway: 0.2, size: 0.2,
  /** Start scatter over the roof (tiles, +-). */
  spread: 0.35,
  /** Pop of the size / brightness on the beat (0.2 = +20 %). */
  pop: 0.22,
  /** Peak alpha of a note. */
  alpha: 0.85,
  /** Only near the camera: full at view height <= nearView, gone at >= farView (tiles tall, like `lodHeightFor`). */
  nearView: 45, farView: 75,
  /** At most this many bars show notes at once (the nearest first). */
  maxBars: 12,
  /** Fade in / out of a bar opening / closing (seconds). */
  fade: 0.8,
  /** Reduced motion: still notes at these life phases (0..1), constant alpha. */
  stillPhases: [0.3, 0.5, 0.72] as readonly number[],
} as const;

const fract = (v: number): number => v - Math.floor(v);
/** Stable 0..1 hash of two ints (no RNG). */
export function hash01(a: number, b = 0): number { let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) / 4294967296; }

/** Notes per bar for a quality tier from its particle share (Low .35 -> 2, Medium .7 -> 4, High 1 -> 6). */
export const notesForQuality = (particles: number): number => Math.max(0, Math.min(APRES_NOTES.perBar, Math.round(APRES_NOTES.perBar * particles)));

/** 0..1 within the current beat; `offset` (0..1 of a beat) differs per bar because every bar plays its own song. */
export function beatPhase(t: number, offset: number): number { return fract((t * APRES_NOTES.bpm) / 60 + offset); }
/** 0..1 pulse envelope: sharp attack at the beat, smooth decay (cubic) over the beat. Reduced motion: always 0. */
export function beatPulse(t: number, offset: number, reduced = false): number { if (reduced) return 0; const p = beatPhase(t, offset); return (1 - p) * (1 - p) * (1 - p); }

/** 0..1 visibility from the camera's view height: full when near, gone when far. */
export function viewFade(viewHeight: number): number { const { nearView: a, farView: b } = APRES_NOTES; return Math.min(1, Math.max(0, (b - viewHeight) / (b - a))); }

/** Open / close fade of one bar: `level` moves toward 1 (open) or 0 (closed) in `APRES_NOTES.fade` seconds. */
export function stepLevel(level: number, open: boolean, dt: number): number { const d = dt / APRES_NOTES.fade; return open ? Math.min(1, level + d) : Math.max(0, level - d); }

export interface NoteState {
  /** Offset from the bar's roof anchor (tiles). */
  dx: number; dy: number; dz: number;
  /** World size (tiles) and alpha (0..1, before the bar's open fade and the view fade). */
  size: number; alpha: number;
}
/**
 * Pure state of note `i` of `n` of the bar with id `id` at render time `t`. Staggered over the life; each note starts at its own hashed spot on the roof and sways sideways.
 * Reduced motion: still notes at `stillPhases` (constant alpha, no pulse). Returns null for a note that is currently invisible.
 */
export function noteState(t: number, id: number, i: number, n: number, reduced = false): NoteState | null {
  const A = APRES_NOTES;
  const seed = hash01(id), sx = (hash01(id, i + 1) - 0.5) * 2 * A.spread, sz = (hash01(id, i + 101) - 0.5) * 2 * A.spread;
  if (reduced) {
    if (i >= A.stillPhases.length || i >= n) return null;
    const p = A.stillPhases[i]!;
    return { dx: sx, dy: A.rise * p, dz: sz, size: A.size * 0.95, alpha: A.alpha * 0.8 };
  }
  const p = fract(t / A.life + i / Math.max(1, n) + seed);
  const fade = Math.min(1, p / 0.12) * (1 - Math.min(1, Math.max(0, (p - 0.55) / 0.45)));
  if (fade <= 0.01) return null;
  const pulse = beatPulse(t, seed);
  return {
    dx: sx + A.sway * Math.sin((p * 1.4 + hash01(id, i + 201)) * Math.PI * 2), dy: A.rise * p, dz: sz,
    size: A.size * (0.8 + 0.4 * Math.min(1, p * 3)) * (1 + A.pop * pulse), alpha: A.alpha * fade * (0.85 + 0.15 * pulse),
  };
}

const VERT = `
attribute vec4 aInfo; // xyz is the world position in aPos, aInfo = (size, alpha, shape seed, 0)
attribute vec3 aPos;
varying vec2 vUv; varying float vAlpha; varying float vSeed;
void main(){
  vAlpha = aInfo.y; vSeed = aInfo.z;
  if (aInfo.y <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUv = vec2(0.0); return; }
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  mv.xy += position.xy * aInfo.x;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0;
}`;
/** A note glyph from three shapes in quad space (head ellipse, stem, flag); eighth note or beamed pair by seed. */
const FRAG = `
uniform vec3 uColor; uniform float uNight;
varying vec2 vUv; varying float vAlpha; varying float vSeed;
void main(){
  vec2 p = vUv;
  float head = length((p - vec2(-0.3, -0.5)) * vec2(1.0, 1.5)) < 0.32 ? 1.0 : 0.0;
  float stem = (abs(p.x - 0.0) < 0.08 && p.y > -0.5 && p.y < 0.65) ? 1.0 : 0.0;
  float flag = (p.x > 0.0 && p.x < 0.5 && p.y > 0.3 && p.y < 0.65 - p.x * 0.55 && p.y > 0.05 + p.x * 0.0 + 0.0) ? 1.0 : 0.0;
  float g = max(head, max(stem, flag));
  if (vSeed > 0.5) { // a second note joined by a beam
    float head2 = length((p - vec2(0.55, -0.35)) * vec2(1.0, 1.5)) < 0.3 ? 1.0 : 0.0;
    float stem2 = (abs(p.x - 0.85) < 0.08 && p.y > -0.35 && p.y < 0.7) ? 1.0 : 0.0;
    float beam = (p.x > 0.0 && p.x < 0.93 && p.y > 0.5 && p.y < 0.68) ? 1.0 : 0.0;
    g = max(max(g * (1.0 - flag), head2), max(stem2, beam));
    g = max(g, max(head, stem));
  }
  if (g < 0.5) discard;
  vec3 col = mix(vec3(1.0, 0.93, 0.7), vec3(1.0, 0.8, 0.45), uNight); // warm, a little deeper at night
  gl_FragColor = vec4(col, vAlpha);
}`;

export interface BarSource { id: number; x: number; y: number; z: number }

/** One shared layer. `update(dt, viewHeight, bars, reduced, notes)`: `bars` = the OPEN, serving bars with their roof anchor in world space (the caller supplies them; closed bars are fading out inside). */
export class ApresNotesView {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  /** The render clock (accumulated frame seconds): the only time source. */
  time = 0;
  private geo = new THREE.InstancedBufferGeometry();
  private mat: THREE.ShaderMaterial;
  private pos: Float32Array; private info: Float32Array;
  private levels = new Map<number, { x: number; y: number; z: number; level: number }>();
  readonly capacity = APRES_NOTES.maxBars * APRES_NOTES.perBar;
  /** Notes drawn last frame (tests / debug). */
  drawn = 0;

  constructor(nightUniform: { value: number } = { value: 0 }) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.pos = new Float32Array(this.capacity * 3); this.info = new Float32Array(this.capacity * 4);
    this.geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.instanceCount = this.capacity;
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, uniforms: { uColor: { value: new THREE.Color(1, 0.9, 0.6) }, uNight: nightUniform } });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; this.mesh.visible = false;
    this.group.add(this.mesh);
  }

  update(dt: number, viewHeight: number, bars: readonly BarSource[], reduced: boolean, notesPerBar: number, focus?: { x: number; z: number }): void {
    this.time += Math.min(dt, 0.1);
    const vf = viewFade(viewHeight);
    const open = new Set<number>();
    for (const b of bars) { open.add(b.id); const s = this.levels.get(b.id); if (s) { s.x = b.x; s.y = b.y; s.z = b.z; } else this.levels.set(b.id, { x: b.x, y: b.y, z: b.z, level: 0 }); }
    for (const [id, s] of this.levels) { s.level = stepLevel(s.level, open.has(id), dt); if (s.level <= 0 && !open.has(id)) this.levels.delete(id); }
    const n = Math.min(APRES_NOTES.perBar, notesPerBar);
    if (vf <= 0 || n <= 0 || this.levels.size === 0) { this.drawn = 0; this.mesh.visible = false; return; }
    let list = [...this.levels].sort((a, b) => a[0] - b[0]);
    if (focus && list.length > APRES_NOTES.maxBars) list = list.sort((a, b) => Math.hypot(a[1].x - focus.x, a[1].z - focus.z) - Math.hypot(b[1].x - focus.x, b[1].z - focus.z)).slice(0, APRES_NOTES.maxBars);
    else list = list.slice(0, APRES_NOTES.maxBars);
    let k = 0;
    for (const [id, s] of list) {
      for (let i = 0; i < n; i++) {
        const st = noteState(this.time, id, i, n, reduced);
        if (!st) continue;
        const a = st.alpha * s.level * vf;
        if (a <= 0.01) continue;
        this.pos[k * 3] = s.x + st.dx; this.pos[k * 3 + 1] = s.y + st.dy; this.pos[k * 3 + 2] = s.z + st.dz;
        this.info[k * 4] = st.size; this.info[k * 4 + 1] = a; this.info[k * 4 + 2] = hash01(id, i + 301) > 0.5 ? 1 : 0; this.info[k * 4 + 3] = 0;
        k++;
      }
    }
    for (let j = k; j < this.drawn; j++) this.info[j * 4 + 1] = 0; // hide the notes drawn last frame and gone now
    this.drawn = k;
    (this.geo.getAttribute('aPos') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aInfo') as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = k > 0;
  }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
