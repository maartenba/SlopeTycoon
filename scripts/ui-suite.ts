/* UI screenshot suite (docs/visual-qa.md, section UI): npm run ui:suite [-- filter]  -> .weave/shots/ui-s-*.png + overlap report per shot. */
import { launch, shot, startServer, type ShotOpts } from './lib/harness';

const B = (id: string): string => `click:button[data-drawer=${id}]`;
const V1280 = '1280x800', V1920 = '1920x1080', V1000 = '1000x700';
/** Clicks 'Skip step' (or Next) n times so the tutorial assistant shows later steps. */
function skip(n: number): string {
  return `(async()=>{const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<${n};i++){const a=document.querySelector('st-assistant');const bs=[...a.shadowRoot.querySelectorAll('button')].filter(b=>!b.hidden&&/Skip step|Next/.test(b.textContent));if(bs[0])bs[0].click();await sleep(400);}})()`;
}
const base: ShotOpts = { start: 'summer', hour: 12, zoom: 2, target: 'lodge', extra: 'starter=1', overlap: true };
const RIDE_PRE = "__slope.populateDemo('medium'); __slope.spawnGuests(300,'skiers')";
export const SET: Array<ShotOpts & { out: string }> = [
  { ...base, out: 'ui-s-menu', bare: true, viewport: V1280, extra: undefined },
  { ...base, out: 'ui-s-hud-1280', viewport: V1280 },
  { ...base, out: 'ui-s-hud-1920', viewport: V1920 },
  { ...base, out: 'ui-s-hud-1000', viewport: V1000 },
  { ...base, out: 'ui-s-buildings', viewport: V1280, steps: B('buildings') },
  { ...base, out: 'ui-s-lifts', viewport: V1280, steps: B('lifts') },
  { ...base, out: 'ui-s-paths', viewport: V1280, steps: B('paths') },
  { ...base, out: 'ui-s-pistes', viewport: V1280, steps: B('pistes') },
  { ...base, out: 'ui-s-terrain', viewport: V1280, steps: B('terrain') },
  { ...base, out: 'ui-s-view', viewport: V1280, steps: B('view') },
  { ...base, out: 'ui-s-finance', viewport: V1280, steps: B('finance') },
  { ...base, out: 'ui-s-ops', viewport: V1280, steps: B('ops') },
  { ...base, out: 'ui-s-marketing', viewport: V1280, steps: B('marketing') },
  { ...base, out: 'ui-s-pricing', viewport: V1280, steps: B('pricing') },
  { ...base, out: 'ui-s-all-open', viewport: V1280, steps: `${B('buildings')};key:F3;click:News`, extra: 'starter=1&tutorial=1' },
  { ...base, out: 'ui-s-all-open-1920', viewport: V1920, steps: `${B('buildings')};key:F3;click:News`, extra: 'starter=1&tutorial=1' },
  { ...base, out: 'ui-s-drawer-pop-1280', viewport: V1280, steps: `${B('buildings')};move:615,640;wait:500` },
  { ...base, out: 'ui-s-drawer-lifts-pop-1280', viewport: V1280, steps: `${B('lifts')};wheel:600;wait:400;move:930,640;wait:500` },
  { ...base, out: 'ui-s-drawer-tab-1000', viewport: V1000, steps: `${B('buildings')};click:Recreation;move:500,550;wait:500` },
  { ...base, out: 'ui-s-drawer-lifts-1920', viewport: V1920, steps: `${B('lifts')};move:1100,880;wait:500` },
  { ...base, out: 'ui-s-drawer-all-1280', viewport: V1280, steps: `${B('buildings')};key:F3;click:News;move:700,640;wait:500`, extra: 'starter=1&tutorial=1' },
  { ...base, out: 'ui-s-drawer-all-1000', viewport: V1000, steps: `${B('lifts')};key:F3;click:News;wait:500`, extra: 'starter=1&tutorial=1' },
  { ...base, out: 'ui-s-drawer-pistes-1000', viewport: V1000, steps: B('pistes') },
  { ...base, out: 'ui-s-drawer-terrain-1000', viewport: V1000, steps: B('terrain') },
  { ...base, out: 'ui-s-drawer-finance-1000', viewport: V1000, steps: B('finance') },
  { ...base, out: 'ui-s-newgame', viewport: V1280, steps: 'click:Back to the main menu;wait:600;click:New game;wait:800' },
  { ...base, out: 'ui-s-settings', viewport: V1280, steps: 'click:Sound & settings;wait:400' },
  { ...base, out: 'ui-s-news-reviews-1280', viewport: V1280, evalJs: `(()=>{const n=document.querySelector('st-news');const t=['Quiet slopes and a friendly lift crew.','The queue at the gondola was long today.','Hot chocolate at the lodge hit the spot.'];t.forEach((x,i)=>n.addReview({guestId:i+1,stars:[4,2,5][i],text:x,tone:'plain',driver:'general'}));})()`, steps: 'click:News;wait:300;click:Reviews;wait:400' },
  { ...base, out: 'ui-s-settings-1920', viewport: V1920, steps: 'click:Sound & settings;wait:400' },
  { ...base, out: 'ui-s-help', viewport: V1280, steps: 'click:Keyboard shortcuts' },
  { ...base, out: 'ui-s-saveload', viewport: V1280, steps: 'click:Save game (Ctrl;wait:500' },
  { ...base, out: 'ui-s-pause', viewport: V1280, steps: 'key:Escape' },
  { ...base, out: 'ui-s-building-info', viewport: V1280, steps: 'mouse:640,420' },
  // ground-level HUD + photo panel (M5.2)
  { ...base, out: 'ui-s-ride-hud-1280', viewport: V1280, size: 128, start: 'winter', hour: 11, extra: undefined, pre: RIDE_PRE, ticks: 600, view: 'ride', guest: 'auto', freeze: true },
  { ...base, out: 'ui-s-ride-hud-1920', viewport: V1920, size: 128, start: 'winter', hour: 11, extra: undefined, pre: RIDE_PRE, ticks: 600, view: 'ride', guest: 'auto', freeze: true },
  { ...base, out: 'ui-s-photo-panel-1280', viewport: V1280, size: 128, start: 'winter', hour: 11, extra: undefined, pre: RIDE_PRE, ticks: 600, view: 'photo', photoHero: true, freeze: true },
  { ...base, out: 'ui-s-photo-panel-1920', viewport: V1920, size: 128, start: 'winter', hour: 11, extra: undefined, pre: RIDE_PRE, ticks: 600, view: 'photo', photoHero: true, freeze: true },
  { ...base, out: 'ui-s-tut-1', viewport: V1280, extra: 'tutorial=1' },
  { ...base, out: 'ui-s-tut-4', viewport: V1280, extra: 'tutorial=1', evalJs: skip(3) },
  { ...base, out: 'ui-s-tut-5', viewport: V1280, extra: 'tutorial=1', evalJs: skip(4) },
  { ...base, out: 'ui-s-tut-10', viewport: V1280, extra: 'tutorial=1', evalJs: skip(9) },
  { ...base, out: 'ui-s-tut-narrow', viewport: '445x1006', extra: 'tutorial=1', steps: 'wait:800;click:Tutorial help;wait:500' },
  { ...base, out: 'ui-s-tut-9', viewport: V1280, extra: 'tutorial=1', evalJs: skip(8) },
  { ...base, out: 'ui-s-tut-14', viewport: V1280, extra: 'tutorial=1', evalJs: skip(13) },
  { ...base, out: 'ui-s-tut-20', viewport: V1280, extra: 'tutorial=1', evalJs: skip(19) },
  { ...base, out: 'ui-s-spot-1', viewport: V1280, extra: 'tutorial=1', steps: 'click:Show me;wait:800' },
  { ...base, out: 'ui-s-spot-5', viewport: V1280, extra: 'tutorial=1', evalJs: skip(3), steps: 'click:Show me;wait:800' },
  { ...base, out: 'ui-s-spot-10', viewport: V1280, extra: 'tutorial=1', evalJs: skip(8), steps: 'click:Show me;wait:800' },
  { ...base, out: 'ui-s-spot-14', viewport: V1280, extra: 'tutorial=1', evalJs: skip(13), steps: 'click:Show me;wait:800' },
  { ...base, out: 'ui-s-spot-20', viewport: V1280, extra: 'tutorial=1', evalJs: skip(19), steps: 'click:Show me;wait:800' },
  { ...base, out: 'ui-s-tut-1920', viewport: V1920, extra: 'tutorial=1', evalJs: skip(8) },
  // M5.3: Career HUD / goals card + level panel / level-up, year report, trophies, scenarios, new game tabs, settings, pause (3 viewports)
  ...([['1280', V1280], ['1920', V1920], ['1000', V1000]] as const).flatMap(([n, vp]): Array<ShotOpts & { out: string }> => [
    { ...base, out: `ui-m53-career-hud-${n}`, viewport: vp, extra: 'starter=1&mode=career' },
    { ...base, out: `ui-m53-levelup-${n}`, viewport: vp, extra: 'starter=1&mode=career', evalJs: 'setTimeout(()=>window.__slope.progression.setLevel(4),200)', steps: 'wait:1500' },
    { ...base, out: `ui-m53-levelpanel-${n}`, viewport: vp, extra: 'starter=1&mode=career', steps: 'click:Level;wait:400' },
    { ...base, out: `ui-m53-buildings-career-${n}`, viewport: vp, extra: 'starter=1&mode=career', steps: B('buildings') },
    { ...base, out: `ui-m53-lifts-career-${n}`, viewport: vp, extra: 'starter=1&mode=career', steps: B('lifts') },
    { ...base, out: `ui-m53-year-${n}`, viewport: vp, extra: 'starter=1', evalJs: 'window.__slope.stats.demoYear(); window.__slope.yearReport.show(undefined,false)', steps: 'wait:1200' },
    { ...base, out: `ui-m53-menu-${n}`, bare: true, viewport: vp, extra: undefined },
    { ...base, out: `ui-m53-trophies-${n}`, bare: true, viewport: vp, extra: undefined, steps: 'click:Trophies;wait:700' },
    { ...base, out: `ui-m53-scenarios-${n}`, bare: true, viewport: vp, extra: undefined, steps: 'click:Scenarios;wait:700' },
    { ...base, out: `ui-m53-newgame-${n}`, bare: true, viewport: vp, extra: undefined, steps: 'click:New game;wait:800' },
    { ...base, out: `ui-m53-scencard-${n}`, viewport: vp, extra: 'scenario=first-tracks' },
    { ...base, out: `ui-m53-scenresult-${n}`, viewport: vp, extra: 'scenario=first-tracks', evalJs: 'setTimeout(()=>window.__slope.scenario.forceResult("won"),200)', steps: 'wait:1500' },
    { ...base, out: `ui-m53-settings-${n}`, viewport: vp, extra: 'starter=1&mode=career', steps: 'click:Sound & settings;wait:500' },
    { ...base, out: `ui-m53-pause-${n}`, viewport: vp, extra: 'starter=1&mode=career', steps: 'key:Escape;wait:400' },
  ]),
];
const only = process.argv[2];
const srv = await startServer();
const br = await launch();
let bad = 0;
try {
  for (const s of SET.filter((x) => !only || x.out.includes(only))) {
    const r = await shot(br, srv.url, s);
    const real = r.errors.filter((e) => !/GL Driver Message|beforeinstallprompt/.test(e));
    console.log(`${r.file}: ${real.length} errors ${r.logs.filter((l) => /^\[(overlap|harness)\]/.test(l)).join(' ; ')}`);
    for (const e of new Set(real)) console.log('   ' + e.slice(0, 300));
    bad += real.length;
  }
} finally { await br.close(); srv.stop(); }
process.exitCode = bad ? 2 : 0;
