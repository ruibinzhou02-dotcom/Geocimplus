"""Exercise real GIS readers and the local multipart endpoints in an isolated workspace."""
import io,json,shutil,tempfile,unittest,zipfile,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import geopandas as gpd
import numpy as np
import rasterio
from PIL import Image
from pyproj import CRS
from rasterio.transform import from_origin
from shapely.geometry import Point,box
from fastapi.testclient import TestClient
from backend.server import create_app

PROJECT=Path(__file__).resolve().parents[1]
class UploadTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.temp=tempfile.TemporaryDirectory(prefix='geocim-upload-test-');cls.root=Path(cls.temp.name)
  (cls.root/'config').mkdir();shutil.copy2(PROJECT/'config/data_catalog.json',cls.root/'config/data_catalog.json')
  cls.client=TestClient(create_app(cls.root,PROJECT/'dist'))
  cls.fixtures=cls.root/'fixtures';cls.fixtures.mkdir()
  gpd.GeoDataFrame({'label':['测试甲','测试乙'],'code':['001','002'],'height':[0,75]},geometry=[box(114.025,22.521,114.026,22.522),box(114.027,22.521,114.028,22.522)],crs=4326).to_crs(32649).to_file(cls.fixtures/'测试面.shp',engine='pyogrio',encoding='UTF-8')
  gpd.GeoDataFrame({'value':[1]},geometry=[Point(114.026,22.522)],crs=4326).to_file(cls.fixtures/'point.shp',engine='pyogrio')
  with rasterio.open(cls.fixtures/'rgb.tif','w',driver='GTiff',width=32,height=32,count=3,dtype='uint8',crs=4326,transform=from_origin(114.025,22.525,.0001,.0001)) as dst:
   data=np.zeros((3,32,32),dtype=np.uint8);data[0]=180;data[1]=90;data[2]=30;dst.write(data)
 @classmethod
 def tearDownClass(cls):cls.client.close();cls.temp.cleanup()
 def post_shape(self,stem,omit=None):
  files=[('files',(p.name,p.read_bytes(),'application/octet-stream')) for p in self.fixtures.glob(stem+'.*') if p.suffix!=omit]
  return self.client.post('/api/uploads',files=files,data={'kind':'vector','encoding':'auto'})
 def test_projected_shape_keeps_properties_and_ids(self):
  r=self.post_shape('测试面');self.assertEqual(r.status_code,200,r.text);m=r.json();self.assertEqual(m['count'],2);self.assertAlmostEqual(m['bounds'][0][0],114.025,places=5)
  data=self.client.get(m['url']).json();p=data['features'][0]['properties'];self.assertEqual(p['code'],'001');self.assertEqual(p['label'],'测试甲');self.assertEqual(p['height'],0)
  self.assertEqual(len({f['properties'][m['idField']] for f in data['features']}),2)
  restarted=TestClient(create_app(self.root,PROJECT/'dist'));self.assertTrue(any(x['id']==m['id'] for x in restarted.get('/api/uploads').json()));restarted.close()
 def test_single_point(self):
  r=self.post_shape('point');self.assertEqual(r.status_code,200,r.text)
 def test_missing_sidecar_rejected(self):
  r=self.post_shape('测试面','.prj');self.assertEqual(r.status_code,400);self.assertIn('.prj',r.json()['detail'])
  files=[('files',(p.name,p.read_bytes())) for p in self.fixtures.glob('测试面.*') if p.suffix!='.prj']
  r=self.client.post('/api/uploads',files=files,data={'kind':'vector'},headers={'Accept-Language':'en'})
  self.assertEqual(r.status_code,400);self.assertTrue(r.json()['detail'].startswith('Missing Shapefile companions:'))
 def test_nested_zip(self):
  buf=io.BytesIO()
  with zipfile.ZipFile(buf,'w') as z:
   for p in self.fixtures.glob('测试面.*'):z.writestr('nested/'+p.name,p.read_bytes())
  r=self.client.post('/api/uploads',files={'files':('shape.zip',buf.getvalue(),'application/zip')},data={'kind':'vector'});self.assertEqual(r.status_code,200,r.text)
 def test_rgb_raster_and_asset_allowlist(self):
  r=self.client.post('/api/uploads',files={'files':('rgb.tif',(self.fixtures/'rgb.tif').read_bytes(),'image/tiff')},data={'kind':'raster'});self.assertEqual(r.status_code,200,r.text)
  m=r.json();self.assertEqual(m['display'],'RGB');self.assertEqual(len(m['coordinates']),4);self.assertTrue(self.client.get(m['url']).content.startswith(b'\x89PNG'));self.assertEqual(self.client.get('/api/uploads/'+m['id']+'/metadata.json').status_code,404)
 def test_zip_traversal_and_foreign_origin(self):
  buf=io.BytesIO()
  with zipfile.ZipFile(buf,'w') as z:z.writestr('../escape.shp',b'bad')
  r=self.client.post('/api/uploads',files={'files':('bad.zip',buf.getvalue())});self.assertEqual(r.status_code,400);self.assertFalse((self.root/'data/uploads/escape.shp').exists())
  r=self.client.post('/api/uploads',files={'files':('bad.shp',b'x')},headers={'Origin':'https://example.com'});self.assertEqual(r.status_code,403)
 def test_png_world_file_requires_crs(self):
  buf=io.BytesIO();Image.new('RGB',(20,20),(80,120,60)).save(buf,format='PNG')
  files=[('files',('located.png',buf.getvalue())),('files',('located.pgw',b'0.0001\n0\n0\n-0.0001\n114.02505\n22.52495\n'))]
  r=self.client.post('/api/uploads',files=files,data={'kind':'raster'});self.assertEqual(r.status_code,400)
  files.append(('files',('located.prj',CRS.from_epsg(4326).to_wkt().encode())))
  r=self.client.post('/api/uploads',files=files,data={'kind':'raster'});self.assertEqual(r.status_code,200,r.text);self.assertAlmostEqual(r.json()['bounds'][0][0],114.025,places=5)

if __name__=='__main__':unittest.main(verbosity=2)
