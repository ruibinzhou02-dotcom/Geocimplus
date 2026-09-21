from pathlib import Path
from urllib.request import urlopen
import ast,json,hashlib
r=Path(__file__).resolve().parents[1]
url='https://raw.githubusercontent.com/BIDS/colormap/master/colormaps.py'
raw=urlopen(url,timeout=30).read()
tree=ast.parse(raw.decode())
ramps={}
for n in tree.body:
    if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name):
        name=n.targets[0].id
        if name in ['_viridis_data','_magma_data','_plasma_data','_inferno_data']:
            data=ast.literal_eval(n.value)
            assert len(data)==256 and all(len(c)==3 and all(0<=v<=1 for v in c) for c in data)
            ramps[name[1:-5]]=['#'+''.join(f'{round(v*255):02x}' for v in c) for c in data]
assert len(ramps)==4
out=r/'src/v2/scientific-palettes.mjs'
out.write_text('// BIDS/colormap: Nathaniel J. Smith, Stefan van der Walt, Eric Firing. CC0.\n// '+url+'\n// Source SHA-256: '+hashlib.sha256(raw).hexdigest()+'\nexport const SCIENTIFIC_RAMPS = '+json.dumps(ramps,indent=2)+';\n',encoding='utf8')
print('Imported four CC0 256-sample scientific colour ramps; no remote code executed.')
