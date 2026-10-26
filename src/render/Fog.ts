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
};

/** GLSL: declare in both stages. */
export const FOG_PARS_VERT = /* glsl */ `varying float vFogDist;`;
export const FOG_PARS_FRAG = /* glsl */ `uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vFogDist;`;
/** Vertex: `viewPos` is the view-space position (vec4). */
export const fogVert = (viewPos: string): string => `vFogDist = length(${viewPos}.xyz);`;
/** Fragment: apply on gl_FragColor.rgb BEFORE the colour-space conversion (fog colour is linear). */
export const FOG_FRAG = /* glsl */ `gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, 1.0 - exp(-uFogDensity * uFogDensity * vFogDist * vFogDist));`;

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
