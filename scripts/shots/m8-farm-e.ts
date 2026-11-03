/* M8 lane E: real farm scene (summer start with starter=1 builds an Alpine Farm: cows on the pasture, petting-zoo goat / sheep) at a close camera.
 * vite-node scripts/shots/m8-farm-e.ts <prefix> [zoom=40] -> .weave/shots/<prefix>-farm.png */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-e-farm', zoom = Number(process.argv[3] ?? 40);
const HIDE = "(()=>{const s=document.createElement('style');s.textContent='#ui,st-toast{display:none!important}';document.head.appendChild(s);})()";
const FARM = "(()=>{const s=__slope;s.loop.setSpeed(0);const v=s.sim.nature.livestock.animals.filter(a=>!a.hidden&&a.species==='cow');const a=v[0];console.log('[stats] cows '+v.length);if(a){const y=s.grid.getCorner(Math.round(a.x),Math.round(a.y))*0.5;const c=s.renderer.controls;c.target.set(a.x,y,a.y);if(c.update)c.update(1);}})()";
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { w: 1600, h: 1000, size: 128, seed: 5, start: 'summer', hour: 12, zoom, extra: 'starter=1', ticks: 900, evalJs: `${HIDE};${FARM}`, out: `${prefix}-farm` });
  for (const l of r.logs) if (l.includes('[stats]')) console.log(l);
  console.log(r.file, r.errors.filter((e) => !/GL Driver/.test(e)).length, 'errors');
} finally { await br.close(); srv.stop(); }
