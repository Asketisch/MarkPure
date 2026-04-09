#!/bin/bash
set -e

# MarkPure Linux .deb Packaging Script

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="$PROJECT_DIR/target/release"
SOURCE_BIN="$BUILD_DIR/markpure"
VERSION="${VERSION:-0.1.0}"
DEB_NAME="markpure_${VERSION}_amd64.deb"
OUTPUT_DIR="$PROJECT_DIR/release"

echo "[INFO] Packaging MarkPure for Linux (.deb)..."

if [ ! -f "$SOURCE_BIN" ]; then
    echo "[ERROR] Binary not found: $SOURCE_BIN"
    echo "[ERROR] Please build with: cargo build --release"
    exit 1
fi

# Create package directory structure
PKG_DIR="$PROJECT_DIR/tmp_deb"
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR/usr/bin"
mkdir -p "$PKG_DIR/usr/share/applications"
mkdir -p "$PKG_DIR/usr/share/icons/hicolor/512x512/apps"
mkdir -p "$PKG_DIR/usr/share/doc/markpure"

# Copy binary
cp "$SOURCE_BIN" "$PKG_DIR/usr/bin/markpure"
chmod 755 "$PKG_DIR/usr/bin/markpure"

# Copy desktop file
cp "$PROJECT_DIR/packaging/linux/markme.desktop" "$PKG_DIR/usr/share/applications/markpure.desktop"

# Copy icon if exists
if [ -f "$PROJECT_DIR/assets/icons/icon.png" ]; then
    cp "$PROJECT_DIR/assets/icons/icon.png" "$PKG_DIR/usr/share/icons/hicolor/512x512/apps/markpure.png"
fi

# Create control file
cat > "$PKG_DIR/DEBIAN/control" << EOF
Package: markpure
Version: $VERSION
Section: editors
Priority: optional
Architecture: amd64
Depends: libwebkit2gtk-4.1-0, libgtk-3-0, libayatana-appindicator3-1, libssl3, libcairo2-0, libpango-1.0-0, librsvg2-0, libstdc++6
Maintainer: MarkPure <support@markpure.app>
Description: A WYSIWYG Markdown editor
 MarkPure is a powerful, feature-rich Markdown editor with live preview,
 syntax highlighting, and export capabilities.
EOF

# Create postinst script
cat > "$PKG_DIR/DEBIAN/postinst" << 'EOF'
#!/bin/bash
update-desktop-database usr/share/applications
if [ -x /usr/bin/update-icon-caches ]; then
    update-icon-caches usr/share/icons/hicolor
fi
exit 0
EOF
chmod 755 "$PKG_DIR/DEBIAN/postinst"

# Create prerm script
cat > "$PKG_DIR/DEBIAN/prerm" << 'EOF'
#!/bin/bash
exit 0
EOF
chmod 755 "$PKG_DIR/DEBIAN/prerm"

# Copy copyright
cat > "$PKG_DIR/usr/share/doc/markpure/copyright" << 'EOF'
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
License: MIT
EOF

# Build .deb
mkdir -p "$OUTPUT_DIR"
dpkg-deb --build "$PKG_DIR" "$OUTPUT_DIR/$DEB_NAME"

# Cleanup
rm -rf "$PKG_DIR"

echo "[INFO] Created: $OUTPUT_DIR/$DEB_NAME"
