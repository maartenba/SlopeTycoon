// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Grid } from '../../src/world/Grid';
import { Economy } from '../../src/sim/Economy';
import { LiftStore } from '../../src/sim/Lift';
import { LiftTool } from '../../src/build/LiftTool';
import { TerraformTool } from '../../src/build/TerraformTool';
import { PlantTool } from '../../src/build/PlantTool';
import { LandscapeTool } from '../../src/build/LandscapeTool';

/** Touch support (docs/touch.md): the lift tool's commit / hint API behind the two-step Place flow, and the tools' pointerleave behaviour. */
const flat = (): Grid => { const g = new Grid(64); for (let vy = 0; vy <= 64; vy++) for (let vx = 0; vx <= 64; vx++) g.setCornerUnchecked(vx, vy, 0); return g; };
const overlays = () => ({ setVertexRect: vi.fn(), setColor: vi.fn(), setTooltip: vi.fn(), hide: vi.fn(), setTerraformPreview: vi.fn() });
const cleanup: Array<() => void> = [];
afterEach(() => { for (const c of cleanup.splice(0)) c(); document.body.replaceChildren(); });

function liftTool(): { tool: LiftTool; dom: HTMLElement; ov: ReturnType<typeof overlays>; place: ReturnType<typeof vi.fn> } {
  const grid = flat();
  const dom = document.createElement('canvas'); document.body.append(dom);
  dom.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 480, right: 640, bottom: 480, x: 0, y: 0, toJSON: () => ({}) });
  const camera = new THREE.OrthographicCamera(-10, 10, 7.5, -7.5, 0.1, 200);
  camera.position.set(32, 60, 32.001); camera.lookAt(32, 0, 32); camera.updateMatrixWorld(true);
  const ov = overlays(), place = vi.fn(() => ({ ok: false, reasons: ['test'], cost: 0, touchedChunks: [] }));
  const economy = new Economy({ money: 1e9 });
  const tool = new LiftTool({
    env: { grid, lifts: new LiftStore(grid.occupancy), economy } as never, props: undefined as never, view: { createPreview: () => ({ group: new THREE.Group(), dispose() {} }) } as never,
    scene: new THREE.Scene(), camera, dom, overlays: ov as never, place: place as never, onPlaced: vi.fn(), onError: vi.fn(), onCancel: vi.fn(),
  });
  cleanup.push(() => tool.dispose());
  return { tool, dom, ov, place };
}
const move = (dom: HTMLElement, x: number, y: number): void => {
  const e = new Event('pointermove', { bubbles: true }) as unknown as Record<string, unknown>;
  Object.assign(e, { clientX: x, clientY: y, button: 0, buttons: 0, pointerId: 1, pointerType: 'touch' });
  dom.dispatchEvent(e as unknown as Event);
};

describe('LiftTool.confirm / touchHint (Place button and second tap of the touch flow)', () => {
  it('has no hint and cannot confirm while no lift is being placed', () => {
    const { tool } = liftTool();
    expect(tool.touchHint()).toBe('');
    expect(tool.confirm()).toBe(false);
  });
  it('bottom stage: asks for the bottom station; confirm without a previewed site is refused', () => {
    const { tool } = liftTool();
    tool.start('chair4');
    expect(tool.touchHint()).toMatch(/bottom station/i);
    expect(tool.stage).toBe('bottom');
    expect(tool.confirm()).toBe(false); // nothing aimed yet
  });
  it('confirm sets the previewed bottom station and moves on to the top stage', () => {
    const { tool, dom } = liftTool();
    tool.start('chair4');
    move(dom, 320, 240);
    expect(tool.confirm()).toBe(true);
    expect(tool.stage).toBe('top');
    expect(tool.touchHint()).toMatch(/top station|✖/);
  });
  it('cancel forgets everything', () => {
    const { tool, dom } = liftTool();
    tool.start('chair4'); move(dom, 320, 240); tool.confirm(); tool.cancel();
    expect(tool.stage).toBeNull();
    expect(tool.touchHint()).toBe('');
  });
});

describe('pointerleave hides the cursor only for the ACTIVE tool (touch: lifting the finger fires pointerleave; the Select hover info must stay)', () => {
  const leave = (dom: HTMLElement): void => { dom.dispatchEvent(new Event('pointerleave')); };
  it('TerraformTool', () => {
    const dom = document.createElement('canvas'), ov = overlays();
    const t = new TerraformTool({ dom, overlays: ov, grid: flat() } as never);
    cleanup.push(() => t.disable());
    leave(dom); expect(ov.hide).not.toHaveBeenCalled();
    t.enable(); leave(dom); expect(ov.hide).toHaveBeenCalledTimes(1);
  });
  it('PlantTool', () => {
    const dom = document.createElement('canvas'), ov = overlays();
    const t = new PlantTool({ dom, overlays: ov, grid: flat() } as never);
    leave(dom); expect(ov.hide).not.toHaveBeenCalled();
    t.enable(); leave(dom); expect(ov.hide).toHaveBeenCalledTimes(1);
  });
  it('LandscapeTool', () => {
    const dom = document.createElement('canvas'), ov = overlays();
    const t = new LandscapeTool({ dom, overlays: ov, grid: flat() } as never);
    leave(dom); expect(ov.hide).not.toHaveBeenCalled();
    t.enable(); leave(dom); expect(ov.hide).toHaveBeenCalledTimes(1);
  });
});

describe('keys typed into an input inside a shadow root (save name, seed) must not reach the tools (found with the on-screen keyboard: "h" opened Help, digits switched brushes)', () => {
  const typeInShadowInput = (): { input: HTMLInputElement; host: HTMLElement } => {
    const host = document.createElement('div'); document.body.append(host);
    const input = document.createElement('input'); host.attachShadow({ mode: 'open' }).append(input);
    return { input, host };
  };
  const key = (input: HTMLInputElement, k: string): void => { input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true })); };
  it('PlantTool ignores digits / brackets typed in a shadow input but reacts to the same keys on the page', () => {
    const t = new PlantTool({ dom: document.createElement('canvas'), overlays: overlays(), grid: flat() } as never);
    t.enable();
    const { input } = typeInShadowInput();
    const m0 = t.mode;
    key(input, '2'); expect(t.mode).toBe(m0);
    const b0 = t.brush; key(input, ']'); expect(t.brush).toBe(b0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' })); expect(t.brush).not.toBe(b0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' })); expect(t.mode).not.toBe(m0);
  });
  it('TerraformTool and LandscapeTool likewise', () => {
    const tt = new TerraformTool({ dom: document.createElement('canvas'), overlays: overlays(), grid: flat() } as never); tt.enable();
    const lt = new LandscapeTool({ dom: document.createElement('canvas'), overlays: overlays(), grid: flat() } as never); lt.enable();
    const { input } = typeInShadowInput();
    const tm = tt.mode, lm = lt.mode;
    for (const k of ['1', '2', '3', '4', '5', '6']) key(input, k);
    expect(tt.mode).toBe(tm); expect(lt.mode).toBe(lm);
    cleanup.push(() => { tt.disable(); lt.disable(); });
  });
});
