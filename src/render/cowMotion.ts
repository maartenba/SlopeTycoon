/**
 * Cow micro-animation (render only): tail swish + the odd flick, ear twitch and a gentle cowbell pendulum. The pure functions here are the single source of
 * truth; `COW_MOTION_GLSL` repeats the same formulas for the vertex shader (the cow layer stays one instanced draw, 0 extra calls). Driven by the frame clock and a
 * stable per-animal phase (`cowPhase(id)`), never by the sim Rng; reduced motion = angles 0.
 */
export const COW_PART = { body: 0, tail: 1, earL: 2, earR: 3, bell: 4 } as const;
/** Pivot of each moving part in mesh space (x, y, z): tail root, ear roots, the strap the bell hangs from. */
export const COW_PIVOT: Readonly<Record<'tail' | 'earL' | 'earR' | 'bell', readonly [number, number, number]>> = {
  tail: [0, 0.36, -0.29], earL: [0.085, 0.385, 0.35], earR: [-0.085, 0.385, 0.35], bell: [0, 0.2, 0.31],
};
/** Stable 0..2pi phase of an animal id. */
export function cowPhase(id: number): number { let h = Math.imul((id | 0) + 1, 0x9e3779b1) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; return ((h >>> 0) / 4294967296) * Math.PI * 2; }
const sstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Tail angle about z (rad): a lazy swish plus an occasional brisk flick. */
export function tailAngle(t: number, ph: number): number { return 0.2 * Math.sin(t * 2.1 + ph) + 0.34 * sstep(0.6, 0.95, Math.sin(t * 0.37 + ph * 1.7)) * Math.sin(t * 9 + ph); }
/** Ear angle about z (rad, `side` +1 left / -1 right): a short twitch every few seconds, each ear on its own beat. */
export function earAngle(t: number, ph: number, side: 1 | -1): number { return side * 0.5 * Math.pow(Math.max(0, Math.sin(t * 0.6 + ph + side * 2.1)), 14) * Math.sin(t * 20 + ph); }
/** Far-zoom fade (view height in tiles, `lodHeightFor`): a 0.06 tile bell is ~1 px at a view height of 40+ and would shimmer, so each part fades out (amplitude x fade, smoothstep) before it gets that small. Bell first, then tail / ears. */
export const MOTION_FADE = { bell: [24, 44], tail: [45, 85] } as const;
export function motionFade(viewHeight: number, part: 'bell' | 'tail'): number {
  const [a, b] = MOTION_FADE[part]; if (!Number.isFinite(viewHeight)) return 0;
  const t = Math.min(1, Math.max(0, (viewHeight - a) / (b - a))); return 1 - t * t * (3 - 2 * t);
}
/** Bell pendulum about x (rad). */
export function bellAngle(t: number, ph: number): number { return 0.16 * Math.sin(t * 2.6 + ph) + 0.06 * Math.sin(t * 5.3 + ph * 2); }

const f = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const glv = (p: readonly [number, number, number]): string => `vec3(${f(p[0])}, ${f(p[1])}, ${f(p[2])})`;

/** Pivots of the sheep (ears only) and the goat (tail only); the unused parts keep a nominal pivot. */
export const SHEEP_PIVOT: typeof COW_PIVOT = { tail: [0, 0.25, -0.15], earL: [0.055, 0.27, 0.185], earR: [-0.055, 0.27, 0.185], bell: [0, 0.2, 0.2] };
export const GOAT_PIVOT: typeof COW_PIVOT = { tail: [0, 0.21, -0.15], earL: [0.03, 0.3, 0.2], earR: [-0.03, 0.3, 0.2], bell: [0, 0.2, 0.2] };
/** Per-species amplitude scale (tail, ear, bell): small animals move a little less so it stays subtle. */
export const MOTION_SCALE = { cow: 1, sheep: 0.8, goat: 1 } as const;

/**
 * Vertex-shader snippets (GLSL mirrors of the functions above). `apply` moves the vertex; `normal` rotates the object-space normal with the SAME rotation (pivot-free), so the
 * lighting follows the swinging part. The shadow depth pass draws the real material, so it sees the same animated pose.
 */
export function motionGlsl(pv: typeof COW_PIVOT, amp = 1): { decl: string; normal: string; apply: string } {
  const a = f(amp);
  return {
    decl: `attribute float aPart; attribute float aPhase; uniform float uCowT; uniform float uCowMotion; uniform float uCowBell;
float cmStep(float a, float b, float x){ float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec3 cmRotZ(vec3 p, vec3 o, float a){ float c = cos(a), s = sin(a); vec3 d = p - o; return o + vec3(c * d.x - s * d.y, s * d.x + c * d.y, d.z); }
vec3 cmRotX(vec3 p, vec3 o, float a){ float c = cos(a), s = sin(a); vec3 d = p - o; return o + vec3(d.x, c * d.y - s * d.z, s * d.y + c * d.z); }
float cmAngle(){
  float t = uCowT, ph = aPhase;
  if (aPart < 1.5) return ${a} * uCowMotion * (0.2 * sin(t * 2.1 + ph) + 0.34 * cmStep(0.6, 0.95, sin(t * 0.37 + ph * 1.7)) * sin(t * 9.0 + ph));
  if (aPart < 3.5) { float sd = aPart < 2.5 ? 1.0 : -1.0; return ${a} * uCowMotion * sd * 0.5 * pow(max(0.0, sin(t * 0.6 + ph + sd * 2.1)), 14.0) * sin(t * 20.0 + ph); }
  return ${a} * uCowBell * (0.16 * sin(t * 2.6 + ph) + 0.06 * sin(t * 5.3 + ph * 2.0));
}`,
    normal: `if (aPart > 0.5 && (uCowMotion > 0.0 || uCowBell > 0.0)) { float ca = cmAngle(); objectNormal = aPart > 3.5 ? cmRotX(objectNormal, vec3(0.0), ca) : cmRotZ(objectNormal, vec3(0.0), ca); }`,
    apply: `if (aPart > 0.5 && (uCowMotion > 0.0 || uCowBell > 0.0)) {
  float ca = cmAngle();
  if (aPart < 1.5) transformed = cmRotZ(transformed, ${glv(pv.tail)}, ca);
  else if (aPart < 3.5) { float sd = aPart < 2.5 ? 1.0 : -1.0; transformed = cmRotZ(transformed, vec3(sd * ${f(pv.earL[0])}, ${f(pv.earL[1])}, ${f(pv.earL[2])}), ca); }
  else transformed = cmRotX(transformed, ${glv(pv.bell)}, ca);
}`,
  };
}
export const COW_MOTION_GLSL = motionGlsl(COW_PIVOT);
