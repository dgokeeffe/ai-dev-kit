#!/usr/bin/env bash
# install.sh - Install Claude Code CLI, Node.js, Databricks CLI, and helper scripts.
# Idempotent: skips anything already installed.
# Runs inside the Databricks App container (no root required).
set -euo pipefail

LOG_PREFIX="[install]"
log() { echo "$LOG_PREFIX $*"; }

export HOME="${HOME:-/tmp/workshop-home}"
mkdir -p "$HOME"

# --- Node.js (required for Claude Code CLI) ---
if command -v node &>/dev/null; then
    log "Node.js already installed: $(node --version)"
else
    log "Installing Node.js (standalone)..."
    NODE_VERSION="22.14.0"
    mkdir -p "$HOME/.local"
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
        | tar -xJ -C "$HOME/.local" --strip-components=1
    log "Node.js installed: $(node --version)"
fi
export PATH="$HOME/.local/bin:$PATH"

# --- Claude Code CLI ---
CLAUDE_BIN="$HOME/.local/bin/claude"
if [ -x "$CLAUDE_BIN" ]; then
    log "Claude Code CLI already installed"
else
    log "Installing Claude Code CLI..."
    npm install -g --prefix "$HOME/.local" @anthropic-ai/claude-code 2>&1 || {
        log "Warning: npm install failed, trying npx..."
        npx --yes @anthropic-ai/claude-code --version 2>/dev/null || true
    }
    if [ -x "$CLAUDE_BIN" ]; then
        log "Claude Code CLI installed"
    else
        log "Claude Code CLI not found at $CLAUDE_BIN (non-fatal)"
    fi
fi

# --- Databricks CLI ---
if command -v databricks &>/dev/null; then
    log "Databricks CLI already installed: $(databricks --version)"
else
    log "Installing Databricks CLI..."
    curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sh 2>&1 \
        || log "Warning: Databricks CLI install failed (non-fatal)"
fi

# --- GitHub CLI (for git-based app deployment) ---
if command -v gh &>/dev/null; then
    log "GitHub CLI already installed: $(gh --version | head -1)"
else
    log "Installing GitHub CLI..."
    GH_VERSION="2.67.0"
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
        | tar -xz -C /tmp
    mv "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" "$HOME/.local/bin/gh" 2>/dev/null \
        || log "Warning: GitHub CLI install failed (non-fatal)"
    rm -rf "/tmp/gh_${GH_VERSION}_linux_amd64"
    log "GitHub CLI installed"
fi

# --- Helper scripts ---
log "Installing helper scripts..."
mkdir -p "$HOME/.local/bin"

# dbx-deploy: deploy current directory as a Databricks App
cat > "$HOME/.local/bin/dbx-deploy" << 'DEPLOY_EOF'
#!/usr/bin/env bash
set -euo pipefail
APP_NAME="${1:?Usage: dbx-deploy <app-name>}"
echo "Deploying $APP_NAME from $(pwd)..."
databricks apps deploy "$APP_NAME" --source-code-path "$(pwd)"
echo "Done! Check: databricks apps get $APP_NAME"
DEPLOY_EOF
chmod +x "$HOME/.local/bin/dbx-deploy"

# dbx-new: scaffold a new project from a template
cat > "$HOME/.local/bin/dbx-new" << 'NEW_EOF'
#!/usr/bin/env bash
set -euo pipefail

TEMPLATE="${1:-}"
PROJECT_NAME="${2:-my-app}"

[ -z "$TEMPLATE" ] && {
    echo "Usage: dbx-new <template> [project-name]"
    echo "Templates: streamlit, dash, flask"
    exit 1
}

case "$TEMPLATE" in
    streamlit)
        mkdir -p "$PROJECT_NAME" && cd "$PROJECT_NAME"
        cat > app.py << 'APP'
import streamlit as st
st.title("Hello from Databricks Apps!")
st.write("This is a Streamlit application running on Databricks.")
name = st.text_input("Enter your name")
if name:
    st.write(f"Hello, {name}!")
APP
        echo "streamlit" > requirements.txt
        cat > app.yaml << 'YAML'
command:
  - streamlit
  - run
  - app.py
  - --server.port
  - $DATABRICKS_APP_PORT
  - --server.address
  - 0.0.0.0
YAML
        ;;
    dash)
        mkdir -p "$PROJECT_NAME" && cd "$PROJECT_NAME"
        cat > app.py << 'APP'
import os
from dash import Dash, html, dcc
import plotly.express as px
import pandas as pd

app = Dash(__name__)
df = pd.DataFrame({"Category": ["A", "B", "C", "D"], "Values": [4, 3, 2, 5]})
fig = px.bar(df, x="Category", y="Values", title="Sample Bar Chart")
app.layout = html.Div([html.H1("Hello from Databricks Apps!"), dcc.Graph(figure=fig)])
server = app.server

if __name__ == "__main__":
    port = int(os.getenv("DATABRICKS_APP_PORT", "8050"))
    app.run(host="0.0.0.0", port=port, debug=False)
APP
        printf "dash\nplotly\npandas\ngunicorn\n" > requirements.txt
        cat > app.yaml << 'YAML'
command:
  - gunicorn
  - app:server
  - --bind
  - 0.0.0.0:$DATABRICKS_APP_PORT
YAML
        ;;
    flask)
        mkdir -p "$PROJECT_NAME" && cd "$PROJECT_NAME"
        cat > app.py << 'APP'
import os
from flask import Flask, jsonify

app = Flask(__name__)

@app.route("/")
def hello():
    return jsonify({"message": "Hello from Databricks Apps!", "status": "running"})

if __name__ == "__main__":
    port = int(os.getenv("DATABRICKS_APP_PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
APP
        printf "flask\ngunicorn\n" > requirements.txt
        cat > app.yaml << 'YAML'
command:
  - gunicorn
  - app:app
  - --bind
  - 0.0.0.0:$DATABRICKS_APP_PORT
YAML
        ;;
    *)
        echo "Unknown template: $TEMPLATE"
        echo "Available: streamlit, dash, flask"
        exit 1
        ;;
esac

echo "Created $PROJECT_NAME/ with $TEMPLATE template."
echo "Next: cd $PROJECT_NAME && dbx-deploy <app-name>"
NEW_EOF
chmod +x "$HOME/.local/bin/dbx-new"

log "Installation complete."
