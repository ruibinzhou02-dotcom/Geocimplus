"""Local GIS upload ingestion. Original files are copied, never edited in place."""
import json
import math
import re
import shutil
import stat
import uuid
import zipfile
from pathlib import Path, PurePosixPath

import numpy as np
import geopandas as gpd
import pandas as pd
import pyogrio
import rasterio
from PIL import Image
from pyproj import CRS, Transformer
from rasterio.enums import ColorInterp, Resampling
from rasterio.vrt import WarpedVRT

MAX_UPLOAD = 256 * 1024**2
MAX_EXPANDED = 512 * 1024**2
EXTENSIONS = {'.shp', '.shx', '.dbf', '.prj', '.cpg', '.sbn', '.sbx', '.xml',
              '.tif', '.tiff', '.png', '.jpg', '.jpeg', '.tfw', '.pgw', '.jgw',
              '.wld', '.adf', '.dat', '.nit', '.dir'}


def safe_relative(name):
    value = PurePosixPath(name.replace('\\', '/'))
    if value.is_absolute() or '..' in value.parts or any(':' in x for x in value.parts):
        raise ValueError('文件路径无效，请重新打包数据。')
    if any(x.rstrip(' .').upper().split('.')[0] in {'CON', 'NUL', 'PRN', 'AUX', *['COM'+str(i) for i in range(1,10)], *['LPT'+str(i) for i in range(1,10)]} for x in value.parts):
        raise ValueError('文件名包含保留名称。')
    return Path(*value.parts)


def unpack(archive, destination):
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        if len(entries) > 512 or sum(i.file_size for i in entries) > MAX_EXPANDED:
            raise ValueError('ZIP解压后超过512 MiB或文件数量超过512。')
        seen = set()
        for item in entries:
            relative = safe_relative(item.filename)
            if stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError('ZIP不能包含链接。')
            if item.is_dir():
                continue
            if relative.suffix.lower() not in EXTENSIONS:
                raise ValueError('ZIP包含不支持的文件：'+relative.name)
            key = str(relative).casefold()
            if key in seen:
                raise ValueError('ZIP内有重复文件名。')
            seen.add(key)
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(item) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)


def bounds_ok(bounds):
    x0,y0,x1,y1 = map(float,bounds)
    if not all(math.isfinite(x) for x in bounds) or not (-180 <= x0 <= x1 <= 180 and -85.05 <= y0 <= y1 <= 85.05):
        raise ValueError('坐标范围无效或超出地图可显示范围，请检查坐标系。')
    return [[x0,y0],[x1,y1]]


