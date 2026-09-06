import React,{useState} from 'react';
import {Upload,FileArchive,Check} from 'lucide-react';

export default function UploadPanel({onImported,onError}) {
 const [files,setFiles]=useState([]),[kind,setKind]=useState('vector'),[encoding,setEncoding]=useState('auto'),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[success,setSuccess]=useState('');
 const upload=()=>{
  if(!files.length)return;setBusy(true);setProgress(0);setSuccess('');onError('');
  const body=new FormData();for(const f of files)body.append('files',f);body.append('kind',kind);body.append('encoding',encoding);
  const xhr=new XMLHttpRequest();xhr.open('POST','/api/uploads');xhr.upload.onprogress=e=>e.lengthComputable&&setProgress(Math.round(e.loaded/e.total*100));
  xhr.onerror=()=>{onError('上传连接中断，请重试。');setBusy(false);};
  xhr.onload=async()=>{try{const result=JSON.parse(xhr.responseText);if(xhr.status!==200)throw new Error(typeof result.detail==='string'?result.detail:'数据导入失败');await onImported(result);setSuccess(`已导入 ${result.name}${result.kind==='vector'?` · ${result.count.toLocaleString()} 个要素`:` · ${result.display}`}`);setFiles([]);}catch(e){onError(e.message);}finally{setBusy(false);}};
  xhr.send(body);
 };
 return <div className="upload-panel"><h3>上传数据</h3><label className="field-label">数据类型<select aria-label="上传数据类型" disabled={busy} value={kind} onChange={e=>{setKind(e.target.value);setFiles([]);setSuccess('');}}><option value="vector">Shapefile 图层</option><option value="raster">卫星影像</option></select></label>
 <label className={'upload-zone '+(busy?'busy':'')} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)setFiles([...e.dataTransfer.files]);}}><Upload size={27}/><b>选择文件或拖放到这里</b><span>{kind==='vector'?'ZIP，或同时选择 shp / shx / dbf / prj':'GeoTIFF，或完整影像数据集 ZIP'}</span><input aria-label="选择上传文件" type="file" multiple disabled={busy} accept={kind==='vector'?'.zip,.shp,.shx,.dbf,.prj,.cpg,.sbn,.sbx,.xml':'.zip,.tif,.tiff,.png,.jpg,.jpeg,.prj,.tfw,.pgw,.jgw,.wld'} onChange={e=>{setFiles([...e.target.files]);setSuccess('');e.target.value='';}}/></label>
 {files.length>0&&<div className="upload-files">{files.map((f,i)=><div key={i}><FileArchive size={14}/><span>{f.name}</span><small>{(f.size/1024**2).toFixed(2)} MiB</small></div>)}</div>}
 {kind==='vector'&&<label className="field-label">属性编码<select aria-label="上传属性编码" value={encoding} disabled={busy} onChange={e=>setEncoding(e.target.value)}><option value="auto">根据文件识别</option><option value="UTF-8">UTF-8</option><option value="GBK">GBK</option><option value="GB18030">GB18030</option></select></label>}
 <button className="primary" disabled={busy||!files.length} onClick={upload}>{busy?(progress<100?`上传中 ${progress}%`:'正在读取坐标与生成预览…'):'上传并添加到地图'}</button>
 <p className="help">文件保存在本机。单次最大 256 MiB；影像需带地理坐标。ZIP 可保留配套目录结构。</p>
 {success&&<div className="upload-success" role="status"><Check size={17}/>{success}</div>}</div>;
}
