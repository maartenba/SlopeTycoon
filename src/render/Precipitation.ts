import * as THREE from 'three';
import { PRECIP_BOX, PRECIP_PARTICLES } from '@/config/balance';
import type { Precip } from '@/sim/Weather';

const VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec2 uFall;   // x: fall speed, y: wind drift speed (world units / s)
uniform float uDensity;
uniform float uSize;
attribute float aRand;
attribute float aEnd; // line segments: 0 = head, 1 = tail
varying float vAlpha;
void main() {
  vec3 raw = position * uBox + vec3(uTime * uFall.y, -uTime * uFall.x, uTime * uFall.y * 0.3);
  // wrap into a box that follows the camera target (seamless: positions are periodic in world space)
  vec3 rel = mod(raw - uCenter + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec3 wp = uCenter + rel;
  wp += vec3(0.0, aEnd * uSize * 0.8, 0.0) - vec3(aEnd * uFall.y * 0.04, 0.0, 0.0);
  vec3 q = abs(rel) / (0.5 * uBox);
  float edge = 1.0 - smoothstep(0.8, 1.0, max(max(q.x, q.y), q.z));
  vAlpha = edge * step(aRand, uDensity);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  gl_PointSize = uSize * 9.0; // orthographic camera: constant screen size
}`;

const FRAG_SNOW = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.15, length(c)) * vAlpha * 0.9;
  if (a < 0.01) discard;
  gl_FragColor = vec4(1.0, 1.0, 1.0, a);
}`;
const FRAG_RAIN = /* glsl */ `
varying float vAlpha;
void main() {
  if (vAlpha < 0.01) discard;
  gl_FragColor = vec4(0.65, 0.75, 0.9, vAlpha * 0.55);
}`;

export interface PrecipState { precip: Precip; /** 0..1 */ intensity: number; /** 0..1 wind */ wind: number }

/**
 * Camera-following precipitation: ONE fixed pool of particles whose positions are computed in the vertex shader from time
 * (no per-frame CPU work except uniforms): Points for snow, LineSegments for rain. Density = fraction of the pool visible, so
 * cost is constant regardless of weather. NOT verified at runtime (no WebGL in the agent env).
 */
export class Precipitation {
  readonly group = new THREE.Group();
  private snow: THREE.Points;
  private rain: THREE.LineSegments;
  private snowMat: THREE.ShaderMaterial;
  private rainMat: THREE.ShaderMaterial;
  private time = 0;
  /** Graphics-quality multiplier on the visible particle fraction. */
  densityScale = 1;

  constructor(count = PRECIP_PARTICLES) {
    const box = new THREE.Vector3(...PRECIP_BOX);
    // deterministic pseudo-random seeds (no Math.random: reproducible visuals)
    let s = 12345;
    const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const pos = new Float32Array(count * 3), rand = new Float32Array(count);
    for (let i = 0; i < count; i++) { pos[i * 3] = rnd(); pos[i * 3 + 1] = rnd(); pos[i * 3 + 2] = rnd(); rand[i] = rnd(); }
    const mkUniforms = (size: number, speed: number): Record<string, THREE.IUniform> => ({
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: box.clone() },
      uFall: { value: new THREE.Vector2(speed, 0) }, uDensity: { value: 0 }, uSize: { value: size },
    });

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
    sg.setAttribute('aEnd', new THREE.BufferAttribute(new Float32Array(count), 1));
    this.snowMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG_SNOW, uniforms: mkUniforms(0.35, 2.2), transparent: true, depthWrite: false });
    this.snow = new THREE.Points(sg, this.snowMat);

    // rain: two vertices per drop sharing the same seed; aEnd=1 on the tail
    const rpos = new Float32Array(count * 6), rr = new Float32Array(count * 2), re = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3;
        rpos[o] = pos[i * 3]!; rpos[o + 1] = pos[i * 3 + 1]!; rpos[o + 2] = pos[i * 3 + 2]!;
        rr[i * 2 + k] = rand[i]!; re[i * 2 + k] = k;
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
    rg.setAttribute('aRand', new THREE.BufferAttribute(rr, 1));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
    this.rainMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG_RAIN, uniforms: mkUniforms(1.2, 14), transparent: true, depthWrite: false });
    this.rain = new THREE.LineSegments(rg, this.rainMat);

    for (const o of [this.snow, this.rain]) { o.frustumCulled = false; o.renderOrder = 20; o.visible = false; this.group.add(o); }
  }

  /** Call every frame: `target` = camera look-at point (world), `dt` seconds. */
  update(dt: number, target: THREE.Vector3, st: PrecipState): void {
    this.time += dt;
    const on = st.precip !== 'none' && st.intensity > 0.01;
    this.snow.visible = on && st.precip === 'snow';
    this.rain.visible = on && st.precip === 'rain';
    const mat = st.precip === 'rain' ? this.rainMat : this.snowMat;
    if (!on) return;
    const u = mat.uniforms;
    (u.uTime as THREE.IUniform<number>).value = this.time;
    (u.uCenter as THREE.IUniform<THREE.Vector3>).value.set(target.x, target.y + PRECIP_BOX[1] * 0.25, target.z);
    (u.uDensity as THREE.IUniform<number>).value = Math.min(1, st.intensity) * this.densityScale;
    const speed = (u.uFall as THREE.IUniform<THREE.Vector2>).value;
    speed.y = st.wind * (st.precip === 'rain' ? 5 : 3);
  }

  dispose(): void {
    for (const o of [this.snow, this.rain]) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
  }
}
