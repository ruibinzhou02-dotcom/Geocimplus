"""Read three ArcInfo stack channels into an explicitly documented display composite."""
import os
os.environ['GDAL_PAM_ENABLED']='NO'
from pathlib import Path
import hashlib,json,shutil
import numpy as np
import rasterio
from rasterio.enums import ColorInterp, Resampling

ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(r'C:\Users\pc\Desktop\TOSHP\TOSHP')
OUT=ROOT/'data/v2/shatou'

def main():
    paths=[p for name in ['111','111c1','111c2','111c3'] for p in (SOURCE/name).rglob('*') if p.is_file()]
    paths += list(SOURCE.glob('111*.aux.xml'))
    digest=lambda:{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    before=digest()
    channels=[];mask=None;reference=None
    # Stack names establish channel order only, not verified spectral identity.
    for name in ['111c1','111c2','111c3']:
        with rasterio.open(SOURCE/name) as s:
            signature=(s.width,s.height,tuple(s.transform))
            if reference is None:
                reference=signature;w=1024;h=round(w*s.height/s.width)
                tx=s.transform*s.transform.scale(s.width/w,s.height/h)
            assert reference==signature,'Channels must have identical pixel alignment'
            a=s.read(1,out_shape=(h,w),masked=True,resampling=Resampling.nearest)
            valid=~np.ma.getmaskarray(a)
            assert np.all((a.data[valid]>=0)&(a.data[valid]<=255))
            mask=valid if mask is None else mask&valid
            channels.append(np.where(valid,a.data,0).astype('uint8'))
    channels.append((mask*255).astype('uint8'))
    tmp=OUT/'basemap-colour.tmp.tif'
    with rasterio.open(tmp,'w',driver='GTiff',width=w,height=h,count=4,dtype='uint8',crs='EPSG:4326',transform=tx,
                       photometric='RGB',interleave='pixel',compress='deflate',ALPHA='YES') as d:
        d.write(np.stack(channels));d.colorinterp=(ColorInterp.red,ColorInterp.green,ColorInterp.blue,ColorInterp.alpha)
        d.update_tags(display='three-channel colour composite',rgb_mapping='R=111c1,G=111c2,B=111c3',
                      rgb_status='provisional; original spectral identities not documented',
                      crs_evidence='111/prj.adf WGS84 geographic; 111/metadata.xml ExtractByMask source',analytical_use='false')
    reportdir=ROOT/'reports/v2.3';reportdir.mkdir(parents=True,exist_ok=True)
    old=OUT/'basemap.tif';backup=reportdir/'basemap-before-colour.tif'
    if old.exists() and not backup.exists():shutil.copy2(old,backup)
    tmp.replace(old)
    manifest=OUT/'catalog.json';catalog=json.loads(manifest.read_text(encoding='utf8'))
    image=next(x for x in catalog['sources'] if x['id']=='basemap')
    image.update(name='Satellite · colour composite',nameZh='卫星底图 · 彩色合成',rgbMapping='R=111c1,G=111c2,B=111c3',rgbStatus='provisional')
    manifest.write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf8')
    assert before==digest(),'Source contents changed'
    report={'source_files_unchanged':True,'source_hashes':before,'display_mapping':image['rgbMapping'],'status':'provisional',
            'crs_evidence':'111/prj.adf and metadata.xml','shape':[h,w],'valid_pixels':int(mask.sum()),
            'output_sha256':hashlib.sha256(old.read_bytes()).hexdigest(),'output':str(old)}
    (reportdir/'satellite-composite-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in report.items() if k!='source_hashes'},ensure_ascii=False))
if __name__=='__main__':main()
