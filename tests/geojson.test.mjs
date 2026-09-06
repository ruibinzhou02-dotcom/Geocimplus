import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGeoJSON} from '../src/geojson.mjs';
const collection=(geometry,properties={name:'测试'})=>({type:'FeatureCollection',features:[{type:'Feature',geometry,properties}]});
test('supports a single MultiPoint and preserves attributes',()=>{const source=collection({type:'MultiPoint',coordinates:[[114,22]]},{__geocim_id:'user',name:'测试'});const r=prepareGeoJSON(source,'test.geojson','one');assert.equal(r.idField,'__geocim_id_');assert.equal(r.data.features[0].properties.name,'测试');assert.equal(source.features[0].properties.__geocim_id,'user');assert.deepEqual(r.bounds,[[114,22],[114,22]]);});
test('rejects projected coordinates and unclosed polygons',()=>{assert.throws(()=>prepareGeoJSON(collection({type:'Point',coordinates:[400000,2000000]}),'x','x'),/coordinates/);assert.throws(()=>prepareGeoJSON(collection({type:'Polygon',coordinates:[[[1,1],[2,1],[2,2],[1,2]]]}),'x','x'),/closed/);});
test('rejects nested attributes and unsafe numeric IDs',()=>{for(const props of [{nested:{secret:1}},{id:9007199254740992}])assert.throws(()=>prepareGeoJSON(collection({type:'Point',coordinates:[0,0]},props),'x','x'),/simple values/);});
