"""Loopback-only GeoCIM service. Explicit file allowlist, no arbitrary execution."""
import argparse,json,os,sys,uuid,shutil
from pathlib import Path
from fastapi import FastAPI,HTTPException,Request,UploadFile,File,Form
from starlette.concurrency import run_in_threadpool
try:
    from .uploads import MAX_UPLOAD, EXTENSIONS, safe_relative, unpack, process_upload, load_uploads
except ImportError:
    from uploads import MAX_UPLOAD, EXTENSIONS, safe_relative, unpack, process_upload, load_uploads
from fastapi.responses import FileResponse,JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
import uvicorn

def create_app(project,frontend=None):
    project=Path(project).resolve(); catalog=json.loads((project/'config/data_catalog.json').read_text(encoding='utf-8'))
    layers={key:json.loads(Path(catalog['layers'][name]['derived_path']).read_text(encoding='utf-8')) for key,name in {'buildings':'建筑','roads':'路网','boundary':'边界','population':'人口网格'}.items()}
    satellite=json.loads(Path(catalog['raster']['metadata_path']).read_text(encoding='utf-8'))
    def coordinates(value):
        if len(value)>=2 and isinstance(value[0],(int,float)): yield value[:2]
        else:
            for child in value: yield from coordinates(child)
    boundary_points=[p for f in layers['boundary']['features'] for p in coordinates(f['geometry']['coordinates'])]
    bounds=[[min(p[0] for p in boundary_points),min(p[1] for p in boundary_points)],[max(p[0] for p in boundary_points),max(p[1] for p in boundary_points)]]
    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
    app.add_middleware(TrustedHostMiddleware,allowed_hosts=['127.0.0.1','localhost','testserver'])
    upload_root=project/'data'/'uploads';upload_root.mkdir(parents=True,exist_ok=True)
    @app.middleware('http')
    async def secure(request,call_next):
        if request.method=='POST':
            origin=request.headers.get('origin')
            if origin and origin not in {'http://127.0.0.1:8765','http://localhost:8765','http://127.0.0.1:5173','http://localhost:5173'}:
                return JSONResponse({'detail':'只接受本地页面上传。'},status_code=403)
            size=request.headers.get('content-length')
            if not size or not size.isdigit() or int(size)>MAX_UPLOAD+1024**2:
                return JSONResponse({'detail':'单次上传最大256 MiB。'},status_code=413)
        response=await call_next(request);response.headers['X-Content-Type-Options']='nosniff';response.headers['Cache-Control']='no-store';return response
    @app.get('/api/uploads')
    def uploaded_layers(): return load_uploads(upload_root)
    @app.get('/api/uploads/{upload_id}/{asset}')
    def uploaded_asset(upload_id:str,asset:str):
        if len(upload_id)!=32 or any(c not in '0123456789abcdef' for c in upload_id) or asset not in {'layer.geojson','preview.png'}:
            raise HTTPException(404,'Unknown upload')
        folder=upload_root/upload_id
        if not (folder/'metadata.json').exists() or not (folder/'derived'/asset).exists():raise HTTPException(404,'Unknown asset')
        return FileResponse(folder/'derived'/asset,media_type='application/geo+json' if asset.endswith('geojson') else 'image/png')
    @app.post('/api/uploads')
    async def upload(files:list[UploadFile]=File(...),kind:str=Form('auto'),encoding:str=Form('auto')):
        if kind not in {'auto','vector','raster'} or encoding not in {'auto','UTF-8','GBK','GB18030'}:raise HTTPException(400,'上传参数无效。')
        if not 1<=len(files)<=256:raise HTTPException(400,'请选择1至256个配套文件。')
        folder=upload_root/uuid.uuid4().hex;source=folder/'source';source.mkdir(parents=True)
        try:
            total=0;seen=set();zip_path=None
            for f in files:
                relative=safe_relative(f.filename or '')
                if len(relative.parts)!=1:raise ValueError('请用ZIP保留目录结构。')
                if relative.suffix.lower()=='.zip':
                    if len(files)!=1:raise ValueError('ZIP请单独上传。')
                    target=folder/'package.zip';zip_path=target
                else:
                    if relative.suffix.lower() not in EXTENSIONS:raise ValueError('不支持该文件类型：'+relative.name)
                    target=source/relative
                if target.name.casefold() in seen:raise ValueError('存在重复文件名。')
                seen.add(target.name.casefold())
                with target.open('xb') as output:
                    while chunk:=await f.read(1024**2):
                        total+=len(chunk)
                        if total>MAX_UPLOAD:raise ValueError('单次上传最大256 MiB。')
                        output.write(chunk)
            if zip_path:await run_in_threadpool(unpack,zip_path,source)
            return await run_in_threadpool(process_upload,folder,encoding,kind)
        except Exception as e:
            # Delete only this newly-created, bounded upload folder on failure.
            if folder.parent==upload_root and len(folder.name)==32:shutil.rmtree(folder)
            if isinstance(e,ValueError):raise HTTPException(400,str(e))
            raise HTTPException(400,'数据读取失败，请检查配套文件、编码和坐标系。') from e
        finally:
            for f in files:await f.close()
    @app.get('/api/health')
    def health(): return {'status':'ok','application':'geocim-local','version':'0.1.0'}
    @app.get('/api/catalog')
    def public_catalog():
        return {'status':catalog['audit_status'],'title':catalog.get('confirmations',{}).get('display_title','城市切片'),'bounds':bounds,'functions':catalog['functions'],'counts':{k:len(v['features']) for k,v in layers.items()},'fields':{k:list(v['features'][0]['properties']) if v['features'] else [] for k,v in layers.items()},'satellite':satellite,'ai_mode':'local-preset','api_verified':False,'height_enabled':catalog['layers']['建筑']['fields']['height_m']['unit']=='m','population_enabled':catalog['layers']['人口网格']['fields']['metric']['unit']=='人','alignment_review':catalog.get('alignment_review'),'audit_date':catalog['generated_at'].split('_')[0]}
    @app.get('/api/layers/{name}')
    def layer(name:str):
        if name not in layers: raise HTTPException(404,'Unknown layer')
        return layers[name]
    @app.get('/api/satellite.png')
    def image(): return FileResponse(catalog['raster']['preview_path'],media_type='image/png')
    @app.get('/api/report')
    def report(): return FileResponse(Path(catalog['report_directory'])/'数据体检报告.md',media_type='text/plain; charset=utf-8')
    @app.get('/api/audit.xlsx')
    def workbook(): return FileResponse(Path(catalog['report_directory'])/'数据体检表.xlsx',filename='GeoCIM-audit.xlsx')
    app.mount('/',StaticFiles(directory=Path(frontend) if frontend else project/'dist',html=True),name='frontend')
    return app

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--project',type=Path,default=Path(os.environ.get('GEOCIM_PROJECT',Path(__file__).resolve().parents[1])));parser.add_argument('--port',type=int,default=8765);parser.add_argument('--frontend',type=Path);args=parser.parse_args()
    uvicorn.run(create_app(args.project,args.frontend),host='127.0.0.1',port=args.port,access_log=False)
