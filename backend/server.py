"""Loopback-only GeoCIM service. Explicit file allowlist, no arbitrary execution."""
import argparse,json,os,sys
from pathlib import Path
from fastapi import FastAPI,HTTPException,Request
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
    @app.middleware('http')
    async def secure(request,call_next):
        response=await call_next(request);response.headers['X-Content-Type-Options']='nosniff';response.headers['Cache-Control']='no-store';return response
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
