/* Visual QA harness CLI (see docs/visual-qa.md).
 * npm run shot -- --size 64 --seed 61 --start summer --hour 12 --zoom 1 --target lodge --out name [--yaw 0.5] [--w 1600 --h 1000] [--extra "k=v&k=v"] [--eval "js"] [--pre "js before ticks"] [--view ride|lift|photo|walk --walk-at lodge|station|x,y --walk-yaw deg --walk-script "w:2;d:1;look:30,-5;e" --walk-start default|choose:x,y --walk-drop x,y --guest auto --vticks N] [--photo-filter warm --photo-hour 17.5 --photo-aspect 16:9 --photo-frame polaroid --photo-vignette 40 --photo-hero 1 --photo-save 1 --photo-from ride]
 * Prints every console message / page error / failed request. Exit code 2 when a shader/WebGL error was seen. */
import { launch, shot, startServer } from './lib/harness';

function parseArgs(): Record<string, string> {
  const a = process.argv.slice(2), r: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) if (a[i]!.startsWith('--')) r[a[i]!.slice(2)] = a[i + 1] && !a[i + 1]!.startsWith('--') ? a[++i]! : '1';
  return r;
}

{
  const a = parseArgs();
  const srv = await startServer();
  const br = await launch();
  try {
    const r = await shot(br, srv.url, {
      size: a.size ? Number(a.size) : undefined, seed: a.seed ? Number(a.seed) : undefined, start: a.start, hour: a.hour ? Number(a.hour) : undefined,
      zoom: a.zoom ? Number(a.zoom) : undefined, target: a.target, out: a.out, yaw: a.yaw ? Number(a.yaw) : undefined, w: a.w ? Number(a.w) : undefined, h: a.h ? Number(a.h) : undefined,
      extra: a.extra, evalJs: a.eval, ticks: a.ticks ? Number(a.ticks) : undefined, steps: a.steps, overlap: !!a.overlap, bare: !!a.bare, viewport: a.viewport,
      photoFilter: a['photo-filter'], photoFrame: a['photo-frame'], photoAspect: a['photo-aspect'], photoHour: a['photo-hour'] ? Number(a['photo-hour']) : undefined, photoVignette: a['photo-vignette'] ? Number(a['photo-vignette']) : undefined, photoHero: !!a['photo-hero'], photoFov: a['photo-fov'] ? Number(a['photo-fov']) : undefined, photoScale: a['photo-scale'] ? Number(a['photo-scale']) : undefined, photoOrbit: a['photo-orbit'], photoSave: !!a['photo-save'], photoFrom: a['photo-from'],
      walkAt: a['walk-at'], walkYaw: a['walk-yaw'] !== undefined ? Number(a['walk-yaw']) : undefined, walkPitch: a['walk-pitch'] !== undefined ? Number(a['walk-pitch']) : undefined, walkScript: a['walk-script'], walkStart: a['walk-start'], walkDrop: a['walk-drop'],
      pre: a.pre, view: a.view, guest: a.guest, vticks: a.vticks ? Number(a.vticks) : undefined, freeze: !!a.freeze, vjs: a.vjs,
    });
    const seen = new Map<string, number>(); for (const l of r.logs) seen.set(l.slice(0, 1500), (seen.get(l.slice(0, 1500)) ?? 0) + 1);
    for (const [l, n] of seen) console.log(n > 1 ? `(x${n}) ${l}` : l);
    console.log(`saved ${r.file}; ${r.errors.length} errors`);
    process.exitCode = r.errors.some((e) => /shader|WebGL/i.test(e)) ? 2 : 0;
  } finally { await br.close(); srv.stop(); }
}
