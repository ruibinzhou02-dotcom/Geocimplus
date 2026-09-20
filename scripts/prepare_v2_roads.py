"""Add a read-only audited road-network derivative to the curated V2 demo."""
import os
os.environ['GDAL_PAM_ENABLED'] = 'NO'
import json, hashlib
from pathlib import Path
import geopandas as gpd

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r'C:\Users\pc\Desktop\TOSHP\TOSHP\路网.shp')

def prepare_roads():
    parts = sorted(SOURCE.parent.glob(SOURCE.stem + '.*'))
    def hashes():
        return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in parts if p.is_file()}
    before = hashes()
    # The companion CPG and raw DBF names both confirm UTF-8. Pass it explicitly
    # because the Windows GDAL default can otherwise misdecode Chinese names.
    encoding=SOURCE.with_suffix('.cpg').read_text(encoding='utf8').strip()
    roads = gpd.read_file(SOURCE,encoding=encoding)
    assert all('\ufffd' not in c for c in roads.columns), 'Invalid field decoding'
    assert roads.crs, 'Source CRS is required'
    assert roads.geometry.notna().all() and (~roads.geometry.is_empty).all()
    assert roads.geometry.is_valid.all(), 'Review invalid source road geometry'
    assert set(roads.geom_type) <= {'LineString', 'MultiLineString'}
    audit = dict(source=str(SOURCE), source_hashes=before, records=len(roads), crs=str(roads.crs), encoding=encoding,
                 geometry_types=roads.geom_type.value_counts().to_dict(),
                 fields={c:str(t) for c,t in roads.dtypes.items() if c!='geometry'},
                 null_counts={c:int(roads[c].isna().sum()) for c in roads.columns if c!='geometry'},
                 bounds=list(roads.total_bounds), invalid_count=0)
    roads = roads.to_crs(4326)
    for col in roads.columns:
        if col=='geometry': continue
        if str(roads[col].dtype).startswith(('int','uint')) and (roads[col].abs()>9007199254740991).any():
            roads[col]=roads[col].astype(str)
    out = ROOT/'data/v2/shatou'
    out.mkdir(parents=True,exist_ok=True)
    (out/'roads.geojson').write_text(roads.to_json(drop_id=True,na='null',separators=(',',':')),encoding='utf8')
    catalog=json.loads((out/'catalog.json').read_text(encoding='utf8'))
    catalog['sources']=[s for s in catalog['sources'] if s['id']!='roads']
    catalog['sources'].append(dict(id='roads',name='Road network',nameZh='路网',kind='vector',geometryType='line',
        category='transport',url='roads.geojson',crs='EPSG:4326',sourceCRS=audit['crs'],symbology={'color':'#d1a878','opacity':1}))
    names={'basemap':'卫星底图 · 灰度','dem':'地形 · DEM','lst':'地表温度','buildings':'建筑','boundary':'研究边界','epw':'深圳 · 典型气象年'}
    for s in catalog['sources']:
        if s['id'] in names:s['nameZh']=names[s['id']]
    (out/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf8')
    assert before==hashes(), 'Source files were changed'
    audit.update(source_files_unchanged=True,output='data/v2/shatou/roads.geojson',output_bounds=list(roads.total_bounds),output_crs='EPSG:4326')
    report=ROOT/'reports/v2.2';report.mkdir(parents=True,exist_ok=True)
    (report/'roads-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({k:audit[k] for k in ['records','crs','geometry_types','fields','output_bounds','source_files_unchanged']},ensure_ascii=False))
    return audit

if __name__=='__main__':prepare_roads()
