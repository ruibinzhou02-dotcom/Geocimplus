$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
if (!(Get-Command cargo -ErrorAction SilentlyContinue)) {throw 'EXE BLOCKED: Rust/Cargo MSVC toolchain is missing. https://v2.tauri.app/start/prerequisites/'}
if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {throw 'pnpm must be on PATH.'}
$pythonExe=Join-Path $PSScriptRoot 'geocim-dev\Scripts\python.exe'
& pnpm run build
if ($LASTEXITCODE -ne 0) {throw 'Frontend build failed.'}
& $pythonExe -m PyInstaller --version
if ($LASTEXITCODE -ne 0) {throw 'Install PyInstaller in geocim-dev before packaging the backend.'}
& $pythonExe -m PyInstaller --noconfirm --onefile --name geocim-backend --distpath src-tauri/bin --workpath reports/pyinstaller-work --specpath reports --collect-submodules uvicorn --collect-submodules fastapi backend/server.py
if ($LASTEXITCODE -ne 0) {throw 'Backend packaging failed.'}
& pnpm tauri build
if ($LASTEXITCODE -ne 0) {throw 'Tauri build failed. Check MSVC, WebView2 and build output.'}
Write-Host 'Build output: src-tauri/target/release/bundle/nsis. Run and verify locally before distributing.'
