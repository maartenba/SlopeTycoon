/* M8 smooth planes / canopies / gliders: line-up of the new models on the village meadow, hiding trees (optionally on a plain background).
 * vite-node scripts/shots/m8-sky-m.ts <prefix> [zoom] [yaw] [plain 0|1] ; the models are the real SkyActivity meshes + the Altiport arrival plane (VehicleModels). */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-m-sky';
const zoom = Number(process.argv[3] ?? 30), yaw = Number(process.argv[4] ?? 0.5), plain = process.argv[5] === '1';
const JS = `(async()=>{
  const V=await import('/src/render/meshes/VehicleModels.ts');
  const S=await import('/src/render/SkyActivity.ts');
  const s=__slope,a0=s.terrainInfo.villageAnchor,a={x:a0.x,y:a0.y+16},gr=s.grid;
  s.trees.group.visible=false;s.rocks.group.visible=false;
  const hh=(x,y)=>gr.getCorner(Math.round(x),Math.round(y))*0.5+0.05;
  let tm=null,bm=null;s.renderer.scene.traverse((o)=>{if(o.isMesh&&!Array.isArray(o.material)){const m=o.material;if(!tm&&m.isMeshLambertMaterial&&m.vertexColors&&!m.transparent)tm=o;if(!bm&&m.isMeshBasicMaterial&&m.vertexColors)bm=o;}});
  const Group=s.trees.group.constructor,Mesh=tm.constructor,Col=tm.material.color.constructor;
  const mat=tm.material.clone(),lit=(bm?bm.material:tm.material).clone();
  const sa=new S.SkyActivity(()=>0,()=>[],()=>[]);
  const root=new Group();root.name='sky-lineup';
  const put=(geo,x,y,z,ry,sc,tint)=>{const mm=mat.clone();if(tint!==undefined)mm.color=new Col(tint);const o=new Mesh(geo,mm);o.position.set(a.x+x,y,a.y+z);o.rotation.y=ry;o.scale.setScalar(sc);root.add(o);};
  const g0=hh(a.x,a.y);
  put(sa.planes.geometry,-2.4,g0+0.45,0,-0.5,1.5);
  const vm=V.buildPlane();const vg=new Group();vg.add(new Mesh(vm.body,mat),new Mesh(vm.lights,lit));if(vm.prop){const pm=new Mesh(vm.prop,mat);pm.position.set(...vm.propPivot);vg.add(pm);}
  vg.position.set(a.x+2.2,g0+0.12,a.y+0.3);vg.rotation.y=-0.5;vg.scale.setScalar(1.5);root.add(vg);
  [0xf08a24,0x1fa7a0,0xd9453a].forEach((c,i)=>put(sa.canopies.geometry,-2.2+i*1.1,g0+0.3,-1.7+(i%2)*0.3,0.5+i*0.4,2.2,c));
  [0x2f6fd0,0xf2c14e].forEach((c,i)=>put(sa.gliders.geometry,1.6+i*1.5,g0+0.4,-1.9,-0.3+i*0.6,2.0,c));
  s.renderer.scene.add(root);
  ${plain ? "s.renderer.scene.children.forEach((c)=>{if(c!==root&&!c.isLight)c.visible=false;});s.renderer.scene.background=new Col(0xdfe6ee);s.renderer.scene.fog=null;" : ''}
  s.renderer.controls.target.set(a.x-0.2,g0+0.5,a.y-0.6);
})()`;
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { w: 1600, h: 1000, size: 128, seed: 5, start: 'summer', hour: 12, zoom, yaw, evalJs: JS, out: `${prefix}` });
  console.log(r.file, r.errors.filter((e) => !/GL Driver|beforeinstallprompt/.test(e)));
} finally { await br.close(); srv.stop(); }
