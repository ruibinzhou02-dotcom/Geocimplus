import React,{useState,useMemo,useEffect,useRef} from 'react';
import {useI18n} from './i18n.jsx';
import {runJob} from './jobs.mjs';
import {featureId} from './controls.mjs';
import {downloadJSON} from './download.mjs';
export const operationNames={statistics:'字段统计',measure:'面积与长度',buffer:'缓冲区',centroid:'生成代表点',kde:'点核密度'};
export default function AnalysisPanel({dataset,metadata,layer,onLayer,selection,onResult,onError,onTable,onUpload,layerCount}){
 const {t,lang}=useI18n(),job=useRef(null),[operation,setOperation]=useState('statistics'),[field,setField]=useState(''),[weightField,setWeightField]=useState(''),[scope,setScope]=useState('all'),[distance,setDistance]=useState(100),[bandwidth,setBandwidth]=useState(200),[cellSize,setCellSize]=useState(100),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[summary,setSummary]=useState(null);
 const data=dataset[layer],fields=useMemo(()=>[...new Set((data?.features||[]).flatMap(f=>Object.keys(f.properties)))],[data]);
 useEffect(()=>{setField(fields.includes('height')?'height':fields[0]||'');setWeightField('');setScope('all');setSummary(null);},[layer]);
 useEffect(()=>()=>job.current?.cancel(),[]);
 const run=async()=>{setBusy(true);onError('');setProgress(0);setSummary(null);try{
  if(!data)throw new Error('请先导入数据。');if(operation!=='statistics'&&layerCount>=20)throw new Error('当前工作空间最多 20 个图层，请先移除部分图层。');
  const ids=new Set(selection.layer===layer?selection.ids:[]),features=scope==='selected'?data.features.filter(f=>ids.has(featureId(f,metadata[layer]?.idField||'stable_id'))):data.features;
  job.current=runJob({job:'analysis',data:{type:'FeatureCollection',features},options:{operation,field,weightField,distance,bandwidth,cellSize,sourceName:metadata[layer]?.name||layer,sourceId:layer,scope,id:'result-'+crypto.randomUUID()}},setProgress);
  const result=await job.current.promise;job.current=null;if(result.kind==='summary')setSummary(result);else onResult({...result,name:`${t(operationNames[operation])} · ${metadata[layer]?.name||layer}`});
 }catch(e){onError(e.message);}finally{job.current=null;setBusy(false);}};
 if(!Object.keys(dataset).length)return <div className="empty-workspace"><h3>{t('从自己的数据开始')}</h3><p>{t('导入图层后，可以查看属性、执行分析并下载结果。')}</p><button className="primary" onClick={onUpload}>{t('导入本地数据')}</button></div>;
 return <div className="analysis-panel"><h3>{t('空间分析')}</h3><label className="field-label">{t('输入图层')}<select aria-label={t('输入图层')} disabled={busy} value={layer} onChange={e=>onLayer(e.target.value)}>{Object.keys(dataset).map(k=><option key={k} value={k}>{t(metadata[k]?.name||k)}</option>)}</select></label>
 <label className="field-label">{t('分析工具')}<select aria-label={t('分析工具')} disabled={busy} value={operation} onChange={e=>{setOperation(e.target.value);setSummary(null);}}>{Object.entries(operationNames).map(([key,name])=><option key={key} value={key}>{t(name)}</option>)}</select></label>
 <label className="field-label">{t('分析范围')}<select aria-label={t('分析范围')} disabled={busy} value={scope} onChange={e=>setScope(e.target.value)}><option value="all">{t('全部要素')}</option><option value="selected">{t('仅已选要素')} ({selection.layer===layer?selection.ids.length:0})</option></select></label>
 {operation==='statistics'&&<label className="field-label">{t('统计字段')}<select aria-label={t('统计字段')} value={field} disabled={busy} onChange={e=>setField(e.target.value)}>{fields.map(f=><option key={f}>{f}</option>)}</select></label>}
 {operation==='buffer'&&<><label className="field-label">{t('缓冲距离（米）')}<input type="number" aria-label={t('缓冲距离（米）')} min="1" max="5000" disabled={busy} value={distance} onChange={e=>setDistance(e.target.value)}/></label><p className="help">{t('每个要素生成独立缓冲区，重叠部分不合并。')}</p></>}
 {operation==='measure'&&<p className="help">{t('面计算面积 m²，线计算长度 m；基于球面测地公式。')}</p>}
 {operation==='centroid'&&<p className="help">{t('代表点为几何顶点的平均位置，凹多边形的点可能位于面外；不是人口分配。')}</p>}
 {operation==='kde'&&<><label className="field-label">{t('带宽（米）')}<input type="number" aria-label={t('带宽（米）')} disabled={busy} min="10" max="5000" value={bandwidth} onChange={e=>setBandwidth(e.target.value)}/></label><label className="field-label">{t('网格边长（米）')}<input type="number" aria-label={t('网格边长（米）')} disabled={busy} min="5" value={cellSize} onChange={e=>setCellSize(e.target.value)}/></label><label className="field-label">{t('权重字段')}<select aria-label={t('权重字段')} disabled={busy} value={weightField} onChange={e=>setWeightField(e.target.value)}><option value="">{t('每个点权重为 1')}</option>{fields.map(f=><option key={f}>{f}</option>)}</select></label><p className="help">{t('仅接收点：高斯核、3 倍带宽截断并归一化，单位为点或权重/km²。MultiPoint 的每个点分别使用权重，不做研究区边界修正。')}</p></>}
 <div className="analysis-actions"><button className="primary" disabled={busy} onClick={run}>{busy?`${t('正在分析…')} ${progress}%`:t('运行分析')}</button>{busy&&<button className="secondary" onClick={()=>job.current?.cancel()}>{t('取消任务')}</button>}</div>
 <button className="secondary" disabled={busy} onClick={()=>onTable(layer)}>{t('打开属性表')}</button>
 {summary&&<div className="analysis-summary" role="status"><h3>{t('统计结果')}</h3><dl>{Object.entries(summary.values).map(([key,value])=><React.Fragment key={key}><dt>{t({count:'记录数',valid:'有效数值',missing:'空值',nonNumeric:'非数值',sum:'总和',mean:'平均值',min:'最小值',max:'最大值',median:'中位数'}[key])}</dt><dd>{value==null?'—':value.toLocaleString(lang==='en'?'en-US':'zh-CN',{maximumFractionDigits:3})}</dd></React.Fragment>)}</dl><button className="secondary" onClick={()=>downloadJSON(summary,'GeoCIM-statistics.json')}>{t('下载统计结果')}</button></div>}
 <p className="privacy-note">{t('分析在当前浏览器独立运行，结果可下载，不会发送给模型。')}</p></div>;
}
