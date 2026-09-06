import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanGraph,demoGraph,runCircuit} from '../src/circuit.mjs';
import {parseChat} from '../src/chat-commands.mjs';
const dataset={buildings:{type:'FeatureCollection',features:[20,60,100].map((height,i)=>({type:'Feature',properties:{height,stable_id:'b'+i},geometry:{type:'Point',coordinates:[114+i*.001,22.5]}}))}};
test('connected selection-buffer circuit executes real data and preserves source',()=>{
 const graph=demoGraph('buildings','buffer'),before=JSON.stringify(dataset);
 const updates=[];const r=runCircuit(graph,dataset,{},'test',(percent,detail)=>updates.push({percent,log:detail.log}));
 assert.deepEqual(updates.map(u=>u.log.length),[1,2,3,4,5]);assert.equal(updates.at(-1).percent,100);
 assert.equal(r.outputs[0].data.features.length,2);assert.equal(r.log.length,5);assert.equal(r.outputs[0].data.features[0].geometry.type,'Polygon');assert.equal(JSON.stringify(dataset),before);
});
test('circuit rejects cyclic edges, duplicate wires and incompatible summary connections',()=>{
 const g=demoGraph();assert.throws(()=>cleanGraph({...g,edges:[...g.edges,{source:'cell-2',target:'cell-1'}]}));
 assert.throws(()=>cleanGraph({...g,edges:[...g.edges,g.edges[0]]}));
 const s=demoGraph('buildings','statistics');s.nodes[2].type='buffer';s.nodes[2].params={distance:100};assert.throws(()=>cleanGraph(s),/不兼容/);
});
test('invalid or missing inputs fail without publishing partial outputs',()=>{
 assert.throws(()=>runCircuit(demoGraph('missing'),dataset,{}),/不存在/);
 const g=demoGraph();g.edges=[];assert.throws(()=>runCircuit(g,dataset,{}),/输入端口/);
});
test('recipe accepts local steps and refuses arbitrary JavaScript',()=>{
 const g=demoGraph('buildings','statistics');g.nodes[1]={...g.nodes[1],type:'recipe',params:{steps:[{operation:'centroid'},{operation:'buffer',distance:100}]}};
 assert.equal(runCircuit(g,dataset,{}).outputs[0].data.features.length,3);
 g.nodes[1].params.steps=[{operation:'eval',code:'alert(1)'}];assert.throws(()=>cleanGraph(g),/白名单/);
 g.nodes[1].params={steps:[{operation:'buffer',distance:100,code:'alert(1)'}]};assert.throws(()=>cleanGraph(g));
});
test('save roundtrip contains no source coordinates and supports rebinding',()=>{
 const g=cleanGraph(JSON.parse(JSON.stringify(demoGraph('new-layer','statistics'))));
 assert.ok(!JSON.stringify(g).includes('coordinates'));const r=runCircuit(g,{'new-layer':dataset.buildings},{});
 assert.equal(r.outputs[0].values.count,3);assert.equal(r.outputs[0].values.mean,60);
});
test('chat presets are bilingual, bounded and never interpret arbitrary code',()=>{
 assert.deepEqual(parseChat('选择高度超过50米的建筑'),parseChat('Select buildings taller than 50 m'));
 assert.deepEqual(parseChat('建筑透明度70%'),{action:'opacity',value:70});
 assert.equal(parseChat('Create density circuit').action,'circuit');
 assert.throws(()=>parseChat('Set building transparency to 101%'));assert.throws(()=>parseChat('fetch("https://example.com")'));
});
