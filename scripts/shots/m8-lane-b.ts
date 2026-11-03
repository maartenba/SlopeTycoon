/* M8 lane B (trees / rocks / guests / animals) helper shots: an animal gallery built from the real geometry functions (the 128 / seed 5 map has no farm, so cow / goat / sheep never show in a real shot).
 * vite-node scripts/shots/m8-lane-b.ts <prefix> -> .weave/shots/<prefix>-animal-gallery{,-close}.png */
import { launch, shot, startServer } from '../lib/harness';

const prefix = process.argv[2] ?? 'm8-after-b';
const HIDE_UI = "(()=>{const s=document.createElement('style');s.textContent='#ui,st-toast{display:none!important}';document.head.appendChild(s);})()";
const GALLERY = "(async()=>{const m=await import('/scripts/shots/m8-lane-b-page.ts');m.animalGallery(__slope);})()";
const srv = await startServer(); const br = await launch(); let bad = 0;
try {
  for (const [out, zoom] of [['animal-gallery', 16], ['animal-gallery-close', 32]] as const) {
    const r = await shot(br, srv.url, { w: 1600, h: 1000, size: 128, seed: 5, start: 'summer', hour: 12, zoom, evalJs: `${HIDE_UI};${GALLERY}`, out: `${prefix}-${out}` });
    for (const e of r.errors.filter((e) => !/GL Driver Message|beforeinstallprompt/.test(e))) { console.log(e); bad++; }
    console.log(r.file);
  }
} finally { await br.close(); srv.stop(); }
process.exitCode = bad ? 2 : 0;
