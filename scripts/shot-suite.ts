/* Screenshot suite (see docs/visual-qa.md): npm run shot:suite  -> .weave/shots/suite-*.png, prints deduped console errors per shot. */
import { launch, shot, startServer, type ShotOpts } from './lib/harness';

/** Clicks 'Skip step' (or Next) n times so the tutorial assistant shows later steps with different text lengths. */
function skip(n: number): string {
  return `(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<${n};i++){const a=document.querySelector('st-assistant');const bs=[...a.shadowRoot.querySelectorAll('button')].filter(b=>!b.hidden&&/Skip step|Next/.test(b.textContent));if(bs[0])bs[0].click();await sleep(400);}})()`;
}

const RIDE_PRE = "__slope.populateDemo('medium'); __slope.spawnGuests(300,'skiers')";

const SET: Array<ShotOpts & { out: string }> = [
  { out: 'suite-boot-summer', start: 'summer', hour: 12 },
  { out: 'suite-village-summer-noon', start: 'summer', hour: 12, zoom: 3, target: 'lodge' },
  { out: 'suite-village-winter-noon', start: 'winter', hour: 12, zoom: 3, target: 'lodge' },
  { out: 'suite-night', start: 'winter', hour: 22, zoom: 3, target: 'lodge' },
  { out: 'suite-lodge-close', start: 'summer', hour: 12, zoom: 8, target: 'lodge' },
  { out: 'suite-far', start: 'summer', hour: 12, zoom: 1, size: 128 },
  { out: 'suite-gallery', start: 'summer', hour: 12, zoom: 2, evalJs: "window.dispatchEvent(new KeyboardEvent('keydown',{key:'b'}))" },
  { out: 'suite-lifts', start: 'winter', hour: 12, zoom: 2.5, target: 'lodge', extra: 'starter=1' },
  { out: 'suite-hud-1280', start: 'winter', hour: 12, w: 1280, h: 800 },
  { out: 'suite-hud-1920', start: 'winter', hour: 12, w: 1920, h: 1080 },
  // ground-level views (M5.2): ride-along (skier / chairlift) and photo mode
  { out: 'suite-ride-ski', start: 'winter', hour: 11, size: 128, pre: RIDE_PRE, ticks: 1500, view: 'ride', guest: 'auto', vticks: 30, freeze: true },
  { out: 'suite-ride-lift', start: 'winter', hour: 11, size: 128, pre: RIDE_PRE, ticks: 300, view: 'lift', freeze: true },
  { out: 'suite-photo-hero', start: 'winter', hour: 11, size: 128, pre: RIDE_PRE, ticks: 600, view: 'photo', photoHero: true, freeze: true },
  { out: 'suite-photo-dusk-film', start: 'winter', hour: 11, size: 128, pre: RIDE_PRE, ticks: 600, view: 'photo', photoHero: true, photoFilter: 'vivid', photoFrame: 'film', photoHour: 17.4, freeze: true },
  { out: 'suite-assistant-1', start: 'winter', hour: 12, w: 1280, h: 800, extra: 'tutorial=1' },
  { out: 'suite-assistant-4', start: 'winter', hour: 12, w: 1280, h: 800, extra: 'tutorial=1', evalJs: skip(3) },
  { out: 'suite-assistant-9', start: 'winter', hour: 12, w: 1280, h: 800, extra: 'tutorial=1', evalJs: skip(8) },
];

const srv = await startServer();
const br = await launch();
let bad = 0;
try {
  for (const s of SET) {
    const r = await shot(br, srv.url, s);
    const real = r.errors.filter((e) => !/GL Driver Message|beforeinstallprompt/.test(e));
    console.log(`${r.file}: ${real.length} errors`);
    for (const e of new Set(real)) console.log('   ' + e.slice(0, 600));
    bad += real.length;
  }
} finally { await br.close(); srv.stop(); }
process.exitCode = bad ? 2 : 0;
