import * as THREE from 'three';

/** What the guard needs from the renderer (WebGLRenderer satisfies it; tests can stub it). */
export interface GuardRenderer {
  properties?: { get(o: unknown): { currentProgram?: { diagnostics?: { runnable?: boolean; programLog?: string; fragmentShader?: { log?: string }; vertexShader?: { log?: string } } } } };
  debug: { onShaderError: unknown };
}

export interface RenderProblem { material: string; owner: string; log: string; fallback: boolean }

type AnyMat = THREE.Material & { onBeforeCompile?: (...a: unknown[]) => void; customProgramCacheKey?: () => string; isShaderMaterial?: boolean };

/**
 * Detects shader compile/link failures of ANY material in the scene (terrain, water, trees, rocks, guests, snow, overlays, buildings) and
 * reports them loudly. Patched built-in materials (Lambert/Standard with onBeforeCompile) fall back to the plain, unpatched material so
 * they never vanish; custom ShaderMaterials cannot be repaired generically and are reported only.
 */
export class MaterialGuard {
  readonly problems = new Map<string, RenderProblem>();
  private seen = new WeakSet<THREE.Material>();
  private frame = 0;
  /** Called once per newly found problem (toast / console). */
  onProblem: ((p: RenderProblem) => void) | null = null;

  constructor(private gl: GuardRenderer, private scene: THREE.Object3D, private every = 20) {
    // Immediate, program-level notification (the callback doesn't know the material, so just log; check() names it).
    this.gl.debug.onShaderError = (): void => { this.frame = this.every; };
  }

  get count(): number { return this.problems.size; }

  /** Call once per frame (cheap: scans every `every` frames). */
  tick(): void {
    if (++this.frame < this.every) return;
    this.frame = 0;
    this.check();
  }

  /** Scan the scene now. Returns the number of problems found so far. */
  check(): number {
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      for (const m of Array.isArray(mat) ? mat : [mat]) this.inspect(m, o);
    });
    return this.problems.size;
  }

  private inspect(m: THREE.Material, owner: THREE.Object3D): void {
    if (this.seen.has(m)) return;
    const d = this.gl.properties?.get(m)?.currentProgram?.diagnostics;
    if (!d || d.runnable !== false) return;
    this.seen.add(m);
    const name = m.name || m.type;
    const mm = m as AnyMat;
    let fallback = false;
    if (!mm.isShaderMaterial && typeof mm.onBeforeCompile === 'function') {
      mm.onBeforeCompile = (): void => {};
      mm.customProgramCacheKey = (): string => `fallback-${m.uuid}`;
      m.needsUpdate = true;
      fallback = true;
    }
    const log = [d.programLog, d.fragmentShader?.log, d.vertexShader?.log].filter(Boolean).join(' ').slice(0, 400);
    const p: RenderProblem = { material: name, owner: owner.name || owner.type, log, fallback };
    this.problems.set(`${name}#${m.uuid}`, p);
    console.error(`Shader error in ${name} (${p.owner})${fallback ? ' - fell back to the unpatched material' : ''}: ${log}`);
    this.onProblem?.(p);
  }

  summary(): string {
    if (!this.problems.size) return 'Render problems: 0';
    return `Render problems: ${this.problems.size} (${[...this.problems.values()].map((p) => `${p.material}@${p.owner}${p.fallback ? ' [fallback]' : ''}`).join(', ')})`;
  }
}
