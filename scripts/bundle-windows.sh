#!/bin/bash
set -e

# MarkPure Windows App Bundle Script
# Usage:
#   ./bundle-windows.sh          - build and package .exe

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="MarkPure"
BUNDLE_DIR="$PROJECT_DIR/target/${APP_NAME}-windows"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# ---- Step 1: Build release ----
log_info "Running release build..."
"$PROJECT_DIR/build.sh" release

# ---- Step 2: Create Windows bundle structure ----
log_info "Creating Windows bundle..."
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

# ---- Step 3: Copy binary ----
cp "$PROJECT_DIR/target/release/markpure.exe" "$BUNDLE_DIR/" 2>/dev/null || \
cp "$PROJECT_DIR/target/release/markpure" "$BUNDLE_DIR/markpure.exe"

# ---- Step 4: Generate .ico file from PNG ----
ICO_DIR="$BUNDLE_DIR/icons"
mkdir -p "$ICO_DIR"

# Check if to-ico is available, otherwise use python or fallback
if command -v to-ico &>/dev/null; then
    to-ico "$PROJECT_DIR/icons/256x256.png" -o "$BUNDLE_DIR/${APP_NAME}.ico"
elif command -v python3 &>/dev/null; then
    # Use Python with Pillow to generate ICO
    python3 << 'PYEOF'
import struct
import zlib
from pathlib import Path

def create_ico(png_path, ico_path):
    """Create ICO file from 256x256 PNG using Pillow if available."""
    try:
        from PIL import Image
        img = Image.open(png_path).convert('RGBA')
        img.save(ico_path, format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
        print(f"Created {ico_path}")
    except ImportError:
        print("Pillow not installed, skipping ICO generation")
        return False
    return True

png_path = Path("/Users/demon/Code/mark-web/icons/256x256.png")
ico_path = Path("/Users/demon/Code/mark-web/target/markpure-windows/markpure.ico")
create_ico(png_path, ico_path)
PYEOF
else
    log_warn "No ICO generation tool available. Install to-ico: cargo install to-ico"
    log_warn "Or install Python Pillow: pip3 install pillow"
fi

# ---- Step 5: Copy icons directory ----
cp -r "$PROJECT_DIR/icons" "$BUNDLE_DIR/"

# ---- Step 6: Create simple launcher script for Windows ----
cat > "$BUNDLE_DIR/${APP_NAME}.bat" << 'EOF'
@echo off
start "" "%~dp0markpure.exe"
EOF

# ---- Done ----
echo ""
log_info "Windows bundle created: $BUNDLE_DIR"
