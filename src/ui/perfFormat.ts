export interface PerfLive {
  fps: number; fpsLow1: number; frameMs: number; frameMaxMs: number;
  calls: number; triangles: number; geometries: number; textures: number;
  tickAvgMs: number; tickP95Ms: number;
  /** 'guests 0.52/1.10' = avg/p95 ms per system, most expensive first. */
  top: Array<{ id: string; avgMs: number; p95Ms: number }>;
  heapMB: number | null; guests: number; quality: string;
}

/** Multi-line text for the debug panel's Perf section. */
export function formatPerfLive(p: PerfLive): string {
  const heap = p.heapMB === null ? 'n/a' : `${p.heapMB.toFixed(0)} MB`;
  const top = p.top.map((t) => `  ${t.id.padEnd(11)} ${t.avgMs.toFixed(3)} avg  ${t.p95Ms.toFixed(3)} p95`).join('\n');
  return [
    `fps ${p.fps.toFixed(0)} (1% low ${p.fpsLow1.toFixed(0)}) | frame ${p.frameMs.toFixed(1)} ms (max ${p.frameMaxMs.toFixed(0)})`,
    `draw calls ${p.calls} | tris ${(p.triangles / 1000).toFixed(0)}k | geometries ${p.geometries} | textures ${p.textures}`,
    `sim tick ${p.tickAvgMs.toFixed(2)} ms avg / ${p.tickP95Ms.toFixed(2)} p95 | guests ${p.guests} | heap ${heap} | graphics ${p.quality}`,
    'top systems (ms/tick):', top || '  (no samples yet)',
  ].join('\n');
}
