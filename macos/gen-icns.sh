#!/bin/bash
set -e

# Generate AppIcon.icns from public/favicon.svg
# Usage: ./macos/gen-icns.sh
# Output: macos/AppIcon.icns

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SVG="$PROJECT_DIR/public/favicon.svg"
ICONSET="$PROJECT_DIR/macos/AppIcon.iconset"
ICNS="$PROJECT_DIR/macos/AppIcon.icns"

if [ ! -f "$SVG" ]; then
    echo "Error: $SVG not found"
    exit 1
fi

rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# Render SVG to 1024x1024 PNG
MASTER="$ICONSET/icon_512x512@2x.png"

if command -v rsvg-convert &>/dev/null; then
    rsvg-convert -w 1024 -h 1024 "$SVG" -o "$MASTER"
else
    # Fallback: use sips to convert SVG (macOS built-in)
    TMP_PNG="$(mktemp /tmp/markpure_icon_XXXXXX.png)"
    # qlmanage renders SVG thumbnails
    qlmanage -t -s 1024 -o /tmp "$SVG" &>/dev/null
    QLOUT="${SVG}.png"
    if [ -f "$QLOUT" ]; then
        mv "$QLOUT" "$TMP_PNG"
    else
        # Try the basename version
        QLOUT="/tmp/$(basename "$SVG").png"
        if [ -f "$QLOUT" ]; then
            mv "$QLOUT" "$TMP_PNG"
        else
            echo "Error: Failed to render SVG. Install rsvg-convert: brew install librsvg"
            rm -rf "$ICONSET"
            exit 1
        fi
    fi
    cp "$TMP_PNG" "$MASTER"
    rm -f "$TMP_PNG"
fi

# Generate all required sizes
declare -a SIZES=(16 32 64 128 256 512)

for size in "${SIZES[@]}"; do
    sips -z "$size" "$size" "$MASTER" --out "$ICONSET/icon_${size}x${size}.png" &>/dev/null
done

# Create @2x variants (each @2x is the same pixels as the next size up)
sips -z 32 32 "$MASTER" --out "$ICONSET/icon_16x16@2x.png" &>/dev/null
sips -z 64 64 "$MASTER" --out "$ICONSET/icon_32x32@2x.png" &>/dev/null
sips -z 256 256 "$MASTER" --out "$ICONSET/icon_128x128@2x.png" &>/dev/null
sips -z 512 512 "$MASTER" --out "$ICONSET/icon_256x256@2x.png" &>/dev/null
# icon_512x512@2x.png is already the 1024px master

# Remove intermediate sizes not needed in the iconset
rm -f "$ICONSET/icon_64x64.png"

# Build .icns
iconutil -c icns "$ICONSET" -o "$ICNS"
rm -rf "$ICONSET"

echo "Generated: $ICNS"
