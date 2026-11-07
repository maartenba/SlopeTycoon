/* eslint-disable @typescript-eslint/no-explicit-any -- runs inside the page against the untyped __slope debug handle */
/** `npm run visitor:studio [-- --tag NAME]`: the rare-visitor model rendered alone on a plain background (3/4 front, side, back, wave, idle) with the real vertex colours and a sun + sky light.
 * Writes .weave/shots/<tag>-studio.png (new --tag every time). Dev aid for the contact sheet. */
import { launch, startServer } from './lib/harness';
import fs from 'node:fs';
const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
const tag = arg('tag', 'visitor-models-studio');
const srv = await startServer(), br = await launch();
try {
  const page = await br.newPage(); await page.setViewport({ width: 800, height: 600 });
  await page.goto(`${srv.url}?size=64&seed=61&start=winter&hints=0&starter=1&mode=career`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!(window as any).__slope, { timeout: 90000 });
  const rows: string[][] = await page.evaluate(async () => {
    const s = (window as any).__slope, T = s.THREE, imp = (u: string): Promise<any> => (new Function('u', 'return import(u)') as any)(u);
    const M = await imp('/src/render/meshes/rareVisitor.ts');
    const W = 360, H = 400, r = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(W, H); r.setClearColor(0xcfe0ee);
    const out: string[][] = [];
    for (const _m of [0]) {
      void _m; const set = M.createPoseSet(), row: string[] = [];
      const views: Array<[string, number, number, number]> = [['walk', 2, 0.6, 1], ['walk', 0, -1.57, 1], ['walk', 6, 2.6, 1], ['wave', 2, 0.35, 1], ['idle', 0, 0.2, 1], ['walk', 4, 0.7, 0]];
      for (const [kind, frame, yaw, look] of views) {
        const sc = new T.Scene(), mat = new T.MeshLambertMaterial({ vertexColors: true });
        const mesh = new T.Mesh(set.get(kind, frame, kind === 'idle' ? 1 : 0), mat); mesh.rotation.y = yaw; sc.add(mesh);
        const gnd = new T.Mesh(new T.CircleGeometry(1.2, 24).rotateX(-Math.PI / 2), new T.MeshLambertMaterial({ color: 0xf1f6fb })); sc.add(gnd);
        sc.add(new T.HemisphereLight(0xdfeaff, 0x9aa8b8, 1.5)); const d = new T.DirectionalLight(0xfff2dd, 1.7); d.position.set(2, 3, 2.5); sc.add(d);
        const cam = new T.PerspectiveCamera(28, W / H, 0.1, 20); cam.position.set(0, 0.95, 3.4); cam.lookAt(0, 0.52, 0);
        r.render(sc, cam); row.push(r.domElement.toDataURL('image/png')); void look;
      }
      out.push(row);
    }
    return out;
  });
  const html = rows.map((row) => `<div class=r>${row.map((d) => `<img src="${d}">`).join('')}</div>`).join('');
  const sp = await br.newPage(); await sp.setViewport({ width: 2200, height: 1250 });
  await sp.setContent(`<style>body{margin:0;background:#222}.r{display:flex;gap:4px;margin:4px}</style>${html}`);
  await sp.screenshot({ path: `.weave/shots/${tag}-studio.png`, fullPage: true });
  fs.writeFileSync('/dev/null', '');
  console.log('saved', `.weave/shots/${tag}-studio.png`);
} finally { await br.close(); srv.stop(); }
