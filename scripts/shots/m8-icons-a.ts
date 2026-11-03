/* M8 lane A: icon sheet. vite-node scripts/shots/m8-icons-a.ts <prefix> [lift|building ids...]
 * Renders the real Thumbnails (same class as the dock) for every lift (default) or the listed buildings into a fixed overlay and shoots it (no idle-prewarm wait). */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-a-icons';
const ids = process.argv.slice(3);
const js = `(async()=>{const {Thumbnails}=await import('/src/render/thumbnails/Thumbnails.ts');const {LIFTS}=await import('/src/config/lifts.ts');
const t=new Thumbnails(__slope.buildingMeshes);const ids=${JSON.stringify(ids)};const kind=ids.length?'building':'lift';const list=ids.length?ids:Object.keys(LIFTS);
const d=document.createElement('div');d.style.cssText='position:fixed;inset:0;z-index:99999;background:#46586a;display:flex;flex-wrap:wrap;gap:6px;padding:8px;align-content:flex-start';document.body.appendChild(d);
for(const id of list){const w=document.createElement('div');w.style.cssText='color:#fff;font:12px sans-serif;text-align:center';for(const s of [160,48]){const i=document.createElement('img');i.src=t.get(kind,id,s)||'';i.style.cssText='display:block;margin:2px auto;background:#2b3a49';w.appendChild(i)}w.appendChild(document.createTextNode(id));d.appendChild(w)}
console.log('[icons] done');})()`;
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { w: 1600, h: 1000, size: 64, seed: 5, start: 'winter', hour: 12, evalJs: js, steps: 'wait:4000', out: `${prefix}` });
  console.log(r.file, r.errors.filter((e) => !/GL Driver/.test(e)));
} finally { await br.close(); srv.stop(); }
