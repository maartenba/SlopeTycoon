import * as THREE from 'three';

/** Summer foliage tint maths, shared by the tree shaders (the GLSL constants are generated from these numbers) and unit tests.
 * A deciduous crown = base leaf colour * mix(YELLOW_GREEN, BLUE_GREEN, hv), then pushed away from grey by SUMMER_SAT so no crown ever reads grey/white. */
export const SUMMER_YELLOW_GREEN: readonly [number, number, number] = [1.3, 1.12, 0.5];
export const SUMMER_BLUE_GREEN: readonly [number, number, number] = [0.72, 1.0, 0.82];
export const SUMMER_SAT = 1.35;
export const SUMMER_VALUE = 0.92;

/** Pure: summer colour of a leaf base (linear rgb) for variety hv 0..1 (mirror of the GLSL `summerColor`). */
export function summerLeaf(base: readonly [number, number, number], hv: number): [number, number, number] {
  const m = [0, 1, 2].map((i) => SUMMER_YELLOW_GREEN[i]! + (SUMMER_BLUE_GREEN[i]! - SUMMER_YELLOW_GREEN[i]!) * hv);
  const c = [base[0] * m[0]!, base[1] * m[1]!, base[2] * m[2]!];
  const l = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  return [0, 1, 2].map((i) => Math.max(0, (l + (c[i]! - l) * SUMMER_SAT) * SUMMER_VALUE)) as [number, number, number];
}

/** Hue (degrees 0..360), saturation, value of a linear rgb triple after sRGB encoding (what the screen shows). */
export function displayHsv(c: readonly [number, number, number]): { h: number; s: number; v: number } {
  const col = new THREE.Color(c[0], c[1], c[2]); // linear working space
  const out = { h: 0, s: 0, l: 0 };
  col.getHSL(out, THREE.SRGBColorSpace);
  const hsv = new THREE.Color().setRGB(c[0], c[1], c[2]).getRGB(new THREE.Color(), THREE.SRGBColorSpace);
  const mx = Math.max(hsv.r, hsv.g, hsv.b), mn = Math.min(hsv.r, hsv.g, hsv.b);
  return { h: out.h * 360, s: mx === 0 ? 0 : (mx - mn) / mx, v: mx };
}

const v3 = (a: readonly number[]): string => `vec3(${a.map((x) => x.toFixed(3)).join(', ')})`;
/** GLSL for the summer colour (inserted into the season shader). */
export const SUMMER_GLSL = `
vec3 summerColor(vec3 base, float hv) {
  vec3 c = base * mix(${v3(SUMMER_YELLOW_GREEN)}, ${v3(SUMMER_BLUE_GREEN)}, hv);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return max(vec3(l) + (c - vec3(l)) * ${SUMMER_SAT.toFixed(3)}, 0.0) * ${SUMMER_VALUE.toFixed(3)};
}`;
