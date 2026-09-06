"""Read-only GeoCIM audit. All derived output is timestamped under --project.
Usage: python scripts/audit_data.py --source PATH --project PATH
"""
import os
os.environ['GDAL_PAM_ENABLED']='NO'
os.environ['PROJ_NETWORK']='OFF'
import argparse, datetime as dt, hashlib, importlib.metadata, json, platform, re, shutil, struct, sys, time, subprocess
from pathlib import Path
import xml.etree.ElementTree as ET
import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio, rasterio, shapely, pyproj
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from PIL import Image
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

def clean(v):
    if isinstance(v,dict): return {str(k):clean(x) for k,x in v.items()}
    if isinstance(v,(list,tuple,np.ndarray)): return [clean(x) for x in v]
    if isinstance(v,np.generic): return clean(v.item())
    if isinstance(v,Path): return str(v)
    if isinstance(v,float) and not np.isfinite(v): return None
    if v is pd.NA or v is pd.NaT: return None
    return v

def save(path,obj): path.write_text(json.dumps(clean(obj),ensure_ascii=False,indent=2),encoding='utf-8')
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def dbf_info(path,encoding):
    raw=path.read_bytes(); n,hsize,rsize=struct.unpack_from('<IHH',raw,4); fields=[]; off=1
    for p in range(32,hsize-1,32):
        if raw[p]==13: break
        b=raw[p:p+32]; name=b[:11].split(b'\0')[0].decode(encoding,errors='strict'); width=b[16]
        vals=[raw[hsize+i*rsize+off:hsize+i*rsize+off+width] for i in range(n)]
        # Strictly decode every original text cell, not merely the visible samples.
        if chr(b[11])=='C': [x.decode(encoding,errors='strict') for x in vals]
        fields.append(dict(name=name,raw_type=chr(b[11]),width=width,decimals=b[17],asterisk_records=[i for i,x in enumerate(vals) if b'*' in x],full_width_records=[i for i,x in enumerate(vals) if len(x.rstrip())==width and x.strip()]))
        off+=width
    return dict(record_count=n,header_size=hsize,record_size=rsize,ldid=raw[29],deleted=sum(raw[hsize+i*rsize]==42 for i in range(n)),fields=fields,expected_bytes=hsize+n*rsize,actual_bytes=len(raw))

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--source',required=True,type=Path); ap.add_argument('--project',required=True,type=Path); a=ap.parse_args()
    src=a.source.resolve(); project=a.project.resolve()
    if src==project or src in project.parents: raise ValueError('Output cannot be inside source')
    stamp=dt.datetime.now().strftime('%Y%m%d_%H%M%S_%f'); out=project/'reports'/stamp; out.mkdir(parents=True)
    derived=project/'data'/stamp; derived.mkdir(parents=True)
    files=[]
    for p in sorted(src.rglob('*')):
        if p.is_file():
            rel=p.relative_to(src); group=p.stem if p.parent==src and p.suffix not in ['.xml'] else rel.parts[0]
            if str(rel).startswith('111') or rel.parts[0]=='info': group='111栅格栈及关联表'
            else: group=p.name.split('.')[0]
            files.append(dict(逻辑数据集=group,相对路径=str(rel),字节=p.stat().st_size,修改时间=dt.datetime.fromtimestamp(p.stat().st_mtime).isoformat(),sha256=sha(p)))
    save(out/'source_manifest_before.json',files)
    env={'python':sys.version,'executable':sys.executable,'platform':platform.platform(),'architecture':platform.machine(),'conda':'PATH和常用位置未发现；使用独立venv，不修改base','gdal_pyogrio':pyogrio.__gdal_version_string__,'gdal_rasterio':rasterio.__gdal_version__,'packages':{m:importlib.metadata.version(m) for m in ['geopandas','pyogrio','rasterio','shapely','pyproj','numpy','pandas','matplotlib','fastapi','uvicorn']},'free_bytes':{p:shutil.disk_usage(p).free for p in ['C:/','D:/']}}
    if os.name=='nt':
        import ctypes
        class MemoryStatus(ctypes.Structure):
            _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong)]+[(n,ctypes.c_ulonglong) for n in ['total_physical','available_physical','total_pagefile','available_pagefile','total_virtual','available_virtual','available_extended_virtual']]
        ms=MemoryStatus();ms.length=ctypes.sizeof(ms)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms)): env['memory_bytes']={'total':ms.total_physical,'available':ms.available_physical}
    save(out/'environment.json',env)
    layers={}; fieldrows=[]; stats=[]; issues=[]; samples={}; geoms={}; catalog={}; anomalies=[]; raw_metadata={}
    def issue(layer,code,severity,detail,ids=None): issues.append({'图层':layer,'问题':code,'级别':severity,'说明':detail,'源FID':ids or []})
    for name in ['边界','建筑','路网','人口网格']:
        t=time.perf_counter(); path=src/(name+'.shp'); companions={ext:path.with_suffix(ext).exists() for ext in ['.shp','.shx','.dbf','.prj','.cpg','.sbn','.sbx']}
        if not all(companions[e] for e in ['.shp','.shx','.dbf']):
            issue(name,'主文件缺失','BLOCKED',str(companions)); continue
        cpg=path.with_suffix('.cpg').read_text(encoding='ascii').strip(); enc='utf-8' if cpg.upper() in ['UTF-8','65001'] else cpg
        dbf=dbf_info(path.with_suffix('.dbf'),enc); xml=ET.parse(str(path)+'.xml'); aliases={x.findtext('attrlabl'):{'alias':x.findtext('attalias'),'description':x.findtext('attrdef')} for x in xml.findall('.//attr')}
        raw_metadata[name]={'cpg':cpg,'dbf':dbf,'xml':xml.getroot().findtext('.//resTitle'),'processes':[x.text for x in xml.findall('.//Process')],'prj':path.with_suffix('.prj').read_text()}
        g=pyogrio.read_dataframe(path,encoding=enc,fid_as_index=True); original=g.drop(columns='geometry'); fid=g.index.tolist(); geom=g.geometry
        valid=geom.notna() & ~geom.is_empty & geom.is_valid; bad=~valid
        types=geom.geom_type.value_counts().to_dict(); duplicate=shapely.to_wkb(shapely.normalize(geom.values)); dups=pd.Series(duplicate,index=g.index).duplicated(keep=False)
        attrdups=original.duplicated(keep=False)
        z=shapely.has_z(geom.values); m=shapely.has_m(geom.values); stype=struct.unpack_from('<i',path.read_bytes(),32)[0]
        transformed=g.to_crs(32649); measure=transformed.length if name=='路网' else transformed.area
        summary={'图层':name,'要素数':len(g),'字段数':len(original.columns),'几何类型':types,'SHP类型码':stype,'Z数量':int(z.sum()),'M数量':int(m.sum()),'CRS':g.crs.to_string(),'范围':g.total_bounds.tolist(),'读取秒':round(time.perf_counter()-t,4),'空几何':int(geom.isna().sum()),'空形状':int(geom.is_empty.sum()),'无效几何':int((~geom.is_valid & geom.notna()).sum()),'多部件':int(geom.geom_type.str.startswith('Multi').sum()),'重复几何涉及数':int(dups.sum()),'重复属性涉及数':int(attrdups.sum()),'零长度或面积':int((measure==0).sum()),'编码':enc,'配套':companions,'分析面积或长度单位':'m' if name=='路网' else 'm²','测量最小':float(measure.min()),'测量最大':float(measure.max()),'测量中位数':float(measure.median())}
        layers[name]=summary; geoms[name]=g
        if name=='建筑':
            tiny=measure<1
            if tiny.any(): issue(name,'小于1平方米面','待核对','可能为边界裁剪碎片；只提示，不删除或并合',g.index[tiny].tolist())
        for label,mask in [('无效或空几何',bad),('重复几何',dups),('重复属性',attrdups),('零长度或面积',measure==0)]:
            if mask.any():
                ids=g.index[mask].tolist(); issue(name,label,'待核对',f'{len(ids)}条，未删除或合并',ids)
                for idx in ids[:30]: anomalies.append({'图层':name,'异常':label,'source_fid':int(idx),'记录':clean(original.loc[idx].to_dict()),'几何原因':shapely.is_valid_reason(geom.loc[idx])})
        data_hash=hashlib.sha256(b''.join(path.with_suffix(e).read_bytes() for e in ['.shp','.shx','.dbf'])).hexdigest()
        idmap=[]
        key={'建筑':'gml_id','人口网格':'geohash7'}.get(name)
        for idx,row in original.iterrows():
            # Persisted source identity is invariant across filtering/loading. No runtime row IDs.
            keyval=str(row[key]) if key and original[key].is_unique else f'{data_hash}:{idx}'
            sid=hashlib.sha256((name+':'+keyval).encode()).hexdigest()[:24]
            idmap.append({'source_fid':int(idx),'stable_id':sid,'original_key':keyval})
        save(derived/(name+'_id_map.json'),idmap)
        webg=g.copy(); webg['stable_id']=[x['stable_id'] for x in idmap]; webg['source_fid']=fid
        webg.to_crs(4326).to_file(derived/(name+'.geojson'),driver='GeoJSON',engine='pyogrio')
        samples[name]=[{'source_fid':int(idx),**clean(row.to_dict())} for idx,row in original.head(50).iterrows()]
        for c in original.columns:
            s=original[c]; non=s.dropna(); f=next(x for x in dbf['fields'] if x['name']==c); meta=aliases.get(c,{})
            fieldrows.append({'图层':name,'原始名称':c,'别名':meta.get('alias'),'字段说明':meta.get('description'),'DBF类型':f['raw_type'],'宽度':f['width'],'小数位':f['decimals'],'解析类型':str(s.dtype),'非空样例':clean(non.head(5).tolist())})
            r={'图层':name,'字段':c,'空值数':int(s.isna().sum()),'空值比例':float(s.isna().mean()),'唯一值数':int(s.nunique()),'统计范围':'全部记录，精确','主要类别':clean(s.value_counts(dropna=False).head(10).to_dict())}
            if pd.api.types.is_numeric_dtype(s):
                r.update({'最小':float(non.min()),'最大':float(non.max()),'中位数':float(non.median()),'P01':float(non.quantile(.01)),'P25':float(non.quantile(.25)),'P75':float(non.quantile(.75)),'P99':float(non.quantile(.99)),'零值':int((s==0).sum()),'负值':int((s<0).sum())})
                neg=s<0
                if neg.any(): issue(name,'数值含负值','待核对',f'{c}: {int(neg.sum())}条；负数不自动视为缺失',g.index[neg].tolist())
            else:
                parsed=pd.to_numeric(non,errors='coerce'); r['数字文本比例']=float(parsed.notna().mean()) if len(non) else None
                if len(non) and parsed.notna().all(): issue(name,'数字以文本保存','提示',f'{c}：保留原文本；ID/日期/时段不能自动转数值')
                if non.astype(str).str.contains('\ufffd',regex=False).any(): issue(name,'替换字符','待核对',c)
            stats.append(r)
            if f['asterisk_records'] and f['raw_type']!='C': issue(name,'DBF星号可能溢出','待核对',c,f['asterisk_records'])
            if f['full_width_records'] and f['raw_type']=='C': issue(name,'文本占满DBF宽度','待核对',f'{c}，可能截断，也可能合法',f['full_width_records'])
        near=[(a,b) for i,a in enumerate(original.columns) for b in list(original.columns)[i+1:] if a.lower()[:8]==b.lower()[:8]]
        if near: issue(name,'近似字段名','提示',str(near))
        catalog[name]={'source_path':str(path),'source_sha256':data_hash,'crs_wkt':g.crs.to_wkt(),'epsg':g.crs.to_epsg(),'coordinate_unit':g.crs.axis_info[0].unit_name,'status':'READY_WITH_LIMITS','feature_count':len(g),'derived_path':str(derived/(name+'.geojson')),'id_map':str(derived/(name+'_id_map.json')),'fields':{},'position_evidence':'prj与投影处理历史一致；物理坐标基准需结合叠加检查'}
        print(name,len(g),flush=True)
    save(out/'metadata_evidence.json',raw_metadata)
    boundary=geoms['边界'].to_crs(32649).geometry.union_all()
    for name,g in geoms.items():
        gm=g.to_crs(32649); safe=gm.geometry[gm.geometry.is_valid & ~gm.geometry.is_empty]; union=safe.union_all(); length=name=='路网'
        denom=union.length if length else union.area; inter=union.intersection(boundary)
        layers[name]['边界内占比_去重长度或面积']=(inter.length if length else inter.area)/denom if denom else None
        layers[name]['与边界相交要素数']=int(gm.intersects(boundary).sum())
        if not length: layers[name]['覆盖研究边界面积比例']=inter.area/boundary.area
        if 'Shape_Area' in gm.columns and not length:
            layers[name]['存储面积对米制面积比中位数']=float((gm['Shape_Area']/gm.area).median())
    b=geoms['建筑']; heights=b['height']; height_detail={'positive_count':int((heights>0).sum()),'zero_count':int((heights==0).sum()),'negative_count':int((heights<0).sum()),'null_count':int(heights.isna().sum()),'positive_rate':float((heights>0).mean()),'unit':None,'meaning':None,'warning':'height仅名称暗示高度；无单位或测量定义；暂不作为真实高度'}
    issue('建筑','高度定义待确认','功能阻塞','height未提供单位/离地定义；来源包含百度三维，不能据此断定物理坐标基准正确')
    for c in ['height','shape_leng','Shape_Le_1','Shape_Area']:
        for idx in b[c].sort_values().index[:3].tolist()+b[c].sort_values().index[-3:].tolist(): anomalies.append({'图层':'建筑','异常':c+'极值供核对','source_fid':int(idx),'记录':clean(b.drop(columns='geometry').loc[idx].to_dict())})
    pop=geoms['人口网格']; pg=pop.to_crs(32649); bbox=pg.bounds; dims=pop.bounds
    sex=pop['male_cnt']+pop['female_cnt']-pop['usum']; age=pop[['u18_cnt','F1934_cnt','F3544_cnt','F4554_cnt','F5564_cnt','o65_cnt']].sum(axis=1)-pop['usum']
    pop_detail={'dates':pop['date'].unique().tolist(),'periods':pop['period'].unique().tolist(),'duplicate_grid_time':int(pop.duplicated(['geohash7','date','period']).sum()),'id_unique':bool(pop['geohash7'].is_unique),'width_degree':[float((dims.maxx-dims.minx).min()),float((dims.maxx-dims.minx).max())],'height_degree':[float((dims.maxy-dims.miny).min()),float((dims.maxy-dims.miny).max())],'area_m2':[float(pg.area.min()),float(pg.area.max()),float(pg.area.median())],'width_bbox_m':[float((bbox.maxx-bbox.minx).min()),float((bbox.maxx-bbox.minx).max())],'height_bbox_m':[float((bbox.maxy-bbox.miny).min()),float((bbox.maxy-bbox.miny).max())],'sex_sum_mismatch':int((sex!=0).sum()),'sex_difference_range':[float(sex.min()),float(sex.max())],'age_sum_mismatch':int((age!=0).sum()),'log2_usum_max_residual':float(np.abs(np.log2(pop.usum.replace(0,np.nan))-pop.usum_log).max()),'measure':None,'unit':None,'temporal_semantics':'date=20190428、period=0910，时区及0910定义未证实；仅一个组合'}
    issue('人口网格','指标口径未定义','功能阻塞','usum及分组字段无来源口径，不能称人数；只有一个date/period组合，不提供动态时间轴')
    if (sex!=0).any(): issue('人口网格','分组加总不等于usum','待核对',f'性别字段{int((sex!=0).sum())}条，年龄字段{int((age!=0).sum())}条；不得自动调整',pop.index[sex!=0].tolist())
    for idx in pop.index[sex!=0][:10]: anomalies.append({'图层':'人口网格','异常':'性别合计差异','source_fid':int(idx),'记录':clean(pop.drop(columns='geometry').loc[idx].to_dict())})
    roads=geoms['路网'].to_crs(32649); endpoints=[]
    for idx,geom in roads.geometry.items():
        for xy in [geom.coords[0],geom.coords[-1]]: endpoints.append((idx,shapely.Point(xy)))
    unmatched=[]; gaps=[]
    for idx,p in endpoints:
        others=roads.geometry.drop(index=idx); dist=others.distance(p).min()
        if dist>0.05: unmatched.append({'source_fid':int(idx),'distance_to_other_line_m':float(dist),'on_clip_edge':p.distance(boundary.boundary)<1})
        if .05<dist<10 and p.distance(boundary.boundary)>=1: gaps.append(int(idx))
    road_detail={'unmatched_endpoints_5cm':len(unmatched),'near_gap_candidate_fids_005_to_10m':sorted(set(gaps)),'endpoints':unmatched,'topology':'仅端点至其他线检查，未完成交点切分/立交分层/方向/旅行时间验证，不支持路网服务区','maxspeed_zero':int((roads.maxspeed==0).sum())}
    save(out/'road_topology.json',road_detail)
    issue('路网','路径分析未验证','功能限制',road_detail['topology'],sorted(set(gaps)))
    raster_info=[]; arrays=[]; source_rasters=[]
    for label in ['111','111/stk.adf','111c1','111c2','111c3']:
        try:
            with rasterio.open(src/label,mode='r') as r:
                try: cmap=r.colormap(1)
                except ValueError: cmap=None
                arr=r.read(1,out_shape=(min(1200,r.height),round(r.width*min(1200,r.height)/r.height)),masked=True,resampling=Resampling.nearest)
                full=r.read(1,masked=True)
                info={'入口':label,'驱动':r.driver,'波段数':r.count,'宽':r.width,'高':r.height,'像元类型':r.dtypes,'CRS':r.crs.to_wkt() if r.crs else None,'有效CRS依据':'111/prj.adf + 栈引用，WGS84地理坐标；子栅格自身无prj','有效EPSG':4326,'分辨率':r.res,'单位':'degree（父栈prj）','仿射变换':list(r.transform),'范围':list(r.bounds),'NoData':r.nodatavals,'颜色解释':[x.name for x in r.colorinterp],'色表':cmap,'子数据集':r.subdatasets,'金字塔':r.overviews(1),'标签':r.tags(),'预览有效比例':float((~np.ma.getmaskarray(arr)).mean()),'预览最小':float(arr.min()),'预览最大':float(arr.max()),'磁盘字节':sum(p.stat().st_size for p in (src/label).rglob('*') if p.is_file())}
                raster_info.append(info); arrays.append(arr); source_rasters.append(label)
                info.update({'全量有效像元数':int(full.count()),'全量NoData像元数':int(np.ma.getmaskarray(full).sum()),'全量最小':int(full.min()),'全量最大':int(full.max()),'全量零值数':int((full==0).sum()),'全量255值数':int((full==255).sum()),'统计范围':'全像元精确统计；预览有效比例为降采样值'})
                del full
        except Exception as e: raster_info.append({'入口':label,'读取错误':str(e),'说明':'驱动不能直接读取栈入口，不代表关联波段文件损坏'})
    stack=(src/'111/stk.adf').read_bytes(); stackrefs=re.findall(rb'111c[123]',stack)
    if stackrefs!=[b'111c1',b'111c2',b'111c3']: raise ValueError('Unexpected stack references; refuse guessing')
    parent_prj=(src/'111/prj.adf').read_text()
    if not all(x in parent_prj for x in ['GEOGRAPHIC','WGS84','DD']): raise ValueError('Unknown raster parent CRS')
    ras=raster_info[-1]; bounds=ras['范围']; extent=[bounds[0],bounds[2],bounds[1],bounds[3]]
    # Preserve samples without stretching. No asserted RGB mapping: grayscale band views are authoritative.
    plt.rcParams['font.sans-serif']=['Microsoft YaHei','SimHei','DejaVu Sans']; plt.rcParams['axes.unicode_minus']=False
    fig,axes=plt.subplots(1,3,figsize=(16,6))
    for ax,arr,label in zip(axes,arrays,source_rasters): ax.imshow(arr,cmap='gray',vmin=0,vmax=255); ax.set_title(label+' 原始单波段灰度'); ax.axis('off')
    fig.suptitle('111 栅格栈预览｜RGB顺序未证实，三个波段分别显示'); fig.tight_layout(); fig.savefig(out/'卫星底图预览图.png',dpi=150); plt.close(fig)
    rgb=np.stack([np.ma.filled(x,0) for x in arrays],axis=-1).clip(0,255).astype('uint8')
    Image.fromarray(rgb).save(out/'候选123顺序_非已验证RGB.png')
    alpha=np.where(np.ma.getmaskarray(arrays[0]),0,255).astype('uint8'); gray=np.ma.filled(arrays[0],0).clip(0,255).astype('uint8')
    rgba=np.stack([gray,gray,gray,alpha],axis=-1); Image.fromarray(rgba).save(derived/'satellite_band1.png')
    meta={'coordinates':[[bounds[0],bounds[3]],[bounds[2],bounds[3]],[bounds[2],bounds[1]],[bounds[0],bounds[1]]],'display':'111c1单波段灰度；RGB未证实','width':gray.shape[1],'height':gray.shape[0],'crs':'EPSG:4326','source':'111/prj.adf and stk.adf'}; save(derived/'satellite.json',meta)
    colors={'边界':'#e6dd45','建筑':'#bc6cff','路网':'#00cde3','人口网格':'#ef8460'}
    geo={n:g.to_crs(4326) for n,g in geoms.items()}; bb=geo['边界'].total_bounds
    centers=[(bb[0]+.25*(bb[2]-bb[0]),bb[1]+.70*(bb[3]-bb[1])),(bb[0]+.55*(bb[2]-bb[0]),bb[1]+.45*(bb[3]-bb[1])),(bb[0]+.80*(bb[2]-bb[0]),bb[1]+.25*(bb[3]-bb[1]))]
    alignment_views=[]
    for i,center in enumerate([None]+centers):
        fig,ax=plt.subplots(figsize=(13,9))
        if center:
            with rasterio.open(src/'111c1') as r:
                win=rasterio.windows.from_bounds(center[0]-.0022,center[1]-.0017,center[0]+.0022,center[1]+.0017,r.transform).round_offsets().round_lengths()
                detail=r.read(1,window=win,masked=True); wb=rasterio.windows.bounds(win,r.transform)
                ax.imshow(detail,extent=[wb[0],wb[2],wb[1],wb[3]],cmap='gray',vmin=0,vmax=255)
        else: ax.imshow(arrays[0],extent=extent,cmap='gray',vmin=0,vmax=255)
        for name,g in geo.items():
            if name=='路网': g.plot(ax=ax,color=colors[name],linewidth=1.1)
            else: g.boundary.plot(ax=ax,color=colors[name],linewidth=.65 if name=='建筑' else 1)
        if center: ax.set_xlim(center[0]-.0022,center[0]+.0022); ax.set_ylim(center[1]-.0017,center[1]+.0017)
        else: ax.set_xlim(bb[0]-.001,bb[2]+.001); ax.set_ylim(bb[1]-.001,bb[3]+.001)
        ax.set_aspect(1/np.cos(np.deg2rad(22.52))); ax.ticklabel_format(useOffset=False); ax.set_xlabel('WGS84 longitude（按声明CRS转换）'); ax.set_ylabel('latitude')
        ax.legend(handles=[Line2D([0],[0],color=c,label=n) for n,c in colors.items()],loc='upper right')
        ax.set_title(('数据叠加总览' if not center else f'局部对齐检查 {i}')+'｜影像111c1灰度｜叠加不等于已验证精度')
        fig.tight_layout(); filename='数据叠加总览.png' if not center else f'局部对齐图_{i}.png'; fig.savefig(out/filename,dpi=160); plt.close(fig)
        alignment_views.append({'file':filename,'center':center,'inspection':'待视觉检查；未量测控制点残差'})
    # Full native resolution windows for the same three centers, keeping coordinates for inspection.
    for i,(x,y) in enumerate(centers,1):
        with rasterio.open(src/'111c1') as r:
            row,col=r.index(x,y); win=rasterio.windows.Window(max(0,col-220),max(0,row-180),440,360); arr=r.read(1,window=win,masked=True)
            Image.fromarray(np.ma.filled(arr,0).clip(0,255).astype('uint8')).save(out/f'影像原分辨率窗口_{i}.png')
    issue('111','RGB顺序未证实','功能限制','栈引用顺序明确，但所有波段颜色解释undefined且无色表；可用c1灰度检查，不宣称原彩正确')
    issue('全局','精确空间对齐待验证','待核对','已按声明CRS输出3处局部叠加图；不能以包围盒或声明CRS认定物理坐标基准正确')
    mapping=[]
    for layer,std,raw,status,why,unit in [
        ('建筑','stable_id','gml_id','已证实','全量唯一非空；哈希持久映射',None),('建筑','height_m','height','待确认','元数据无单位或离地定义',None),('建筑','floors',None,'不存在','现有字段无层数',None),('建筑','construction_year',None,'不存在','2025/2026仅处理日期',None),('建筑','use',None,'不存在','无用途字段',None),('建筑','footprint_area_m2','Shape_Area','已证实','面几何面积；元数据内部单位平方，非总建筑面积','m²'),('建筑','legacy_length','shape_leng','待确认','数值疑似原始经纬度周长，不能当米',None),('路网','road_class','fclass','已证实','类别值及中文描述一致',None),('路网','speed','maxspeed','待确认','多数0，单位和0语义未定义',None),('人口网格','grid_id','geohash7','已证实','全量唯一非空',None),('人口网格','metric','usum','待确认','无人数/设备数/扩样定义',None),('人口网格','date','date','已证实','原始文本20190428，来源表同名；保留文本',None),('人口网格','period','period','待确认','只有0910；时段解释和时区待确认',None),('边界','region_name',None,'待确认','处理历史沙头；边界无名称/层级属性',None)]:
        mapping.append({'图层':layer,'标准字段':std,'原始字段':raw,'状态':status,'依据':why,'单位':unit}); catalog[layer]['fields'][std]={'raw':raw,'status':status,'reason':why,'unit':unit}
    functions=[{'功能':n,'状态':s,'可做与限制':d} for n,s,d in [
        ('建筑二维','READY_WITH_LIMITS','可显示真实面与原始属性；物理坐标对齐待核对'),('建筑三维高度','BLOCKED','height单位和定义待确认；禁用真实高度拉伸'),('建筑年代着色','BLOCKED','无建成年份字段'),('用途着色','BLOCKED','无建筑用途字段'),('路网显示','READY_WITH_LIMITS','可显示真实线；不做路径服务区'),('人口静态图','READY_WITH_LIMITS','可显示网格与usum原始指标；不标称人口数量'),('人口时间变化','BLOCKED','只有一个日期和时段组合'),('卫星底图','READY_WITH_LIMITS','111c1灰度可显示；RGB和精确对齐待验证'),('自然语言属性查询','READY_WITH_LIMITS','允许原始字段查询和本地预设命令；API未验证')]]
    source_bytes=sum(x['字节'] for x in files); raster_bytes=sum(x['字节'] for x in files if x['逻辑数据集']=='111栅格栈及关联表'); native_bytes=ras['宽']*ras['高']*3*4
    storage={'source_bytes':source_bytes,'raster_source_bytes':raster_bytes,'native_three_band_bytes':ras['宽']*ras['高']*3*np.dtype(ras['像元类型'][0]).itemsize,'native_dtype':ras['像元类型'][0],'conservative_int32_working_bytes':native_bytes,'candidate_rgb_uint8_bytes':ras['宽']*ras['高']*3,'all_pyramids_int32_approx_bytes':round(native_bytes*4/3),'bounded_preview_dimensions':[gray.shape[1],gray.shape[0]],'audit_derived_actual_bytes':sum(p.stat().st_size for p in derived.rglob('*') if p.is_file()),'proposed_peak_gis_bytes':source_bytes+native_bytes*2+round(native_bytes*4/3)+512*1024**2,'peak_method':'完整源副本+两份保守int32三波段转换临时文件+4/3金字塔+512MiB报告与矢量余量；原生实际int16，当前只做预览，未复制完整源/切全部瓦片'}
    evidence={'height':height_detail,'population':pop_detail,'roads':road_detail,'alignment':alignment_views,'storage':storage}
    save(out/'audit_details.json',evidence)
    changed=[f['相对路径'] for f in files if not (src/f['相对路径']).exists() or sha(src/f['相对路径'])!=f['sha256'] or dt.datetime.fromtimestamp((src/f['相对路径']).stat().st_mtime).isoformat()!=f['修改时间']]
    added=[str(p.relative_to(src)) for p in src.rglob('*') if p.is_file() and str(p.relative_to(src)) not in {f['相对路径'] for f in files}]
    if changed or added: raise RuntimeError(f'Source changed: {changed}; added: {added}')
    save(out/'source_integrity.json',{'all_sha256_and_mtime_unchanged':True,'files':len(files),'new_files':added})
    cat={'audit_status':'READY_WITH_LIMITS','generated_at':stamp,'report_directory':str(out),'derived_directory':str(derived),'analysis_crs':'EPSG:32649','analysis_reason':'沿用源米制UTM49N，保留WKT；当地接近UTM50N边缘，未改写原CRS','layers':catalog,'raster':{'source_path':str(src/'111'),'stack_references':[x.decode() for x in stackrefs],'effective_epsg':4326,'crs_evidence':parent_prj,'rgb_order':None,'reason':'波段颜色解释undefined','preview_path':str(derived/'satellite_band1.png'),'metadata_path':str(derived/'satellite.json')},'functions':functions,'source_integrity':'SHA256、mtime、文件清单前后均一致','unknowns':['height单位和定义','usum统计对象和口径','RGB顺序','百度建筑物理坐标基准与精确叠加','边界正式名称层级']}
    save(project/'config/data_catalog.json',cat); save(out/'data_catalog_snapshot.json',cat)
    tables={'图层概览':list(layers.values()),'文件清单':files,'字段字典':fieldrows,'字段统计':stats,**{n+'前50条':r for n,r in samples.items()},'问题清单':issues,'字段映射':mapping,'功能可用性':functions,'栅格信息':raster_info,'异常样例':anomalies}
    save(out/'workbook_data.json',tables)
    lines=['# GeoCIM 数据体检报告','','审计结论：**READY_WITH_LIMITS**。真实文件已逐层读取，当前仅允许受限基础展示。物理坐标对齐、高度单位、人口口径及RGB仍待核对。',f'审计时间：{stamp}。输出目录：{out}。','原始数据只读：全部文件SHA256、修改时间、清单前后相同。没有删除、修复、合并原始记录。','','## 真实读取结果','|图层|要素|字段|CRS|无效|重复几何涉及数|','|---|---:|---:|---|---:|---:|']
    lines += [f"|{n}|{r['要素数']}|{r['字段数']}|{r['CRS']}|{r['无效几何']}|{r['重复几何涉及数']}|" for n,r in layers.items()]
    lines += ['','## 属性与数据口径',f'建筑height：{json.dumps(clean(height_detail),ensure_ascii=False)}','建筑不存在层数、建成年份、用途字段。XML处理日期不作为建成年份。Shape_Area为几何面面积，不是总建筑面积。shape_leng与Shape_Le_1口径不同，不能混用。',f'人口网格：{json.dumps(clean(pop_detail),ensure_ascii=False)}','date与period各只有一个值，禁止虚构24小时。usum_log与log2(usum)关系仅作为数值证据，不推定人口口径。分组加总存在差异，未修改。','研究区元数据处理历史含沙头及深圳市源图层；边界只含id和几何量，正式行政名称和级别未确认。不是深圳全市。','中文按CPG声明UTF-8严格解码全部DBF文本；无静默替换。DBF原始宽度、类型、删除标志和逐字段统计见JSON/Excel。XML中要素数0为陈旧元数据，实际计数来自完整读取。','','## 几何、覆盖与坐标','完整CRS WKT保存在catalog。边界/建筑/路网声明WGS84 UTM49N，网格声明WGS84经纬度。网页衍生副本通过to_crs转换，未强行指定向量CRS。长度面积统一用32649。','覆盖率为有效几何先并集后与边界相交所得长度/面积÷原并集长度/面积，排除重复计量；不表示遥感识别准确率。']
    lines += [f"- {n}：边界内占比{r['边界内占比_去重长度或面积']:.6%}，相交{r['与边界相交要素数']}条。" for n,r in layers.items()]
    lines += ['建筑相互重叠不自动判错；无效/重复源FID与异常样例保留。稳定ID来源于唯一原始键；无唯一键时使用源数据哈希+源FID，映射已持久化，加载筛选不重编号。',f"道路端点未贴其他线（5厘米阈值）{road_detail['unmatched_endpoints_5cm']}个，候选近断裂FID见road_topology.json。未建立可路由拓扑、方向语义、速度与旅行时间，不能做消防服务区。",'总览和3张局部图按声明CRS绘制；尚需视觉核对，不将相交视为精确对齐。百度来源带来基准核对要求，但不能仅凭百度名称认定BD-09。未使用固定平移。','','## 111卫星栅格','111是Arc/Info栈结构，stk.adf明确引用111c1/111c2/111c3；当前GDAL不能直接打开父栈，各子目录由AIG驱动真实读取。info/vat为关联信息，aux.xml记录三波段描述和已有统计。父prj.adf声明WGS84地理坐标和DD，子栅格无自身CRS，副本引用父栈已知CRS而非猜测。',f"三个单波段均{ras['宽']}×{ras['高']}，{ras['像元类型']}，分辨率{ras['分辨率']}度（约1米量级，纬度相关），范围{ras['范围']}。详细仿射/NoData/色表/金字塔见栅格表。",'波段颜色解释均undefined，无色表；RGB顺序未证实。交付三个灰度波段预览和明确标注的123候选图，不能把候选图当已验证原彩。网页仅可提供111c1灰度模式。原分辨率局部窗口另存，原始颜色/值未改写。','','## 功能矩阵','|功能|状态|限制|','|---|---|---|']
    lines += [f"|{r['功能']}|{r['状态']}|{r['可做与限制']}|" for r in functions]
    lines += ['','## 环境与空间',f'环境版本：`{json.dumps(env,ensure_ascii=False)}`',f'磁盘估算：`{json.dumps(storage,ensure_ascii=False)}`','同来源PyPI预编译wheel安装于独立venv；Rasterio与Pyogrio各自带GDAL，实际导入/读取已验证。未安装osgeo Python接口或gdalinfo CLI，不能把这两项标为可用。','全量源只有几十MiB，首版可用全部小范围矢量和1200像素高预览，不需先切整幅全层级瓦片。打包依赖另实测，不以GIS估算代替。','','## 问题与需要补充','完整问题、源FID、字段映射及异常样例见数据体检表.xlsx与workbook_data.json。请确认height的单位/定义、usum口径、period解释、RGB顺序及坐标转换来源。缺项只阻塞相关功能。','技术修复：未修改几何；已解决独立GIS依赖缺失、父栈无法直接读取（按明确栈引用读取子栅格）、网页CRS转换和持久ID映射。','开发状态：本报告生成时审计代码已实际运行；首版程序另按验收结果记录，不以本报告声称程序/EXE完成。','','## 复现',f'`geocim-dev\\Scripts\\python.exe scripts\\audit_data.py --source "{src}" --project "{project}"`','每次按微秒时间新建报告和衍生目录，不覆盖历史；config/data_catalog.json是最新索引，报告内保留快照。再运行scripts/build_workbook.mjs指向workbook_data.json生成Excel。','','## 技术参考','- https://gdal.org/en/stable/drivers/raster/arcinfo_grid_format.html','- https://gdal.org/en/stable/user/configoptions.html','- https://rasterio.readthedocs.io/en/stable/topics/configuration.html']
    (out/'数据体检报告.md').write_text('\n'.join(lines),encoding='utf-8')
    confirmations=project/'config/local_confirmations.json'
    if confirmations.exists():
        apply_confirmations(out,project,json.loads(confirmations.read_text(encoding='utf-8')))
    node=shutil.which('node')
    builder=project/'scripts/build_workbook.mjs'
    if node and builder.exists():
        subprocess.run([node,str(builder),str(out/'workbook_data.json')],check=True,cwd=project/'scripts')
    else:
        (out/'Excel生成阻塞.txt').write_text('需要Node与Codex内置artifact-tool依赖后运行scripts/build_workbook.mjs；未生成Excel，不能视为全部审计交付完成。',encoding='utf-8')
    print('REPORT='+str(out),flush=True)

