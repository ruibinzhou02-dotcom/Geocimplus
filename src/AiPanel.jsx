import React,{useState} from 'react';
import {useI18n} from './i18n.jsx';
export default function AiPanel({status,onRefresh,onError}){
 const {t}=useI18n(),[testing,setTesting]=useState(false);
 const test=async()=>{setTesting(true);onError('');try{const r=await fetch('/api/ai/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const body=await r.json();if(!r.ok)throw new Error(body.detail||'请求失败，请重试。');await onRefresh();}catch(e){onError(e.message);}finally{setTesting(false);}};
 return <div className="ai-panel"><h3>{t('AI 设置')}</h3><div className="ai-status"><b>OpenAI API</b><span>{t(!status?.configured?'等待配置密钥':status.verified?'连接成功':'已配置，尚未测试')}</span></div><p>{t('模型')} · {status?.model||'gpt-4.1-mini'}</p><div className="layer-actions"><button onClick={onRefresh} disabled={testing}>{t('刷新配置')}</button><button onClick={test} disabled={testing||!status?.configured}>{t(testing?'正在连接…':'连接测试')}</button></div><p className="help">{t('连接测试会发出一次小额计费的 API 请求。')}</p><h3>{t('服务端配置')}</h3><p className="help">{t('在服务器运行 configure-ai.ps1，输入自己的 API Key。密钥不会进入网页。')}</p><p className="help">{t('OpenAI 模式会发送对话、图层名称、字段和汇总统计；不发送坐标、影像或完整属性表。')}</p></div>;
}
