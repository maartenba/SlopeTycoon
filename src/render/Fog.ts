import * as THREE from 'three';

/**
 * Shared exponential fog for the perspective views (M5.2). ONE uniform set is referenced by every custom ShaderMaterial (terrain, water, trees, rocks);
 * standard (Lambert / Basic / Points) materials get the same fog through `scene.fog` (FogExp2) which is ALWAYS installed (density 0 in iso) so toggling
 * the view never triggers shader recompiles. Density 0 = exact iso look (mix(c, fog, 0) == c).
 *
 * The sky is a CSS gradient behind a transparent canvas, so the fog colour is the gradient's HORIZON colour (Lighting.apply): distant terrain fades into
 * the sky instead of painting a wall over it.
 */
export const fogUniforms = {
  uFogColor: { value: new THREE.Color(0.66, 0.83, 0.96) },
  uFogDensity: { value: 0 },
  /** M7.0 valley fog (render-only, docs/atmosphere.md): x = amount 0..1 (0 = off: exact old look), y = fog line (world y), z = soft edge (world units). */
  uValleyFog: { value: new THREE.Vector3(0, 0, 5) },
  uValleyFogT: { value: 0 },
  /** Linear fog colour of the valley bank (lit by the sky; Atmosphere controller). */
  uValleyFogColor: { value: new THREE.Color(0.8, 0.85, 0.92) },
};

/** GLSL: declare in both stages. */
export const FOG_PARS_VERT = /* glsl */ `varying float vFogDist;
varying vec3 vFogW;`;
export const FOG_PARS_FRAG = /* glsl */ `uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uValleyFog;
uniform float uValleyFogT;
uniform vec3 uValleyFogColor;
varying float vFogDist;
varying vec3 vFogW;
float atmHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float atmNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(atmHash(i), atmHash(i + vec2(1.0, 0.0)), f.x), mix(atmHash(i + vec2(0.0, 1.0)), atmHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`;
/** Vertex: `viewPos` is the view-space position (vec4). */
export const fogVert = (viewPos: string): string => `vFogDist = length(${viewPos}.xyz);
  vFogW = transpose(mat3(viewMatrix)) * ${viewPos}.xyz + cameraPosition;`;
/** Fragment: apply on gl_FragColor.rgb BEFORE the colour-space conversion (fog colour is linear). */
export const FOG_FRAG = /* glsl */ `gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, 1.0 - exp(-uFogDensity * uFogDensity * vFogDist * vFogDist));
  if (uValleyFog.x > 0.001) { // valley fog bank: world-space height band + slow world-space noise (never screen-space: no crawl under camera motion)
    vec2 vfp = vFogW.xz + uValleyFogT * vec2(0.35, 0.2);
    float vfn = atmNoise(vfp * 0.05) * 0.65 + atmNoise(vfp * 0.13 + 4.0) * 0.35;
    float vfh = 1.0 - smoothstep(uValleyFog.y - uValleyFog.z, uValleyFog.y + uValleyFog.z, vFogW.y + (vfn - 0.5) * uValleyFog.z * 1.6);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uValleyFogColor, clamp(vfh * uValleyFog.x * (0.7 + 0.45 * vfn), 0.0, 0.9));
  }`;

/** Distance (tiles) at which the fog is ~95 % opaque for a map size. */
export const fogRangeFor = (mapSize: number): number => Math.min(260, Math.max(90, mapSize * 0.9));
/** FogExp2 density for 95 % opacity at `range`: 1 - exp(-(d*range)^2) = 0.95 -> d = sqrt(-ln 0.05) / range. */
export const fogDensityFor = (range: number): number => Math.sqrt(-Math.log(0.05)) / range;

export class ViewFog {
  readonly fog: THREE.FogExp2;
  constructor(private scene: THREE.Scene) {
    this.fog = new THREE.FogExp2(0xa9d4f5, 0);
    scene.fog = this.fog;
  }
  get density(): number { return fogUniforms.uFogDensity.value; }
  setDensity(d: number): void { fogUniforms.uFogDensity.value = d; this.fog.density = d; }
  /** Horizon colour in sRGB (the CSS gradient's horizon stop, 0..1). */
  setColor(rgbSRGB: readonly [number, number, number]): void {
    fogUniforms.uFogColor.value.setRGB(rgbSRGB[0], rgbSRGB[1], rgbSRGB[2], THREE.SRGBColorSpace);
    this.fog.color.copy(fogUniforms.uFogColor.value);
  }
}
