# Builds the native Store agent (agent/, C++17, CMake) exactly like the
# Electron repo's electron/scripts/build-agent.js, then stages the binary
# where the Tauri bundler expects it (src-tauri/resources/agent/).
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/build-agent.ps1 [-Version 3.0.0]
# Requirements: Windows, CMake, Visual Studio C++ Build Tools (x64).
param(
    [string]$Version = "3.0.0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($Version)) {
    throw "Agent version is required: -Version <major.minor.patch> (read from package.json by CI)."
}
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$') {
    throw "Invalid agent version: '$Version'"
}

if (-not $env:OS -or $env:OS -notlike "*Windows*") {
    throw "Native agent release builds require Windows, CMake and Visual Studio C++ Build Tools."
}

$build = Join-Path $root "agent/build/cmake"
Write-Host "Configuring agent build at $build"
& cmake -S (Join-Path $root "agent") -B $build -A x64 "-DAGENT_VERSION=$Version"
if ($LASTEXITCODE -ne 0) { throw "cmake configure failed with exit code $LASTEXITCODE" }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& cmake --build $build --config Release --parallel 2
if ($LASTEXITCODE -ne 0) { throw "cmake build failed with exit code $LASTEXITCODE" }
& ctest --test-dir $build -C Release --output-on-failure
if ($LASTEXITCODE -ne 0) { throw "agent tests failed with exit code $LASTEXITCODE" }

$exe = Join-Path $root "agent/build/HyperFamilyStoreAgent.exe"
if (-not (Test-Path $exe)) { throw "Agent binary was not produced: $exe" }

# Stage for the Tauri bundle (tauri.conf.json -> bundle.resources).
$stage = Join-Path $root "src-tauri/resources/agent"
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item $exe (Join-Path $stage "HyperFamilyStoreAgent.exe") -Force

$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
Set-Content -Path "$exe.sha256" -Value "$hash  HyperFamilyStoreAgent.exe"
Write-Host "Native agent $Version staged: $((Get-Item $exe).Length) bytes; SHA-256 $hash"
