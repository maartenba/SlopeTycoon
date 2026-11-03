/* M8 lane G: real ride / walk / lift ground shots (near trees + rocks). vite-node scripts/shots/m8-ground-g.ts <prefix>  -> .weave/shots/<prefix>-{ride,lift,walk-lodge,walk-lake}.png */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-g-ground';
const srv = await startServer(); const br = await launch();
try {
  const base = { w: 1600, h: 1000, size: 128, seed: 5, hour: 11, ticks: 1500, extra: 'starter=1' } as const;
  const sets = [
    { out: `${prefix}-walk-forest`, start: 'summer' as never, view: 'walk', walkAt: '96,60', walkYaw: 200, walkPitch: 2 },
    { out: `${prefix}-ride`, start: 'winter' as never, view: 'ride', vticks: 40 },
    { out: `${prefix}-lift`, start: 'winter' as never, view: 'lift' },
    { out: `${prefix}-walk-lodge`, start: 'summer' as never, view: 'walk', walkAt: 'lodge', walkYaw: 30, walkPitch: 0 },
    { out: `${prefix}-walk-lake`, start: 'summer' as never, view: 'walk', walkAt: '103,90', walkYaw: 0, walkPitch: -5 },
  ];
  for (const s of sets) {
    const r = await shot(br, srv.url, { ...base, ...s } as never);
    console.log(r.file, r.errors.filter((e) => !/GL Driver|beforeinstallprompt/.test(e)).length, 'errors');
  }
} finally { await br.close(); srv.stop(); }
