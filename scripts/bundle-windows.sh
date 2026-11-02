#!/bin/bash
set -e

# MarkPure Windows Bundle Script
# Usage:
#   ./bundle-windows.sh                        - build and package portable dir
#   SKIP_BUILD=1 ./bundle-windows.sh           - skip the build step (bundle a prebuilt binary)
#   TARGET_DIR=target/release ./bundle-windows.sh SKIP_BUILD=1
#                                              - bundle a binary from a specific cargo target dir
#
# 产物是 target/MarkPure-windows/ 目录（markpure.exe + 图标 + 说明），
# 压缩成 zip 交给发布流程（CI 里用 PowerShell Compress-Archive）。
#
# exe 自身的图标与版本信息由 backend/apps/desktop/build.rs 在
# Windows 构建时经 winresource 嵌入，这里只需打包运行时文件。

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="MarkPure"
BUNDLE_DIR="$PROJECT_DIR/target/${APP_NAME}-windows"
TARGET_DIR="${TARGET_DIR:-target/release}"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# ---- Step 1: Build ----
if [ "${SKIP_BUILD:-0}" = "1" ]; then
    log_info "Skipping build (SKIP_BUILD=1), using binary in $TARGET_DIR"
else
    log_info "Running release build..."
    "$PROJECT_DIR/scripts/build.sh" release
fi

# ---- Step 2: Create bundle structure ----
log_info "Creating Windows bundle..."
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

# ---- Step 3: Copy binary ----
cp "$PROJECT_DIR/$TARGET_DIR/markpure.exe" "$BUNDLE_DIR/markpure.exe"

# ---- Step 4: Copy icons（窗口图标运行时从 exe 同目录的 icons/ 加载）----
if [ -d "$PROJECT_DIR/resources/icons" ]; then
    mkdir -p "$BUNDLE_DIR/icons"
    cp "$PROJECT_DIR/resources/icons/256x256.png" "$BUNDLE_DIR/icons/"
    cp "$PROJECT_DIR/resources/icons/markpure.ico" "$BUNDLE_DIR/markpure.ico"
    log_info "Icons copied."
else
    log_warn "Icons directory not found, bundle will use the exe-embedded icon only."
fi

# ---- Step 5: README ----
cat > "$BUNDLE_DIR/README.txt" << 'EOF'
MarkPure - A WYSIWYG Markdown editor

使用方法
--------
直接双击 markpure.exe 运行，无需安装。

说明
----
- 系统需已启用 WebView2 运行时（Windows 10/11 默认自带；
  若缺失，系统会自动提示安装）。
- markpure.ico 供手动创建快捷方式时使用，
  exe 本身已内嵌图标。
EOF

# ---- Done ----
echo ""
log_info "Windows bundle created: $BUNDLE_DIR"
log_info "Zip it for distribution, e.g.: powershell Compress-Archive ... or: zip -r MarkPure-windows.zip MarkPure-windows"
