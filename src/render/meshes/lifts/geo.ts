import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PartBuilder, SignSpec } from '../common';

/** Merge all PartBuilder layers into one vertex-coloured geometry (lifts use a single Lambert material). */
export function finishGeometry(b: PartBuilder): THREE.BufferGeometry {
  return finishWithSign(b).geometry;
}

/** Number of material slots a lift geometry needs: 2 when it has a translucent glass group (opaque first, glass second). */
export const glassGroups = (g: THREE.BufferGeometry): boolean => g.groups.length > 1;

/** Same, but keeps the (textured) sign planes apart so they can use a canvas-text material. */
export function finishWithSign(b: PartBuilder): { geometry: THREE.BufferGeometry; sign: SignSpec | null } {
  const parts = b.finish();
  const list = [parts.wood, parts.stone, parts.roof].filter((g): g is THREE.BufferGeometry => !!g);
  const opaque = mergeGeometries(list, false) ?? new THREE.BufferGeometry();
  const geometry = parts.glass && list.length ? (mergeGeometries([opaque, parts.glass], true) ?? opaque) : opaque;
  return { geometry, sign: parts.sign ?? null };
}

export const liftMaterial = (): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ vertexColors: true });
/** Translucent pane material for carrier glass groups (bubble hoods, cabin windows). */
export const liftGlassMaterial = (): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false });

/** Stable content hash of a geometry's positions + colours (for distinctness tests). */
export function geometryHash(g: THREE.BufferGeometry): string {
  let h = 2166136261;
  for (const name of ['position', 'color']) {
    const a = g.getAttribute(name);
    if (!a) continue;
    const arr = a.array as Float32Array;
    for (let i = 0; i < arr.length; i++) { h ^= Math.round(arr[i]! * 1000); h = Math.imul(h, 16777619); }
  }
  return `${g.getAttribute('position').count}:${(h >>> 0).toString(16)}`;
}
