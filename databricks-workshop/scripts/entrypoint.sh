#!/usr/bin/env bash
# entrypoint.sh - Databricks App startup for workshop workers.
# Installs dependencies then starts the FastAPI server.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

export HOME="${HOME:-/tmp/workshop-home}"
mkdir -p "$HOME"
export PATH="$HOME/.local/bin:$PATH"

echo "=== Vibe Coding Workshop — Worker Starting ==="
echo "App directory: $APP_DIR"
echo "Port: ${DATABRICKS_APP_PORT:-8000}"
echo "HOME: $HOME"

# Step 1: Install Python dependencies
echo "--- Installing Python dependencies ---"
pip install --quiet -r "$APP_DIR/server/requirements.txt" 2>&1 || {
    echo "pip install failed, trying with --user..."
    pip install --quiet --user -r "$APP_DIR/server/requirements.txt" 2>&1
}

# Step 2: Install Claude Code CLI, Databricks CLI, helpers
echo "--- Running install.sh ---"
bash "$APP_DIR/scripts/install.sh"

# Step 3: Create workspaces directory
WORKSPACES_DIR="${WORKSPACES_DIR:-./workspaces}"
mkdir -p "$WORKSPACES_DIR"
echo "Workspaces directory: $WORKSPACES_DIR"

# Step 4: Build frontend if dist doesn't exist and source is present
if [ ! -d "$APP_DIR/client/dist" ] && [ -f "$APP_DIR/client/package.json" ]; then
    echo "--- Building frontend ---"
    cd "$APP_DIR/client"
    npm ci 2>&1 || true
    npm run build 2>&1 || echo "Frontend build failed (non-fatal, API still works)"
    cd "$APP_DIR"
fi

# Step 5: Start the server
echo "--- Starting workshop server ---"
cd "$APP_DIR"
exec uvicorn server.app:app \
    --host 0.0.0.0 \
    --port "${DATABRICKS_APP_PORT:-8000}" \
    --loop uvloop \
    --log-level info
