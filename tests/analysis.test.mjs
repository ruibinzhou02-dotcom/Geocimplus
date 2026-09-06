import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {zipSync,strToU8} from 'fflate';
import {area} from '@turf/area';
import {analyze,kde} from '../src/spatial-analysis.mjs';
import {importFiles,unpackShapeZip} from '../src/import-local.mjs';
const point=(x=113.99,y=22.53,p={})=>({type:'Feature',properties:p,geometry:{type:'Point',coordinates:[x,y]}});
const fc=features=>({type:'FeatureCollection',features});
test('statistics distinguish missing and nonnumeric without changing source',()=>{
 const d=fc([10,'20',null,'',false,'bad'].map(v=>point(0,0,{v}))),before=JSON.stringify(d);
 const r=analyze(d,{operation:'statistics',field:'v'});
 assert.deepEqual(r.values,{count:6,valid:2,missing:2,nonNumeric:2,sum:30,mean:15,min:10,max:20,median:15});assert.equal(JSON.stringify(d),before);
});
test('100 metre point buffer has expected area and preserves source properties',()=>{
 const r=analyze(fc([point(0,0,{name:'甲'})]),{operation:'buffer',distance:100});
 assert.ok(Math.abs(area(r.data)/ (Math.PI*100**2)-1)<0.01);assert.equal(r.data.features[0].properties.name,'甲');
 assert.throws(()=>analyze(fc([point()]),{operation:'buffer',distance:-1}));
});
test('geodesic measurement gives equatorial one degree length',()=>{
 const r=analyze(fc([{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}}]),{operation:'measure'});
 assert.ok(Math.abs(r.data.features[0].properties.geocim_length_m-111195.08)<1);
 assert.equal(r.data.features[0].properties.geocim_area_m2,null);
});
test('KDE approximately conserves weight and scales linearly',()=>{
 const a=kde([point(113.99,22.53,{w:1})],{bandwidth:100,cellSize:10,weightField:'w'});
 const b=kde([point(113.99,22.53,{w:3})],{bandwidth:100,cellSize:10,weightField:'w'});
 const total=a.features.reduce((n,f)=>n+f.properties.density_km2*100/1e6,0);
 assert.ok(Math.abs(total-1)<.01);a.features.forEach((f,i)=>assert.ok(Math.abs(3*f.properties.density_km2-b.features[i].properties.density_km2)<1e-9));
});
test('KDE refuses polygons, invalid weights, regional extent and excessive grid',()=>{
 const polygon={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[0,0],[.01,0],[.01,.01],[0,0]]]}};
 assert.throws(()=>kde([polygon],{bandwidth:100,cellSize:10}),/点图层/);
 for(const w of [null,-1,'bad'])assert.throws(()=>kde([point(0,0,{w})],{bandwidth:100,cellSize:10,weightField:'w'}));
 assert.throws(()=>kde([point(0,0),point(3,0)],{bandwidth:100,cellSize:10}));
 assert.throws(()=>kde([point(0,0)],{bandwidth:5000,cellSize:5}));
});
test('MultiPoint weight applies to each point',()=>{
 const r=kde([{...point(0,0,{w:2}),geometry:{type:'MultiPoint',coordinates:[[0,0],[.001,0]]}}],{bandwidth:100,cellSize:10,weightField:'w'});
 assert.ok(Math.abs(r.features.reduce((n,f)=>n+f.properties.density_km2*.0001,0)-4)<.04);
});
test('SHP ZIP restores Chinese and transforms UTM to WGS84',async()=>{
 const bytes=await readFile(new URL('./fixtures/browser/points.zip',import.meta.url));
 const [r]=await importFiles([new File([bytes],'points.zip')]);
 assert.equal(r.data.features.length,2);assert.equal(r.data.features[0].properties.name,'测试点甲');
 assert.ok(Math.abs(r.data.features[0].geometry.coordinates[0]-113.99)<1e-7);
 assert.ok(Math.abs(r.data.features[0].geometry.coordinates[1]-22.53)<1e-7);
});
test('ZIP rejects traversal and SHP without CRS',async()=>{
 assert.throws(()=>unpackShapeZip(zipSync({'../bad.shp':strToU8('bad')})),/路径/);
 await assert.rejects(importFiles([new File(['bad'],'bad.shp')]),/配套/);
});
