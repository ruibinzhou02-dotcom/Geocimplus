"""Read-only source audit and reproducible V2 local demo preparation."""
import os
os.environ['GDAL_PAM_ENABLED'] = 'NO'
import json, hashlib, shutil
from pathlib import Path
from datetime import datetime
import numpy as np
import rasterio
import geopandas as gpd
from shapely import make_valid

ROOT = Path(__file__).resolve().parents[1]
RAW = Path(r'C:\Users\pc\Desktop\新的数据\新的数据')
GRIDS = Path(r'C:\Users\pc\Desktop\两个栅格数据')
OUT = ROOT / 'data/v2/shatou'
REPORT = ROOT / 'reports/v2'

def hashes():
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest()
            for root in [RAW, GRIDS] for p in root.rglob('*') if p.is_file()}

def main():
    before = hashes()
    OUT.mkdir(parents=True, exist_ok=True)
    REPORT.mkdir(parents=True, exist_ok=True)
    audit = {'created': datetime.now().isoformat(), 'source_hashes': before, 'rasters': {}, 'warnings': [
        'DEM CRS: native EPSG:4019 is an unspecified datum on GRS80, not synonymous with CGCS2000. Derivative uses EPSG:4490 from supplied XML CGCS2000 evidence; horizontal transformation accuracy is unverified.',
        'DEM vertical datum and DTM/DSM status unknown. Ground recovery must be opt-in.',
        'User confirmed LST Celsius and acquisition month 2026-08; exact day/time, product and quality layer unknown. Zero retained.',
        'Bounds overlap does not establish valid-pixel coverage. Browser grid reports valid counts.',
        'User confirmed BLDG_HEIGH metres. DEM likely contains roofs per user; ground estimation is derived, not surveyed.'
    ]}
    for name, crs, unit in [('dem', 'EPSG:4490', 'm'), ('lst', 'EPSG:3857', '°C')]:
        with rasterio.open(GRIDS / name) as src:
            a = src.read(1, masked=True)
            mask = np.ma.getmaskarray(a) | ~np.isfinite(a.data) | (np.abs(a.data) > 1e30)
            valid = a.data[~mask]
            profile = dict(driver='GTiff', width=src.width, height=src.height, count=1,
                           dtype='float32', crs=crs, transform=src.transform, nodata=-9999.,
                           compress='deflate', predictor=3, tiled=True, blockxsize=256, blockysize=256)
            target = OUT / f'{name}.tif'
            with rasterio.open(target, 'w', **profile) as dst:
                dst.write(np.where(mask, -9999., a.data).astype('float32'), 1)
                dst.update_tags(source_format=src.driver, value_unit=unit, source_crs=str(src.crs),
                                crs_evidence='dem/metadata.xml CGCS2000' if name == 'dem' else 'lst.aux.xml EPSG:3857',
                                zero_policy='retained', acquisition_time='2026-08; day/time unknown; user confirmed' if name=='lst' else 'unknown')
            with rasterio.open(target) as dst:
                b = dst.read(1, masked=True)
                assert np.array_equal(mask, np.ma.getmaskarray(b))
                assert np.array_equal(valid, b.data[~mask]), 'Conversion changed native numerical values'
            audit['rasters'][name] = dict(shape=list(a.shape), source_crs=str(src.crs), derivative_crs=crs,
                source_nodata=src.nodata, unit=unit, valid=int(valid.size), nodata=int(mask.sum()),
                zeros=int((valid == 0).sum()), min=float(valid.min()), max=float(valid.max()), mean=float(valid.mean()),
                bounds=list(src.bounds), native_values_verified=True)
    buildings = gpd.read_file(RAW / '沙头建筑新.shp')
    bad = ~buildings.geometry.is_valid
    audit['buildings'] = {'count':len(buildings), 'invalid_ids':buildings.loc[bad, 'BLDG_NO'].astype(str).tolist(),
                          'crs':str(buildings.crs), 'height_field':'BLDG_HEIGH', 'height_unit':'m', 'height_unit_evidence':'User confirmed 2026-09-21'}
    buildings.loc[bad, 'geometry'] = buildings.loc[bad, 'geometry'].map(make_valid)
    # Preserve all originals on disk, but omit names/addresses from the portable demo derivative.
    fields = ['BLDG_NO', 'BLDG_HEIGH', 'UP_BLDG_FL', 'BLDG_USAGE', 'geometry']
    buildings = buildings[fields].to_crs(4326)
    buildings['BLDG_NO'] = buildings['BLDG_NO'].astype(str)
    buildings.to_file(OUT / 'buildings.geojson', driver='GeoJSON')
    assert buildings.geometry.is_valid.all()
    epw = next(RAW.rglob('*.epw'))
    shutil.copyfile(epw, OUT / 'weather.epw')
    # Existing reviewed boundary supplies context, not a new spatial extent assumption.
    catalog = json.loads((ROOT / 'config/data_catalog.json').read_text(encoding='utf-8'))
    boundary = Path(catalog['layers']['边界']['derived_path'])
    shutil.copyfile(boundary, OUT / 'boundary.geojson')
    # Reuse the reviewed V1 first-band satellite preview. RGB order remains unknown.
    preview=Path(catalog['raster']['preview_path'])
    with rasterio.open(Path(catalog['raster']['source_path']).parent/'111c1') as src:
        data=src.read(1,out_shape=(1024,1024))
        tx=src.transform*src.transform.scale(src.width/1024,src.height/1024)
        with rasterio.open(OUT/'basemap.tif','w',driver='GTiff',width=1024,height=1024,count=1,dtype=data.dtype,crs='EPSG:4326',transform=tx,nodata=src.nodata,compress='deflate') as dst:
            dst.write(data,1)
            dst.update_tags(display='first-band grayscale; RGB order unknown',analytical_use='false')
    manifest = {'version':2, 'name':'Shatou Urban Regeneration', 'localOnly':True,
                'analysisCRS':'EPSG:32650', 'sources':[
                    {'id':'basemap', 'name':'Satellite · grayscale', 'kind':'raster', 'url':'basemap.tif', 'role':'imagery', 'unit':'display only'},
                    {'id':'dem', 'name':'Terrain · DEM', 'kind':'raster', 'url':'dem.tif', 'role':'dem', 'unit':'m', 'datum':'unknown'},
                    {'id':'lst', 'name':'Land surface temperature', 'kind':'raster', 'url':'lst.tif', 'role':'lst', 'unit':'°C', 'acquisition':'2026-08 (day/time unknown)', 'unitEvidence':'User confirmation'},
                    {'id':'buildings', 'name':'Buildings', 'kind':'vector', 'url':'buildings.geojson', 'heightField':'BLDG_HEIGH', 'heightConfirmed':True},
                    {'id':'boundary', 'name':'Study boundary', 'kind':'vector', 'url':'boundary.geojson'},
                    {'id':'epw', 'name':'Shenzhen · typical weather year', 'kind':'epw', 'url':'weather.epw'}],
                'warnings':audit['warnings']}
    (OUT / 'catalog.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    assert before == hashes(), 'Source contents changed during preparation'
    audit['source_files_unchanged'] = True
    (REPORT / 'data-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'output':str(OUT), 'rasters':audit['rasters'], 'buildings':audit['buildings'], 'source_files_unchanged':True}, ensure_ascii=False))

if __name__ == '__main__':
    main()
