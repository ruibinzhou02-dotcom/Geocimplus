from pathlib import Path
import tarfile,json,datetime
r=Path.cwd(); release=datetime.datetime.now().strftime('%Y%m%d-%H%M%S-v22')
archive=r/'releases'/f'{release}.tar.gz'
allowed=['catalog.json','dem.tif','lst.tif','basemap.tif','buildings.geojson','boundary.geojson','roads.geojson','weather.epw']
with tarfile.open(archive,'w:gz') as t:
 for name in ['cloud-server.mjs','cloud-worker.mjs']: t.add(r/'releases/cloud-v2'/name,arcname=name)
 # Publish V2 at both the main domain and the existing V2 URL.
 t.add(r/'dist/v2.html',arcname='web/index.html')
 t.add(r/'dist/v2.html',arcname='web/v2.html')
 # The source index remains the V1 development entry; preserve its public URL.
 t.add(r/'dist/index.html',arcname='web/v1.html')
 t.add(r/'dist/assets',arcname='web/assets')
 # Only the curated derived example files are published, never source folders or backups.
 for name in allowed:
  p=r/'data/v2/shatou'/name
  if name=='catalog.json':
   import io
   data=json.loads(p.read_text(encoding='utf8'));data['localOnly']=False;data['execution']='fixed-example-server'
   b=json.dumps(data,ensure_ascii=False,indent=2).encode('utf8');info=tarfile.TarInfo('data/catalog.json');info.size=len(b);info.mode=0o644;t.addfile(info,io.BytesIO(b))
  else:t.add(p,arcname='data/'+name)
(r/'releases/v22-release.json').write_text(json.dumps({'release':release,'archive':str(archive)}),encoding='utf8')
print(release,archive.stat().st_size)
