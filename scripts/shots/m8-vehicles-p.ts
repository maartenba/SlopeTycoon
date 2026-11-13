/* Vehicle look pass: a car park row (8 styles + hash looks) and a mixed-traffic row (cars, minibus, coach) via the real createVehicleMesh. vite-node scripts/shots/m8-vehicles-p.ts <prefix> [zoom] [winter 0|1] [hour] [low 0|1] [yaw] */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-p-veh';
const zoom = Number(process.argv[3] ?? 20), winter = process.argv[4] === '1', hour = Number(process.argv[5] ?? 12), low = process.argv[6] === '1', yaw = Number(process.argv[7] ?? 0.5);
const JS = `(async()=>{
  const M=await import('/src/render/meshes/Vehicles.ts');
  const s=__slope,a0=s.terrainInfo.villageAnchor,a={x:a0.x,y:a0.y+16},gr=s.grid;
  s.trees.group.visible=false;s.rocks.group.visible=false;
  M.setVehicleSnow(${winter ? 1 : 0});
  const hh=(x,y)=>gr.getCorner(Math.round(x),Math.round(y))*0.5+0.05;
  const Group=s.trees.group.constructor,root=new Group();root.name='veh-p';
  const put=(m,x,z,rot,sc=1.2)=>{m.group.position.set(a.x+x,hh(a.x+x,a.y+z),a.y+z);m.group.rotation.y=rot;m.group.scale.setScalar(sc);root.add(m.group);};
  for(let i=0;i<8;i++){const id=[11,23,37,52,7,64,80,95][i];const m=M.createVehicleMesh(0,id,${winter},i===4,${low});put(m,-5+i*1.5,-2.4,0.8);}
  for(let i=0;i<8;i++){const m=M.createVehicleMesh(0,100+i*7,${winter},false,${low});put(m,-5+i*1.5,-0.6,0.8);}
  put(M.createVehicleMesh(1,3,${winter},false,${low}),-3.5,2.0,0.8,1.2);put(M.createVehicleMesh(1,1,${winter},false,${low}),0,2.2,0.8,1.2);put(M.createVehicleMesh(0,205,${winter},false,${low}),3,2.0,0.8);put(M.createVehicleMesh(0,311,${winter},false,${low}),4.4,2.0,0.8);
  s.renderer.scene.add(root);
  s.renderer.controls.target.set(a.x+0.5,hh(a.x,a.y)+0.3,a.y);
  setTimeout(()=>console.log('[stats] MaterialGuard problems '+s.materialGuard.check()),2500);
})()`;
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { w: 1600, h: 1000, size: 128, seed: 5, start: winter ? 'winter' : 'summer', hour, zoom, yaw, evalJs: JS, out: prefix });
  for (const l of r.logs) if (l.includes('[stats]')) console.log(l);
  console.log(r.file, r.errors.filter((e) => !/GL Driver|beforeinstallprompt/.test(e)));
} finally { await br.close(); srv.stop(); }
