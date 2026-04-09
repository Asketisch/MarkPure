#!/bin/bash
set -e

# MarkPure CNB Build Script
# Builds the application using Cloud Native Buildpacks (pack CLI)

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
CDIR="$(cd "$(dirname "$0")" && pwd)"

# Configuration
IMAGE_NAME="${IMAGE_NAME:-markpure}"
BUILDER_IMAGE="${BUILDER_IMAGE:-dockership/builder:base}"
REGISTRY="${REGISTRY:-docker.io}"
CNB_PLATFORM="${CNB_PLATFORM:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check dependencies
check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        log_error "$1 is not installed. Please install it first."
        log_info "Install pack: https://buildpacks.io/docs/install/pack/"
        exit 1
    fi
}

check_cmd pack

# Set platform-specific registry
if [ -n "$CNB_PLATFORM" ]; then
    REGISTRY="$CNB_PLATFORM"
    log_info "Using CNB platform registry: $REGISTRY"
fi

# Full image name
FULL_IMAGE_NAME="${REGISTRY}/${IMAGE_NAME}"

log_info "Building MarkPure with CNB..."
log_info "Builder: $BUILDER_IMAGE"
log_info "Image: $FULL_IMAGE_NAME"

# Build with pack
pack build "$FULL_IMAGE_NAME" \
    --builder "$BUILDER_IMAGE" \
    --trust-builder \
    --verbose \
    --no-pull

if [ $? -eq 0 ]; then
    log_info "Build successful!"
    log_info "Image: $FULL_IMAGE_NAME"
else
    log_error "Build failed"
    exit 1
fi
