#!/bin/bash
set -e

# Generate AppIcon.icns from icons/markpure_icon.png
# Usage: ./macos/gen-icns.sh
# Output: macos/AppIcon.icns

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ICON_PNG="$PROJECT_DIR/icons/markpure_icon.png"
ICONSET="$PROJECT_DIR/macos/AppIcon.iconset"
ICNS="$PROJECT_DIR/macos/AppIcon.icns"

if [ ! -f "$ICON_PNG" ]; then
    echo "Error: $ICON_PNG not found"
    exit 1
fi

rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# Use the 1024x1024 PNG as master source
MASTER="$ICONSET/icon_512x512@2x.png"
sips -z 1024 1024 "$ICON_PNG" --out "$MASTER" &>/dev/null

# Generate all required sizes for icns
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
