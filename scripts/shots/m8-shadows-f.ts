/* M8 lane F: sun-shadow receiving + perspective-view shadows shots. vite-node scripts/shots/m8-shadows-f.ts <prefix> <iso|ride|walk|photo|all> [low|med|high] [summer|winter]
 * Sets the quality live, waits for the shadow pass, prints the rig stats + MaterialGuard summary. New --out per run (the image reader caches by path). */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-f';
const which = process.argv[3] ?? 'all';
const q = process.argv[4] ?? 'high';
const season = process.argv[5] ?? 'summer';
const HIDE = "(()=>{const s=document.createElement('style');s.textContent='#ui,st-toast{display:none!important}';document.head.appendChild(s);})()";
const SET = (extra = ''): string => `(async()=>{const s=__slope,r=s.renderer;s.view.setQuality('${q}');${extra}await new Promise(x=>setTimeout(x,3500));if(r.shadows.rt){const rt=r.shadows.rt,n=rt.width,buf=new Uint8Array(n*n);r.webgl.readRenderTargetPixels(rt,0,0,n,n,buf);const rows=[];for(let y=0;y<n;y+=64){let t='';for(let x=0;x<n;x+=32){let c=0;for(let j=0;j<64;j+=8)for(let i=0;i<32;i+=8)if(buf[(y+j)*n+x+i]>0)c++;t+=c>6?'#':c>2?'+':c>0?'.':' ';}rows.push(t);}console.info('[shadows] MAP|'+rows.join('|'));}console.info('[shadows] enabled='+r.shadows.enabled+' '+JSON.stringify(r.shadows.stats)+' calls='+r.webgl.info.render.calls+' tris='+r.webgl.info.render.triangles+' P='+JSON.stringify(r.shadows.uniforms.uShadowP.value.toArray())+' cam='+JSON.stringify(r.camera.position.toArray().map(v=>+v.toFixed(1)))+' M='+(()=>{const m=r.shadows.uniforms.uShadowM.value;const out=[];for(const [x,y,z] of [[32,4,54],[28,4.5,50.7],[32,12,54]]){const v=new (m.constructor===Object?Object:r.camera.position.constructor)(x,y,z).applyMatrix4(m);out.push(v.toArray().map(q=>+q.toFixed(3)))}return JSON.stringify(out)})()+' covered='+(()=>{try{const rt=r.shadows.rt,n=rt.width,buf=new Uint8Array(n*n);r.webgl.readRenderTargetPixels(rt,0,0,n,n,buf);let c=0;for(let i=0;i<buf.length;i++)if(buf[i]>0)c++;return (c/buf.length*100).toFixed(2)+'%'}catch(e){return 'err '+e}})()+' guard='+(s.materialGuard.check(),s.materialGuard.summary()));})()`;
const common = { w: 1400, h: 900, size: 64, seed: 61, start: season } as const;
const srv = await startServer(); const br = await launch();
const run = async (name: string, o: Record<string, unknown>): Promise<void> => {
  const r = await shot(br, srv.url, { ...common, ...o, out: `${prefix}-${name}-${q}` } as never);
  for (const l of r.logs.filter((x) => /\[shadows\]|Render problems|Shader error/.test(x))) console.log(l);
  console.log(r.file, r.errors.filter((e) => !/GL Driver|beforeinstallprompt/.test(e)).length, 'errors');
};
try {
  if (which === 'iso' || which === 'all') {
    await run('iso17', { hour: 17, zoom: 1.6, target: 'lodge', yaw: 2.2, evalJs: `${HIDE};${SET()}` });
    await run('iso-lodge-close', { hour: 17.5, zoom: 4.5, target: 'lodge', yaw: 2.2, evalJs: `${HIDE};${SET()}` });
  }
  // ground cameras on the sun side of the lodge (anchor 32,54 on 64 / seed 61), sun 16:00 comes from (+0.75, +0.66): shadows fall toward the camera
  const waitVjs = `(async()=>{await new Promise(x=>setTimeout(x,0));})()`;
  const vjs = SET();
  if (which === 'demo' || which === 'all') {
    // a populated demo resort (lifts, guests, buildings): iso at 17:00 rotated, a lift ride, and a photo from the ride
    const demo = { size: 128, seed: 5, pre: "__slope.populateDemo('medium')", ticks: 900, w: 1400, h: 900 };
    await run('demo-iso17', { ...demo, hour: 17, zoom: 2.2, target: 'lodge', yaw: 2.2, evalJs: `${HIDE};${SET()}` });
    await run('demo-ride', { ...demo, hour: 17, view: 'ride', guest: 'auto', vjs: SET() });
    await run('demo-photo', { ...demo, hour: 17, view: 'photo', photoFrom: 'ride', photoHero: true, vjs: SET() });
  }
  if (which === 'walk' || which === 'all') await run('walk', { hour: 17.5, view: 'walk', walkAt: '25.2,49.7', walkYaw: 237.7, walkPitch: -9, walkScript: 'w:0.01', vjs });
  if (which === 'walk' || which === 'all') await run('walk-far', { hour: 17.5, view: 'walk', walkAt: '27.2,61.6', walkYaw: 327.7, walkPitch: -8, walkScript: 'w:0.01', vjs });
  if (which === 'photo' || which === 'all') await run('photo', { hour: 17.5, view: 'photo', photoFrom: 'walk', walkAt: '27.6,50.2', walkYaw: 228.6, photoHero: true, photoSave: true, vjs });
  void waitVjs;
} finally { await br.close(); srv.stop(); }
