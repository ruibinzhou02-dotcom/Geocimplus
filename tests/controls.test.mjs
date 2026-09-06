import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {initialState,executeAction,selectBuildings,summarize,parsePreset} from '../src/controls.mjs';
const catalog=JSON.parse(fs.readFileSync(path.resolve('config/data_catalog.json'),'utf8'));
const features=JSON.parse(fs.readFileSync(catalog.layers['建筑'].derived_path,'utf8')).features;
test('Source height filters and counts agree with direct actual properties',()=>{
 for(const threshold of [0,30,50,100,200,392]){
  const s=executeAction(initialState(),{type:'filter',min:threshold});const result=selectBuildings(features,s);
  assert.equal(result.length,features.filter(f=>f.properties.height>threshold).length);
  assert.ok(result.every(f=>f.properties.height>threshold));
 }
});
test('Preset and button share exact action state and stable IDs',()=>{
 const a=executeAction(initialState(),parsePreset('仅显示高度超过50米的建筑'));
 const b=executeAction(initialState(),{type:'filter',min:50,max:null});assert.deepEqual(a,b);
 const ids=selectBuildings(features,a).map(f=>f.properties.stable_id);assert.equal(new Set(ids).size,ids.length);
 assert.equal(selectBuildings(features,executeAction(a,{type:'clear'})).length,features.length);
});
test('Invalid requests cannot mutate current state',()=>{
 const state=executeAction(initialState(),{type:'filter',min:50});const before=JSON.stringify(state);
 for(const a of [{type:'filter',min:80,max:20},{type:'filter',min:-1},{type:'filter',min:NaN},{type:'layer',name:'shell',visible:true},{type:'color',value:'year'},{type:'reset',execute:'anything'}])assert.throws(()=>executeAction(state,a));
 for(const s of ['筛选1990年以前的建筑','显示动态人口','5分钟消防服务范围','执行Shell','显示高层建筑'])assert.throws(()=>parsePreset(s));
 assert.equal(JSON.stringify(state),before);
});
test('Empty filters, zero and missing values retain correct meaning',()=>{
 assert.deepEqual(summarize([]),{count:0,validHeights:0,mean:null,max:null,median:null});
 const sample=[0,null,6].map(height=>({properties:{height}}));assert.equal(summarize(sample).validHeights,2);assert.equal(summarize(sample).mean,3);
 assert.equal(selectBuildings(features,executeAction(initialState(),{type:'search',value:'nonexistent_id'})).length,0);
});