def vector_import(source, destination, encoding):
    companions = {p.suffix.lower():p for p in source.parent.iterdir() if p.stem.casefold()==source.stem.casefold()}
    missing = [x for x in ['.shx','.dbf','.prj'] if x not in companions]
    if missing:
        raise ValueError('Shapefile缺少配套文件：'+', '.join(missing))
    # Normalize companion suffixes only in the uploaded copy for GDAL discovery.
    for ext,p in companions.items():
        target=source.parent/(source.stem+ext)
        if p.name!=target.name: p.rename(target)
    source=source.parent/(source.stem+'.shp')
    if encoding=='auto':
        cpg=source.with_suffix('.cpg')
        encoding=cpg.read_text(encoding='ascii').strip() if cpg.exists() else None
    if encoding and encoding.upper() in {'65001','UTF-8'}: encoding='UTF-8'
    if pyogrio.read_info(source)['features']>100000: raise ValueError('首版单次支持最多100,000个要素，请分区域上传。')
    g=gpd.read_file(source,engine='pyogrio',encoding=encoding)
    if g.crs is None: raise ValueError('未能识别坐标系，请补充正确的.prj。')
    if not len(g): raise ValueError('Shapefile没有要素。')
    if len(g)>100000: raise ValueError('首版单次支持最多100,000个要素，请分区域上传。')
    if g.geometry.isna().any() or g.geometry.is_empty.any() or not g.geometry.is_valid.all():
        raise ValueError('文件包含空或无效几何，请在副本中修复后再上传。')
    if not set(g.geom_type).issubset({'Polygon','MultiPolygon','LineString','MultiLineString','Point','MultiPoint'}):
        raise ValueError('暂不支持此几何类型。')
    for c in g.columns:
        if c!='geometry' and g[c].dropna().astype(str).str.contains('\ufffd',regex=False).any():
            raise ValueError('属性编码包含替换字符，请选择正确编码后重试。')
    crs=g.crs.to_wkt(); g=g.to_crs(4326)
    bounds=bounds_ok(g.total_bounds)
    id_field='__geocim_id'
    while id_field in g.columns: id_field+='_'  # Never overwrite a user's field.
    g[id_field]=[uuid.uuid4().hex for _ in range(len(g))]
    content=json.loads(g.to_json(drop_id=True,na='null'))
    (destination/'layer.geojson').write_text(json.dumps(content,ensure_ascii=False),encoding='utf-8')
    return {'kind':'vector','name':source.stem,'count':len(g),'bounds':bounds,'idField':id_field,
            'fields':[{'name':c,'type':'number' if pd.api.types.is_numeric_dtype(g[c]) else 'text'} for c in g.columns if c not in {'geometry',id_field}],
            'crs_wkt':crs,'geometry_types':sorted(set(g.geom_type)),'encoding':encoding or 'GDAL DBF元数据'}


def raster_import(source, destination, parent_crs=None):
    with rasterio.Env(GDAL_PAM_ENABLED='NO',PROJ_NETWORK='OFF'):
        driver='AIG' if source.is_dir() else {'.tif':'GTiff','.tiff':'GTiff','.png':'PNG','.jpg':'JPEG','.jpeg':'JPEG'}[source.suffix.lower()]
        with rasterio.open(source,driver=driver) as r:
            crs=r.crs or parent_crs
            if not crs and source.is_file() and source.with_suffix('.prj').exists():
                crs=CRS.from_wkt(source.with_suffix('.prj').read_text(encoding='utf-8-sig'))
            if not crs: raise ValueError('影像没有可识别的坐标系，请上传GeoTIFF或完整世界文件与.prj。')
            if r.transform.is_identity: raise ValueError('影像缺少地理定位信息，不能按普通图片直接放到地图。')
            colors=list(r.colorinterp)
            if all(c in colors for c in [ColorInterp.red,ColorInterp.green,ColorInterp.blue]):
                bands=[colors.index(c)+1 for c in [ColorInterp.red,ColorInterp.green,ColorInterp.blue]]
                display='RGB'; cmap=None
            else:
                bands=[1];display='灰度（第1波段）'
                try: cmap=r.colormap(1);display='原始色表'
                except ValueError: cmap=None
            with WarpedVRT(r,src_crs=crs,crs='EPSG:3857',resampling=Resampling.nearest,add_alpha=ColorInterp.alpha not in colors,warp_mem_limit=128) as vrt:
                ratio=min(1,2048/max(vrt.width,vrt.height));w=max(1,round(vrt.width*ratio));h=max(1,round(vrt.height*ratio))
                values=vrt.read(bands,out_shape=(len(bands),h,w),masked=True,resampling=Resampling.nearest)
                valid=~np.any(np.ma.getmaskarray(values),axis=0)
                if not valid.any(): raise ValueError('影像有效范围内没有可显示像元。')
                alpha=vrt.dataset_mask(out_shape=(h,w),resampling=Resampling.nearest)
                if cmap:
                    table=np.zeros((max(cmap)+1,4),dtype='uint8')
                    for key,value in cmap.items(): table[key]=value
                    indices=np.ma.filled(values[0],0).astype('int64')
                    rgba=table[np.clip(indices,0,len(table)-1)]
                    rgba[:,:,3]=np.minimum(rgba[:,:,3],alpha)
                else:
                    channels=[];stretches=[]
                    for band in values:
                        good=band.compressed();lo=float(good.min());hi=float(good.max())
                        if lo>=0 and hi<=255: scaled=np.ma.filled(band,0).astype('uint8');stretches.append(None)
                        else:
                            lo,hi=np.percentile(good,[2,98]);hi=hi if hi>lo else lo+1
                            scaled=np.clip((np.ma.filled(band,lo)-lo)/(hi-lo)*255,0,255).astype('uint8');stretches.append([float(lo),float(hi)])
                        channels.append(scaled)
                    if len(channels)==1: channels*=3
                    rgba=np.dstack([*channels,np.where(valid,alpha,0)]).astype('uint8')
                    if any(stretches): display+=' · 预览2–98%拉伸'
                Image.fromarray(rgba).save(destination/'preview.png')
                b=vrt.bounds;t=Transformer.from_crs(3857,4326,always_xy=True)
                corners=[list(t.transform(x,y)) for x,y in [(b.left,b.top),(b.right,b.top),(b.right,b.bottom),(b.left,b.bottom)]]
                bounds=bounds_ok([corners[3][0],corners[3][1],corners[1][0],corners[1][1]])
            return {'kind':'raster','name':source.stem,'bounds':bounds,'coordinates':corners,'display':display,'bands':r.count,'driver':r.driver,'source_width':r.width,'source_height':r.height,'preview_size':[w,h],'crs_wkt':CRS.from_user_input(crs).to_wkt()}


