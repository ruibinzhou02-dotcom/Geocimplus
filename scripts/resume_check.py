"""Compare the original read-only dataset to the completed audit; never overwrite it."""
import datetime,hashlib,json,platform,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
catalog=json.loads((ROOT/'config/data_catalog.json').read_text(encoding='utf-8'))
previous=Path(catalog['report_directory']);manifest=json.loads((previous/'source_manifest_before.json').read_text(encoding='utf-8'))
source=Path('C:/Users/pc/Desktop/TOSHP/TOSHP');changed=[];current=[]
for p in sorted(source.rglob('*')):
 if p.is_file():
  with p.open('rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
  current.append({'相对路径':str(p.relative_to(source)),'sha256':digest,'字节':p.stat().st_size})
old={x['相对路径']:x for x in manifest}
for x in current:
 if x['相对路径'] not in old or x['sha256']!=old[x['相对路径']]['sha256']:changed.append(x['相对路径'])
missing=sorted(set(old)-{x['相对路径'] for x in current})
out=ROOT/'reports'/('resume_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));out.mkdir()
report={'project':str(ROOT),'source':str(source),'source_files':len(current),'changed':changed,'missing':missing,'previous_audit':str(previous),'python':platform.python_version(),'platform':platform.platform(),'free_gib':{d:round(shutil.disk_usage(d).free/1024**3,1) for d in ['C:/','D:/']},'derived_files':{k:{'exists':Path(v['derived_path']).exists(),'bytes':Path(v['derived_path']).stat().st_size} for k,v in catalog['layers'].items()}}
(out/'local_check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2));print('Report:',out)
if changed or missing:raise SystemExit(2)
