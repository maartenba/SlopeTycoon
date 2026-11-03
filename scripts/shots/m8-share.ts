/* M8 triangle share per category in an iso frame (docs/graphics-audit.md): hides one layer at a time and diffs renderer.info.render.triangles / calls. vite-node scripts/shots/m8-share.ts */
import { launch, shot, startServer } from '../lib/harness';
const JS = (zoom: number): string => `(async()=>{const s=__slope,r=s.renderer;const sleep=(ms)=>new Promise(x=>setTimeout(x,ms));s.spawnGuests(300,'skiers');s.loop.setSpeed(1);r.controls.zoom=1;r.controls.zoomBy(${zoom});await sleep(3500);
const frame=()=>{r.onFrame(1/60);r.webgl.render(r.scene,r.camera);const i=r.webgl.info.render;return [i.triangles,i.calls];};
for(let i=0;i<4;i++)frame();const base=frame();
const layers={trees:s.trees&&s.trees.group,rocks:s.rocks&&s.rocks.group,terrain:s.terrain&&s.terrain.group,buildings:s.buildingsView&&s.buildingsView.group,guests:s.guestRenderer&&s.guestRenderer.group,water:s.water&&s.water.group};
const out={total:base};for(const [k,g] of Object.entries(layers)){if(!g){out[k]='n/a';continue;}g.visible=false;for(let i=0;i<2;i++)frame();const f=frame();g.visible=true;out[k]=[base[0]-f[0],base[1]-f[1]];}
console.log('[share] '+JSON.stringify(out));})()`;
const srv = await startServer(); const br = await launch();
try {
  for (const [size, seed, zoom, q] of [[128, 5, 3, 'med'], [128, 5, 1.5, 'med'], [256, 7, 3, 'med']] as const) {
    const r = await shot(br, srv.url, { size, seed, start: 'winter', hour: 11, w: 1280, h: 800, out: `m8-share-${size}-${zoom}`, pre: "__slope.populateDemo('medium')", ticks: 1200, target: 'lodge', zoom, evalJs: `__slope.view.setQuality('${q}');${JS(zoom)}` });
    console.log(`${size} zoom ${zoom} ${q}:`, r.logs.find((l) => l.includes('[share]'))?.replace(/.*\[share\] /, '') ?? 'n/a');
  }
} finally { await br.close(); srv.stop(); }
