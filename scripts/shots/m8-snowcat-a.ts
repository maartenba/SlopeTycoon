/* M8 lane A: groomer fleet model close-up (3 yaws) rendered straight from createSnowcatGeometry into an overlay. vite-node scripts/shots/m8-snowcat-a.ts <prefix> */
import { launch, shot, startServer } from '../lib/harness';
const prefix = process.argv[2] ?? 'm8-after-a-snowcat';
const js = `(async()=>{const T=await import('/node_modules/three/build/three.module.js');const {createSnowcatGeometry}=await import('/src/render/meshes/Snowcat.ts');
const d=document.createElement('div');d.style.cssText='position:fixed;inset:0;z-index:99999;background:#cfd8e3;display:flex;gap:8px;padding:8px';document.body.appendChild(d);
for(const yaw of [0.4,2.2,4.0]){const c=document.createElement('canvas');c.width=520;c.height=420;d.appendChild(c);const r=new T.WebGLRenderer({canvas:c,antialias:true});r.setClearColor(0xe8eef5);
const s=new T.Scene();s.add(new T.HemisphereLight(0xcfe4ff,0x6a5a66,1.0));const l=new T.DirectionalLight(0xfff0d0,1.5);l.position.set(10,15,5);s.add(l);
const m=new T.Mesh(createSnowcatGeometry(),new T.MeshLambertMaterial({vertexColors:true}));m.rotation.y=yaw;s.add(m);
const cam=new T.OrthographicCamera(-0.8,0.8,0.65,-0.65,0.1,50);const P=Math.atan(1/Math.SQRT2);cam.position.set(Math.sin(Math.PI/4)*Math.cos(P)*10,Math.sin(P)*10+0.25,Math.cos(Math.PI/4)*Math.cos(P)*10);cam.lookAt(0,0.25,0.1);r.render(s,cam);}
console.log('[snowcat] done');})()`;
const srv = await startServer(); const br = await launch();
try {
  const r = await shot(br, srv.url, { w: 1600, h: 440, size: 64, seed: 5, start: 'winter', hour: 12, evalJs: js, steps: 'wait:2500', out: prefix });
  console.log(r.file, r.errors.filter((e) => !/GL Driver/.test(e)).length);
} finally { await br.close(); srv.stop(); }
