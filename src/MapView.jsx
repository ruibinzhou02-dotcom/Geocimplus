import {useI18n} from './i18n.jsx';
import React,{useEffect,useRef} from 'react';
import maplibregl from 'maplibre-gl';
import {featureId} from './controls.mjs';
import {exportMapPNG} from './export-map.mjs';
import 'maplibre-gl/dist/maplibre-gl.css';

export const heightColor=['step',['coalesce',['get','height'],0],'#C4B7E5',30,'#9C83D6',60,'#7659C8',100,'#5938B5',200,'#372164'];
export function geometryBounds(features){
 const points=[];const walk=c=>{if(typeof c?.[0]==='number')points.push(c);else c?.forEach(walk);};
 features.forEach(f=>walk(f.geometry?.coordinates));if(!points.length)return null;
 const b=[[Infinity,Infinity],[-Infinity,-Infinity]];for(const p of points){b[0][0]=Math.min(b[0][0],p[0]);b[0][1]=Math.min(b[0][1],p[1]);b[1][0]=Math.max(b[1][0],p[0]);b[1][1]=Math.max(b[1][1],p[1]);}return b;
}
export default function MapView({catalog,dataset,metadata,rasters,settings,selection,threeD,color,camera,tableOpen,onPick,onReady,onError,onExporter}){
 const {t,lang}=useI18n();
 const container=useRef(null),map=useRef(null),groups=useRef([]),ready=useRef(false),dataRef=useRef(dataset),metaRef=useRef(metadata),callbacks=useRef({onPick,onReady,onError});
 dataRef.current=dataset;metaRef.current=metadata;callbacks.current={onPick,onReady,onError};
 const fit=(m,bounds,duration=0)=>m.fitBounds(bounds,{padding:{top:tableOpen?45:100,bottom:tableOpen?35:70,left:55,right:55},duration,maxZoom:18,pitch:threeD?52:0,bearing:threeD?-22:0});
 const addVector=(m,key,data)=>{
  m.addSource(key,{type:'geojson',data});
  const fill=key==='buildings'?heightColor:key==='population'?['step',['coalesce',['get','usum'],0],'#EDF0D8',300,'#D3DEAC',700,'#A8C65B',1500,'#718F35',3000,'#3F5E24']:key==='boundary'?'#CFD4CF':'#5AA8A0';
  const add=(suffix,type,geometry,paint)=>{for(const selected of [false,true]){const id=`${key}-${suffix}${selected?'-chosen':''}`;m.addLayer({id,type,source:key,filter:['==',['geometry-type'],geometry],paint});groups.current.push({id,type,geometry,selected,key});}};
  add('fill','fill','Polygon',{'fill-color':fill});
  add('volume','fill-extrusion','Polygon',{'fill-extrusion-color':fill,'fill-extrusion-height':['coalesce',['get','height'],0],'fill-extrusion-base':0});
  add('line','line','LineString',{'line-color':key==='roads'?'#778086':'#378D84','line-width':key==='roads'?2.5:2});
  add('edge','line','Polygon',{'line-color':key==='boundary'?'#809B71':'#708987','line-width':key==='boundary'?1.6:.7});
  add('point','circle','Point',{'circle-color':'#7659C8','circle-radius':5,'circle-stroke-width':1,'circle-stroke-color':'#FFFFFF'});
 };
 useEffect(()=>{
  const m=new maplibregl.Map({container:container.current,canvasContextAttributes:{preserveDrawingBuffer:true},style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#F4F5F3'}}]},center:[(catalog.bounds[0][0]+catalog.bounds[1][0])/2,(catalog.bounds[0][1]+catalog.bounds[1][1])/2],zoom:13,pitch:threeD?52:0,bearing:threeD?-22:0,dragRotate:true,pitchWithRotate:true,attributionControl:false});map.current=m;
  m.dragRotate.enable();
  const preventMenu=e=>e.preventDefault();container.current.addEventListener('contextmenu',preventMenu);
  m.addControl(new maplibregl.NavigationControl(),'bottom-right');m.addControl(new maplibregl.ScaleControl({unit:'metric'}),'bottom-left');
  m.on('load',()=>{m.addLayer({id:'raster-anchor',type:'background',paint:{'background-opacity':0}});ready.current=true;fit(m,catalog.bounds);onExporter(options=>exportMapPNG(m,options));callbacks.current.onReady(true);});
  m.on('error',e=>callbacks.current.onError(e.error?.message||'地图加载失败'));
  m.on('click',e=>{const layers=groups.current.map(g=>g.id).filter(id=>m.getLayer(id));if(!layers.length)return;const f=m.queryRenderedFeatures(e.point,{layers})[0];if(!f)return;const key=f.source,idField=metaRef.current[key]?.idField||'stable_id';const original=dataRef.current[key]?.features.find(x=>featureId(x,idField)===featureId(f,idField));if(original)callbacks.current.onPick({layer:key,feature:original});});
  const resize=new ResizeObserver(()=>m.resize());resize.observe(container.current);
  return()=>{ready.current=false;groups.current=[];resize.disconnect();container.current?.removeEventListener('contextmenu',preventMenu);m.remove();};
 },[catalog]);
 useEffect(()=>{
  const m=map.current;if(!m||!ready.current)return;
  for(const key of [...new Set(groups.current.map(g=>g.key))])if(!dataset[key]){for(const g of groups.current.filter(g=>g.key===key))if(m.getLayer(g.id))m.removeLayer(g.id);if(m.getSource(key))m.removeSource(key);groups.current=groups.current.filter(g=>g.key!==key);}
  for(const layer of m.getStyle().layers.filter(l=>l.type==='raster'))if(!rasters.some(r=>r.id===layer.source)){m.removeLayer(layer.id);m.removeSource(layer.source);}
  for(const r of rasters)if(!m.getSource(r.id)){m.addSource(r.id,{type:'image',url:r.url,coordinates:r.coordinates});m.addLayer({id:r.id+'-raster',type:'raster',source:r.id,paint:{'raster-fade-duration':0}},'raster-anchor');}
  for(const key of [...['boundary','population','roads','buildings'],...Object.keys(dataset).filter(k=>!['boundary','population','roads','buildings'].includes(k))])if(dataset[key]&&!m.getSource(key))addVector(m,key,dataset[key]);
  for(const r of rasters){m.setLayoutProperty(r.id+'-raster','visibility',settings[r.id]?.visible?'visible':'none');m.setPaintProperty(r.id+'-raster','raster-opacity',1-(settings[r.id]?.transparency??0)/100);}
  for(const g of groups.current){
   const ids=selection.layer===g.key?selection.ids:[],idField=metadata[g.key]?.idField||'stable_id',match=['in',['to-string',['get',idField]],['literal',ids]];
   m.setFilter(g.id,['all',['==',['geometry-type'],g.geometry],g.selected?match:['!',match]]);
   const heightField=metadata[g.key]?.heightField||'',volume=!!heightField&&threeD;
   if(g.type==='fill-extrusion')m.setPaintProperty(g.id,'fill-extrusion-height',['max',0,['to-number',['get',heightField||'__no_height'],0]]);
   const show=!!dataset[g.key]&&settings[g.key]?.visible!==false&&(g.type==='fill-extrusion'?volume:g.geometry==='Polygon'?!volume:true);
   m.setLayoutProperty(g.id,'visibility',show?'visible':'none');
   const opacity=1-(settings[g.key]?.[g.selected?'selectedTransparency':'transparency']??(g.selected?15:30))/100;m.setPaintProperty(g.id,g.type+'-opacity',opacity);if(g.type==='circle')m.setPaintProperty(g.id,'circle-stroke-opacity',opacity);
   if(!g.selected&&metadata[g.key]?.density&&g.type==='fill'){const {field,max}=metadata[g.key].density;m.setPaintProperty(g.id,'fill-color',['interpolate',['linear'],['get',field],0,'#f1edf9',Math.max(max,1e-12)*.4,'#ac87d2',Math.max(max,1e-12),'#562690']);}
   if(g.selected)m.setPaintProperty(g.id,g.type+'-color','#D8BA59');else if(g.key==='buildings'&&['fill','fill-extrusion'].includes(g.type))m.setPaintProperty(g.id,g.type+'-color',color==='height'?heightColor:'#7659C8');
  }
 },[dataset,metadata,rasters,settings,selection,threeD,color,camera]);
 useEffect(()=>{if(ready.current)map.current.easeTo({pitch:threeD?52:0,duration:350});},[threeD]);
 useEffect(()=>{if(ready.current)fit(map.current,camera?.bounds||catalog.bounds,camera?.bounds?500:0);},[camera]);
 useEffect(()=>{if(ready.current){map.current.resize();fit(map.current,camera?.bounds||catalog.bounds);}},[tableOpen]);
 useEffect(()=>{
  for(const [selector,zh,en] of [['.maplibregl-ctrl-zoom-in','放大','Zoom in'],['.maplibregl-ctrl-zoom-out','缩小','Zoom out'],['.maplibregl-ctrl-compass','拖动旋转，点击朝北','Drag to rotate, click to face north']]){
   const button=container.current?.querySelector(selector);if(button){const label=lang==='en'?en:zh;button.setAttribute('title',label);button.setAttribute('aria-label',label);}
  }
 },[lang,catalog]);
 return <div ref={container} className="map" aria-label={t("交互地图")}/>;
}
