#!/bin/bash
set -e

# MarkPure macOS Packaging Script
# Creates .app bundle and .dmg installer

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="$PROJECT_DIR/target/release"
SOURCE_BIN="$BUILD_DIR/markpure"
SOURCE_ICNS="$PROJECT_DIR/assets/icons/icon.icns"
INFO_PLIST="$PROJECT_DIR/packaging/macos/Info.plist"
VERSION="${VERSION:-0.1.0}"

APP_NAME="MarkPure.app"
DMG_NAME="MarkPure-${VERSION}-macOS.dmg"
TMP_DIR="$PROJECT_DIR/tmp_package"
APP_DIR="$TMP_DIR/$APP_NAME"

echo "[INFO] Packaging MarkPure for macOS..."

# Clean up
rm -rf "$TMP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# Copy binary
cp "$SOURCE_BIN" "$APP_DIR/Contents/MacOS/$APP_NAME"
chmod +x "$APP_DIR/Contents/MacOS/$APP_NAME"

# Copy Info.plist
cp "$INFO_PLIST" "$APP_DIR/Contents/Info.plist"

# Copy icon if exists
if [ -f "$SOURCE_ICNS" ]; then
    cp "$SOURCE_ICNS" "$APP_DIR/Contents/Resources/$APP_NAME.icns"
fi

# Create DMG
hdiutil create -volname "$APP_NAME" -srcfolder "$TMP_DIR" -ov -format UDZO -imagekey zlib-level=9 -fs HFS+ "$PROJECT_DIR/release/$DMG_NAME"

# Cleanup
rm -rf "$TMP_DIR"

echo "[INFO] Created: $PROJECT_DIR/release/$DMG_NAME"
