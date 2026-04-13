#!/bin/bash
set -e

# MarkPure macOS App Bundle Script
# Usage:
#   ./bundle-macos.sh          - build and package .app
#   SIGN=0 ./bundle-macos.sh   - skip ad-hoc codesigning

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="MarkPure"
BUNDLE_DIR="$PROJECT_DIR/target/${APP_NAME}.app"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# ---- Step 1: Build ----
log_info "Running release build..."
"$PROJECT_DIR/build.sh" release

# ---- Step 2: Create .app bundle structure ----
log_info "Creating app bundle..."
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/Contents/MacOS"
mkdir -p "$BUNDLE_DIR/Contents/Resources"

# ---- Step 3: Copy binary ----
cp "$PROJECT_DIR/target/release/markpure" "$BUNDLE_DIR/Contents/MacOS/markpure"

# ---- Step 4: Copy Info.plist ----
cp "$PROJECT_DIR/macos/Info.plist" "$BUNDLE_DIR/Contents/"

# ---- Step 5: Copy icon ----
ICNS="$PROJECT_DIR/macos/AppIcon.icns"
if [ ! -f "$ICNS" ]; then
    log_warn "AppIcon.icns not found, generating from favicon.svg..."
    bash "$PROJECT_DIR/macos/gen-icns.sh"
fi

if [ -f "$ICNS" ]; then
    cp "$ICNS" "$BUNDLE_DIR/Contents/Resources/"
    log_info "App icon copied."
else
    log_warn "No icon available. App will use default macOS icon."
fi

# ---- Step 5b: Copy icons directory for window icon ----
if [ -d "$PROJECT_DIR/icons" ]; then
    cp -r "$PROJECT_DIR/icons" "$BUNDLE_DIR/Contents/Resources/"
    log_info "Icons directory copied."
else
    log_warn "Icons directory not found."
fi

# ---- Step 6: Ad-hoc codesign ----
if [ "${SIGN:-1}" != "0" ]; then
    log_info "Signing app bundle (ad-hoc)..."
    codesign --force --deep --sign - "$BUNDLE_DIR"
else
    log_info "Skipping code signing (SIGN=0)."
fi

# ---- Done ----
echo ""
log_info "App bundle created: $BUNDLE_DIR"
log_info "Run:  open \"$BUNDLE_DIR\""
