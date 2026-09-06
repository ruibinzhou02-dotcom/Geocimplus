import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import * as Switch from '@radix-ui/react-switch';
import {Layers3,RotateCcw,ArrowUp,Building2,Layers,MessageSquare,X,Table2,Upload} from 'lucide-react';
import {featureId,selectByAttribute,summarize,updateTransparency} from './controls.mjs';
import MapView,{geometryBounds} from './MapView.jsx';
import AttributeTable,{Transparency} from './AttributeTable.jsx';
import UploadPanel from './UploadPanel.jsx';
import './style.css';
import './workspace.css';
import './bilingual.css';
import {LanguageProvider,useI18n} from './i18n.jsx';
import AiPanel from './AiPanel.jsx';

const baseNames={buildings:'建筑',roads:'路网',population:'人口网格',boundary:'边界'};
const initialSettings={buildings:{visible:true,transparency:35,selectedTransparency:15},roads:{visible:true,transparency:15,selectedTransparency:15},population:{visible:false,transparency:55,selectedTransparency:15},boundary:{visible:true,transparency:80,selectedTransparency:15},satellite:{visible:false,transparency:0}};
async function getJSON(url){const r=await fetch(url);if(!r.ok)throw new Error('数据加载失败：'+r.status);return r.json();}
function Toggle({label,checked,onChange}){const {t}=useI18n();return <div className="toggle"><span>{t(label)}</span><Switch.Root className="switch" aria-label={t(label)} checked={checked} onCheckedChange={onChange}><Switch.Thumb className="thumb"/></Switch.Root></div>;}
function App(){
 const {lang,setLang,t}=useI18n();
 const [aiStatus,setAiStatus]=useState(null),[aiMode,setAiMode]=useState('local'),[aiBusy,setAiBusy]=useState(false);
 const refreshAI=async()=>{try{setAiStatus(await getJSON('/api/ai/status'));}catch(e){setError(e.message);}};
 useEffect(()=>{refreshAI();},[]);
 const [catalog,setCatalog]=useState(null),[dataset,setDataset]=useState({}),[metadata,setMetadata]=useState({}),[rasters,setRasters]=useState([]),[settings,setSettings]=useState(initialSettings),[ready,setReady]=useState(false),[error,setError]=useState('');
 const [tab,setTab]=useState('dialog'),[selection,setSelection]=useState({layer:'buildings',ids:[]}),[picked,setPicked]=useState(null),[tableOpen,setTableOpen]=useState(false),[tableLayer,setTableLayer]=useState('buildings'),[threeD,setThreeD]=useState(true),[color,setColor]=useState('height'),[camera,setCamera]=useState(null),[panelTransparency,setPanelTransparency]=useState(62);
 const [input,setInput]=useState(''),[messages,setMessages]=useState([]);
 useEffect(()=>{(async()=>{
  const [c,buildings,roads,population,boundary,uploads]=await Promise.all(['/api/catalog','/api/layers/buildings','/api/layers/roads','/api/layers/population','/api/layers/boundary','/api/uploads'].map(getJSON));
  const data={buildings,roads,population,boundary},metas=Object.fromEntries(Object.entries(baseNames).map(([id,name])=>[id,{id,name,idField:'stable_id',kind:'vector'}]));
  const images=[{id:'satellite',name:'卫星底图',display:'灰度',url:'/api/satellite.png',coordinates:c.satellite.coordinates}],nextSettings={...initialSettings};
  for(const item of uploads){metas[item.id]=item;nextSettings[item.id]={visible:true,transparency:item.kind==='raster'?0:35,selectedTransparency:15};if(item.kind==='vector')data[item.id]=await getJSON(item.url);else images.push(item);}
  setDataset(data);setMetadata(metas);setRasters(images);setSettings(nextSettings);setThreeD(c.height_enabled);setCatalog(c);
 })().catch(e=>setError(e.message));},[]);
 const stats=useMemo(()=>summarize(dataset.buildings?.features||[]),[dataset]);
 const toggle=(key,value)=>setSettings(s=>({...s,[key]:{...s[key],visible:value}}));
 const opacity=(layer,value,scope='layer')=>setSettings(s=>updateTransparency(s,{layer,value,scope},Object.keys(s)));
 const select=next=>{setSelection(next);setPicked(null);};
 const openTable=(layer=tableLayer)=>{setTableLayer(layer);setTableOpen(true);setTab('attributes');};
 const locate=features=>{const bounds=geometryBounds(features);if(bounds)setCamera({bounds,token:Date.now()});};
 const reset=()=>{select({layer:tableLayer,ids:[]});setCamera({token:Date.now()});setError('');};
 const imported=async item=>{if(item.kind==='vector'){const data=await getJSON(item.url);setDataset(s=>({...s,[item.id]:data}));setTableLayer(item.id);}else setRasters(s=>[...s,item]);setMetadata(s=>({...s,[item.id]:item}));setSettings(s=>({...s,[item.id]:{visible:true,transparency:item.kind==='raster'?0:35,selectedTransparency:15}}));setCamera({bounds:item.bounds,token:Date.now()});};
 const execute=args=>{
  if(!args||typeof args!=='object')throw new Error('指令参数无效');const {action,layer='buildings'}=args;
  if(action==='select'){if(!dataset[layer])throw new Error('未知矢量图层');const ids=selectByAttribute(dataset[layer].features,args,metadata[layer]?.idField||'stable_id');select({layer,ids});openTable(layer);return {selected:ids.length};}
  if(action==='opacity'){updateTransparency(settings,args,Object.keys(settings));opacity(layer,args.value,args.scope||'layer');return {transparency:Number(args.value)};}
  if(action==='layer'){if(!settings[layer]||typeof args.visible!=='boolean')throw new Error('图层参数无效');toggle(layer,args.visible);return {visible:args.visible};}
  if(action==='table'){if(!dataset[layer])throw new Error('未知矢量图层');openTable(layer);return {opened:layer};}
  if(action==='clear'){select({layer:tableLayer,ids:[]});return {selected:0};}
  if(action==='color'&&['height','uniform'].includes(args.mode)){setColor(args.mode);return {color:args.mode};}
  if(action==='view'&&typeof args.threeD==='boolean'){setThreeD(args.threeD);return {threeD:args.threeD};}
  if(action==='reset'){reset();return {reset:true};}
  throw new Error('未知指令');
 };
 const sendLocal=text=>{if(!text.trim())return;setInput('');let answer;try{
  const raw=text.trim(),presets={'Open attribute table':'打开属性表','Show population grid':'显示人口网格','Clear selection':'清除选择','Color buildings by height':'按建筑高度着色'},q=presets[raw]||raw,height=q.match(/^(?:选择|选中)(?:建筑)?高度(?:超过|大于)(\d+(?:\.\d+)?)米(?:的建筑)?$/)||q.match(/^select buildings (?:taller than|higher than|over) (\d+(?:\.\d+)?)\s*m(?:etres|eters)?$/i),alpha=q.match(/^建筑透明度(?:设为|调为)?(\d+)%$/)||q.match(/^set building transparency to (\d+)%$/i);
  if(height){const r=execute({action:'select',layer:'buildings',field:'height',operator:'gt',value:height[1]});answer=`已选择 ${r.selected.toLocaleString()} 栋建筑，可在属性表中调整选中要素的透明度。`;}
  else if(q==='打开属性表'){execute({action:'table',layer:tableLayer});answer='已打开属性表。';}
  else if(q==='清除选择'){execute({action:'clear'});answer='已清除选择。';}
  else if(q==='显示人口网格'){execute({action:'layer',layer:'population',visible:true});answer='已显示人口网格。';}
  else if(q==='按建筑高度着色'){execute({action:'color',mode:'height'});answer='已按建筑高度着色。';}
  else if(alpha){execute({action:'opacity',layer:'buildings',value:Number(alpha[1])});answer=`建筑图层透明度已设为 ${alpha[1]}%。`;}
  else answer='可试试：打开属性表、选择高度超过50米的建筑、建筑透明度70%、显示人口网格。';
 }catch(e){answer=e.message;}setMessages(s=>[...s,{role:'user',text},{role:'assistant',text:answer}]);};
 const send=async text=>{
  if(aiBusy||!text.trim())return;
  if(aiMode==='local'){sendLocal(text);return;}
  setInput('');setAiBusy(true);setError('');
  const history=messages.slice(-8).map(m=>({role:m.role,content:m.text.slice(0,4000)}));
  setMessages(s=>[...s,{role:'user',text}]);
  try{
   const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,language:lang,history,current_layer:selection.ids.length?selection.layer:tableLayer,selected_count:selection.ids.length})});
   const result=await response.json();if(!response.ok)throw new Error(typeof result.detail==='string'?result.detail:'请求失败，请重试。');
   const results=result.actions.map(action=>({action:action.action,result:execute(action)}));
   const receipts=results.map(({action,result:r})=>lang==='en'?(r.selected!=null?`Selected ${r.selected.toLocaleString()} features.`:r.transparency!=null?`Transparency set to ${r.transparency}%.`:`Applied: ${action}.`):(r.selected!=null?`已选 ${r.selected.toLocaleString()} 个要素`:r.transparency!=null?`透明度已设为 ${r.transparency}%。`:`已执行：${{layer:'图层显示',table:'打开属性表',color:'建筑着色',view:'视角切换',reset:'重置视角'}[action]||action}。`));
   setMessages(s=>[...s,{role:'assistant',text:[result.reply,...receipts].filter(Boolean).join('\n'),api:true}]);await refreshAI();
  }catch(e){setError(e.message);setMessages(s=>[...s,{role:'assistant',text:e.message}]);}finally{setAiBusy(false);}
 };
 useEffect(()=>{
  if(!catalog||!document.modelContext?.registerTool)return;const controller=new AbortController();
  try{document.modelContext.registerTool({name:'geocim_edit_view',description:'操作本地 GeoCIM：打开属性表、按属性选择、设置透明度和图层显示。透明度0不透明，100完全透明。',inputSchema:{type:'object',properties:{action:{enum:['select','opacity','layer','table','clear','color']},layer:{type:'string'},field:{type:'string'},operator:{enum:['eq','ne','gt','gte','lt','lte','contains','empty','notempty']},value:{type:['string','number']},scope:{enum:['layer','selected']},visible:{type:'boolean'},mode:{enum:['height','uniform']}},required:['action']},execute:async args=>{try{return {content:[{type:'text',text:JSON.stringify(execute(args))}]};}catch(e){return {content:[{type:'text',text:e.message}],isError:true};}}},{signal:controller.signal});}catch(e){console.debug('本地视图工具注册：',e.message);}return()=>controller.abort();
 },[catalog,dataset,metadata,settings,tableLayer]);
 const tabs=[['dialog',MessageSquare,'对话'],['layers',Layers,'图层'],['attributes',Table2,'属性表'],['upload',Upload,'上传']];
 const layerControls=key=><div className="layer-row" key={key}><Toggle label={t(metadata[key]?.name||key)} checked={!!settings[key]?.visible} onChange={v=>toggle(key,v)}/><p>{dataset[key].features.length.toLocaleString()}{t(" 个要素")}</p><Transparency label={t((metadata[key]?.name||key)+'透明度')} value={settings[key]?.transparency??30} onChange={v=>opacity(key,v)}/><div className="layer-actions"><button onClick={()=>openTable(key)}>{t("属性表")}</button><button onClick={()=>locate(dataset[key].features)}>{t("定位图层")}</button></div></div>;
 const panelControl=<Transparency label={t("统计卡与图例透明度")} value={panelTransparency} onChange={setPanelTransparency}/>;
 return <div className="app" style={{'--panel-alpha':1-panelTransparency/100}}><header className="topbar"><div className="brand"><div className="brand-icon"><Layers3 size={24}/></div><b>GeoCIM</b></div><div className="top-meta"><span className="local-dot"/>{t("本地工作空间")}<button className="ai-settings-button" onClick={()=>{setTab('ai');refreshAI();}}>{t("AI 设置")}</button><div className="language-switch" aria-label={t('切换语言')}><button aria-pressed={lang==='zh'} onClick={()=>setLang('zh')}>{t("中文")}</button><button aria-pressed={lang==='en'} onClick={()=>setLang('en')}>English</button></div><button className="upload-top" onClick={()=>setTab('upload')}><Upload size={15}/>{t("上传数据")}</button></div></header>
 <main><section className={'map-area '+(tableOpen?'with-table':'')}>
 {catalog&&<MapView catalog={catalog} dataset={dataset} metadata={metadata} rasters={rasters} settings={settings} selection={selection} threeD={threeD} color={color} camera={camera} tableOpen={tableOpen} onPick={setPicked} onReady={v=>{setReady(v);setCamera({token:Date.now()});}} onError={setError}/>}
 <div className="map-title"><h1>{t('项目：沙头分析')}</h1></div>
 <div className="map-toolbar"><button className={threeD?'selected':''} onClick={()=>setThreeD(!threeD)}>{t(threeD?'3D 建筑':'2D 平面')}</button><button className={settings.satellite?.visible?'selected':''} onClick={()=>toggle('satellite',!settings.satellite?.visible)}>{t("卫星底图")}</button><button aria-label={t("重置视角")} title={t("重置视角")} onClick={reset}><RotateCcw size={17}/></button></div>
 <div className="stats-bar"><div><span>{t("建筑数量")}</span><strong>{stats.count.toLocaleString()}</strong></div><div><span>{t("平均高度")}</span><strong>{t(stats.mean?.toFixed(1)??'—')}<small>{t("米")}</small></strong></div><div><span>{t("最高建筑")}</span><strong>{t(stats.max??'—')}<small>{t("米")}</small></strong></div></div>
 <div className="legend"><b>{t("建筑离地高度")}</b><span className="legend-unit">{t("米")}</span>{color==='height'?<><div className="legend-ramp"/><div className="legend-ticks"><span>0</span><span>30</span><span>60</span><span>100</span><span>200+</span></div></>:<div className="uniform-key"/>}{settings.population?.visible&&<div className="pop-legend"><b>{t("网格人数")}</b><div className="pop-ramp"/><div className="legend-ticks"><span>0</span><span>300</span><span>700</span><span>1,500</span><span>3,000+</span></div></div>}</div>
 {!ready&&<div className="loading">{t(error||'正在加载城市空间…')}</div>}
 {picked&&<div className="property-card"><div className="property-heading"><b>{t(metadata[picked.layer]?.name)}{t("属性")}</b><button aria-label={t("关闭要素属性")} onClick={()=>setPicked(null)}><X size={16}/></button></div><dl>{Object.entries(picked.feature.properties).map(([k,v])=><React.Fragment key={k}><dt>{k}</dt><dd>{v==null?'NULL':String(v)}</dd></React.Fragment>)}</dl><button className="secondary" onClick={()=>{select({layer:picked.layer,ids:[featureId(picked.feature,metadata[picked.layer]?.idField||'stable_id')]});openTable(picked.layer);}}>{t("在属性表中选择")}</button></div>}
 {tableOpen&&<AttributeTable dataset={dataset} metadata={metadata} layer={tableLayer} onLayer={setTableLayer} selection={selection} onSelection={select} onClose={()=>setTableOpen(false)} settings={settings} onOpacity={opacity} onLocate={locate} onError={setError}/>}
 </section><aside><div className="aside-heading"><div><Layers3 size={21}/><h2>{t("探索助手")}</h2></div><select className="mode-select" aria-label={t('助手模式')} value={aiMode} disabled={aiBusy} onChange={e=>setAiMode(e.target.value)}><option value="local">{t('本地预设')}</option><option value="openai">OpenAI API</option></select></div><nav className="tabs">{tabs.map(([key,Icon,label])=><button key={key} className={tab===key?'active':''} onClick={()=>{setTab(key);if(key==='attributes')setTableOpen(true);}}><Icon size={15}/>{t(label)}</button>)}</nav>
 <div className="aside-scroll">{error&&<div className="error" role="alert"><button aria-label={t("关闭提示")} onClick={()=>setError('')}><X size={14}/></button>{t(error)}</div>}
 {tab==='dialog'&&<><div className="context-card"><div className="context-icon"><Building2 size={21}/></div><div><b>{t('项目：沙头分析')}</b></div></div><div className="chat-messages">{messages.map((m,i)=><div key={i} className={'message '+m.role}>{m.role==='assistant'&&<span className="message-label">GEOCIM</span>}<p>{m.api||m.role==='user'?m.text:t(m.text)}</p></div>)}</div><div className="suggestions"><span>{t("从一个操作开始")}</span>{['打开属性表','选择高度超过50米的建筑','建筑透明度70%','显示人口网格'].map(suggestion=><button key={suggestion} onClick={()=>send(t(suggestion))}>{t(suggestion)}<ArrowUp size={14}/></button>)}</div></>}
 {tab==='layers'&&<><h3>{t("矢量图层")}</h3>{Object.keys(dataset).map(layerControls)}<h3>{t("底图")}</h3>{rasters.map(r=><div className="layer-row" key={r.id}><Toggle label={t(r.name+(r.display?.includes('灰度')?'（灰度）':''))} checked={!!settings[r.id]?.visible} onChange={v=>toggle(r.id,v)}/><Transparency label={t(r.name+'透明度')} value={settings[r.id]?.transparency??0} onChange={v=>opacity(r.id,v)}/></div>)}<h3>{t("浮动面板")}</h3>{t(panelControl)}</>}
 {tab==='attributes'&&<><h3>{t("图层属性表")}</h3><div className="attribute-layer-list">{Object.keys(dataset).map(key=><button className={key===tableLayer?'selected':''} key={key} onClick={()=>openTable(key)}><Table2 size={16}/><span>{t(metadata[key]?.name)}</span><small>{dataset[key].features.length.toLocaleString()}</small></button>)}</div><div className="selection-summary"><b>{t(metadata[tableLayer]?.name)}</b><span>{t("已选 ")}{t(selection.layer===tableLayer?selection.ids.length.toLocaleString():0)}{t(" 个要素")}</span></div><Transparency label={t("当前图层透明度")} value={settings[tableLayer]?.transparency??30} onChange={v=>opacity(tableLayer,v)}/><Transparency label={t("当前选中要素透明度")} value={settings[tableLayer]?.selectedTransparency??15} disabled={selection.layer!==tableLayer||!selection.ids.length} onChange={v=>opacity(tableLayer,v,'selected')}/><p className="help">{t("在下方属性表中按字段选择，也可以勾选单条记录。选中的要素以金色显示。")}</p><h3>{t("建筑着色")}</h3><select aria-label={t("建筑着色方式")} value={color} onChange={e=>setColor(e.target.value)}><option value="height">{t("按离地高度着色")}</option><option value="uniform">{t("统一颜色")}</option></select><h3>{t("浮动面板")}</h3>{t(panelControl)}</>}
 {tab==='ai'&&<AiPanel status={aiStatus} onRefresh={refreshAI} onError={setError}/>}
 {tab==='upload'&&<UploadPanel onImported={imported} onError={setError}/>}
 </div><div className="composer"><form onSubmit={e=>{e.preventDefault();send(input);}}><textarea aria-label={t("输入地图指令")} placeholder={t("例如：选择高度超过50米的建筑")} disabled={aiBusy} maxLength={2000} rows={2} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(input);}}}/><button type="submit" disabled={aiBusy} aria-label={t("发送指令")}><ArrowUp size={17}/></button></form><p>{t(aiBusy?'正在处理…':aiMode==='openai'?(aiStatus?.configured?'OpenAI API':'等待配置密钥'):'本地预设指令')}</p></div></aside></main></div>;
}
createRoot(document.getElementById('root')).render(<LanguageProvider><App/></LanguageProvider>);
