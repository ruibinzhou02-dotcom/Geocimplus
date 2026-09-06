export const initialState=()=>({minHeight:null,maxHeight:null,color:'height',threeD:true,buildings:true,roads:true,population:false,satellite:false,search:''});
export function validateAction(a){
 if(!a||typeof a!=='object'||Array.isArray(a))throw new Error('请求格式无效');
 const allowed={filter:['type','min','max'],color:['type','value'],layer:['type','name','visible'],view:['type','threeD'],search:['type','value'],reset:['type'],clear:['type']};
 if(!allowed[a.type]||Object.keys(a).some(k=>!allowed[a.type].includes(k)))throw new Error('不支持的操作或参数');
 if(a.type==='filter'){
  for(const key of ['min','max'])if(a[key]!=null&&(typeof a[key]!=='number'||!Number.isFinite(a[key])||a[key]<0||a[key]>2000))throw new Error('高度阈值应在0至2000米之间');
  if(a.min!=null&&a.max!=null&&a.min>=a.max)throw new Error('最低阈值必须小于最高阈值');
 }
 if(a.type==='color'&&!['height','uniform'].includes(a.value))throw new Error('当前只支持高度或统一着色；无年代、用途字段');
 if(a.type==='layer'&&(!['buildings','roads','population','satellite'].includes(a.name)||typeof a.visible!=='boolean'))throw new Error('图层或显示参数无效');
 if(a.type==='view'&&typeof a.threeD!=='boolean')throw new Error('视角参数无效');
 if(a.type==='search'&&(typeof a.value!=='string'||a.value.length>100))throw new Error('检索内容最多100字');
 return a;
}
export function executeAction(state,input){
 const a=validateAction(input);let next={...state};
 if(a.type==='filter')next={...next,minHeight:a.min??null,maxHeight:a.max??null};
 if(a.type==='color')next.color=a.value;
 if(a.type==='layer')next[a.name]=a.visible;
 if(a.type==='view')next.threeD=a.threeD;
 if(a.type==='search')next.search=a.value.trim();
 if(a.type==='clear')next={...next,minHeight:null,maxHeight:null,search:''};
 if(a.type==='reset')next=initialState();
 return next;
}
export function selectBuildings(features,state){return features.filter(f=>{
 const p=f.properties,h=p.height;
 return (state.minHeight==null||(typeof h==='number'&&h>state.minHeight))&&(state.maxHeight==null||(typeof h==='number'&&h<state.maxHeight))&&(!state.search||[p.gml_id,p.objectid_1,p.stable_id].some(v=>String(v).includes(state.search)));
});}
export function summarize(features){
 const hs=features.map(f=>f.properties.height).filter(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0).sort((a,b)=>a-b);
 return {count:features.length,validHeights:hs.length,mean:hs.length?hs.reduce((a,b)=>a+b,0)/hs.length:null,max:hs.length?hs.at(-1):null,median:hs.length?(hs[Math.floor((hs.length-1)/2)]+hs[Math.floor(hs.length/2)])/2:null};
}
export function parsePreset(text){
 const s=text.trim().replace(/[。！!？?]/g,'');
 if(/年代|年以前|年之前|用途|老旧/.test(s))throw new Error('没有建成年代或用途字段，无法执行；“老旧”也未定义阈值。');
 if(/24小时|动态|时间变化|消防|火灾|服务范围/.test(s))throw new Error('当前数据不支持此功能；没有多时段数据或经过验证的消防路网模型。');
 if(/^(清除筛选|清空筛选)$/.test(s))return {type:'clear'};
 if(/^(复位|重置地图|复位地图)$/.test(s))return {type:'reset'};
 if(/^(按建筑高度着色|按高度着色|高度着色)$/.test(s))return {type:'color',value:'height'};
 if(/^(统一着色|紫色建筑)$/.test(s))return {type:'color',value:'uniform'};
 if(/^(二维视图|切换二维|2D)$/.test(s))return {type:'view',threeD:false};
 if(/^(三维视图|切换三维|3D)$/.test(s))return {type:'view',threeD:true};
 const layer=s.match(/^(显示|隐藏)(人口网格|路网|建筑|卫星底图)$/);
 if(layer)return {type:'layer',name:{人口网格:'population',路网:'roads',建筑:'buildings',卫星底图:'satellite'}[layer[2]],visible:layer[1]==='显示'};
 const f=s.match(/^(?:仅显示|筛选|显示)?(?:建筑)?高度(?:超过|大于|高于)(\d+(?:\.\d+)?)米(?:的建筑)?$/);
 if(f)return validateAction({type:'filter',min:Number(f[1]),max:null});
 if(/^(统计|当前统计|有多少建筑|统计建筑数量)$/.test(s))return {type:'stats'};
 if(s.includes('高层'))throw new Error('“高层”未设分类阈值，请明确输入“高度超过50米的建筑”等数值条件。');
 throw new Error('本地预设模式未匹配此指令。可尝试“按建筑高度着色”“仅显示高度超过50米的建筑”“显示人口网格”。');
}
