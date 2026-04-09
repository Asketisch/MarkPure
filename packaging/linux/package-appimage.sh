#!/bin/bash
set -e

# MarkPure Linux AppImage Packaging Script

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="$PROJECT_DIR/target/release"
SOURCE_BIN="$BUILD_DIR/markpure"
APPIMAGE_NAME="MarkPure-${VERSION:-0.1.0}-Linux.AppImage"
OUTPUT_DIR="$PROJECT_DIR/release"

echo "[INFO] Packaging MarkPure for Linux (AppImage)..."

if [ ! -f "$SOURCE_BIN" ]; then
    echo "[ERROR] Binary not found: $SOURCE_BIN"
    echo "[ERROR] Please build with: cargo build --release"
    exit 1
fi

# Create AppDir
APP_DIR="$PROJECT_DIR/tmp_appdir"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/usr/bin"
mkdir -p "$APP_DIR/usr/share/applications"
mkdir -p "$APP_DIR/usr/share/icons/hicolor/512x512/apps"

# Copy binary
cp "$SOURCE_BIN" "$APP_DIR/usr/bin/markpure"
chmod +x "$APP_DIR/usr/bin/markpure"

# Copy desktop file
cp "$PROJECT_DIR/packaging/linux/markme.desktop" "$APP_DIR/usr/share/applications/markpure.desktop"

# Copy icon if exists
if [ -f "$PROJECT_DIR/assets/icons/icon.png" ]; then
    cp "$PROJECT_DIR/assets/icons/icon.png" "$APP_DIR/usr/share/icons/hicolor/512x512/apps/markpure.png"
fi

# Create AppRun
cat > "$APP_DIR/AppRun" << 'EOF'
#!/bin/bash
export PATH="$APPDIR/usr/bin:$PATH"
export LD_LIBRARY_PATH="$APPDIR/usr/lib:$LD_LIBRARY_PATH"
exec "$APPDIR/usr/bin/markpure" "$@"
EOF
chmod +x "$APP_DIR/AppRun"

# Check for appimagetool
if ! command -v appimagetool &>/dev/null; then
    echo "[INFO] Installing appimagetool..."
    wget -q "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage" -O /tmp/appimagetool
    chmod +x /tmp/appimagetool
    APPIMAGETOOL=/tmp/appimagetool
else
    APPIMAGETOOL=appimagetool
fi

# Build AppImage
mkdir -p "$OUTPUT_DIR"
cd "$APP_DIR"
$APPIMAGETOOL "$APP_DIR" "$OUTPUT_DIR/$APPIMAGE_NAME"

# Cleanup
rm -rf "$APP_DIR"

echo "[INFO] Created: $OUTPUT_DIR/$APPIMAGE_NAME"
