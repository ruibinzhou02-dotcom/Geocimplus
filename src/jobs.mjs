export function runJob(payload,onProgress=()=>{}){
 const worker=new Worker(new URL('./spatial.worker.js',import.meta.url),{type:'module'});
 let rejectJob,timer;
 const promise=new Promise((resolve,reject)=>{
  rejectJob=reject;timer=setTimeout(()=>{worker.terminate();reject(new Error('任务超时，请缩小数据范围后重试。'));},90000);
  worker.onmessage=({data})=>{if(data.progress!=null){onProgress(data.progress,data);return;}clearTimeout(timer);worker.terminate();data.error?reject(new Error(data.error)):resolve(data.result);};
  worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(new Error('任务无法完成，请检查数据格式或缩小范围。'));};
  worker.postMessage(payload);
 });
 return {promise,cancel(){clearTimeout(timer);worker.terminate();rejectJob(new Error('已取消任务。'));}};
}
