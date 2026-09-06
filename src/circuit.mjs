import {analyze} from './spatial-analysis.mjs';
import {prepareGeoJSON} from './geojson.mjs';
import {selectByAttribute,featureId} from './controls.mjs';

export const batteries={
 source:{label:'输入图层',input:false,output:'vector',params:['layer']},
 select:{label:'按属性选择',input:true,output:'vector',params:['field','operator','value']},
 centroid:{label:'生成代表点',input:true,output:'vector',params:[]},
 buffer:{label:'缓冲区',input:true,output:'vector',params:['distance']},
 measure:{label:'面积与长度',input:true,output:'vector',params:[]},
 kde:{label:'点核密度',input:true,output:'vector',params:['bandwidth','cellSize','weightField']},
 statistics:{label:'字段统计',input:true,output:'summary',params:['field']},
 recipe:{label:'微流程',input:true,output:'vector',params:['steps']},
 output:{label:'结果输出',input:true,output:null,params:[]}
};
export const defaults={source:{layer:'buildings'},select:{field:'height',operator:'gt',value:50},centroid:{},buffer:{distance:100},measure:{},kde:{bandwidth:200,cellSize:100,weightField:''},statistics:{field:'height'},recipe:{steps:[{operation:'centroid'},{operation:'buffer',distance:100}]},output:{}};
const fail=s=>{throw new Error(s);};
const plain=o=>o&&typeof o==='object'&&!Array.isArray(o);
function checkParams(type,p){
 if(!plain(p)||Object.keys(p).some(k=>!batteries[type].params.includes(k)))fail('电池参数无效。');
 for(const [k,v] of Object.entries(p))if(k!=='steps'&&(typeof v!=='string'&&typeof v!=='number'||typeof v==='string'&&v.length>500||typeof v==='number'&&!Number.isFinite(v)))fail('电池参数无效。');
 if(type==='source'&&(typeof p.layer!=='string'||!p.layer))fail('请为输入电池绑定图层。');
 if(type==='select'&&(!p.field||!['eq','ne','gt','gte','lt','lte','contains','empty','notempty'].includes(p.operator)))fail('属性选择参数无效。');
 if(type==='statistics'&&!p.field)fail('请选择统计字段。');
 if(type==='recipe'){
  if(!Array.isArray(p.steps)||!p.steps.length||p.steps.length>6)fail('微流程需要 1–6 个本地步骤。');
  for(const step of p.steps){if(!plain(step)||!['centroid','buffer','measure','kde'].includes(step.operation))fail('微流程只支持白名单分析步骤，不执行任意代码。');checkParams(step.operation,Object.fromEntries(Object.entries(step).filter(([k])=>k!=='operation')));}
 }
}
export function cleanGraph(graph){
 if(!plain(graph)||graph.version!==1||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges)||!graph.nodes.length||graph.nodes.length>40||graph.edges.length>80)fail('流程格式无效：最多 40 个电池、80 条连线。');
 const ids=new Set();
 const nodes=graph.nodes.map(n=>{
  if(!plain(n)||typeof n.id!=='string'||!/^[-\w]{1,80}$/.test(n.id)||ids.has(n.id)||!Object.hasOwn(batteries,n.type))fail('电池类型或编号无效。');ids.add(n.id);checkParams(n.type,n.params);
  const pos=n.position||{x:0,y:0};if(!plain(pos)||!Number.isFinite(pos.x)||!Number.isFinite(pos.y)||Math.abs(pos.x)>100000||Math.abs(pos.y)>100000)fail('电池位置无效。');
  return {id:n.id,type:n.type,params:structuredClone(n.params),position:{x:pos.x,y:pos.y}};
 });
 const pairs=new Set();const edges=graph.edges.map((e,i)=>{
  if(!plain(e)||!ids.has(e.source)||!ids.has(e.target)||e.source===e.target)fail('连线端点无效。');
  const a=nodes.find(n=>n.id===e.source),b=nodes.find(n=>n.id===e.target),pair=e.source+'>'+e.target;
  if(pairs.has(pair)||!batteries[a.type].output||!batteries[b.type].input||a.type==='statistics'&&b.type!=='output')fail('连线类型不兼容。');pairs.add(pair);
  return {id:'wire-'+i,source:e.source,target:e.target};
 });
 if(nodes.some(n=>edges.filter(e=>e.target===n.id).length>1))fail('每个输入端口只能连接一条线。');
 const done=new Set(),order=[];
 while(order.length<nodes.length){const next=nodes.find(n=>!done.has(n.id)&&edges.filter(e=>e.target===n.id).every(e=>done.has(e.source)));if(!next)fail('流程中存在循环连线。');done.add(next.id);order.push(next);}
 return {version:1,nodes,edges};
}
export function demoGraph(layer='buildings',kind='density'){
 const types=kind==='buffer'?['source','select','centroid','buffer','output']:kind==='statistics'?['source','statistics','output']:['source','centroid','kde','output'];
 return {version:1,nodes:types.map((type,i)=>({id:'cell-'+i,type,params:{...structuredClone(defaults[type]),...(type==='source'?{layer}:{})},position:{x:60+i*255,y:160}})),edges:types.slice(1).map((_,i)=>({id:'wire-'+i,source:'cell-'+i,target:'cell-'+(i+1)}))};
}
export function runCircuit(input,dataset,metadata,runId='circuit',progress=()=>{}){
 const graph=cleanGraph(input),pending=[...graph.nodes],results=new Map(),log=[],outputs=[];
 if(!graph.nodes.some(n=>n.type==='output'))fail('请添加结果输出电池。');
 for(const n of graph.nodes)if(n.type!=='source'&&graph.edges.filter(e=>e.target===n.id).length!==1)fail('请连接所有电池的输入端口。');
 let coordinates=0;
 const step=(data,type,params,id)=>{
  if(type==='select'){
   const prepared=prepareGeoJSON(data,'selection-input','selection'),ids=new Set(selectByAttribute(prepared.data.features,params,prepared.idField));
   const selected=data.features.filter((_,i)=>ids.has(featureId(prepared.data.features[i],prepared.idField)));
   if(!selected.length)fail('没有满足条件的要素。');return prepareGeoJSON({type:'FeatureCollection',features:selected},'selection',id);
  }
  return analyze(data,{...params,operation:type,id});
 };
 while(pending.length){
  const index=pending.findIndex(n=>graph.edges.filter(e=>e.target===n.id).every(e=>results.has(e.source)));const n=pending.splice(index,1)[0];
  try{
   let result;
   if(n.type==='source'){if(!Object.hasOwn(dataset,n.params.layer))fail('输入图层不存在，请重新绑定。');result={kind:'vector',data:dataset[n.params.layer],name:metadata[n.params.layer]?.name||n.params.layer};}
   else{
    const upstream=results.get(graph.edges.find(e=>e.target===n.id).source);
    if(n.type==='output'){result={...upstream,id:runId+'-'+n.id,name:'Circuit · '+(upstream.name||'result'),analysis:{...upstream.analysis,circuit:graph,createdAt:new Date().toISOString()}};outputs.push(result);}
    else if(n.type==='recipe'){result=upstream;for(const [i,s] of n.params.steps.entries())result=step(result.data,s.operation,Object.fromEntries(Object.entries(s).filter(([k])=>k!=='operation')),runId+'-'+n.id+'-'+i);}
    else result=step(upstream.data,n.type,n.params,runId+'-'+n.id);
    if(n.type!=='output')result={...result,name:batteries[n.type].label};
   }
   if(result.kind==='vector'&&n.type!=='source'&&n.type!=='output'){
    const count=p=>typeof p[0]==='number'?1:p.reduce((sum,c)=>sum+count(c),0);
    coordinates+=result.data.features.reduce((sum,f)=>sum+count(f.geometry.coordinates),0);if(coordinates>1500000)fail('流程累计结果过大，请拆分流程。');
   }
   results.set(n.id,result);log.push({id:n.id,type:n.type,count:result.data?.features.length??result.values?.count,status:'done'});progress(Math.round(results.size/graph.nodes.length*100));
  }catch(e){throw new Error(`${n.id}: ${e.message}`);}
 }
 return {outputs:outputs.map(r=>r.kind==='vector'&&!r.bounds?{...prepareGeoJSON(r.data,r.name,r.id),analysis:r.analysis}:r),log,graph};
}
