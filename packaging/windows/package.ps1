# MarkPure Windows Packaging Script
# Creates NSIS installer

param(
    [string]$Version = "0.1.0",
    [string]$OutputDir = "release"
)

$ProjectDir = $PSScriptRoot | Split-Path -Parent -Parent
$BuildDir = "$ProjectDir\target\release"
$Binary = "$BuildDir\markpure.exe"
$InstallerScript = "$ProjectDir\packaging\windows\installer.nsi"
$OutputPath = "$ProjectDir\$OutputDir"

Write-Host "[INFO] Packaging MarkPure for Windows..."

if (-not (Test-Path $Binary)) {
    Write-Error "Binary not found: $Binary"
    Write-Error "Please build with: cargo build --release"
    exit 1
}

if (-not (Test-Path $InstallerScript)) {
    Write-Error "Installer script not found: $InstallerScript"
    exit 1
}

# Check for NSIS
$nsis = Get-Command makensis -ErrorAction SilentlyContinue
if (-not $nsis) {
    Write-Host "[INFO] NSIS not found, installing via chocolatey..."
    choco install nsis -y
}

# Create output directory
if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath | Out-Null
}

# Build installer
Write-Host "[INFO] Building installer..."
& makensis -VERSION1 "$Version" "-DVERSION=$Version" "-DOUTFILE=$OutputPath\MarkPure-${Version}-Windows-setup.exe" "$InstallerScript"

if ($LASTEXITCODE -eq 0) {
    Write-Host "[INFO] Created: $OutputPath\MarkPure-${Version}-Windows-setup.exe"
} else {
    Write-Error "NSIS build failed"
    exit 1
}
