import * as THREE from 'three';

/** Terrain-only atmosphere uniforms (shared objects, mutated in place by the AtmosphereController; neutral = the pre-M7.0 look). */
export const atmosTerrainUniforms = {
  uAtmA: { value: new THREE.Vector4(0, 1e9, 0, 0) },
  uAtmB: { value: new THREE.Vector4(0, 0, 0, 0) },
  uAlpColor: { value: new THREE.Color(1, 0.52, 0.5) },
};
