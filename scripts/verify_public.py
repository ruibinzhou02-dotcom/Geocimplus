"""Verify deployed allowlisted files, HTTPS and disabled public POST endpoints."""
import json,hashlib,urllib.request,urllib.error,sys
from pathlib import Path
from datetime import datetime
root=Path(__file__).resolve().parents[1]
release=Path(sys.argv[1]);manifest=json.loads((release/'manifest.json').read_text())
results=[]
for item in manifest['files']:
 url='https://geocimplus.com/'+item['path']
 with urllib.request.urlopen(url,timeout=20) as r:
  body=r.read();ok=hashlib.sha256(body).hexdigest()==item['sha256']
  results.append({'path':item['path'],'status':r.status,'sha256_matches':ok})
  if not ok:raise RuntimeError('Deployment hash differs: '+item['path'])
for path in ['/api/ai/chat','/api/uploads']:
 try:urllib.request.urlopen(urllib.request.Request('https://geocimplus.com'+path,data=b'{}',headers={'Content-Type':'application/json'}),timeout=20)
 except urllib.error.HTTPError as e:
  if e.code not in (403,405):raise
  results.append({'path':path,'method':'POST','status':e.code})
 else:raise RuntimeError('Public POST unexpectedly enabled')
output=root/'reports/resume_20260906_164140/public_verification.json'
output.write_text(json.dumps({'checked_at':datetime.now().isoformat(),'release':str(release),'results':results},indent=2),encoding='utf8')
print(json.dumps({'passed':len(results),'report':str(output)}))
