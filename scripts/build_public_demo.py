"""Package the current UI with reproducible fictional data. Never reads GIS originals."""
from pathlib import Path
import json,random,shutil,hashlib,zipfile
from datetime import datetime

root=Path(__file__).resolve().parents[1]
release=root/'releases'/('public-demo-'+datetime.now().strftime('%Y%m%d_%H%M%S'))
site=release/'site';site.mkdir(parents=True)
shutil.copy2(root/'dist/index.html',site/'index.html')
shutil.copytree(root/'dist/assets',site/'assets')
rng=random.Random(260906)
def write(name,data):
 p=site/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf8')
def feature(kind,coords,**props):return {'type':'Feature','geometry':{'type':kind,'coordinates':coords},'properties':{'synthetic':True,**props}}
def ring(x,y,w,h):return [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]
# Fictional geometry at an arbitrary equatorial location; not derived from Shatou.
buildings=[]
for x in range(28):
 for y in range(20):
  if (x*3+y)%17==0:continue
  bx=.002+x*.00055;by=.002+y*.00055
  height=rng.choice([15,24,36,54,72,96,120,180])+rng.randint(0,10)
  buildings.append(feature('Polygon',[ring(bx,by,.00030,.00032)],stable_id=f'demo-building-{x}-{y}',height=height))
roads=[feature('LineString',[[.001,.0018+y*.00055],[.018,.0018+y*.00055]],stable_id=f'demo-road-h-{y}') for y in range(21)]
roads +=[feature('LineString',[[.0018+x*.00055,.001],[.0018+x*.00055,.014]],stable_id=f'demo-road-v-{x}') for x in range(29)]
population=[feature('Polygon',[ring(x*.002,y*.002,.002,.002)],stable_id=f'demo-cell-{x}-{y}',usum=rng.randint(100,3200)) for x in range(1,9) for y in range(1,7)]
boundary=[feature('Polygon',[ring(.001,.001,.017,.013)],stable_id='demo-boundary')]
for key,data in dict(buildings=buildings,roads=roads,population=population,boundary=boundary).items():write('api/layers/'+key,{'type':'FeatureCollection','features':data})
write('api/catalog',{'mode':'public-demo','synthetic':True,'height_enabled':True,'bounds':[[.001,.001],[.018,.014]],'satellite':None})
write('api/uploads',[])
write('api/ai/status',{'configured':False,'verified':False,'provider':'OpenAI','model':None,'mode':'public-demo','enabled':False})
(site/'robots.txt').write_text('User-agent: *\nDisallow: /\n',encoding='utf8')
manifest=[]
for p in sorted(site.rglob('*')):
 if p.is_file():manifest.append({'path':p.relative_to(site).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(release/'manifest.json').write_text(json.dumps({'synthetic':True,'files':manifest},indent=2),encoding='utf8')
with zipfile.ZipFile(release/'site.zip','w',zipfile.ZIP_DEFLATED) as z:
 for item in manifest:z.write(site/item['path'],item['path'])
print(json.dumps({'release':str(release),'zip_bytes':(release/'site.zip').stat().st_size,'counts':{'buildings':len(buildings),'roads':len(roads),'population':len(population)}}))
