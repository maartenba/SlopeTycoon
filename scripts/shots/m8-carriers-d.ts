/* M8 lane D: carrier close-ups on a perspective test page (scripts/shots/carriers-d.html: the real carrier meshes + materials, plain hemisphere / sun light).
 * vite-node scripts/shots/m8-carriers-d.ts <out> <old|new> <kinds,..> [az=0.6] [el=0.25] [dist=3.2] [near] */
import { launch, startServer } from '../lib/harness';
const [out = 'm8-after-d-car', which = 'new', kinds = 'chair6b', az = '0.6', el = '0.25', dist = '3.2', near = ''] = process.argv.slice(2);
const srv = await startServer(); const br = await launch();
try {
  const page = await br.newPage(); await page.setViewport({ width: 1200, height: 640 });
  const errs: string[] = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`${srv.url}scripts/shots/carriers-d.html?kinds=${kinds}&old=${which === 'old' ? 1 : 0}&near=${near ? 1 : 0}&az=${az}&el=${el}&dist=${dist}${process.env.FIGS ? `&figs=${process.env.FIGS}` : ''}`);
  await page.waitForFunction('window.__done===true', { timeout: 60000 });
  await page.screenshot({ path: `.weave/shots/${out}.png` });
  console.log(out, errs.filter((e) => !/GL Driver/.test(e)));
} finally { await br.close(); srv.stop(); }
