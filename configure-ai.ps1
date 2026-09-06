$ErrorActionPreference='Stop'
$configPath=Join-Path $PSScriptRoot 'config\local_ai.json'
$modelName=Read-Host 'OpenAI model [gpt-4.1-mini]'
if ([string]::IsNullOrWhiteSpace($modelName)) {$modelName='gpt-4.1-mini'}
$secureKey=Read-Host 'OpenAI API Key (hidden; saved only in local server config)' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
 $plainKey=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()
 if ([string]::IsNullOrWhiteSpace($plainKey)) {throw 'No key entered. Configuration was not changed.'}
 $payload=@{api_key=$plainKey;model=$modelName.Trim()} | ConvertTo-Json
 [IO.File]::WriteAllText($configPath,$payload,[Text.UTF8Encoding]::new($false))
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
 & icacls.exe $configPath /inheritance:r /grant:r "${identity}:(F)" | Out-Null
 if ($LASTEXITCODE -ne 0) {throw 'Could not restrict file permissions. Check config/local_ai.json permissions before using it.'}
 Write-Host 'Saved. In GeoCIM, open AI settings and refresh configuration. Do not share or publish config/local_ai.json.'
} finally {
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
 $plainKey=$null;$payload=$null;$secureKey.Dispose()
}
