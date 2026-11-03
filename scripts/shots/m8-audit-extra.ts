import type { ShotOpts } from '../lib/harness';
type S = ShotOpts & { out: string; keepUi?: boolean };
/** Guest lineup: rows = gear (walk, hike, bike, ski x2, sit, lie), columns = guest types 0-5, 10 (boarder), 12 (sledder), 2 (family: kids). Sim paused. */
const LINEUP = `(()=>{const s=__slope;s.loop.setSpeed(0);const st=s.guestSim.store,g=s.grid,b=s.buildings.all().find(q=>q.type==='baseLodge');
const rows=[[0,0],[0,1],[0,2],[0,5],[0,5],[5,0],[7,0]],cols=[0,1,2,3,4,5,10,12,2,2];
const x0=b.x+1,y0=b.y+b.h+3.5;
rows.forEach((r,ri)=>cols.forEach((t,ci)=>{const x=x0+ci*1.3,y=y0+ri*1.5;const z=g.getCorner(Math.round(x),Math.round(y))*0.5;
const sl=st.add({x,y,z,type:t,skill:1,budget:1,group:0,mode:0,overnight:false,leaveDay:99,tick:0});if(sl<0)return;st.state[sl]=r[0];st.moveMode[sl]=r[1];st.px[sl]=x-0.1;st.py[sl]=y;st.pz[sl]=z;}));
s.renderer.controls.target.set(x0+5.8,g.getCorner(Math.round(x0+6),Math.round(y0+4))*0.5,y0+4.5);})()`;
const DEMO = "__slope.populateDemo('medium'); __slope.spawnGuests(300,'mixed')";
const at = (type: string): string => `(()=>{const s=__slope,b=s.buildings.all().find(q=>q.type==='${type}');if(b){const g=s.buildingsView.get(b.id);s.renderer.controls.target.set(b.x+b.w/2,g?g.position.y:0,b.y+b.h/2);}})()`;
export const EXTRA: S[] = [
  // trees / rocks / bushes
  { out: 'trees-winter-close', start: 'winter', hour: 12, zoom: 8, target: '40,24' },
  { out: 'trees-summer-close', start: 'summer', hour: 12, zoom: 8, target: '40,24' },
  { out: 'trees-summer-mid', start: 'summer', hour: 12, zoom: 3, target: '40,24' },
  // guests (lineup, close)
  { out: 'guests-winter-lineup', start: 'winter', hour: 12, size: 64, seed: 61, zoom: 24, evalJs: LINEUP },
  { out: 'guests-summer-lineup', start: 'summer', hour: 12, size: 64, seed: 61, zoom: 24, evalJs: LINEUP },
  { out: 'guests-slope-iso', start: 'winter', hour: 12, size: 128, seed: 5, zoom: 6, pre: DEMO, ticks: 1500, freeze: true },
  { out: 'guests-ride-skier', start: 'winter', hour: 11, size: 128, seed: 5, pre: DEMO, ticks: 1500, view: 'ride', guest: 'auto', vticks: 30, freeze: true },
  { out: 'guests-ride-lift', start: 'winter', hour: 11, size: 128, seed: 5, pre: DEMO, ticks: 300, view: 'lift', freeze: true },
  // animals
  { out: 'animals-ibex', start: 'summer', hour: 12, size: 128, seed: 5, zoom: 14, evalJs: "__slope.findAnimal('ibex')" },
  { out: 'animals-chamois', start: 'summer', hour: 12, size: 128, seed: 5, zoom: 14, evalJs: "__slope.findAnimal('chamois')" },
  { out: 'animals-marmot', start: 'summer', hour: 12, size: 128, seed: 5, zoom: 14, evalJs: "__slope.findAnimal('marmot')" },
  { out: 'animals-fox', start: 'summer', hour: 12, size: 128, seed: 5, zoom: 14, evalJs: "__slope.findAnimal('fox')" },
  { out: 'animals-eagle', start: 'summer', hour: 12, size: 128, seed: 5, zoom: 14, evalJs: "__slope.findAnimal('eagle')" },
  { out: 'animals-sheep', start: 'summer', hour: 12, size: 128, seed: 5, zoom: 14, evalJs: "__slope.findAnimal('sheep')" },
  { out: 'animals-cow', start: 'summer', hour: 12, size: 128, seed: 5, zoom: 14, evalJs: "__slope.findAnimal('cow')" },
  { out: 'animals-goat', start: 'summer', hour: 12, size: 128, seed: 5, zoom: 14, evalJs: "__slope.findAnimal('goat')" },
  // vehicles / lifts / buildings in the real resort
  { out: 'vehicles-demo-lodge', start: 'winter', hour: 12, size: 128, seed: 5, zoom: 6, pre: DEMO, ticks: 900, evalJs: at('parking') },
  { out: 'vehicles-snowcat', start: 'winter', hour: 12, size: 128, seed: 5, zoom: 8, pre: DEMO, ticks: 600, evalJs: at('groomerGarage') },
  { out: 'vehicles-helipad', start: 'winter', hour: 12, size: 128, seed: 5, zoom: 8, pre: DEMO, ticks: 300, evalJs: at('helipad') },
  { out: 'vehicles-train', start: 'winter', hour: 12, size: 128, seed: 5, zoom: 8, pre: DEMO, ticks: 300, evalJs: at('trainStation') },
  { out: 'lifts-starter-close', start: 'winter', hour: 12, zoom: 5, target: 'lodge', extra: 'starter=1' },
  { out: 'lifts-starter-mid', start: 'winter', hour: 12, zoom: 2.5, target: 'lodge', extra: 'starter=1' },
  { out: 'resort-demo-winter-iso', start: 'winter', hour: 12, size: 128, seed: 5, zoom: 2.5, pre: DEMO, ticks: 1200, evalJs: at('baseLodge') },
  { out: 'resort-demo-summer-iso', start: 'summer', hour: 12, size: 128, seed: 5, zoom: 2.5, pre: DEMO, ticks: 1200, evalJs: at('baseLodge') },
  // terrain / water
  { out: 'terrain-winter-iso', start: 'winter', hour: 12, size: 128, seed: 5, zoom: 1.6 },
  { out: 'terrain-summer-iso', start: 'summer', hour: 12, size: 128, seed: 5, zoom: 1.6 },
  { out: 'terrain-256-far', start: 'winter', hour: 12, size: 256, seed: 7, zoom: 1.3 },
  { out: 'water-river-summer', start: 'summer', hour: 13, size: 128, seed: 5, zoom: 6, evalJs: "(async()=>{const s=__slope;const RP=await import('/src/world/RiverPlanner.ts');const best=(s.sim.rivers.natural).map(p=>({p,pl:RP.planRiver(s.sim.riverEnv(),p,null)})).filter(q=>q.pl.ok).sort((a,b)=>b.pl.path.length-a.pl.path.length)[0];if(best){s.riverDebug.dig(best.p.x,best.p.y);const m=best.pl.path[best.pl.path.length>>1];s.refreshProps(Array.from({length:s.grid.chunksPerRow**2},(_,i)=>i));s.renderer.controls.target.set(m.x,0,m.y);}console.log('[stats] river '+(best?best.pl.path.length:0));})()" },
  { out: 'water-river-winter-ice', start: 'winter', hour: 13, size: 128, seed: 5, zoom: 6, evalJs: "(async()=>{const s=__slope;const RP=await import('/src/world/RiverPlanner.ts');const best=(s.sim.rivers.natural).map(p=>({p,pl:RP.planRiver(s.sim.riverEnv(),p,null)})).filter(q=>q.pl.ok).sort((a,b)=>b.pl.path.length-a.pl.path.length)[0];if(best){s.riverDebug.dig(best.p.x,best.p.y);const m=best.pl.path[best.pl.path.length>>1];s.refreshProps(Array.from({length:s.grid.chunksPerRow**2},(_,i)=>i));s.renderer.controls.target.set(m.x,0,m.y);}console.log('[stats] river '+(best?best.pl.path.length:0));})()" },
  { out: 'snow-close-winter', start: 'winter', hour: 12, size: 128, seed: 5, zoom: 12, target: 'lodge' },
  // lighting phases + shadows
  { out: 'light-dawn', start: 'winter', hour: 7.3, zoom: 3, target: 'lodge' },
  { out: 'light-noon', start: 'winter', hour: 12, zoom: 3, target: 'lodge' },
  { out: 'light-dusk', start: 'winter', hour: 16.8, zoom: 3, target: 'lodge' },
  { out: 'light-night', start: 'winter', hour: 22, zoom: 3, target: 'lodge' },
  { out: 'light-lowsun-trees', start: 'summer', hour: 17, zoom: 8, target: '40,24' },
  { out: 'light-lowsun-lodge-close', start: 'summer', hour: 17, zoom: 10, target: 'lodge' },
  // icons / thumbnails (UI kept)
  { out: 'icons-buildings-drawer', keepUi: true, start: 'winter', hour: 12, steps: 'click:Buildings;wait:1500', w: 1600, h: 1000 },
  { out: 'icons-lifts-drawer', keepUi: true, start: 'winter', hour: 12, steps: 'click:Lifts;wait:1500', w: 1600, h: 1000 },
  // 1440p + phone iso defaults
  { out: 'hd-winter-noon', start: 'winter', hour: 12, zoom: 3, target: 'lodge', w: 2560, h: 1440, extra: 'starter=1' },
  { out: 'hd-summer-noon', start: 'summer', hour: 12, zoom: 3, target: 'lodge', w: 2560, h: 1440, extra: 'starter=1' },
  { out: 'hd-winter-dusk', start: 'winter', hour: 16.8, zoom: 3, target: 'lodge', w: 2560, h: 1440, extra: 'starter=1' },
  { out: 'hd-night', start: 'winter', hour: 22, zoom: 3, target: 'lodge', w: 2560, h: 1440, extra: 'starter=1' },
  { out: 'phone-winter-noon', keepUi: true, start: 'winter', hour: 12, zoom: 3, target: 'lodge', viewport: '390x844', touch: true, extra: 'starter=1' },
  { out: 'phone-summer-noon', keepUi: true, start: 'summer', hour: 12, zoom: 3, target: 'lodge', viewport: '390x844', touch: true, extra: 'starter=1' },
  { out: 'phone-night', keepUi: true, start: 'winter', hour: 22, zoom: 3, target: 'lodge', viewport: '390x844', touch: true, extra: 'starter=1' },
];