def apply_confirmations(out,project,confirmed):
    """Explicit user definitions live in ignored local config, never in source code."""
    cat=json.loads((out/'data_catalog_snapshot.json').read_text(encoding='utf-8'))
    tables=json.loads((out/'workbook_data.json').read_text(encoding='utf-8'))
    evidence=json.loads((out/'audit_details.json').read_text(encoding='utf-8'))
    report=(out/'数据体检报告.md').read_text(encoding='utf-8')
    for layer,key,ckey in [('建筑','height_m','height'),('人口网格','metric','population')]:
        info=confirmed.get(ckey)
        if not info: continue
        field=cat['layers'][layer]['fields'][key]
        field.update(status='已证实（用户确认）',unit=info['unit'],reason=info['evidence'],meaning=info['meaning'])
        for row in tables['字段映射']:
            if row['图层']==layer and row['标准字段']==key: row.update(状态=field['status'],单位=info['unit'],依据=info['evidence'])
        evidence[ckey].update(unit=info['unit'],meaning=info['meaning'],confirmation=info['evidence'])
        if ckey=='height': evidence[ckey]['warning']='单位与离地定义由用户确认，测量方法/精度尚未提供；不称实测高精度'
        else: evidence[ckey]['measure']='人数'
    if confirmed.get('height'):
        for row in cat['functions']:
            if row['功能']=='建筑三维高度': row.update(状态='READY_WITH_LIMITS',可做与限制='用户确认height为米制离地高度，可按源值拉伸；精度与物理位置需核对')
        tables['问题清单']=[r for r in tables['问题清单'] if r['问题']!='高度定义待确认']
        cat['unknowns']=[x for x in cat['unknowns'] if x!='height单位和定义']
    if confirmed.get('population'):
        for row in cat['functions']:
            if row['功能']=='人口静态图': row.update(状态='READY_WITH_LIMITS',可做与限制='用户确认usum为人数；仅单期网格专题图，去重/扩样/时区口径未补充')
        tables['问题清单']=[r for r in tables['问题清单'] if r['问题']!='指标口径未定义']
        cat['unknowns']=[x for x in cat['unknowns'] if x!='usum统计对象和口径']+['人口去重/扩样/分组差异及period时区']
    note=confirmed.get('alignment_review')
    if note:
        cat['alignment_review']=note
        for row in tables['问题清单']:
            if row['问题']=='精确空间对齐待验证': row['说明']=note
    tables['功能可用性']=cat['functions']
    cat['confirmations']=confirmed
    # Rewrite dependent passages so the final report does not contain stale blockers.
    report=report.replace('当前仅允许受限基础展示。物理坐标对齐、高度单位、人口口径及RGB仍待核对。','可进入受限首版开发；height和usum已由用户确认。物理对齐精度、人口进一步统计口径及RGB仍待核对。')
    if confirmed.get('height'):
        report=re.sub(r'建筑height：.*?\n', '建筑height：'+json.dumps(evidence['height'],ensure_ascii=False)+'\n',report)
        report=report.replace('|建筑三维高度|BLOCKED|height单位和定义待确认；禁用真实高度拉伸|','|建筑三维高度|READY_WITH_LIMITS|用户确认height为米制离地高度；可按源值拉伸，测量精度未提供|')
    if confirmed.get('population'):
        report=re.sub(r'^人口网格：.*?\n','人口网格：'+json.dumps(evidence['population'],ensure_ascii=False)+'\n',report,flags=re.MULTILINE)
        report=report.replace('|人口静态图|READY_WITH_LIMITS|可显示网格与usum原始指标；不标称人口数量|','|人口静态图|READY_WITH_LIMITS|用户确认usum为人数；单期专题图；去重/扩样口径待补充|')
    report=report.replace('请确认height的单位/定义、usum口径、period解释、RGB顺序及坐标转换来源。','height为米制离地高度、usum为人数已获用户确认。尚需period时区/去重扩样说明、RGB顺序及原始坐标转换来源。')
    if note:
        report=report.replace('尚需视觉核对，不将相交视为精确对齐。','已检查三处可辨识位置：'+note)
        report+='\n\n## 三处图像人工检查记录\n'+note+'\n'
    report+='\n## 用户确认来源\n'+json.dumps(confirmed,ensure_ascii=False,indent=2)+'\n'
    save(out/'audit_details.json',evidence);save(out/'workbook_data.json',tables);save(out/'data_catalog_snapshot.json',cat);save(project/'config/data_catalog.json',cat)
    (out/'数据体检报告.md').write_text(report,encoding='utf-8')

if __name__=='__main__': main()
