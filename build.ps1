# MarkPure Build Script for Windows
# Usage:
#   .\build.ps1          - debug build
#   .\build.ps1 release  - release (optimized) build
#   .\build.ps1 clean    - clean build artifacts
#   .\build.ps1 run      - build and run

param(
    [ValidateSet("debug", "release", "clean", "run")]
    [string]$Mode = "debug"
)

$ProjectDir = $PSScriptRoot
$ErrorActionPreference = "Stop"

function Write-Info($message) {
    Write-Host "[INFO] $message" -ForegroundColor Green
}

function Write-Error($message) {
    Write-Host "[ERROR] $message" -ForegroundColor Red
}

# ---- Clean ----
if ($Mode -eq "clean") {
    Write-Info "Cleaning build artifacts..."
    if (Test-Path "$ProjectDir\dist") {
        Remove-Item -Recurse -Force "$ProjectDir\dist"
    }
    cargo clean --manifest-path "$ProjectDir\Cargo.toml"
    Write-Info "Clean done."
    exit 0
}

# ---- Check dependencies ----
function Test-Command($cmd) {
    try {
        Get-Command $cmd -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

if (-not (Test-Command node)) {
    Write-Error "node is not installed. Please install Node.js first."
    exit 1
}

if (-not (Test-Command cargo)) {
    Write-Error "cargo is not installed. Please install Rust first."
    exit 1
}

# ---- Step 1: Install npm dependencies ----
Write-Info "Installing npm dependencies..."
Set-Location $ProjectDir
npm install --silent 2>$null

# ---- Step 2: Build frontend (Vite) ----
Write-Info "Building frontend (Vite)..."
npx vite build

# ---- Step 3: Build Rust backend ----
# Force recompile so rust-embed picks up fresh dist/ assets
$mainRs = "$ProjectDir\src-rust\src\main.rs"
if (Test-Path $mainRs) {
    (Get-Item $mainRs).LastWriteTime = Get-Date
}

$CARGO_FLAG = ""
if ($Mode -eq "release") {
    $CARGO_FLAG = "--release"
    Write-Info "Building Rust backend (release)..."
} else {
    Write-Info "Building Rust backend (debug)..."
}

cargo build $CARGO_FLAG

# ---- Done ----
$BINARY = if ($Mode -eq "release") {
    "$ProjectDir\target\release\markpure.exe"
} else {
    "$ProjectDir\target\debug\markpure.exe"
}

Write-Host ""
Write-Info "Build complete!"
Write-Info "Binary: $BINARY"

# ---- Run ----
if ($Mode -eq "run") {
    Write-Info "Launching..."
    & $BINARY
}
