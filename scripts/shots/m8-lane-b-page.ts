/* Browser-side half of m8-lane-b.ts (served by the dev server so it shares the app's three instance). */
import * as THREE from 'three';
import * as A from '../../src/render/meshes/Animals';

export function animalGallery(s: any): void {
  const a = s.terrainInfo.villageAnchor, gr = s.grid, hh = (x: number, y: number): number => gr.getCorner(Math.round(x), Math.round(y)) * 0.5;
  s.trees.group.visible = false; s.rocks.group.visible = false;
  const names = ['Cow', 'Sheep', 'Goat', 'Deer', 'Ibex', 'Chamois', 'Marmot', 'Fox', 'Eagle', 'Bear', 'Wolf', 'Rabbit', 'Donkey'];
  const g = new THREE.Group(); g.name = 'lane-b-gallery';
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  names.forEach((n, i) => {
    const f = (A as unknown as Record<string, () => THREE.BufferGeometry>)[`create${n}Geometry`]; if (!f) return;
    const m = new THREE.Mesh(f(), mat);
    m.position.set(a.x - 4 + (i % 7) * 1.1, hh(a.x, a.y) + 0.6, a.y - 9 + Math.floor(i / 7) * 1.4); m.scale.setScalar(1.5); g.add(m);
  });
  s.renderer.scene.add(g);
  s.renderer.controls.target.set(a.x - 1, hh(a.x, a.y) + 0.6, a.y - 8.5);
}