def process_upload(folder, encoding='auto', kind='auto'):
    source=folder/'source'; derived=folder/'derived';derived.mkdir()
    files=list(source.rglob('*'))
    shapes=[p for p in files if p.suffix.lower()=='.shp']
    rasters=[p for p in files if p.suffix.lower() in {'.tif','.tiff','.png','.jpg','.jpeg'}]
    grids=[p.parent for p in files if p.name.lower()=='hdr.adf']
    parent_crs=None
    if shapes and (rasters or grids): raise ValueError('请将矢量和卫星影像分开上传。')
    if shapes:
        if kind=='raster':raise ValueError('选择的是卫星影像，但文件包含Shapefile。')
        if len(shapes)!=1: raise ValueError('每次上传一个Shapefile图层。')
        meta=vector_import(shapes[0],derived,encoding)
    else:
        if kind=='vector':raise ValueError('未找到.shp主文件。')
        if grids:
            stacks=[p for p in files if p.name.lower()=='stk.adf']
            if stacks:
                if len(stacks)!=1:raise ValueError('每次上传一个栅格栈。')
                stack=stacks[0];refs=re.findall(rb'[A-Za-z0-9_]{2,13}',stack.read_bytes())
                matches=[p for ref in refs for p in grids if p.name.encode('ascii',errors='ignore')==ref]
                if not matches:raise ValueError('栅格栈引用不完整。')
                prj=stack.parent/'prj.adf'
                if prj.exists():
                    definition=prj.read_text()
                    if all(x in definition for x in ['GEOGRAPHIC','WGS84','DD']):parent_crs=CRS.from_epsg(4326)
                rasters=[matches[0]]
            elif len(grids)==1:rasters=grids
            else:raise ValueError('多个Grid目录需要保留栈文件及配套结构。')
        if len(rasters)!=1:raise ValueError('请选择一个GeoTIFF影像或包含完整栅格数据集的ZIP。')
        meta=raster_import(rasters[0],derived,parent_crs)
    meta['id']=folder.name
    meta['url']=f"/api/uploads/{folder.name}/"+('layer.geojson' if meta['kind']=='vector' else 'preview.png')
    (folder/'metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
    return meta


def load_uploads(root):
    result=[]
    for p in sorted(root.glob('*/metadata.json')):
        try: result.append(json.loads(p.read_text(encoding='utf-8')))
        except (ValueError,OSError): continue
    return result
