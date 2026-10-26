/* Fixed before/after scene set for the "softer look" pass: npm run shot -- is too slow per scene, so: vite-node scripts/soft-shots.ts <prefix> (writes .weave/shots/<prefix>-*.png). */
import { launch, shot, startServer, type ShotOpts } from './lib/harness';
const prefix = process.argv[2] ?? 'soft-after';
const RIDE_PRE = "__slope.populateDemo('medium'); __slope.spawnGuests(300,'skiers')";
const SET: Array<ShotOpts & { out: string }> = [
  { out: 'village-day-winter', start: 'winter', hour: 12, zoom: 3, target: 'lodge' },
  { out: 'village-dusk-winter', start: 'winter', hour: 17.3, zoom: 3, target: 'lodge' },
  { out: 'village-night-winter', start: 'winter', hour: 22, zoom: 3, target: 'lodge' },
  { out: 'meadow-summer', start: 'summer', hour: 12, zoom: 4, target: 'lodge' },
  { out: 'forest-close', start: 'summer', hour: 12, zoom: 8, target: '40,24' },
  { out: 'forest-close-winter', start: 'winter', hour: 12, zoom: 8, target: '40,24' },
  { out: 'slope-guests', start: 'winter', hour: 12, size: 128, zoom: 6, pre: RIDE_PRE, ticks: 1500, freeze: true },
  { out: 'lift-stations', start: 'winter', hour: 12, zoom: 2.5, target: 'lodge', extra: 'starter=1' },
  { out: 'farm-animals', start: 'summer', hour: 12, zoom: 5, target: '20,20' },
  { out: 'lake-beach', start: 'summer', hour: 13, zoom: 4, target: '44,44' },
  { out: 'gallery', start: 'summer', hour: 12, zoom: 2, evalJs: "window.dispatchEvent(new KeyboardEvent('keydown',{key:'b'}))" },
  { out: 'ride-ski', start: 'winter', hour: 11, size: 128, pre: RIDE_PRE, ticks: 1500, view: 'ride', guest: 'auto', vticks: 30, freeze: true },
  { out: 'ride-lift', start: 'winter', hour: 11, size: 128, pre: RIDE_PRE, ticks: 300, view: 'lift', freeze: true },
  { out: 'walk', start: 'summer', hour: 12, view: 'walk', walkAt: 'lodge' } as ShotOpts & { out: string },
];
const srv = await startServer(); const br = await launch(); let bad = 0;
try {
  for (const s of SET) {
    const stat = "(async()=>{await new Promise(r=>setTimeout(r,2500));const i=__slope.renderer.webgl.info.render;console.log('[stats] '+i.calls+' calls '+i.triangles+' tris');})()";
    const r = await shot(br, srv.url, { ...s, evalJs: `${s.evalJs ?? ''};${stat}`, out: `${prefix}-${s.out}` });
    for (const l of r.logs) if (l.includes('[stats]')) console.log('   ' + l);
    const real = r.errors.filter((e) => !/GL Driver Message|beforeinstallprompt/.test(e));
    console.log(`${r.file}: ${real.length} errors`); bad += real.length;
  }
} finally { await br.close(); srv.stop(); }
process.exitCode = bad ? 2 : 0;
