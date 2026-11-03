/* M8 audit wrapper (docs/graphics-audit.md): before / after shots of every model category in ONE browser session.
 * vite-node scripts/shots/m8-audit.ts <prefix> [filter-substring ...]   -> .weave/shots/<prefix>-<name>.png (staged, not committed)
 * Gallery shots use the debug model gallery (key B): 69 buildings in 9 rows of 8 (7.5 tiles apart), then 12 lift rows (4.6 apart). Terrain is flat-height under the gallery only roughly. */
import { BUILDINGS } from '../../src/config/buildings';
import { launch, shot, startServer, type ShotOpts } from '../lib/harness';

const prefix = process.argv[2] ?? 'm8-before';
const filters = process.argv.slice(3);
const HIDE_UI = "(()=>{const s=document.createElement('style');s.textContent='#ui,st-toast{display:none!important}';document.head.appendChild(s);})()";
const KEY_B = "window.dispatchEvent(new KeyboardEvent('keydown',{key:'b'}))";
/** Aim the iso camera at a point of the gallery (cx cols from the centre, rows) after toggling it on. */
const galleryAim = (col: number, z: number): string => `${KEY_B};(()=>{const s=__slope,a=s.terrainInfo.villageAnchor,g=s.renderer.scene.getObjectByName('model-gallery'),gr=s.grid,oy=gr.getCorner(a.x,a.y)*0.5+0.4;
const hh=(x,y)=>gr.getCorner(Math.max(0,Math.min(gr.size,Math.round(x))),Math.max(0,Math.min(gr.size,Math.round(y))))*0.5+0.4;
if(g&&!g.userData.lifted){g.userData.lifted=1;s.trees.group.visible=false;s.rocks.group.visible=false;for(const c of g.children)c.position.y+=hh(c.position.x,c.position.z)-oy;}
const y=hh(a.x+(${col}),a.y+(${z}));s.renderer.controls.target.set(a.x+(${col}),y,a.y+(${z}));})()`;
const SET: Array<ShotOpts & { out: string }> = [];
const nb = Object.keys(BUILDINGS).length, rows = Math.ceil(nb / 8);
for (let g = 0; g * 4 < nb; g++) {
  const idx = [g * 4, g * 4 + 1, g * 4 + 2, g * 4 + 3].filter((i) => i < nb), mean = (f: (i: number) => number): number => idx.reduce((t, i) => t + f(i), 0) / idx.length;
  const cx = mean((i) => ((i % 8) - 3.5) * 7.5), cz = mean((i) => -4 - Math.floor(i / 8) * 7.5);
  SET.push({ out: `bld-${String(g).padStart(2, '0')}`, size: 256, seed: 5, start: 'summer', hour: 12, zoom: 16, evalJs: galleryAim(cx, cz) });
}
// lifts: 12 rows 4.6 apart starting z0 = -4 - rows*7.5 - 2, x0 = -14 ; three shots of four rows
for (let k = 0; k < 3; k++) SET.push({ out: `lift-rows${k}`, size: 256, seed: 5, start: 'summer', hour: 12, zoom: 20, evalJs: galleryAim(-8, -4 - rows * 7.5 - 2 - (k * 4 + 1.5) * 4.6) });

const srv = await startServer(); const br = await launch(); let bad = 0;
try {
  const all = [...SET, ...(await import('./m8-audit-extra')).EXTRA];
  for (const s of all) {
    if (filters.length && !filters.some((f) => s.out.includes(f))) continue;
    const stat = "(async()=>{await new Promise(r=>setTimeout(r,2500));const i=__slope.renderer.webgl.info.render;console.log('[stats] '+i.calls+' calls '+i.triangles+' tris');})()";
    const r = await shot(br, srv.url, { w: 1600, h: 1000, ...s, evalJs: `${(s as { keepUi?: boolean }).keepUi ? '' : HIDE_UI};${s.evalJs ?? ''};${stat}`, out: `${prefix}-${s.out}` });
    for (const l of r.logs) if (l.includes('[stats]') || l.includes('[view]')) console.log('   ' + s.out + ' ' + l);
    const real = r.errors.filter((e) => !/GL Driver Message|beforeinstallprompt/.test(e));
    console.log(`${r.file}: ${real.length} errors`); bad += real.length;
  }
} finally { await br.close(); srv.stop(); }
process.exitCode = bad ? 2 : 0;
