import React,{useState,useRef,useEffect} from 'react';
import {Upload,FileArchive,Check} from 'lucide-react';
import {useI18n} from './i18n.jsx';
import {runJob} from './jobs.mjs';
export default function UploadPanel({onImported,onError,layerCount=0}){
 const {t}=useI18n(),job=useRef(null);
 const [files,setFiles]=useState([]),[encoding,setEncoding]=useState('auto'),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[success,setSuccess]=useState('');
 useEffect(()=>()=>job.current?.cancel(),[]);
 const upload=async()=>{setBusy(true);setSuccess('');onError('');setProgress(0);try{
  if(layerCount>=20)throw new Error('当前工作空间最多 20 个图层，请先移除部分图层。');
  job.current=runJob({job:'import',files,options:{encoding}},setProgress);const items=await job.current.promise;job.current=null;
  if(layerCount+items.length>20)throw new Error('当前工作空间最多 20 个图层，请先移除部分图层。');
  onImported(items);setFiles([]);setSuccess('导入完成，已加入我的数据。');
 }catch(e){onError(e.message);}finally{job.current=null;setBusy(false);}};
 return <div className="upload-panel"><h3>{t('导入本地数据')}</h3><p className="privacy-note">{t('文件仅在你的浏览器内处理，不上传服务器，不与其他访客共享。刷新页面会清除，请及时下载结果。')}</p>
 <label className="upload-zone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)setFiles([...e.dataTransfer.files]);}}><Upload size={27}/><b>{t('选择文件或拖放到这里')}</b><span>GeoJSON · SHP / ZIP · GeoTIFF</span><input aria-label={t('选择上传文件')} type="file" multiple disabled={busy} accept=".geojson,.json,.zip,.shp,.shx,.dbf,.prj,.cpg,.sbn,.sbx,.tif,.tiff" onChange={e=>{setFiles([...e.target.files]);setSuccess('');e.target.value='';}}/></label>
 <p className="help">{t('SHP 需同时选择同名 shp、shx、dbf、prj；或上传包含它们的 ZIP。GeoJSON 需为 WGS84 经纬度。每次最多 64 MiB。')}</p>
 {files.length>0&&<div className="upload-files">{files.map((f,i)=><div key={i}><FileArchive size={14}/><span>{f.name}</span><small>{(f.size/1024**2).toFixed(2)} MiB</small></div>)}</div>}
 <label className="field-label">{t('属性编码')}<select aria-label={t('上传属性编码')} disabled={busy} value={encoding} onChange={e=>setEncoding(e.target.value)}><option value="auto">{t('CPG 优先，否则 UTF-8')}</option><option value="UTF-8">UTF-8</option><option value="GBK">GBK</option><option value="GB18030">GB18030</option></select></label>
 <button className="primary" disabled={busy||!files.length} onClick={upload}>{busy?`${t('正在处理…')} ${progress}%`:t('导入到我的数据')}</button>{busy&&<button className="secondary" onClick={()=>job.current?.cancel()}>{t('取消任务')}</button>}
 <p className="help">{t('GeoTIFF 自动读取地理坐标，显示第 1 波段灰度预览；像元统计基于预览采样。原始文件不会改写。')}</p>
 {success&&<div className="upload-success" role="status"><Check size={17}/>{t(success)}</div>}</div>;
}
