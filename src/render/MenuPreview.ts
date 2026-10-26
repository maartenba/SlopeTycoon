import { Grid } from '../world/Grid';
import { generateTerrain } from '../world/TerrainGen';
import { TerrainMesh } from './TerrainMesh';
import { HEIGHT_UNIT } from '../config/balance';
import type { Renderer } from './Renderer';

/** Seed of the title-screen preview map (a 64 map, generated with the normal terrain generator). */
export const MENU_PREVIEW_SEED = 61;

/**
 * Title-screen backdrop: a seeded 64 map in winter, camera slowly orbiting (yaw drift, no input). UNVERIFIED at runtime in agent
 * sessions (no WebGL): the host wraps this in try/catch and falls back to a plain background.
 */
export function startMenuPreview(renderer: Renderer): { dispose(): void } {
  const grid = new Grid(64);
  generateTerrain(grid, MENU_PREVIEW_SEED);
  const terrain = new TerrainMesh(grid, renderer.sun);
  renderer.scene.add(terrain.group);
  let maxH = 0;
  for (let i = 0; i < grid.heights.length; i++) maxH = Math.max(maxH, grid.heights[i]!);
  const maxWorld = Math.max(1, Math.ceil(maxH * HEIGHT_UNIT));
  terrain.snowline = Math.max(1, maxWorld * 0.3);
  terrain.autumn = 0;
  terrain.springBloom = 0;
  const c = renderer.controls;
  c.zoom = 1.6;
  c.target.set(32, 0, 28);
  renderer.onFrame = (dt): void => {
    c.yaw += dt * 0.08;
    const cam = c.camera;
    terrain.update(cam.top - cam.bottom, () => {});
  };
  renderer.start();
  return { dispose: () => { renderer.onFrame = null; renderer.scene.remove(terrain.group); renderer.dispose(); } };
}
