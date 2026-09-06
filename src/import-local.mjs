import {unzipSync} from 'fflate';
import shp from 'shpjs';
import proj4 from 'proj4';
import {fromArrayBuffer} from 'geotiff';
import {prepareGeoJSON} from './geojson.mjs';

const MiB=1024**2,decode=b=>new TextDecoder().decode(b);
function projection(epsg){
 const n=Number(epsg),zone=n%100;
 if((n>=32601&&n<=32660)||(n>=32701&&n<=32760))proj4.defs('EPSG:'+n,`+proj=utm +zone=${zone} ${n>=32700?'+south':''} +datum=WGS84 +units=m +no_defs`);
 if(!proj4.defs('EPSG:'+n))throw new Error('不支持这个影像坐标系，请先转换为 WGS84、Web Mercator 或 WGS84 UTM。');
 return 'EPSG:'+n;
}
export function unpackShapeZip(bytes){
 let total=0,count=0;const seen=new Set();
 return unzipSync(bytes,{filter:f=>{
  const name=f.name.replaceAll('\\','/').toLowerCase();
  if(++count>512||!Number.isFinite(f.originalSize)||(total+=f.originalSize)>128*MiB)throw new Error('ZIP 解压后最多 128 MiB、512 个文件。');
  if(name.startsWith('/')||name.split('/').includes('..')||name.includes(':')||seen.has(name))throw new Error('ZIP 文件路径无效或重复。');seen.add(name);
  return /\.(shp|shx|dbf|prj|cpg)$/i.test(name)&&!name.startsWith('__macosx/');
 }});
}
export async function importFiles(files,{encoding='auto'}={},progress=()=>{}){
 if(!files.length||files.length>512||files.reduce((n,f)=>n+f.size,0)>64*MiB)throw new Error('每次最多导入 64 MiB、512 个文件。');
 let contents={};
 for(const f of files){if(f.name.toLowerCase().endsWith('.zip')){if(files.length!==1)throw new Error('ZIP 请单独导入。');contents=unpackShapeZip(new Uint8Array(await f.arrayBuffer()));}else{if(Object.keys(contents).some(k=>k.toLowerCase()===f.name.toLowerCase()))throw new Error('文件名重复。');contents[f.name]=new Uint8Array(await f.arrayBuffer());}}
 const normalized=Object.fromEntries(Object.entries(contents).map(([name,data])=>[name.toLowerCase(),{name,data}]));
 const results=[];
 const primary=Object.keys(normalized).filter(k=>/\.(geojson|json|shp|tif|tiff)$/.test(k));
 if(!primary.length||primary.length>12)throw new Error('请选择 GeoJSON、完整 Shapefile 或 GeoTIFF，每次最多 12 个图层。');
 for(const [i,key] of primary.entries()){
  const {name,data}=normalized[key],id='local-'+crypto.randomUUID();let item;
  if(/\.shp$/.test(key)){
   const stem=key.slice(0,-4),parts={};
   for(const ext of ['shp','shx','dbf','prj']){if(!normalized[stem+'.'+ext])throw new Error('Shapefile 需要同名 shp、shx、dbf、prj 配套文件。');parts[ext]=normalized[stem+'.'+ext].data;}
   const prj=decode(parts.prj).trim();if(!prj)throw new Error('PRJ 坐标系文件为空。');proj4(prj,'EPSG:4326');
   let cpg=encoding==='auto'?(normalized[stem+'.cpg']?decode(normalized[stem+'.cpg'].data).trim():'UTF-8'):encoding;
   if(cpg==='65001')cpg='UTF-8';if(cpg==='936')cpg='GBK';
   const count=new DataView(parts.dbf.buffer,parts.dbf.byteOffset,parts.dbf.byteLength).getUint32(4,true);
   if(count>100000)throw new Error('图层最多 100,000 个要素。');
   const geo=await shp({shp:parts.shp,dbf:parts.dbf,prj,cpg});
   if(geo.features.length!==count)throw new Error('SHP 与 DBF 记录数不一致。');
   for(const f of geo.features)for(const k of Object.keys(f.properties))if(f.properties[k] instanceof Date)f.properties[k]=f.properties[k].toISOString().slice(0,10);
   item=prepareGeoJSON(geo,name.replace(/\.shp$/i,''),id);item.importInfo={format:'Shapefile',encoding:cpg,sourceCRS:prj};
  }else if(/\.tiff?$/.test(key)){item=await importRaster(data,id,name);}
  else item=prepareGeoJSON(JSON.parse(decode(data)),name,id);
  results.push({...item,workspace:'personal',sessionOnly:true});progress(Math.round((i+1)/primary.length*100));
 }
 return results;
}
async function importRaster(bytes,id,name){
 const tiff=await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),im=await tiff.getImage(),keys=im.getGeoKeys(),fd=im.getFileDirectory();
 const width=im.getWidth(),height=im.getHeight(),samples=im.getSamplesPerPixel();
 if(width*height>16000000||width*height*im.getBytesPerPixel()>128*MiB)throw new Error('影像解码规模过大，请先裁剪到 1600 万像元、128 MiB 以内。');
 const crs=projection(keys?.ProjectedCSTypeGeoKey||keys?.GeographicTypeGeoKey);
 if(fd.ModelTransformation&&(fd.ModelTransformation[1]!==0||fd.ModelTransformation[4]!==0))throw new Error('旋转影像请先重投影为正北朝上的 GeoTIFF。');
 const extent=im.getBoundingBox(),[rx,ry]=im.getResolution();if(rx<=0||ry>=0)throw new Error('请先将影像转换为正北朝上的 GeoTIFF。');
 const ratio=Math.min(1,1024/Math.max(width,height)),w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));
 const bands=await im.readRasters({samples:[0],width:w,height:h,resampleMethod:'nearest'}),values=bands[0],nodata=im.getGDALNoData();
 let min=Infinity,max=-Infinity,sum=0,n=0;for(const v of values)if(Number.isFinite(v)&&v!==nodata){min=Math.min(min,v);max=Math.max(max,v);sum+=v;n++;}
 if(!n)throw new Error('影像第 1 波段没有有效像元。');
 const toWgs=proj4(crs,'EPSG:4326'),toMerc=proj4(crs,'EPSG:3857');let box=[Infinity,Infinity,-Infinity,-Infinity];
 for(let i=0;i<=32;i++)for(const p of [[extent[0]+(extent[2]-extent[0])*i/32,extent[1]],[extent[0]+(extent[2]-extent[0])*i/32,extent[3]],[extent[0],extent[1]+(extent[3]-extent[1])*i/32],[extent[2],extent[1]+(extent[3]-extent[1])*i/32]]){const ll=toWgs.forward(p);if(!ll.every(Number.isFinite)||Math.abs(ll[0])>180||Math.abs(ll[1])>85.05)throw new Error('影像超出可显示的经纬度范围。');const a=toMerc.forward(p);box=[Math.min(box[0],a[0]),Math.min(box[1],a[1]),Math.max(box[2],a[0]),Math.max(box[3],a[1])];}
 const long=Math.max(box[2]-box[0],box[3]-box[1]);if(!(long>0))throw new Error('影像空间范围无效。');
 const ow=Math.max(1,Math.round(1024*(box[2]-box[0])/long)),oh=Math.max(1,Math.round(1024*(box[3]-box[1])/long)),pixels=new Uint8ClampedArray(ow*oh*4),back=proj4('EPSG:3857',crs);
 for(let y=0;y<oh;y++)for(let x=0;x<ow;x++){
  const q=back.forward([box[0]+(x+.5)*(box[2]-box[0])/ow,box[3]-(y+.5)*(box[3]-box[1])/oh]);
  const sx=Math.floor((q[0]-extent[0])/(extent[2]-extent[0])*w),sy=Math.floor((extent[3]-q[1])/(extent[3]-extent[1])*h);if(sx<0||sx>=w||sy<0||sy>=h)continue;
  const v=values[sy*w+sx];if(!Number.isFinite(v)||v===nodata)continue;const k=(y*ow+x)*4,c=max===min?128:Math.round((v-min)/(max-min)*255);pixels[k]=pixels[k+1]=pixels[k+2]=c;pixels[k+3]=255;
 }
 const inverse=proj4('EPSG:3857','EPSG:4326'),coordinates=[[box[0],box[3]],[box[2],box[3]],[box[2],box[1]],[box[0],box[1]]].map(p=>inverse.forward(p));
 const canvas=new OffscreenCanvas(ow,oh);canvas.getContext('2d').putImageData(new ImageData(pixels,ow,oh),0,0);const blob=await canvas.convertToBlob({type:'image/png'});
 return {id,name,kind:'raster',blob,coordinates,bounds:[coordinates[3],coordinates[1]],display:'灰度',rasterInfo:{crs,width,height,bands:samples,band:1,nodata,sampled:true,sampleCount:n,min,max,mean:sum/n,preview:[ow,oh]}};
}
