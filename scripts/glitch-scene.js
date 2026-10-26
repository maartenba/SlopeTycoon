(()=>{const G=window.__G,S=window.__slope,g=S.grid;
const D={firstAid:[2,2],alpineFarm:[6,5],snowCannon:[1,1],rangerStation:[4,3],warningSign:[1,1],kidsGround:[4,4],mountainHut:[3,3],chalet:[3,3],snowcatOutpost:[3,3]};
const [w,h]=D[G.type]||[2,2];
function sp(x,y){let mn=1e9,mx=-1e9;for(let j=y;j<=y+h;j++)for(let i=x;i<=x+w;i++){const c=g.getCorner(i,j);mn=Math.min(mn,c);mx=Math.max(mx,c)}return mx-mn}
for(let y=20;y<108;y+=3){let ok=false;for(let x=20;x<108;x+=3){if(S.debugPlace('patrolHub',x,y,0,true).ok){ok=true;break}}if(ok)break}
let at=null;
for(let y=10;y<116&&!at;y++)for(let x=10;x<116&&!at;x++){if(sp(x,y)!==G.sp)continue;const o=S.debugPlace(G.type,x,y,0,false);if(o.ok){at=[x,y];}}
if(!at){console.log('no spot');return}
if(G.clear){const t=[];S.props.removeInRect(at[0]-G.clear,at[1]-G.clear,at[0]+w+G.clear,at[1]+h+G.clear,t);S.refreshProps(t);}
S.buildingsView.sync();
const c=S.renderer.controls;const gp=S.buildingsView.objects();
const b=S.buildings.all().find(q=>q.type===G.type);const m=S.buildingsView.get(b.id);
c.target.set(b.x+w/2,m.position.y,b.y+h/2);c.zoom=1;c.zoomBy(G.zoom||8);if(G.yaw!==undefined)c.yaw=G.yaw;
console.log('placed',G.type,at.join(','),'y',m.position.y);})()
