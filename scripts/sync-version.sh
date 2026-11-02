#!/bin/bash
set -euo pipefail

# MarkPure 版本同步工具（本地发布准备用）
#
# 版本号在三处硬编码，本脚本一次性同步：
#   1. backend/apps/desktop/Cargo.toml        —— 权威来源（CARGO_PKG_VERSION 由此而来）
#   2. frontend/src/features/settings/AboutSection.svelte —— 「关于」页展示
#   3. distribution/macos/Info.plist          —— .app 的 CFBundleVersion（仅 macOS 有 PlistBuddy）
#
# 发布流程：改版本 → 提交 → 打 vX.Y.Z tag → push，CI 校验 tag 与
# Cargo.toml 一致后自动构建四平台产物。不在 CI 里改版本的原因：
# 改动 Cargo.toml 会使已提交的 Cargo.lock 过期，--locked 构建直接失败。
#
# 用法：
#   ./sync-version.sh 0.2.0    # 同步到指定版本（不带 v 前缀）
#   ./sync-version.sh          # dry-run：只打印三处当前值

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

CARGO_TOML="$PROJECT_DIR/backend/apps/desktop/Cargo.toml"
ABOUT_SVELTE="$PROJECT_DIR/frontend/src/features/settings/AboutSection.svelte"
INFO_PLIST="$PROJECT_DIR/distribution/macos/Info.plist"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

current_version() {
    # Cargo.toml 是权威来源
    sed -n 's/^version = "\(.*\)"/\1/p' "$CARGO_TOML" | head -n1
}

if [ $# -eq 0 ]; then
    echo "当前版本（backend/apps/desktop/Cargo.toml）：$(current_version)"
    echo "AboutSection.svelte：$(grep -o '<p class="version">v[^<]*</p>' "$ABOUT_SVELTE" | sed 's/.*>v\([0-9.]*\)<.*/\1/')"
    if command -v /usr/libexec/PlistBuddy &>/dev/null; then
        echo "Info.plist：$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST" 2>/dev/null || echo '未知')"
    fi
    echo ""
    echo "用法：$0 <版本号>   （例如 $0 0.2.0，不带 v 前缀）"
    exit 0
fi

NEW_VERSION="$1"
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    log_error "版本号格式应为 X.Y.Z（如 0.2.0），收到：$NEW_VERSION"
    exit 1
fi

# 1. Cargo.toml（只匹配行首的 package version，不碰依赖的版本号）
perl -pi -e 's/^version = "[^"]*"/version = "'"$NEW_VERSION"'"/' "$CARGO_TOML"
log_info "Cargo.toml -> $NEW_VERSION"

# 2. AboutSection.svelte
perl -pi -e 's/<p class="version">v[^<]*<\/p>/<p class="version">v'"$NEW_VERSION"'<\/p>/' "$ABOUT_SVELTE"
log_info "AboutSection.svelte -> v$NEW_VERSION"

# 3. Info.plist（PlistBuddy 仅 macOS 自带；在别的平台跳过并提示）
if [ -f "$INFO_PLIST" ]; then
    if command -v /usr/libexec/PlistBuddy &>/dev/null; then
        /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $NEW_VERSION" \
                                -c "Set :CFBundleShortVersionString $NEW_VERSION" "$INFO_PLIST"
        log_info "Info.plist -> $NEW_VERSION"
    else
        log_error "非 macOS 环境没有 PlistBuddy，请手动把 $INFO_PLIST 的 CFBundleVersion / CFBundleShortVersionString 改为 $NEW_VERSION"
        exit 1
    fi
fi

# 4. 同步 Cargo.lock 里 markpure 成员的版本。不用 cargo metadata：
# 它会预下载 lock 里所有平台的依赖（macOS 上也要拉 webview2-com-sys），
# 离线必失败。workspace 成员在 lock 中没有校验和，精确改写
# 「name = "markpure"」紧跟的 version 行与 cargo 自行写入的效果一致。
LOCK="$PROJECT_DIR/Cargo.lock"
if [ -f "$LOCK" ]; then
    if ! grep -q '^name = "markpure"$' "$LOCK"; then
        log_error "Cargo.lock 里找不到 markpure 成员条目，请手动跑一次 cargo check"
        exit 1
    fi
    perl -0pi -e 's/(name = "markpure"\nversion = ")[^"]*(")/${1}'"$NEW_VERSION"'${2}/' "$LOCK"
    log_info "Cargo.lock 已刷新"
else
    log_error "未找到 Cargo.lock（应在版本库中）——请先 git pull 或手动跑一次 cargo check"
    exit 1
fi

echo ""
log_info "全部同步到 ${NEW_VERSION}。接下来：git commit 后打 v${NEW_VERSION} tag 并 push。"
