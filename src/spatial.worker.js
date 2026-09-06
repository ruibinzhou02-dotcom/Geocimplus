import {importFiles} from './import-local.mjs';
import {analyze} from './spatial-analysis.mjs';
self.onmessage=async({data})=>{
 try{const progress=value=>self.postMessage({progress:value});const result=data.job==='import'?await importFiles(data.files,data.options,progress):analyze(data.data,data.options,progress);self.postMessage({result});}
 catch(e){self.postMessage({error:e.message||'任务失败。'});}
};
