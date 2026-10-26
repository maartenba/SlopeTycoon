import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CAMERA_PITCH } from '@/config/balance';
import { cameraOffset, panBasis, snapYaw } from '@/render/CameraController';

function project(yaw: number, p: THREE.Vector3, pitch = CAMERA_PITCH): THREE.Vector3 {
  const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  cam.position.copy(cameraOffset(yaw, pitch, 30));
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return p.clone().project(cam);
}

describe('camera', () => {
  it('pitch is 35.264deg', () => {
    expect((CAMERA_PITCH * 180) / Math.PI).toBeCloseTo(35.264, 3);
    const o = cameraOffset(0.3, CAMERA_PITCH, 10);
    expect((Math.asin(o.y / o.length()) * 180) / Math.PI).toBeCloseTo(35.264, 3);
  });
  it('unit tile edges at yaw 45deg: dx:dy = 1/sin(pitch) (true iso sqrt3:1)', () => {
    const yaw = Math.PI / 4;
    const o = project(yaw, new THREE.Vector3(0, 0, 0));
    for (const v of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
      const q = project(yaw, v).sub(o);
      expect(Math.abs(q.x) / Math.abs(q.y)).toBeCloseTo(1 / Math.sin(CAMERA_PITCH), 6);
    }
  });
  it('2:1 ratio holds for the 30deg dimetric pitch (projection math check)', () => {
    const pitch = Math.asin(0.5);
    const yaw = Math.PI / 4;
    const o = project(yaw, new THREE.Vector3(0, 0, 0), pitch);
    const q = project(yaw, new THREE.Vector3(1, 0, 0), pitch).sub(o);
    expect(Math.abs(q.x) / Math.abs(q.y)).toBeCloseTo(2, 6);
  });
  it('snaps to 90deg steps offset by 45deg', () => {
    const a = Math.PI / 4;
    expect(snapYaw(a, 1)).toBeCloseTo(a + Math.PI / 2);
    expect(snapYaw(a, -1)).toBeCloseTo(a - Math.PI / 2);
  });
  it('pan basis rotates with yaw', () => {
    const b = panBasis(0);
    expect(b.forward[1]).toBeCloseTo(-1);
    const c = panBasis(Math.PI / 2);
    expect(c.forward[0]).toBeCloseTo(-1);
  });
});
