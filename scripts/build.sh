#!/bin/bash
set -e

# MarkPure Build Script
# Usage:
#   ./build.sh          - debug build
#   ./build.sh release   - release (optimized) build
#   ./build.sh clean     - clean build artifacts
#   ./build.sh run       - build and run

MODE="${1:-debug}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ---- Clean ----
if [ "$MODE" = "clean" ]; then
    log_info "Cleaning build artifacts..."
    rm -rf "$PROJECT_DIR/dist"
    cd "$PROJECT_DIR" && cargo clean
    log_info "Clean done."
    exit 0
fi

# ---- Check dependencies ----
check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        log_error "$1 is not installed. Please install it first."
        exit 1
    fi
}

check_cmd node
check_cmd cargo

# ---- Step 1: Install npm dependencies ----
log_info "Installing npm dependencies..."
cd "$PROJECT_DIR"
npm install --silent 2>/dev/null

# ---- Step 2: Generate app icons (PNG + macOS icns) ----
log_info "Generating app icons..."
if [ -f "$PROJECT_DIR/scripts/gen-icns.sh" ]; then
    bash "$PROJECT_DIR/scripts/gen-icns.sh" || log_warn "Icon generation failed, continuing without icons"
fi

# ---- Step 3: Build frontend (Vite) ----
log_info "Building frontend (Vite)..."
cd "$PROJECT_DIR"
npx vite build .

# ---- Step 4: Build Rust backend ----
# Force recompile so rust-embed picks up fresh dist/ assets
touch "$PROJECT_DIR/backend/apps/desktop/src/main.rs"

CARGO_FLAG=""
if [ "$MODE" = "release" ]; then
    CARGO_FLAG="--release"
    log_info "Building Rust backend (release)..."
else
    log_info "Building Rust backend (debug)..."
fi

cd "$PROJECT_DIR"
cargo build $CARGO_FLAG

# ---- Done ----
if [ "$MODE" = "release" ]; then
    BINARY="$PROJECT_DIR/target/release/markpure"
else
    BINARY="$PROJECT_DIR/target/debug/markpure"
fi

echo ""
log_info "Build complete!"
log_info "Binary: $BINARY"

# ---- Run ----
if [ "$MODE" = "run" ]; then
    log_info "Launching..."
    exec "$BINARY"
fi
