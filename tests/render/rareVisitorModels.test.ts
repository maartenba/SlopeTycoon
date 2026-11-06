import { describe, expect, it } from 'vitest';
import { MODEL_IDS, WALK_FRAMES, WAVE_FRAMES, createPoseSet, legLenOf, triangles } from '../../src/render/meshes/rareVisitor';
import { GAIT, frameOf, idlePose, phaseAt, swingOf, walkPose, wavePose } from '../../src/render/meshes/visitorGait';
import { VISITOR } from '../../src/config/visitor';

describe('rare visitor models', () => {
  for (const m of MODEL_IDS) {
    it(`${m}: one coloured geometry per pose, <= ~950 triangles, same count in every pose, ~1 tile tall, feet on the ground`, () => {
      const set = createPoseSet(m), all = [...Array.from({ length: WALK_FRAMES }, (_, i) => set.get('walk', i)), set.get('idle', 0), set.get('idle', 0, 1), ...Array.from({ length: WAVE_FRAMES }, (_, i) => set.get('wave', i))];
      for (const g of all) {
        expect(triangles(g)).toBeLessThanOrEqual(950); expect(triangles(g)).toBe(triangles(all[0]!));
        expect(g.getAttribute('color')).toBeDefined(); expect(g.getAttribute('normal')).toBeDefined();
        g.computeBoundingBox(); const b = g.boundingBox!;
        expect(b.min.y).toBeGreaterThan(-0.08); expect(b.min.y).toBeLessThan(0.06); expect(b.max.y).toBeGreaterThan(0.95); expect(b.max.y).toBeLessThan(1.7);
        for (const v of g.getAttribute('position').array) expect(Number.isFinite(v)).toBe(true);
      }
      set.dispose();
    });
  }
  it('three distinct models (different silhouettes) selected by name', () => {
    const w = MODEL_IDS.map((m) => { const g = createPoseSet(m).get('idle', 0); g.computeBoundingBox(); const b = g.boundingBox!; return [b.max.x - b.min.x, b.max.y].map((x) => x.toFixed(2)).join('x'); });
    expect(new Set(w).size).toBe(3); expect([...MODEL_IDS]).toEqual(['plush', 'shaggy', 'bigfoot']);
    expect(['plush', 'shaggy', 'bigfoot']).toContain(VISITOR.model);
  });
  it('wave poses raise the +x... the -x arm above the shoulder', () => {
    const g = createPoseSet('plush').get('wave', 2); g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeGreaterThan(1.0);
  });
});

describe('rare visitor gait (pure)', () => {
  const spec = { legLen: 0.25 };
  it('loops: pose(0) == pose(1) and is continuous', () => {
    const a = walkPose(0, spec), b = walkPose(1, spec);
    for (const k of Object.keys(a) as Array<keyof typeof a>) expect(b[k]).toBeCloseTo(a[k], 9);
    let prev = walkPose(0, spec);
    for (let i = 1; i <= 200; i++) { const p = walkPose(i / 200, spec); for (const k of Object.keys(p) as Array<keyof typeof p>) expect(Math.abs(p[k] - prev[k])).toBeLessThan(0.08); prev = p; }
  });
  it('legs alternate (opposite angles), arms swing against the same-side leg, half a cycle later it mirrors', () => {
    for (let i = 0; i < 40; i++) {
      const p = walkPose(i / 40, spec), q = walkPose(i / 40 + 0.5, spec);
      expect(p.legL).toBeCloseTo(-p.legR, 9); expect(p.armL * p.legL).toBeLessThanOrEqual(1e-12); expect(p.armR * p.legR).toBeLessThanOrEqual(1e-12);
      expect(q.legL).toBeCloseTo(p.legR, 9); expect(q.armL).toBeCloseTo(p.armR, 9);
      expect(Math.abs(p.liftL * p.liftR)).toBe(0); // only one foot is lifted at a time
      expect(p.bob).toBeLessThanOrEqual(0);
    }
  });
  it('the body is highest as the legs pass and lowest at the footfall; sway and head counter-turn follow the stride', () => {
    expect(walkPose(0, spec).bob).toBeCloseTo(0, 9); expect(walkPose(0.25, spec).bob).toBeLessThan(-0.005);
    expect(walkPose(0.25, spec).sway).toBeGreaterThan(0); expect(walkPose(0.75, spec).sway).toBeLessThan(0);
    expect(walkPose(0.25, spec).headYaw).toBeLessThan(0);
  });
  it('stride length vs speed: one step covers the spread of the legs (no skating) for every model, ~1 step a second at the visitor\'s pace', () => {
    for (const m of MODEL_IDS) { const L = legLenOf(m), A = swingOf({ legLen: L }); expect(Math.abs(2 * L * Math.sin(A) / GAIT.stepLen - 1)).toBeLessThan(0.12); expect(A).toBeLessThanOrEqual(GAIT.maxSwing); expect(A).toBeGreaterThan(0.3); }
    expect(phaseAt(2 * GAIT.stepLen)).toBeCloseTo(1, 9); expect(GAIT.stepLen).toBe(VISITOR.stepLen);
    // ~0.4 tiles/s at 1x (a path of ~18 tiles over ~8 sim hours of ~6 s each, minus pauses) => a step every 0.8 s
    const speed = 18 / ((8 * 60 - 45 - 2 * 36) * 0.1); expect(GAIT.stepLen / speed).toBeGreaterThan(0.5); expect(GAIT.stepLen / speed).toBeLessThan(1.4);
  });
  it('frames: every phase maps to a walk frame, the standing pose has legs together', () => {
    for (let i = 0; i < 100; i++) { const f = frameOf(i / 37, WALK_FRAMES); expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThan(WALK_FRAMES); }
    expect(frameOf(0.999, 8)).toBe(0); const id = idlePose(); expect(id.legL).toBe(0); expect(id.legR).toBe(0);
  });
  it('the wave rises, wiggles and lowers', () => {
    expect(wavePose(0).raise).toBe(0); expect(wavePose(0.5).raise).toBe(1); expect(wavePose(1).raise).toBe(0);
    const ws = Array.from({ length: 50 }, (_, i) => wavePose(0.2 + (i / 50) * 0.6).wiggle); expect(Math.max(...ws)).toBeGreaterThan(0.2); expect(Math.min(...ws)).toBeLessThan(-0.2);
  });
});
