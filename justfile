set windows-shell := ["powershell", "-NoLogo", "-Command"]

profile := "debug"

# Install npm dependencies
install:
    npm ci

# Build frontend with Vite
build-frontend:
    npx vite build

# Build Rust backend
build-rust:
    # Force rust-embed recompile
    touch src-rust/src/main.rs
    cargo build {{ if profile == "release" { "--release" } else { "" } }}

# Full build (frontend + Rust)
build: install build-frontend build-rust
    echo "Build complete!"

# Run the application
run: build
    cargo run {{ if profile == "release" { "--release" } else { "" } }}

# Clean build artifacts
clean:
    rm -rf dist
    cargo clean

# Check code
check: install
    npm run check
    cargo check --workspace

# Run tests
test:
    cargo test --workspace

# Format code
fmt:
    cargo fmt --all
    npm run build -- --format

# Lint code
lint:
    cargo clippy --workspace -- -D warnings

# macOS only: bundle as .app
bundle-macos: build
    ./bundle-macos.sh

# Build release
release:
    profile := "release"
    install
    npx vite build
    touch src-rust/src/main.rs
    cargo build --release
