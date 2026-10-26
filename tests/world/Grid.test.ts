import { describe, expect, it } from 'vitest';
import { Grid, Shape, classifyCorners } from '../../src/world/Grid';
import { Occupancy, OccFlag } from '../../src/world/Occupancy';

describe('classifyCorners', () => {
  it('flat', () => expect(classifyCorners(3, 3, 3, 3)).toEqual({ shape: Shape.Flat, rotation: 0 }));
  it('half slope + rotations', () => {
    expect(classifyCorners(1, 1, 0, 0)).toEqual({ shape: Shape.HalfSlope, rotation: 0 });
    expect(classifyCorners(0, 1, 1, 0)).toEqual({ shape: Shape.HalfSlope, rotation: 1 });
    expect(classifyCorners(0, 0, 1, 1)).toEqual({ shape: Shape.HalfSlope, rotation: 2 });
    expect(classifyCorners(1, 0, 0, 1)).toEqual({ shape: Shape.HalfSlope, rotation: 3 });
  });
  it('full slope', () => {
    expect(classifyCorners(2, 2, 0, 0)).toEqual({ shape: Shape.FullSlope, rotation: 0 });
    expect(classifyCorners(2, 0, 0, 2)).toEqual({ shape: Shape.FullSlope, rotation: 3 });
  });
  it('corner up / down', () => {
    expect(classifyCorners(0, 0, 1, 0)).toEqual({ shape: Shape.CornerUp, rotation: 2 });
    expect(classifyCorners(1, 1, 1, 0)).toEqual({ shape: Shape.CornerDown, rotation: 3 });
  });
  it('valley', () => {
    expect(classifyCorners(1, 0, 1, 0)).toEqual({ shape: Shape.Valley, rotation: 0 });
    expect(classifyCorners(0, 1, 0, 1)).toEqual({ shape: Shape.Valley, rotation: 1 });
  });
  it('steep/diagonal', () => {
    expect(classifyCorners(0, 1, 2, 1).shape).toBe(Shape.Steep);
    expect(classifyCorners(0, 1, 1, 2).shape).toBe(Shape.Steep);
  });
});

describe('Grid', () => {
  it('rejects bad sizes', () => expect(() => new Grid(100 as never)).toThrow());
  it('corner order', () => {
    const g = new Grid(128);
    g.setCornerUnchecked(5, 5, 1);
    g.setCornerUnchecked(6, 5, 2);
    g.setCornerUnchecked(6, 6, 3);
    g.setCornerUnchecked(5, 6, 4);
    expect(g.getCorners(5, 5)).toEqual([1, 2, 3, 4]);
  });
  it('setCorner rejects violations and accepts valid', () => {
    const g = new Grid(128);
    expect(g.setCorner(10, 10, 2)).toBe(true);
    expect(g.setCorner(10, 10, 3)).toBe(false);
    expect(g.getCorner(10, 10)).toBe(2);
    expect(g.checkInvariants()).toEqual([]);
    g.setCornerUnchecked(20, 20, 5);
    expect(g.checkInvariants().length).toBe(4);
  });
  it('edges of map', () => {
    const g = new Grid(128);
    expect(g.setCorner(0, 0, 2)).toBe(true);
    expect(g.setCorner(128, 128, 2)).toBe(true);
  });
  it('steepness', () => {
    const g = new Grid(128);
    expect(g.steepness(0, 0)).toBe(0);
    g.setCornerUnchecked(0, 1, 2);
    g.setCornerUnchecked(1, 1, 2);
    expect(g.steepness(0, 0)).toBe(2);
    expect(g.classifyTile(0, 0).shape).toBe(Shape.FullSlope);
  });
  it('dirty chunks', () => {
    const g = new Grid(128);
    expect(g.consumeDirtyChunks()).toEqual([]);
    g.setCorner(32, 32, 1); // touches 4 chunks
    expect(g.consumeDirtyChunks().sort((a, b) => a - b)).toEqual([0, 1, 4, 5]);
    expect(g.consumeDirtyChunks()).toEqual([]);
    g.setSnow(40, 3, 0.5);
    expect(g.consumeDirtyChunks()).toEqual([]); // snow uses its own dirty set (no geometry rebuild)
    expect(g.consumeSnowDirtyChunks()).toEqual([1]);
    expect(g.consumeSnowDirtyChunks()).toEqual([]);
  });
  it('256 grid < 20MB', () => {
    const g = new Grid(256);
    expect(g.byteLength()).toBeLessThan(20 * 1024 * 1024);
  });
});

describe('Occupancy', () => {
  it('flags and ids', () => {
    const o = new Occupancy(128);
    expect(o.isFree(1, 1)).toBe(true);
    o.set(1, 1, OccFlag.Building, 42);
    o.set(1, 1, OccFlag.Path);
    expect(o.has(1, 1, OccFlag.Path)).toBe(true);
    expect(o.entityId[o.index(1, 1)]).toBe(42);
    o.clear(1, 1, OccFlag.Building);
    o.clear(1, 1, OccFlag.Path);
    expect(o.isFree(1, 1)).toBe(true);
    expect(o.entityId[o.index(1, 1)]).toBe(0);
  });
});
