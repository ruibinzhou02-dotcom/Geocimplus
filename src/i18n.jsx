import {circuitEnglish} from './circuit-i18n.mjs';
import {analysisEnglish} from './analysis-i18n.mjs';
import React,{createContext,useContext,useEffect,useMemo,useState} from 'react';
const en={...analysisEnglish,...circuitEnglish,
 '演示指令':'Demo commands','公开演示使用本地预设指令，尚未接入模型。':'This public demo uses local preset commands. No AI model is connected.',
 '导出 PNG':'Export PNG','正在导出…':'Exporting…','本地真实数据':'Local real data','公开演示':'Public demo','基础图层：模拟数据':'Base layers: synthetic data',
 '请选择一个不超过 32 MiB 的 GeoJSON 文件。':'Choose one GeoJSON file up to 32 MiB.',
 'GeoJSON 仅保留在当前浏览器页面，刷新后清除。坐标需为 WGS84 经纬度，最大 32 MiB。':'GeoJSON stays in this browser page and is cleared on refresh. WGS84 longitude/latitude required, up to 32 MiB.',

 '项目：沙头分析':'Project: Shatou analysis','沙头分析':'Shatou analysis','城市空间探索':'Spatial workspace','本地工作空间':'Local workspace','上传数据':'Upload data','对话':'Chat','图层':'Layers','属性表':'Attributes','上传':'Upload','探索助手':'Assistant','本地预设':'Local commands','本地预设指令':'Local commands','从一个操作开始':'Start with an action','打开属性表':'Open attribute table','选择高度超过50米的建筑':'Select buildings taller than 50 m','建筑透明度70%':'Set building transparency to 70%','显示人口网格':'Show population grid','按建筑高度着色':'Color buildings by height',
 '建筑':'Buildings','路网':'Roads','人口网格':'Population grid','边界':'Boundary','卫星底图':'Satellite basemap','（灰度）':' (grayscale)','灰度':'Grayscale','3D 建筑':'3D buildings','2D 平面':'2D map','重置视角':'Reset view','建筑数量':'Buildings','平均高度':'Mean height','最高建筑':'Tallest building','建筑离地高度':'Building height','米':'m','网格人数':'People per cell','正在加载城市空间…':'Loading project…','关闭要素属性':'Close feature properties','在属性表中选择':'Select in attribute table','关闭提示':'Dismiss message',
 '矢量图层':'Vector layers','定位图层':'Zoom to layer','底图':'Basemaps','浮动面板':'Floating panels','图层属性表':'Layer attributes','当前图层透明度':'Current layer transparency','当前选中要素透明度':'Selected feature transparency','建筑着色':'Building colors','建筑着色方式':'Building color scheme','按离地高度着色':'By building height','统一颜色':'Uniform color','统计卡与图例透明度':'Statistics and legend transparency','图层透明度':'Layer transparency','已选要素透明度':'Selected feature transparency','输入地图指令':'Enter a map command','例如：选择高度超过50米的建筑':'e.g. Select buildings taller than 50 m','发送指令':'Send command',
 '属性表图层':'Attribute table layer','关闭属性表':'Close attribute table','选择属性字段':'Attribute field','属性比较方式':'Comparison operator','属性比较值':'Comparison value','输入属性值':'Enter a value','按属性选择':'Select by attribute','清除选择':'Clear selection','定位已选要素':'Zoom to selection','仅查看已选':'Show selected rows only','0% 不透明 · 100% 完全透明':'0% opaque · 100% transparent','选择当前页':'Select this page','选择记录 ':'Select record ','空值':'Null','没有符合当前查看条件的记录':'No records to display','每页 50 条 · 地图保留所有要素':'50 rows per page · All features stay on the map','上一页':'Previous page','下一页':'Next page',
 '等于':'equals','不等于':'not equal','大于':'greater than','大于等于':'at least','小于':'less than','小于等于':'at most','包含':'contains','为空':'is empty','非空':'is not empty','已选 ':'Selected ',' 个要素':' features',' 个矢量图层 · 本地数据':' vector layers · Local data','属性':' properties',
 '数据类型':'Data type','上传数据类型':'Upload type','Shapefile 图层':'Shapefile layer','卫星影像':'Satellite imagery','选择文件或拖放到这里':'Choose files or drop them here','ZIP，或同时选择 shp / shx / dbf / prj':'ZIP, or select shp / shx / dbf / prj together','GeoTIFF，或完整影像数据集 ZIP':'GeoTIFF, or a complete imagery dataset ZIP','选择上传文件':'Choose upload files','属性编码':'Attribute encoding','上传属性编码':'Upload encoding','根据文件识别':'Detect from file','上传并添加到地图':'Upload and add to map','正在读取坐标与生成预览…':'Reading coordinates and creating preview…','文件保存在本机。单次最大 256 MiB；影像需带地理坐标。ZIP 可保留配套目录结构。':'Files stay on the server. Up to 256 MiB per upload; imagery must be georeferenced. ZIP preserves companion folders.',
 '在下方属性表中按字段选择，也可以勾选单条记录。选中的要素以金色显示。':'Select by a field below or check individual rows. Selected features are highlighted in gold.','可以打开属性表，按字段选择要素，再调整图层或选中要素的透明度。也可以上传自己的 Shapefile 和卫星影像。':'Open an attribute table to select features and adjust transparency, or upload your own Shapefile and satellite imagery.',
 '已打开属性表。':'Attribute table opened.','已清除选择。':'Selection cleared.','已显示人口网格。':'Population grid shown.','已按建筑高度着色。':'Buildings colored by height.','可试试：打开属性表、选择高度超过50米的建筑、建筑透明度70%、显示人口网格。':'Try: Open attribute table, Select buildings taller than 50 m, Set building transparency to 70%, or Show population grid.',
 '请选择有效字段和比较方式':'Choose a valid field and operator.','数值比较需要输入有效数字':'Enter a valid number for numeric comparisons.','透明度必须为0–100之间的数字':'Transparency must be a number between 0 and 100.','未知矢量图层':'Unknown vector layer','指令参数无效':'Invalid command parameters','图层参数无效':'Invalid layer parameters','未知指令':'Unknown command',
 'AI 设置':'AI settings','助手模式':'Assistant mode','等待配置密钥':'API key required','已配置，尚未测试':'Configured, not tested','连接成功':'Connection verified','连接测试':'Test connection','刷新配置':'Refresh configuration','正在连接…':'Connecting…','正在处理…':'Working…','模型':'Model','服务端配置':'Server configuration','在服务器运行 configure-ai.ps1，输入自己的 API Key。密钥不会进入网页。':'Run configure-ai.ps1 on the server and enter your API key. The key is never sent to the browser.','OpenAI 模式会发送对话、图层名称、字段和汇总统计；不发送坐标、影像或完整属性表。':'OpenAI mode sends chat, layer names, fields and summary statistics; no coordinates, imagery or complete attribute tables.','连接测试会发出一次小额计费的 API 请求。':'Testing makes one small billable API request.','切换语言':'Switch language','交互地图':'Interactive map','请选择本地预设，或先配置服务端 API Key。':'Use local commands or configure the server API key first.',
 '上传连接中断，请重试。':'Upload interrupted. Please try again.','数据导入失败':'Import failed.','请求失败，请重试。':'Request failed. Please try again.','未配置 OpenAI API Key。请在服务器运行 configure-ai.ps1。':'OpenAI API key is missing. Run configure-ai.ps1 on the server.','OpenAI 密钥无效或无权限。':'The OpenAI key is invalid or lacks access.','OpenAI 配额不足或请求过于频繁。':'OpenAI quota exceeded or rate limit reached.','OpenAI 服务或模型暂不可用。':'The OpenAI service or model is unavailable.','无法连接 OpenAI，请检查服务器网络和服务支持地区。':'Unable to reach OpenAI. Check the server connection and supported regions.','模型返回的操作无效，未执行。':'The model returned an invalid action. Nothing was executed.','请求太频繁，请稍后重试。':'Too many requests. Please try again shortly.','正在执行另一个请求，请稍后重试。':'Another request is running. Please try again shortly.'
};
export function translate(text,lang='zh'){
 if(lang!=='en'||typeof text!=='string')return text;
 if(Object.hasOwn(en,text))return en[text];
 if(text.startsWith('Circuit · '))return 'Circuit · '+translate(text.slice(10),lang);
 if(/^cell-[-\w]+: /.test(text)){const index=text.indexOf(': ');return text.slice(0,index+2)+translate(text.slice(index+2),lang);}
 if(/^第 \d+ 个要素几何无效/.test(text))return `Feature ${text.match(/\d+/)[0]} has invalid geometry. Repair it first.`;
 if(text.endsWith('（灰度）'))return translate(text.slice(0,-4),lang)+' (grayscale)';
 if(/^已选择 [\d,]+ 栋建筑/.test(text))return `Selected ${text.match(/[\d,]+/)[0]} buildings. Adjust selected feature transparency in the attribute table.`;
 if(/^建筑图层透明度已设为 /.test(text))return `Building transparency set to ${text.match(/\d+/)[0]}%.`;
 if(/^已选 [\d,]+ 个要素$/.test(text))return `Selected ${text.match(/[\d,]+/)[0]} features`;
 if(/^上传中 \d+%$/.test(text))return `Uploading ${text.match(/\d+/)[0]}%`;
 if(text.startsWith('已导入 '))return text.replace('已导入 ','Imported ').replace(' 个要素',' features').replace('灰度（第1波段）','Grayscale (band 1)').replace(' · 预览2–98%拉伸',' · 2–98% preview stretch');
 if(text.endsWith('透明度'))return `${translate(text.slice(0,-3),lang)} transparency`;
 if(text.startsWith('选择记录 '))return text.replace('选择记录 ','Select record ');
 if(text.startsWith('数据加载失败：'))return text.replace('数据加载失败：','Data load failed: ');
 return text;
}
const I18n=createContext({lang:'en',t:s=>s,setLang:()=>{}});
export function LanguageProvider({children}){
 const [lang,setLang]=useState(()=>{try{return localStorage.getItem('geocim.language')==='zh'?'zh':'en';}catch{return 'en';}});
 useEffect(()=>{document.documentElement.lang=lang==='en'?'en':'zh-CN';document.title=lang==='en'?'GeoCIM · Shatou analysis':'GeoCIM · 沙头分析';try{localStorage.setItem('geocim.language',lang);}catch{}},[lang]);
 const value=useMemo(()=>({lang,setLang,t:s=>translate(s,lang)}),[lang]);return <I18n.Provider value={value}>{children}</I18n.Provider>;
}
export const useI18n=()=>useContext(I18n);
