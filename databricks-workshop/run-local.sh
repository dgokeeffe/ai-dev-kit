#!/usr/bin/env bash
# Run the workshop app locally in personal mode.
#
# Sessions persist as long as this process runs. Close your laptop,
# reopen, reconnect to http://localhost:5173 — output replays from buffer.
#
# Usage:
#   ./run-local.sh              # personal mode (no auto-create)
#   ./run-local.sh --workshop   # workshop mode (auto-creates 3 sessions)
#
# Transcripts are saved to ./transcripts/ for overnight review.

set -euo pipefail
cd "$(dirname "$0")"

MODE="personal"
PORT="${PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

if [[ "${1:-}" == "--workshop" ]]; then
    MODE="workshop"
fi

# ---- Python venv ----
if [ ! -d .venv ]; then
    echo "Creating Python venv..."
    uv venv .venv
    source .venv/bin/activate
    uv pip install -r server/requirements.txt
else
    source .venv/bin/activate
fi

# ---- Frontend deps ----
if [ ! -d client/node_modules ]; then
    echo "Installing frontend dependencies..."
    (cd client && npm install)
fi

# ---- Build frontend (if not built) ----
if [ ! -d client/dist ]; then
    echo "Building frontend..."
    (cd client && npm run build)
fi

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║  Claude Sessions — ${MODE} mode           "
echo "║                                           ║"
echo "║  http://localhost:${PORT}                  "
echo "║                                           ║"
echo "║  Idle timeout: disabled (sessions persist) ║"
echo "║  Transcripts:  ./transcripts/             ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# ---- Start server ----
export ENV=development
export IDLE_TIMEOUT_MINUTES=0
export MAX_SESSIONS_PER_USER=10

exec uvicorn server.app:app \
    --host 127.0.0.1 \
    --port "$PORT"
