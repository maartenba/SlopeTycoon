/* Contact sheet of the town shots: npm run town:sheet -- --tag b1 --shot wide --out docs/img/towns-sheet.png (then npm run docs:img) [--cols 2] [--cell 640] */
import { readFileSync, existsSync } from 'node:fs';
import { launch } from './lib/harness';
import { TOWNS } from '../src/game/demoTowns';

const a: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i]!.startsWith('--')) a[process.argv[i]!.slice(2)] = process.argv[i + 1] ?? '1';
const tag = a.tag ?? 'b1', shot = a.shot ?? 'wide', out = a.out ?? '.weave/shots/towns-sheet.png';
const cols = Number(a.cols ?? 2), cell = Number(a.cell ?? 640), ch = Math.round(cell * 0.625);
const items = TOWNS.map((t) => ({ t, f: `.weave/shots/towns-${tag}-${t.id}-${shot}.png` })).filter((i) => existsSync(i.f));
const rows = Math.ceil(items.length / cols);
const html = `<body style="margin:0;background:#10161f;font:600 14px system-ui;color:#fff"><div style="display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:4px">${items.map((i) => `<div style="position:relative;width:${cell}px;height:${ch}px"><img src="data:image/png;base64,${readFileSync(i.f).toString('base64')}" style="width:${cell}px;height:${ch}px;object-fit:cover"><span style="position:absolute;left:8px;top:6px;background:rgba(0,0,0,.55);padding:2px 8px;border-radius:6px">${i.t.name}</span></div>`).join('')}</div></body>`;
const br = await launch();
try {
  const page = await br.newPage();
  await page.setViewport({ width: cols * cell + (cols - 1) * 4, height: rows * ch + (rows - 1) * 4, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: out });
  console.log('saved', out);
} finally { await br.close(); }
