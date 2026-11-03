/* M8 lane A: close-ups of individual gallery buildings (same gallery aim as m8-audit.ts). vite-node scripts/shots/m8-closeup-a.ts <prefix> <id[:zoom]> ... */
import { BUILDINGS } from '../../src/config/buildings';
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-a-close';
const HIDE_UI = "(()=>{const s=document.createElement('style');s.textContent='#ui,st-toast{display:none!important}';document.head.appendChild(s);})()";
const KEY_B = "window.dispatchEvent(new KeyboardEvent('keydown',{key:'b'}))";
const galleryAim = (col: number, z: number): string => `${KEY_B};(()=>{const s=__slope,a=s.terrainInfo.villageAnchor,g=s.renderer.scene.getObjectByName('model-gallery'),gr=s.grid,oy=gr.getCorner(a.x,a.y)*0.5+0.4;
const hh=(x,y)=>gr.getCorner(Math.max(0,Math.min(gr.size,Math.round(x))),Math.max(0,Math.min(gr.size,Math.round(y))))*0.5+0.4;
if(g&&!g.userData.lifted){g.userData.lifted=1;s.trees.group.visible=false;s.rocks.group.visible=false;for(const c of g.children)c.position.y+=hh(c.position.x,c.position.z)-oy;}
const y=hh(a.x+(${col}),a.y+(${z}));s.renderer.controls.target.set(a.x+(${col}),y,a.y+(${z}));})()`;

const ids = Object.keys(BUILDINGS);
const srv = await startServer(); const br = await launch();
try {
  for (const arg of process.argv.slice(3)) {
    const [id, z] = arg.split(':'); const i = ids.indexOf(id!); if (i < 0) { console.log('unknown', id); continue; }
    const r = await shot(br, srv.url, { w: 1200, h: 800, size: 256, seed: 5, start: 'summer', hour: 12, zoom: Number(z ?? 9), evalJs: `${HIDE_UI};${galleryAim(((i % 8) - 3.5) * 7.5, -4 - Math.floor(i / 8) * 7.5)}`, out: `${prefix}-${id}` });
    console.log(r.file, r.errors.filter((e) => !/GL Driver|beforeinstallprompt/.test(e)).length);
  }
} finally { await br.close(); srv.stop(); }
