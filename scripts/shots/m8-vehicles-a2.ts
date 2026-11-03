/* M8 lane A2: vehicle line-up (5 cars, minibus, bus, train, plane, helicopter) on the village meadow, hiding trees. vite-node scripts/shots/m8-vehicles-a2.ts <prefix> [zoom] [hourOrYaw...] */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-a2-veh';
const zoom = Number(process.argv[3] ?? 40);
const OFFX = Number(process.argv[4] ?? 0), OFFY = Number(process.argv[5] ?? 16);
const JS = `(async()=>{
  const V=await import('/src/render/meshes/VehicleModels.ts');
  const H=await import('/src/render/meshes/Helicopter.ts');
  const s=__slope,a0=s.terrainInfo.villageAnchor,a={x:a0.x+${OFFX},y:a0.y+${OFFY}},gr=s.grid;
  s.trees.group.visible=false;s.rocks.group.visible=false;
  const hh=(x,y)=>gr.getCorner(Math.round(x),Math.round(y))*0.5+0.05;
  let tm=null,bm=null;s.renderer.scene.traverse((o)=>{if(o.isMesh&&!Array.isArray(o.material)){const m=o.material;if(!tm&&m.isMeshLambertMaterial&&m.vertexColors&&!m.transparent)tm=o;if(!bm&&m.isMeshBasicMaterial&&m.vertexColors)bm=o;}});
  const mat=tm.material.clone(),lit=(bm?bm.material:tm.material).clone();const Group=s.trees.group.constructor,Mesh=tm.constructor;
  const root=new Group();root.name='veh-lineup';
  const add=(m,x,z,sc=1)=>{const g=new Group();g.add(new Mesh(m.body,mat),new Mesh(m.lights,lit));g.position.set(a.x+x,hh(a.x+x,a.y+z),a.y+z);g.rotation.y=-0.6;g.scale.setScalar(sc);root.add(g);};
  const cols=[0xc93a32,0x2f5fa8,0xe8b93a,0x3a7d4a,0xf2f2f2];
  for(let i=0;i<5;i++)add(V.buildCar(i,cols[i],i===1?1:i===2?2:0),-4+i*1.2,-1.5,1.6);
  add(V.buildBus(true,0xe8b93a),2.4,-1.5,1.6);add(V.buildBus(false,0x2f6fd0),4.4,-1.5,1.6);
  add(V.buildTrain(),0,1.8,1.0);add(V.buildPlane(),-5,2.5,1.0);
  const h=new H.HelicopterMesh();h.group.visible=true;h.set(a.x+5.5,hh(a.x+5.5,a.y+2.5)+0.1,a.y+2.5,-0.6,0.4);root.add(h.group);
  s.renderer.scene.add(root);
  s.renderer.controls.target.set(a.x+0.5,hh(a.x,a.y)+0.3,a.y+0.5);
})()`;
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { w: 1600, h: 1000, size: 128, seed: 5, start: 'summer', hour: 12, zoom, yaw: Number(process.argv[6] ?? 0.5), evalJs: JS, out: `${prefix}-lineup` });
  console.log(r.file, r.errors.filter((e) => !/GL Driver|beforeinstallprompt/.test(e)));
} finally { await br.close(); srv.stop(); }
