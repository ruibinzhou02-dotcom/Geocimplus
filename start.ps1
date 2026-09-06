$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$pythonExe=Join-Path $projectRoot 'geocim-dev\Scripts\python.exe'
if (!(Test-Path -LiteralPath $pythonExe)) {throw 'Missing geocim-dev. See README.md setup instructions.'}
try {
    $health=Invoke-RestMethod 'http://127.0.0.1:8765/api/health' -TimeoutSec 2
    if ($health.application -eq 'geocim-local') {Write-Host 'GeoCIM already running: http://127.0.0.1:8765/';exit 0}
    throw 'Port 8765 is occupied by another application.'
} catch {if ($_.Exception.Message -like '*occupied*') {throw}}
$reportPath=Join-Path $projectRoot 'reports'
New-Item -ItemType Directory -Path $reportPath -Force | Out-Null
$serverScript=Join-Path $projectRoot 'backend\server.py'
$arguments=@(('"'+$serverScript+'"'),'--project',('"'+$projectRoot+'"'),'--port','8765')
$process=Start-Process -FilePath $pythonExe -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $reportPath 'server.stdout.log') -RedirectStandardError (Join-Path $reportPath 'server.stderr.log') -PassThru
$process.Id | Set-Content (Join-Path $reportPath 'server.pid')
for ($attempt=0;$attempt -lt 30;$attempt++) {
    Start-Sleep -Milliseconds 300
    if ($process.HasExited) {throw 'GeoCIM failed to start. See reports/server.stderr.log.'}
    try {$health=Invoke-RestMethod 'http://127.0.0.1:8765/api/health' -TimeoutSec 1;if($health.application -eq 'geocim-local'){Write-Host 'GeoCIM ready: http://127.0.0.1:8765/';exit 0}}catch{}
}
throw 'Startup timed out. See reports/server.stderr.log.'
