$ErrorActionPreference='Stop'
$pidFile=Join-Path $PSScriptRoot 'reports\server.pid'
if (!(Test-Path -LiteralPath $pidFile)) {Write-Host 'No saved GeoCIM process.';exit 0}
$serverPid=[int](Get-Content -LiteralPath $pidFile)
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid" -ErrorAction SilentlyContinue
if (!$process) {Write-Host 'GeoCIM is already stopped.';exit 0}
$expected=(Join-Path $PSScriptRoot 'backend\server.py')
if (!$process.CommandLine.Contains($expected)) {throw 'Saved PID belongs to a different process; refused to stop it.'}
Stop-Process -Id $serverPid
Write-Host 'GeoCIM stopped. Data and reports remain on disk.'
