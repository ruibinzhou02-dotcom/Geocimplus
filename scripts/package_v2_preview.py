"""Build a static preview package containing code only; no private example datasets."""
from pathlib import Path
import zipfile,json
ROOT=Path(__file__).resolve().parents[1]
out=ROOT/'releases/GeoCIM-V2-code-preview.zip'
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    for p in (ROOT/'dist').rglob('*'):
        if p.is_file():z.write(p,p.relative_to(ROOT/'dist'))
    z.writestr('DEPLOY-NOTES.txt','V2 entry: /v2.html. Static code only. Local project import and analysis require no backend. Shatou example uses /v2-data/catalog.json; its private local data is deliberately excluded. Do not replace production before separate preview verification. No AI/API service is included.\n')
print(out)
