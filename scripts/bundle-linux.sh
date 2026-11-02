#!/bin/bash
set -e

# MarkPure Linux Bundle Script
# Usage:
#   ./bundle-linux.sh                       - build and package portable dir
#   SKIP_BUILD=1 ./bundle-linux.sh          - skip the build step (bundle a prebuilt binary)
#   TARGET_DIR=target/release ./bundle-linux.sh SKIP_BUILD=1
#                                           - bundle a binary from a specific cargo target dir
#
# 产物是 target/MarkPure-linux/ 目录（markpure + 图标 + desktop 文件 + 说明），
# 由发布流程 tar.gz 后附到 GitHub Release。本脚本只做拷贝与组织，
# 平台无关，可在任意 unix 上演练。
#
# 运行时依赖系统 webkit2gtk-4.1（README.txt 里有各发行版安装命令）。

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="MarkPure"
BUNDLE_DIR="$PROJECT_DIR/target/${APP_NAME}-linux"
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
log_info "Creating Linux bundle..."
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

# ---- Step 3: Copy binary ----
cp "$PROJECT_DIR/$TARGET_DIR/markpure" "$BUNDLE_DIR/markpure"

# ---- Step 4: Copy icons（窗口图标运行时从 exe 同目录的 icons/ 加载）----
if [ -d "$PROJECT_DIR/resources/icons" ]; then
    mkdir -p "$BUNDLE_DIR/icons"
    cp "$PROJECT_DIR/resources/icons/256x256.png" "$BUNDLE_DIR/icons/"
    log_info "Icon copied."
else
    log_warn "Icons directory not found."
fi

# ---- Step 5: Desktop entry（手动安装到 ~/.local/share/applications 用）----
if [ -f "$PROJECT_DIR/distribution/linux/markpure.desktop" ]; then
    cp "$PROJECT_DIR/distribution/linux/markpure.desktop" "$BUNDLE_DIR/"
    log_info "Desktop entry copied."
else
    log_warn "markpure.desktop not found."
fi

# ---- Step 6: README ----
cat > "$BUNDLE_DIR/README.txt" << 'EOF'
MarkPure - A WYSIWYG Markdown editor

使用方法
--------
  chmod +x markpure
  ./markpure

系统依赖
--------
本应用通过系统 WebView（webkit2gtk 4.1）渲染界面，各主流发行版
安装方式：

  Debian / Ubuntu 22.04+：
    sudo apt install libwebkit2gtk-4.1-0
  Fedora 36+：
    sudo dnf install webkit2gtk4.1
  Arch：
    sudo pacman -S webkit2gtk-4.1

（仅构建源码时才需要对应的 -dev / -devel 包；运行只需上面的运行库。）

可选：加入应用菜单
------------------
  mkdir -p ~/.local/{share/applications,share/icons/hicolor/256x256/apps,bin}
  cp markpure ~/.local/bin/
  cp icons/256x256.png ~/.local/share/icons/hicolor/256x256/apps/markpure.png
  # 编辑 markpure.desktop，把 Exec 和 Icon 改为绝对路径：
  #   Exec=/home/你的用户名/.local/bin/markpure
  #   Icon=/home/你的用户名/.local/share/icons/hicolor/256x256/apps/markpure.png
  cp markpure.desktop ~/.local/share/applications/

PDF 导出
--------
PDF 导出使用系统字体：需要 DejaVu 或 Liberation（拉丁），
中文需要文泉驿或 Noto Sans CJK（缺失时 PDF 中文为空白，不报错）。
主流桌面发行版默认已具备。
EOF

# ---- Done ----
echo ""
log_info "Linux bundle created: $BUNDLE_DIR"
log_info "Tarball it for distribution, e.g.: tar -czf MarkPure-linux-x64.tar.gz -C target MarkPure-linux"
