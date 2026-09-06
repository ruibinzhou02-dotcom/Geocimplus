"""Build the authorized real Shatou demo + anonymous browser analysis release.

Uses the reviewed publication files, never copies the original GIS folder.
The user authorized public demo data in the 2026-09-06 project conversation.
"""
from pathlib import Path
from datetime import datetime
import json, hashlib, shutil, zipfile, urllib.request

root = Path(__file__).resolve().parents[1]
review = root / 'private/public-review'
approved = json.loads((review / 'manifest.json').read_text(encoding='utf8'))
release = root / 'releases' / ('public-analysis-' + datetime.now().strftime('%Y%m%d_%H%M%S'))
site = release / 'site'
site.mkdir(parents=True)
shutil.copy2(root / 'dist/index.html', site / 'index.html')
shutil.copytree(root / 'dist/assets', site / 'assets')
allowed = {'buildings.geojson': {'height', 'stable_id'}, 'roads.geojson': {'stable_id'},
           'boundary.geojson': {'stable_id'}, 'population.geojson': {'usum', 'date', 'stable_id'}}
counts = {}
for item in approved:
    name = item['file']
    assert name in allowed or name == 'satellite-grayscale.png', name
    source = review / name
    assert hashlib.sha256(source.read_bytes()).hexdigest() == item['sha256'], name
    if name in allowed:
        data = json.loads(source.read_text(encoding='utf8'))
        assert len(data['features']) == item['count']
        assert all(set(f['properties']) == allowed[name] for f in data['features'])
        key = name.removesuffix('.geojson')
        destination = site / 'api/layers' / key
        counts[key] = len(data['features'])
    else:
        destination = site / 'api/satellite.png'
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
# Whitelist only bounds and image positioning from the local catalog.
with urllib.request.urlopen('http://127.0.0.1:8765/api/catalog', timeout=15) as response:
    local = json.load(response)
catalog = {'mode': 'public-analysis', 'synthetic': False, 'height_enabled': True,
           'bounds': local['bounds'], 'counts': counts,
           'satellite': {'coordinates': local['satellite']['coordinates'], 'display': 'grayscale'},
           'visitor_processing': 'browser-only; memory-only; no model API'}
(site / 'api/catalog').write_text(json.dumps(catalog, separators=(',', ':')), encoding='utf8')
(site / 'api/uploads').write_text('[]', encoding='utf8')
(site / 'robots.txt').write_text('User-agent: *\nAllow: /\nDisallow: /api/\n', encoding='utf8')
files = [{'path': p.relative_to(site).as_posix(), 'bytes': p.stat().st_size,
          'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
         for p in sorted(site.rglob('*')) if p.is_file()]
(release / 'manifest.json').write_text(json.dumps({'synthetic': False, 'counts': counts,
    'publication_data': approved, 'files': files}, indent=2), encoding='utf8')
with zipfile.ZipFile(release / 'site.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for item in files:
        archive.write(site / item['path'], item['path'])
print(json.dumps({'release': str(release), 'counts': counts,
                  'zip_bytes': (release / 'site.zip').stat().st_size}))
