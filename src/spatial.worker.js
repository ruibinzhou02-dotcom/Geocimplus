import {importFiles} from './import-local.mjs';
import {analyze} from './spatial-analysis.mjs';
import {runCircuit} from './circuit.mjs';
self.onmessage=async({data})=>{
 try{const progress=(value,detail={})=>self.postMessage({progress:value,...detail});const result=data.job==='import'?await importFiles(data.files,data.options,progress):data.job==='circuit'?runCircuit(data.graph,data.dataset,data.metadata,data.runId,progress):analyze(data.data,data.options,progress);self.postMessage({result});}
 catch(e){self.postMessage({error:e.message||'任务失败。'});}
};
