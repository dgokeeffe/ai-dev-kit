#!/bin/bash
# Deploy script for Databricks Builder App (Node.js backend)
# Deploys the Node.js server + React frontend to Databricks Apps platform

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$PROJECT_DIR")"

APP_NAME="${APP_NAME:-}"
STAGING_DIR=""
SKIP_BUILD="${SKIP_BUILD:-false}"

usage() {
  echo "Usage: $0 <app-name> [options]"
  echo ""
  echo "Deploy the Databricks Builder App (Node.js) to Databricks Apps platform."
  echo ""
  echo "Arguments:"
  echo "  app-name              Name of the Databricks App (required)"
  echo ""
  echo "Options:"
  echo "  --skip-build          Skip frontend and backend build"
  echo "  --staging-dir DIR     Custom staging directory"
  echo "  -h, --help            Show this help message"
}

while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help) usage; exit 0 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --staging-dir) STAGING_DIR="$2"; shift 2 ;;
    -*) echo -e "${RED}Error: Unknown option $1${NC}"; usage; exit 1 ;;
    *)
      if [ -z "$APP_NAME" ]; then
        APP_NAME="$1"
      else
        echo -e "${RED}Error: Unexpected argument $1${NC}"; usage; exit 1
      fi
      shift ;;
  esac
done

if [ -z "$APP_NAME" ]; then
  echo -e "${RED}Error: App name is required${NC}"
  usage
  exit 1
fi

STAGING_DIR="${STAGING_DIR:-/tmp/${APP_NAME}-node-deploy}"

echo -e "${BLUE}=== Databricks Builder App (Node.js) Deployment ===${NC}"
echo -e "  App Name:     ${GREEN}${APP_NAME}${NC}"
echo -e "  Staging Dir:  ${STAGING_DIR}"
echo ""

# Check prerequisites
echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"
if ! command -v databricks &> /dev/null; then
  echo -e "${RED}Error: Databricks CLI not found.${NC}"
  exit 1
fi

if ! databricks auth describe &> /dev/null; then
  echo -e "${RED}Error: Not authenticated with Databricks.${NC}"
  exit 1
fi

WORKSPACE_HOST=$(databricks auth describe --output json 2>/dev/null | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('details', {}).get('host', '') or d.get('host', ''))" 2>/dev/null || echo "")
CURRENT_USER=$(databricks current-user me --output json 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin).get('userName', ''))" 2>/dev/null || echo "")
WORKSPACE_PATH="/Workspace/Users/${CURRENT_USER}/apps/${APP_NAME}"
echo -e "  Workspace:    ${WORKSPACE_HOST}"
echo -e "  User:         ${CURRENT_USER}"
echo ""

# Verify app exists
echo -e "${YELLOW}[2/6] Verifying app exists...${NC}"
if ! databricks apps get "$APP_NAME" &> /dev/null; then
  echo -e "${RED}Error: App '${APP_NAME}' does not exist.${NC}"
  echo -e "Create it first: ${GREEN}databricks apps create ${APP_NAME}${NC}"
  exit 1
fi
echo -e "  ${GREEN}ok${NC} App '${APP_NAME}' exists"
echo ""

# Build backend
echo -e "${YELLOW}[3/6] Building backend...${NC}"
if [ "$SKIP_BUILD" = true ]; then
  echo -e "  ${GREEN}ok${NC} Skipping build (--skip-build)"
else
  cd "$PROJECT_DIR/server-node"
  npm ci --silent
  npm run build
  echo -e "  ${GREEN}ok${NC} Backend built"
fi
echo ""

# Build frontend
echo -e "${YELLOW}[4/6] Building frontend...${NC}"
if [ "$SKIP_BUILD" = true ]; then
  echo -e "  ${GREEN}ok${NC} Skipping build (--skip-build)"
else
  cd "$PROJECT_DIR/client"
  if [ ! -d "node_modules" ]; then
    npm install --silent
  fi
  npm run build
  echo -e "  ${GREEN}ok${NC} Frontend built"
fi
cd "$PROJECT_DIR"
echo ""

# Prepare staging
echo -e "${YELLOW}[5/6] Preparing deployment package...${NC}"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

# Copy backend build
cp -r server-node/dist "$STAGING_DIR/"
cp server-node/package.json "$STAGING_DIR/"
cp server-node/package-lock.json "$STAGING_DIR/"

# Copy app.yaml from server-node
cp server-node/app.yaml "$STAGING_DIR/"

# Copy frontend build
mkdir -p "$STAGING_DIR/client"
if [ -d "client/out" ]; then
  cp -r client/out/* "$STAGING_DIR/client/"
elif [ -d "client/dist" ]; then
  cp -r client/dist/* "$STAGING_DIR/client/"
fi

# Copy skills
SKILLS_DIR="$REPO_ROOT/databricks-skills"
if [ -d "$SKILLS_DIR" ]; then
  echo "  Copying skills..."
  mkdir -p "$STAGING_DIR/skills"
  for skill_dir in "$SKILLS_DIR"/*/; do
    skill_name=$(basename "$skill_dir")
    if [ "$skill_name" != "TEMPLATE" ] && [ -f "$skill_dir/SKILL.md" ]; then
      cp -r "$skill_dir" "$STAGING_DIR/skills/"
    fi
  done
fi

# Copy root package.json for Claude Code CLI dependency
if [ -f "$PROJECT_DIR/package.json" ]; then
  cp "$PROJECT_DIR/package.json" "$STAGING_DIR/package-root.json"
fi

echo -e "  ${GREEN}ok${NC} Package prepared"
echo ""

# Upload and deploy
echo -e "${YELLOW}[6/6] Uploading and deploying...${NC}"
databricks workspace import-dir "$STAGING_DIR" "$WORKSPACE_PATH" --overwrite 2>&1 | tail -5
DEPLOY_OUTPUT=$(databricks apps deploy "$APP_NAME" --source-code-path "$WORKSPACE_PATH" 2>&1)
echo "$DEPLOY_OUTPUT"

if echo "$DEPLOY_OUTPUT" | grep -q '"state":"SUCCEEDED"'; then
  echo ""
  echo -e "${GREEN}Deployment successful!${NC}"
  APP_URL=$(databricks apps get "$APP_NAME" --output json 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin).get('url', 'N/A'))" 2>/dev/null || echo "N/A")
  echo -e "  App URL: ${GREEN}${APP_URL}${NC}"
else
  echo -e "${RED}Deployment may have issues. Check output above.${NC}"
  exit 1
fi
