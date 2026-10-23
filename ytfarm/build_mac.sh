#!/bin/bash
# Build BrowserFarm as a macOS .app bundle using PyInstaller
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="BrowserFarm"

echo "=== ${APP_NAME} macOS Build ==="
echo ""

# Install / verify dependencies
echo "[1/4] Checking dependencies..."
pip3 install -r requirements.txt --quiet

echo "[2/4] Installing PyInstaller..."
pip3 install pyinstaller --quiet

echo "[3/4] Installing Playwright browsers..."
python3 -m playwright install chromium --with-deps 2>/dev/null || \
    python3 -m playwright install chromium

echo "[4/4] Building .app bundle..."

pyinstaller \
    --name "${APP_NAME}" \
    --onedir \
    --windowed \
    --icon NONE \
    \
    --add-data "dashboard/static:dashboard/static" \
    --add-data "config.yaml:." \
    \
    --hidden-import "uvicorn.logging" \
    --hidden-import "uvicorn.loops" \
    --hidden-import "uvicorn.loops.auto" \
    --hidden-import "uvicorn.protocols" \
    --hidden-import "uvicorn.protocols.http" \
    --hidden-import "uvicorn.protocols.http.auto" \
    --hidden-import "uvicorn.protocols.websockets" \
    --hidden-import "uvicorn.protocols.websockets.auto" \
    --hidden-import "uvicorn.protocols.websockets.websockets_impl" \
    --hidden-import "uvicorn.lifespan" \
    --hidden-import "uvicorn.lifespan.on" \
    --hidden-import "uvicorn.lifespan.off" \
    --hidden-import "websockets" \
    --hidden-import "websockets.legacy" \
    --hidden-import "websockets.legacy.server" \
    \
    --hidden-import "fastapi" \
    --hidden-import "sqlalchemy" \
    --hidden-import "sqlalchemy.dialects.sqlite" \
    --hidden-import "pydantic" \
    --hidden-import "pydantic.v1" \
    --hidden-import "yaml" \
    \
    --hidden-import "apscheduler" \
    --hidden-import "apscheduler.schedulers" \
    --hidden-import "apscheduler.schedulers.background" \
    --hidden-import "apscheduler.triggers" \
    --hidden-import "apscheduler.triggers.cron" \
    \
    --hidden-import "rumps" \
    \
    --hidden-import "core" \
    --hidden-import "core.browser" \
    --hidden-import "core.fingerprint" \
    --hidden-import "core.profile_store" \
    --hidden-import "core.proxy" \
    --hidden-import "core.task_runner" \
    \
    --hidden-import "engine" \
    --hidden-import "engine.worker" \
    --hidden-import "engine.scheduler" \
    --hidden-import "engine.queue" \
    \
    --hidden-import "actions" \
    --hidden-import "actions.search" \
    --hidden-import "actions.watch" \
    --hidden-import "actions.like" \
    --hidden-import "actions.subscribe" \
    --hidden-import "actions.comment" \
    \
    --hidden-import "behavior" \
    --hidden-import "behavior.human" \
    \
    --hidden-import "dashboard" \
    --hidden-import "dashboard.server" \
    \
    --collect-all "fastapi" \
    --collect-all "starlette" \
    --collect-all "anyio" \
    --collect-all "apscheduler" \
    --collect-all "rumps" \
    \
    --noconfirm \
    --clean \
    app.py

echo ""
echo "=== Build complete ==="
echo ""
echo "  App bundle : dist/${APP_NAME}.app"
echo "  Binary     : dist/${APP_NAME}/${APP_NAME}"
echo ""
echo "  To run     : open dist/${APP_NAME}.app"
echo "  To install : cp -r dist/${APP_NAME}.app /Applications/"
echo ""
