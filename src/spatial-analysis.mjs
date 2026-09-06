import {area} from '@turf/area';
import {length} from '@turf/length';
import {buffer} from '@turf/buffer';
import {centroid} from '@turf/centroid';
import {booleanValid} from '@turf/boolean-valid';
import proj4 from 'proj4';
import {prepareGeoJSON} from './geojson.mjs';

const numeric=v=>typeof v==='number'?v:typeof v==='string'&&v.trim()!==''?Number(v):NaN;
const feature=(geometry,properties)=>({type:'Feature',geometry,properties});
function boundsOf(features){let b=[Infinity,Infinity,-Infinity,-Infinity];const walk=p=>{if(typeof p[0]==='number'){b=[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])];}else p.forEach(walk);};features.forEach(f=>walk(f.geometry.coordinates));return b;}
function checkRegional(features){const b=boundsOf(features);if(b[2]-b[0]>2||b[3]-b[1]>2||Math.abs(b[1])>80||Math.abs(b[3])>80)throw new Error('请将分析范围控制在约 2 度以内，并避开极区和日期变更线。');return b;}
export function analyze(data,{operation,field='',distance=100,bandwidth=200,cellSize=100,weightField='',sourceName='',sourceId='',scope='all',id='analysis'},progress=()=>{}){
 const features=data?.features;if(!Array.isArray(features)||!features.length)throw new Error('请先选择有要素的图层。');
 if(features.length>100000)throw new Error('分析最多 100,000 个要素。');
 const provenance={operation,source:sourceName,sourceId,inputCount:features.length,scope,createdAt:new Date().toISOString()};
 if(operation==='statistics'){
  const values=[];let missing=0,nonNumeric=0;
  for(const f of features){const v=f.properties[field];if(v==null||v===''){missing++;continue;}const n=numeric(v);if(Number.isFinite(n))values.push(n);else nonNumeric++;}
  const sorted=values.sort((a,b)=>a-b),n=sorted.length,sum=sorted.reduce((a,b)=>a+b,0),mean=n?sum/n:null;
  return {kind:'summary',provenance:{...provenance,field},values:{count:features.length,valid:n,missing,nonNumeric,sum:n?sum:null,mean,min:n?sorted[0]:null,max:n?sorted.at(-1):null,median:n?(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2:null}};
 }
 let output,parameters={};
 if(operation==='measure'){
  const reserved=['geocim_area_m2','geocim_length_m'];if(features.some(f=>reserved.some(k=>Object.hasOwn(f.properties,k))))throw new Error('结果字段已存在，请使用原始图层计算。');
  output=features.map((f,i)=>{if(!booleanValid(f))throw new Error(`第 ${i+1} 个要素几何无效，请先修复。`);return feature(f.geometry,{...f.properties,geocim_area_m2:/Polygon/.test(f.geometry.type)?area(f):null,geocim_length_m:/LineString/.test(f.geometry.type)?length(f,{units:'meters'}):null});});
  parameters={method:'spherical geodesic; polygon area and line length',areaUnit:'m²',lengthUnit:'m'};
 }else if(operation==='centroid'){
  checkRegional(features);output=features.map(f=>feature(centroid(f).geometry,{...f.properties}));parameters={method:'mean of geometry vertices; may lie outside a concave polygon'};
 }else if(operation==='buffer'){
  const d=Number(distance);if(!Number.isFinite(d)||d<=0||d>5000)throw new Error('缓冲距离需大于 0 且不超过 5000 米。');if(features.length>2000)throw new Error('缓冲区一次最多 2000 个要素，可先在属性表中选择部分要素。');checkRegional(features);
  output=features.map((f,i)=>{if(!booleanValid(f))throw new Error(`第 ${i+1} 个要素几何无效，请先修复。`);const r=buffer(f,d,{units:'meters',steps:12});if(!r)throw new Error('无法为某个要素生成缓冲区。');return feature(r.geometry,{...f.properties,geocim_buffer_m:d});});parameters={distance_m:d,dissolved:false,steps:12};
 }else if(operation==='kde'){
  const result=kde(features,{bandwidth:Number(bandwidth),cellSize:Number(cellSize),weightField},progress);output=result.features;parameters=result.parameters;
 }else throw new Error('未知分析操作。');
 const item=prepareGeoJSON({type:'FeatureCollection',features:output},sourceName,id);
 return {...item,analysis:{...provenance,...parameters},density:operation==='kde'?{field:'density_km2',max:Math.max(...output.map(f=>f.properties.density_km2))}:null};
}
export function kde(features,{bandwidth:h,cellSize:s,weightField=''},progress=()=>{}){
 if(!Number.isFinite(h)||h<10||h>5000||!Number.isFinite(s)||s<5||s>h)throw new Error('带宽应为 10–5000 米；网格边长应为 5 米至带宽。');
 const box=checkRegional(features),projection=proj4('EPSG:4326',`+proj=aeqd +lat_0=${(box[1]+box[3])/2} +lon_0=${(box[0]+box[2])/2} +datum=WGS84 +units=m`),points=[];
 for(const f of features){if(!['Point','MultiPoint'].includes(f.geometry.type))throw new Error('核密度需要点图层；面或线请先显式生成代表点。');const weight=weightField?numeric(f.properties[weightField]):1;if(!Number.isFinite(weight)||weight<0)throw new Error('权重字段必须全部为非负数且没有空值。');for(const p of f.geometry.type==='Point'?[f.geometry.coordinates]:f.geometry.coordinates)points.push([...projection.forward(p),weight]);}
 if(points.length>10000)throw new Error('核密度一次最多 10,000 个点。');
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),r=3*h,x0=Math.floor((Math.min(...xs)-r)/s)*s,y0=Math.floor((Math.min(...ys)-r)/s)*s;
 const nx=Math.ceil((Math.max(...xs)+r-x0)/s),ny=Math.ceil((Math.max(...ys)+r-y0)/s);
 if(nx*ny>20000||points.length*(Math.ceil(2*r/s)+1)**2>30000000)throw new Error('核密度计算量过大，请增大网格边长或缩小输入范围。');
 const grid=new Float64Array(nx*ny),normalizer=1e6/(2*Math.PI*h*h*(1-Math.exp(-4.5)));
 points.forEach(([px,py,weight],i)=>{for(let y=Math.max(0,Math.floor((py-r-y0)/s));y<Math.min(ny,Math.ceil((py+r-y0)/s));y++)for(let x=Math.max(0,Math.floor((px-r-x0)/s));x<Math.min(nx,Math.ceil((px+r-x0)/s));x++){const d2=(x0+(x+.5)*s-px)**2+(y0+(y+.5)*s-py)**2;if(d2<=r*r)grid[y*nx+x]+=weight*normalizer*Math.exp(-d2/(2*h*h));}if(i%100===0)progress(Math.round(i/points.length*90));});
 const output=[];for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const a=x0+x*s,b=y0+y*s;output.push(feature({type:'Polygon',coordinates:[[[a,b],[a+s,b],[a+s,b+s],[a,b+s],[a,b]].map(p=>projection.inverse(p))]},{density_km2:grid[y*nx+x]}));}
 return {features:output,parameters:{method:'Gaussian KDE, radial cutoff 3 bandwidths, mass normalized',projection:'local azimuthal equidistant',bandwidth_m:h,cell_m:s,weightField:weightField||null,pointCount:points.length,multipointWeight:'per point',unit:weightField?'weight/km²':'points/km²',extent:'input points plus 3 bandwidths',edgeCorrection:false}};
}
