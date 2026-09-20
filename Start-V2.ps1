param([int]$Port=8766)
$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$pythonPath=Join-Path $projectRoot 'geocim-dev\Scripts\python.exe'
if(-not (Test-Path -LiteralPath $pythonPath)){throw 'Project Python environment missing. See docs/V2本地版使用与验收.md.'}
if(-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\v2.html'))){throw 'Build V2 first: pnpm build'}
$previewUrl="http://127.0.0.1:$Port/v2.html"
$running=$false
try{$response=Invoke-WebRequest -Uri $previewUrl -TimeoutSec 2 -UseBasicParsing;$running=$response.Content -match 'Local Studio'}catch{}
if(-not $running){
 $scriptPath=Join-Path $projectRoot 'scripts\serve_v2.py'
 Start-Process -FilePath $pythonPath -ArgumentList @('"'+$scriptPath+'"','--port',"$Port") -WorkingDirectory $projectRoot -WindowStyle Hidden
 for($i=0;$i -lt 20;$i++){try{$response=Invoke-WebRequest -Uri $previewUrl -TimeoutSec 1 -UseBasicParsing;if($response.Content -match 'Local Studio'){$running=$true;break}}catch{};Start-Sleep -Milliseconds 200}
}
if(-not $running){throw "Preview did not start on port $Port. Check that the port is available."}
Start-Process $previewUrl
