#!/bin/bash
# Build YTFarm as a macOS .app bundle using PyInstaller
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== YTFarm macOS Build ==="

# Check dependencies
python3 -c "import fastapi, uvicorn, playwright, sqlalchemy" 2>/dev/null || {
    echo "Installing dependencies..."
    pip3 install -r requirements.txt
}

pip3 install pyinstaller 2>/dev/null || true

echo "Building .app bundle..."

pyinstaller \
    --name "YTFarm" \
    --onedir \
    --windowed \
    --icon NONE \
    --add-data "dashboard/static:dashboard/static" \
    --add-data "config.yaml:." \
    --hidden-import "uvicorn.logging" \
    --hidden-import "uvicorn.loops" \
    --hidden-import "uvicorn.loops.auto" \
    --hidden-import "uvicorn.protocols" \
    --hidden-import "uvicorn.protocols.http" \
    --hidden-import "uvicorn.protocols.http.auto" \
    --hidden-import "uvicorn.protocols.websockets" \
    --hidden-import "uvicorn.protocols.websockets.auto" \
    --hidden-import "uvicorn.lifespan" \
    --hidden-import "uvicorn.lifespan.on" \
    --hidden-import "uvicorn.lifespan.off" \
    --hidden-import "fastapi" \
    --hidden-import "sqlalchemy" \
    --hidden-import "pydantic" \
    --hidden-import "yaml" \
    --hidden-import "core" \
    --hidden-import "core.browser" \
    --hidden-import "core.fingerprint" \
    --hidden-import "core.profile_store" \
    --hidden-import "core.proxy" \
    --hidden-import "engine" \
    --hidden-import "engine.worker" \
    --hidden-import "engine.scheduler" \
    --hidden-import "engine.queue" \
    --hidden-import "actions" \
    --hidden-import "actions.search" \
    --hidden-import "actions.watch" \
    --hidden-import "actions.like" \
    --hidden-import "actions.subscribe" \
    --hidden-import "actions.comment" \
    --hidden-import "behavior" \
    --hidden-import "behavior.human" \
    --hidden-import "dashboard" \
    --hidden-import "dashboard.server" \
    --collect-all "fastapi" \
    --collect-all "starlette" \
    --noconfirm \
    --clean \
    app.py

echo ""
echo "=== Build complete ==="
echo "App bundle: dist/YTFarm.app"
echo ""
echo "To run: open dist/YTFarm.app"
echo "Or:     ./dist/YTFarm/YTFarm"
