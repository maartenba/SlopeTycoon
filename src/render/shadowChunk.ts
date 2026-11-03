import * as THREE from 'three';

/**
 * Shared GLSL for materials that RECEIVE the High-tier sun shadow map (docs/shadows.md). Everything here sits behind `#ifdef USE_SHADOWS`, a define that
 * `ShadowRig` adds only on High: Low / Med never see these blocks, never compile a new program, and bind no extra texture. The terrain keeps its own copy
 * of the sampler (TerrainMesh.ts); this one serves buildings, lift stations, vehicles, guests, props (patched Lambert) and trees / rocks (custom shaders).
 */

/** Shadow-pass-only uniform: xyz = the real (main) camera, w = 1 while the depth pass runs. Tree / rock distance bands read it instead of `cameraPosition`
 * (which is the sun camera during the pass), so the perspective views' trees cast the same LOD they draw. */
export const shadowPassUniforms = { uShCam: { value: new THREE.Vector4(0, 0, 0, 0) }, /** Tree cast density 0..1 (1 = every tree casts); only read while the depth pass runs. */ uShDens: { value: 1 } };

/** Vertex GLSL: `shCam()` = the camera the scene is drawn from, also inside the shadow pass. Needs `cameraPosition` (ShaderMaterial vertex prefix). */
export const SH_CAM_GLSL = /* glsl */ `
uniform vec4 uShCam;
uniform float uShDens;
vec3 shCam() { return uShCam.w > 0.5 ? uShCam.xyz : cameraPosition; }
// Gradual cast density (heavy scenes): in the depth pass a stable per-instance hash of the seed decides whether the tree casts (nested: raising the density only adds trees). Never in the main pass.
bool shDropTree(float seed) { return uShCam.w > 0.5 && uShDens < 0.999 && fract(sin(seed * 53.3 + 1.7) * 43758.5453) >= uShDens; }`;

/** Fragment GLSL: uniforms + `recvShadow(world position, world normal)` -> multiplier 0..1 for the SUN term (1 = lit). 4 hardware-PCF taps, fixed offsets (no screen-space noise). */
export const SHADOW_RECV_FRAG = /* glsl */ `
#ifdef USE_SHADOWS
uniform sampler2DShadow tShadow;
uniform mat4 uShadowM;
uniform vec4 uShadowP; // x strength, y depth bias, z 1 / map size, w normal offset (world units)
float recvShadow(vec3 wp, vec3 n) {
  if (uShadowP.x < 0.001) return 1.0;
  vec4 sc = uShadowM * vec4(wp + n * uShadowP.w, 1.0);
  vec3 p = sc.xyz;
  vec2 edge = min(p.xy, 1.0 - p.xy);
  float inside = smoothstep(0.0, 0.05, min(edge.x, edge.y));
  if (inside <= 0.0) return 1.0;
  float t = uShadowP.z * 0.9, z = p.z - uShadowP.y;
  float s = texture(tShadow, vec3(p.xy + vec2(t, t * 0.4), z));
  s += texture(tShadow, vec3(p.xy + vec2(-t * 0.4, t), z));
  s += texture(tShadow, vec3(p.xy + vec2(-t, -t * 0.4), z));
  s += texture(tShadow, vec3(p.xy + vec2(t * 0.4, -t), z));
  return mix(1.0, 1.0 - uShadowP.x * (1.0 - s * 0.25), inside);
}
#endif`;

/** Placeholder uniforms for custom ShaderMaterials with the receiver block (replaced by the rig's shared objects when the material is adopted). */
export function shadowReceiverUniforms(): Record<string, THREE.IUniform> {
  return { tShadow: { value: null }, uShadowM: { value: new THREE.Matrix4() }, uShadowP: { value: new THREE.Vector4() } };
}

type Shader = { vertexShader: string; fragmentShader: string };

/**
 * Patches a built-in Lambert program (after its own onBeforeCompile) so the SUN term (`reflectedLight.directDiffuse`) is scaled by the shadow factor and the
 * ambient / hemisphere term loses up to ~11 % in shade (like the terrain); emissive (night windows) stays. World position comes from the view-space position (works for instanced, batched and
 * custom-vertex materials alike). r186: `vColor` is vec4 and untouched here.
 */
export function patchLambertReceiver(s: Shader): void {
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\n#ifdef USE_SHADOWS\nvarying vec3 vSWp;\n#endif')
    .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef USE_SHADOWS\nvSWp = transpose(mat3(viewMatrix)) * mvPosition.xyz + cameraPosition;\n#endif');
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', '#include <common>\n#ifdef USE_SHADOWS\nvarying vec3 vSWp;\n#endif\n' + SHADOW_RECV_FRAG)
    .replace('#include <aomap_fragment>', '#ifdef USE_SHADOWS\nfloat rsF = recvShadow(vSWp, normalize(transpose(mat3(viewMatrix)) * normal));\nreflectedLight.directDiffuse *= rsF;\nreflectedLight.indirectDiffuse *= 1.0 - 0.16 * (1.0 - rsF); // a little sky / bounce is lost in shade too (same idea as the terrain)\n#endif\n#include <aomap_fragment>');
}
