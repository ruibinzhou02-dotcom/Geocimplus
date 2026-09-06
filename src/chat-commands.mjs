export const chatPresets=['打开属性表','选择高度超过50米的建筑','建筑透明度70%','显示人口网格','创建核密度电路'];
export function parseChat(text){
 if(typeof text!=='string'||text.length>1000)throw new Error('对话指令最多 1000 字。');
 const s=text.trim().replace(/[。!！?？]$/,'');
 if(/^(打开属性表|open attribute table)$/i.test(s))return {action:'table'};
 const select=s.match(/^(?:选择高度超过|select buildings taller than\s*)(\d+(?:\.\d+)?)\s*(?:米的建筑|m)$/i);
 if(select)return {action:'select',field:'height',operator:'gt',value:Number(select[1])};
 const opacity=s.match(/^(?:建筑透明度|set building transparency to\s*)(\d+(?:\.\d+)?)\s*%$/i);
 if(opacity){const value=Number(opacity[1]);if(value>100)throw new Error('透明度必须为0–100之间的数字');return {action:'opacity',value};}
 if(/^(显示人口网格|show population grid)$/i.test(s))return {action:'population'};
 if(/^(清除选择|clear selection)$/i.test(s))return {action:'clear'};
 if(/^(2d|二维视图)$/i.test(s))return {action:'view',threeD:false};
 if(/^(3d|三维视图)$/i.test(s))return {action:'view',threeD:true};
 if(/^(创建核密度电路|create density circuit|核密度分析)$/i.test(s))return {action:'circuit',template:'density'};
 if(/^(创建缓冲区电路|create buffer circuit)$/i.test(s))return {action:'circuit',template:'buffer'};
 if(/^(统计高度|summarize height)$/i.test(s))return {action:'statistics',field:'height'};
 throw new Error('本地预设未匹配。请使用下方示例；自由对话将在接入模型后开放。');
}
