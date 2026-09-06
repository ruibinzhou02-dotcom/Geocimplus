// RFC 7946 GeoJSON import runs entirely in the browser, including on the public demo.
export function prepareGeoJSON(input,name,id){
 if(input?.type!=='FeatureCollection'||!Array.isArray(input.features)||!input.features.length||input.features.length>100000)throw new Error('GeoJSON needs a FeatureCollection with 1–100,000 features.');
 if(input.crs&&!['urn:ogc:def:crs:OGC:1.3:CRS84','EPSG:4326'].includes(input.crs.properties?.name))throw new Error('GeoJSON must use WGS84 longitude/latitude (RFC 7946).');
 let positions=0;const bounds=[[Infinity,Infinity],[-Infinity,-Infinity]];
 const point=p=>{if(!Array.isArray(p)||p.length<2||p.length>3||!p.every(Number.isFinite)||p[0]<-180||p[0]>180||p[1]<-85.05||p[1]>85.05)throw new Error('Invalid WGS84 coordinates.');if(++positions>500000)throw new Error('GeoJSON exceeds 500,000 positions.');for(let i=0;i<2;i++){bounds[0][i]=Math.min(bounds[0][i],p[i]);bounds[1][i]=Math.max(bounds[1][i],p[i]);}};
 const line=c=>{if(!Array.isArray(c)||c.length<2)throw new Error('A line needs at least 2 positions.');c.forEach(point);};
 const polygon=c=>{if(!Array.isArray(c)||!c.length)throw new Error('A polygon needs a ring.');for(const ring of c){line(ring);if(ring.length<4||ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw new Error('Polygon rings must be closed and contain at least 4 positions.');}};
 const fields=new Set();let idField='__geocim_id';
 for(const f of input.features){
  if(f?.type!=='Feature'||!f.geometry||f.properties!=null&&(typeof f.properties!=='object'||Array.isArray(f.properties)))throw new Error('Invalid GeoJSON feature.');
  for(const [k,v] of Object.entries(f.properties||{})){if(k.length>128||typeof v==='object'&&v!==null||typeof v==='string'&&v.length>10000||typeof v==='number'&&(!Number.isFinite(v)||Number.isInteger(v)&&!Number.isSafeInteger(v)))throw new Error('Attributes must be simple values; store large numeric IDs as strings.');fields.add(k);}
  const {type,coordinates:c}=f.geometry;const fn={Point:point,MultiPoint:a=>{if(!Array.isArray(a)||!a.length)throw new Error('Empty geometry.');a.forEach(point);},LineString:line,MultiLineString:a=>{if(!Array.isArray(a)||!a.length)throw new Error('Empty geometry.');a.forEach(line);},Polygon:polygon,MultiPolygon:a=>{if(!Array.isArray(a)||!a.length)throw new Error('Empty geometry.');a.forEach(polygon);}}[type];if(!fn)throw new Error('Unsupported geometry type.');fn(c);
 }
 if(fields.size>128)throw new Error('GeoJSON exceeds 128 attribute fields.');
 while(fields.has(idField))idField+='_';
 const data={type:'FeatureCollection',features:input.features.map((f,i)=>({type:'Feature',geometry:f.geometry,properties:{...f.properties,[idField]:id+'-'+i}}))};
 return {id,name:name.replace(/\.(geojson|json)$/i,''),kind:'vector',count:data.features.length,idField,bounds,data,sessionOnly:true,fields:[...fields].map(name=>({name}))};
}
