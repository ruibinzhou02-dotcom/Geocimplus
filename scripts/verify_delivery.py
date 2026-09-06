"""Check exported workbook content and local delivery. Writes local evidence only."""
import json, pathlib, zipfile, xml.etree.ElementTree as ET, urllib.request, urllib.error, hashlib, os, shutil
root=pathlib.Path(__file__).resolve().parents[1]
cat=json.loads((root/'config/data_catalog.json').read_text(encoding='utf-8'));out=pathlib.Path(cat['report_directory'])
tables=json.loads((out/'workbook_data.json').read_text(encoding='utf-8'))
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
result={}
with zipfile.ZipFile(out/'数据体检表.xlsx') as z:
    strings=[''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
    checks=[]
    for i,(name,rows) in enumerate(tables.items(),1):
        sheet=ET.fromstring(z.read(f'xl/worksheets/sheet{i}.xml'));cells={c.attrib['r']:c for c in sheet.findall('.//m:c',ns)}
        keys=list(dict.fromkeys(k for row in rows for k in row))
        def letter(n):
            s='';n+=1
            while n: n,r=divmod(n-1,26);s=chr(65+r)+s
            return s
        text_count=0
        for r,row in enumerate(rows,2):
            for c,k in enumerate(keys):
                expected=row.get(k)
                if not isinstance(expected,str): continue
                cell=cells.get(f'{letter(c)}{r}');assert cell is not None,(name,k,r)
                kind=cell.attrib.get('t');v=cell.findtext('m:v',namespaces=ns)
                actual=strings[int(v)] if kind=='s' else ''.join(cell.find('m:is',ns).itertext()) if kind=='inlineStr' else v
                assert kind in ['s','str','inlineStr'],(name,k,r,'NOT TEXT')
                assert actual==expected,(name,k,r,actual,expected)
                text_count+=1
        assert not sheet.findall('.//m:f',ns),'Unexpected formula'
        assert sheet.find('.//m:pane',ns) is not None,'Missing frozen header'
        table=ET.fromstring(z.read(f'xl/tables/table{i}.xml'));assert table.find('m:autoFilter',ns) is not None,'Missing filter'
        checks.append({'sheet':name,'rows':len(rows),'source_text_cells_verified':text_count,'frozen_header':True,'filter':True,'unexpected_formula_count':0})
    result['xlsx']=checks
    result['xlsx_preview_note']='Artifact-tool preview visually omits leading zero on numeric-looking text; exported XLSX XML verified all original text cells exactly, including period 0910. This is a preview renderer limitation, not an edited value.'
features=json.loads(pathlib.Path(cat['layers']['建筑']['derived_path']).read_text(encoding='utf-8'))['features']
ids=[f['properties']['stable_id'] for f in features];assert len(ids)==len(set(ids))
browser_evidence=json.loads((out/'browser_checks.json').read_text(encoding='utf-8'))
expected=browser_evidence['clicked_building'];record=next(f['properties'] for f in features if f['properties']['source_fid']==expected['source_fid'])
assert all(record[k]==v for k,v in expected.items())
result['browser_property_crosscheck']={**expected,'matches':True}
threshold=browser_evidence['filter_threshold_m'];result['filtered_count']=sum(f['properties']['height']>threshold for f in features)
assert result['filtered_count']==browser_evidence['filtered_count']
for route in ['/api/health','/api/catalog','/api/layers/buildings','/api/satellite.png','/api/audit.xlsx','/api/report','/']:
    with urllib.request.urlopen('http://127.0.0.1:8765'+route) as response: assert response.status==200
for route in ['/api/layers/not_a_layer','/config/data_catalog.json','/backend/server.py']:
    try:urllib.request.urlopen('http://127.0.0.1:8765'+route);raise AssertionError('Unexpected accessible path')
    except urllib.error.HTTPError as e: assert e.code==404
result['http_allowlist_verified']=True
manifest=json.loads((out/'source_manifest_before.json').read_text(encoding='utf-8'))
source=pathlib.Path(cat['layers']['建筑']['source_path']).parent
assert {str(p.relative_to(source)) for p in source.rglob('*') if p.is_file()}=={r['相对路径'] for r in manifest}
assert all(hashlib.sha256((source/r['相对路径']).read_bytes()).hexdigest()==r['sha256'] for r in manifest)
result['original_files_unchanged']=len(manifest)
sizes={}
for folder in ['geocim-dev','node_modules','dist','data','reports']:
    total=0
    for base,dirs,files in os.walk(root/folder,followlinks=False):
        dirs[:]=[d for d in dirs if not (pathlib.Path(base)/d).is_junction() and not (pathlib.Path(base)/d).is_symlink()]
        for f in files:
            p=pathlib.Path(base)/f
            if not p.is_symlink(): total+=p.stat().st_size
    sizes[folder]=total
result['logical_directory_bytes_excluding_link_targets']=sizes
result['disk_free_bytes']={p:shutil.disk_usage(p).free for p in ['C:/','D:/']}
result['exe']={'status':'BLOCKED','evidence':'build-exe.ps1 actually executed and stopped: Rust/Cargo MSVC toolchain is missing','rust_compilation':'not performed','desktop_launch':'not performed','clean_machine':'not performed'}
(out/'交付验证.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'report':str(out),'xlsx_sheets':len(checks),'text_cells_verified':sum(x['source_text_cells_verified'] for x in checks),'filtered_count':result['filtered_count'],'directory_bytes':sizes},ensure_ascii=False))
