#!/bin/bash
# Deploy script for Databricks Builder App
# Supports two deployment modes:
#   --git   Deploy from Git repository (recommended)
#   legacy  Upload files to workspace (fallback)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$PROJECT_DIR")"

# Default values
APP_NAME="${APP_NAME:-}"
WORKSPACE_PATH=""
STAGING_DIR=""
SKIP_BUILD="${SKIP_BUILD:-false}"
PREP_ONLY="${PREP_ONLY:-false}"
GIT_DEPLOY="${GIT_DEPLOY:-false}"
GIT_BRANCH=""
GIT_COMMIT=""

# Usage information
usage() {
  echo "Usage: $0 [<app-name>] [options]"
  echo ""
  echo "Deploy the Databricks Builder App to Databricks Apps platform."
  echo ""
  echo "Arguments:"
  echo "  app-name              Name of the Databricks App"
  echo ""
  echo "Deployment Modes:"
  echo "  --git                 Deploy from Git repository (recommended)"
  echo "  --branch BRANCH       Git branch to deploy (default: current branch)"
  echo "  --commit SHA          Deploy a specific Git commit"
  echo "  --prep-only           Legacy: build frontend + copy packages for DAB deploy"
  echo ""
  echo "Options:"
  echo "  --skip-build          Skip frontend build (use existing build)"
  echo "  --staging-dir DIR     Custom staging directory (legacy mode)"
  echo "  -h, --help            Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0 --git my-builder-app              # Deploy current branch from Git"
  echo "  $0 --git my-builder-app --branch dev # Deploy 'dev' branch from Git"
  echo "  $0 --prep-only                       # Legacy: prep for databricks bundle deploy"
  echo "  $0 my-builder-app                    # Legacy: upload files to workspace"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help)
      usage
      exit 0
      ;;
    --git)
      GIT_DEPLOY=true
      shift
      ;;
    --branch)
      GIT_BRANCH="$2"
      shift 2
      ;;
    --commit)
      GIT_COMMIT="$2"
      shift 2
      ;;
    --prep-only)
      PREP_ONLY=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --staging-dir)
      STAGING_DIR="$2"
      shift 2
      ;;
    -*)
      echo -e "${RED}Error: Unknown option $1${NC}"
      usage
      exit 1
      ;;
    *)
      if [ -z "$APP_NAME" ]; then
        APP_NAME="$1"
      else
        echo -e "${RED}Error: Unexpected argument $1${NC}"
        usage
        exit 1
      fi
      shift
      ;;
  esac
done

# ══════════════════════════════════════════════════════════════════════════
# Git-based deployment
# ══════════════════════════════════════════════════════════════════════════
if [ "$GIT_DEPLOY" = true ]; then
  if [ -z "$APP_NAME" ]; then
    echo -e "${RED}Error: App name is required for --git deployment${NC}"
    echo "  Usage: $0 --git <app-name> [--branch <branch>]"
    exit 1
  fi

  echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║       Git-based Deployment                                ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  # Determine branch or commit
  if [ -n "$GIT_COMMIT" ]; then
    GIT_REF_TYPE="commit"
    GIT_REF="$GIT_COMMIT"
  else
    if [ -z "$GIT_BRANCH" ]; then
      GIT_BRANCH=$(cd "$REPO_ROOT" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
    fi
    GIT_REF_TYPE="branch"
    GIT_REF="$GIT_BRANCH"
  fi

  echo -e "  App Name:     ${GREEN}${APP_NAME}${NC}"
  echo -e "  Git ${GIT_REF_TYPE}:  ${GREEN}${GIT_REF}${NC}"
  echo -e "  Source Path:  databricks-claude-forge"
  echo ""

  # Check prerequisites
  echo -e "${YELLOW}[1/4] Checking prerequisites...${NC}"
  if ! command -v databricks &> /dev/null; then
    echo -e "${RED}Error: Databricks CLI not found.${NC}"
    exit 1
  fi
  if ! databricks auth describe &> /dev/null; then
    echo -e "${RED}Error: Not authenticated. Run: databricks auth login${NC}"
    exit 1
  fi
  echo -e "  ${GREEN}✓${NC} Databricks CLI authenticated"

  # Verify app exists and has git_repository configured
  echo -e "${YELLOW}[2/4] Verifying app...${NC}"
  APP_JSON=$(databricks apps get "$APP_NAME" --output json 2>/dev/null || echo "{}")
  if echo "$APP_JSON" | python3 -c "import sys, json; d=json.load(sys.stdin); assert d.get('name')" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} App '${APP_NAME}' exists"
  else
    echo -e "${RED}Error: App '${APP_NAME}' not found.${NC}"
    echo "  Create it first with: databricks bundle deploy -t dev"
    exit 1
  fi

  # Check if git_repository is set
  HAS_GIT=$(echo "$APP_JSON" | python3 -c "import sys, json; d=json.load(sys.stdin); print('yes' if d.get('git_repository') else 'no')" 2>/dev/null || echo "no")
  if [ "$HAS_GIT" != "yes" ]; then
    echo -e "${YELLOW}  ⚠ App does not have git_repository configured.${NC}"
    echo -e "  Run 'databricks bundle deploy -t dev' first to set up git integration."
    exit 1
  fi
  echo -e "  ${GREEN}✓${NC} Git repository configured"

  # Check for uncommitted changes
  echo -e "${YELLOW}[3/4] Checking Git status...${NC}"
  cd "$REPO_ROOT"
  if [ -n "$(git status --porcelain -- databricks-claude-forge/ databricks-tools-core/ databricks-mcp-server/ databricks-skills/ 2>/dev/null)" ]; then
    echo -e "${YELLOW}  ⚠ Uncommitted changes detected in app-related directories.${NC}"
    echo "  The deployment will use the latest PUSHED commit, not local changes."
    echo ""
    read -p "  Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "  Aborted. Commit and push your changes first."
      exit 1
    fi
  fi

  # Check if local branch is ahead of remote
  LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null)
  if [ "$GIT_REF_TYPE" = "branch" ]; then
    REMOTE_SHA=$(git rev-parse "origin/${GIT_BRANCH}" 2>/dev/null || echo "")
    if [ -n "$REMOTE_SHA" ] && [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
      echo -e "${YELLOW}  ⚠ Local branch is not in sync with origin/${GIT_BRANCH}.${NC}"
      echo "  Push your changes: git push origin ${GIT_BRANCH}"
    fi
  fi
  echo -e "  ${GREEN}✓${NC} Git status checked"
  echo ""
  echo -e "  ${BLUE}Note:${NC} The platform automatically runs 'npm run build' during"
  echo -e "  deployment, which builds the React frontend. No pre-build needed."

  # Deploy from Git
  echo -e "${YELLOW}[4/4] Deploying from Git...${NC}"
  if [ "$GIT_REF_TYPE" = "commit" ]; then
    DEPLOY_JSON="{\"git_source\": {\"commit\": \"${GIT_REF}\", \"source_code_path\": \"databricks-claude-forge\"}}"
  else
    DEPLOY_JSON="{\"git_source\": {\"branch\": \"${GIT_REF}\", \"source_code_path\": \"databricks-claude-forge\"}}"
  fi

  echo "  Payload: $DEPLOY_JSON"
  echo ""

  DEPLOY_OUTPUT=$(databricks apps deploy "$APP_NAME" --json "$DEPLOY_JSON" 2>&1)
  echo "$DEPLOY_OUTPUT"

  # Get app URL
  APP_URL=$(databricks apps get "$APP_NAME" --output json 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin).get('url', 'N/A'))" 2>/dev/null || echo "N/A")

  echo ""
  echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║         Git Deployment Initiated!                          ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  App URL:  ${GREEN}${APP_URL}${NC}"
  echo -e "  Branch:   ${GIT_REF}"
  echo ""
  echo "  Monitor deployment:"
  echo "    databricks apps logs ${APP_NAME}"
  echo ""
  exit 0
fi

# ══════════════════════════════════════════════════════════════════════════
# Legacy: --prep-only (build frontend + copy packages for DABs file deploy)
# ══════════════════════════════════════════════════════════════════════════

# Validate app name (not required for --prep-only)
if [ -z "$APP_NAME" ] && [ "$PREP_ONLY" != true ]; then
  echo -e "${RED}Error: App name is required${NC}"
  echo ""
  usage
  exit 1
fi

# Set derived paths
STAGING_DIR="${STAGING_DIR:-/tmp/${APP_NAME:-builder-app}-deploy}"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       Legacy File-based Deployment                        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  App Name:     ${GREEN}${APP_NAME}${NC}"
echo -e "  Staging Dir:  ${STAGING_DIR}"
echo -e "  Skip Build:   ${SKIP_BUILD}"
echo -e "  Prep Only:    ${PREP_ONLY}"
echo ""

# --prep-only: build frontend and copy packages/skills for DAB, then exit
if [ "$PREP_ONLY" = true ]; then
  echo -e "${YELLOW}[prep] Building frontend...${NC}"
  cd "$PROJECT_DIR/client"
  if [ "$SKIP_BUILD" = true ] && [ -d "out" ]; then
    echo -e "  ${GREEN}✓${NC} Using existing build (--skip-build)"
  else
    [ ! -d "node_modules" ] && npm install --silent
    npm run build
    echo -e "  ${GREEN}✓${NC} Frontend built"
  fi
  cd "$PROJECT_DIR"

  echo -e "${YELLOW}[prep] Copying packages and skills...${NC}"
  rm -rf "$PROJECT_DIR/packages" "$PROJECT_DIR/skills"
  mkdir -p "$PROJECT_DIR/packages/databricks_tools_core" "$PROJECT_DIR/packages/databricks_mcp_server"
  if [ -d "$REPO_ROOT/databricks-tools-core/databricks_tools_core" ]; then
    cp -r "$REPO_ROOT/databricks-tools-core/databricks_tools_core/"* "$PROJECT_DIR/packages/databricks_tools_core/"
    echo -e "  ${GREEN}✓${NC} databricks-tools-core"
  fi
  if [ -d "$REPO_ROOT/databricks-mcp-server/databricks_mcp_server" ]; then
    cp -r "$REPO_ROOT/databricks-mcp-server/databricks_mcp_server/"* "$PROJECT_DIR/packages/databricks_mcp_server/"
    echo -e "  ${GREEN}✓${NC} databricks-mcp-server"
  fi
  mkdir -p "$PROJECT_DIR/skills"
  if [ -d "$REPO_ROOT/databricks-skills" ]; then
    for skill_dir in "$REPO_ROOT/databricks-skills"/*/; do
      [ -d "$skill_dir" ] || continue
      skill_name=$(basename "$skill_dir")
      [ "$skill_name" = "TEMPLATE" ] && continue
      [ -f "$skill_dir/SKILL.md" ] && cp -r "$skill_dir" "$PROJECT_DIR/skills/"
    done
    echo -e "  ${GREEN}✓${NC} skills"
  fi
  echo ""
  echo -e "${GREEN}Prep complete. Run: databricks bundle deploy -t dev${NC}"
  exit 0
fi

# Check prerequisites
echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"

# Check Databricks CLI
if ! command -v databricks &> /dev/null; then
  echo -e "${RED}Error: Databricks CLI not found. Install with: pip install databricks-cli${NC}"
  exit 1
fi

# Check if authenticated
if ! databricks auth describe &> /dev/null; then
  echo -e "${RED}Error: Not authenticated with Databricks. Run: databricks auth login${NC}"
  exit 1
fi

# Get workspace info (handle both old and new CLI output formats)
WORKSPACE_HOST=$(databricks auth describe --output json 2>/dev/null | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('details', {}).get('host', '') or d.get('host', ''))" 2>/dev/null || echo "")
if [ -z "$WORKSPACE_HOST" ]; then
  echo -e "${RED}Error: Could not determine Databricks workspace. Check your authentication.${NC}"
  exit 1
fi

# Get current user for workspace path
CURRENT_USER=$(databricks current-user me --output json 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin).get('userName', ''))" 2>/dev/null || echo "")
if [ -z "$CURRENT_USER" ]; then
  echo -e "${RED}Error: Could not determine current user.${NC}"
  exit 1
fi

WORKSPACE_PATH="/Workspace/Users/${CURRENT_USER}/apps/${APP_NAME}"
echo -e "  Workspace:    ${WORKSPACE_HOST}"
echo -e "  User:         ${CURRENT_USER}"
echo -e "  Deploy Path:  ${WORKSPACE_PATH}"
echo ""

# Check if app exists
echo -e "${YELLOW}[2/6] Verifying app exists...${NC}"
if ! databricks apps get "$APP_NAME" &> /dev/null; then
  echo -e "${RED}Error: App '${APP_NAME}' does not exist.${NC}"
  echo -e "Create it first with: ${GREEN}databricks apps create ${APP_NAME}${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} App '${APP_NAME}' exists"
echo ""

# Build frontend
echo -e "${YELLOW}[3/6] Building frontend...${NC}"
cd "$PROJECT_DIR/client"

if [ "$SKIP_BUILD" = true ]; then
  if [ ! -d "out" ]; then
    echo -e "${RED}Error: No existing build found at client/out. Cannot skip build.${NC}"
    exit 1
  fi
  echo -e "  ${GREEN}✓${NC} Using existing build (--skip-build)"
else
  # Install dependencies if needed
  if [ ! -d "node_modules" ]; then
    echo "  Installing npm dependencies..."
    npm install --silent
  fi

  echo "  Building production bundle..."
  npm run build
  echo -e "  ${GREEN}✓${NC} Frontend built successfully"
fi
cd "$PROJECT_DIR"

# Validate frontend build
echo -e "${YELLOW}[3.5/6] Validating frontend build...${NC}"
if [ ! -f "$PROJECT_DIR/client/out/index.html" ]; then
  echo -e "${RED}Error: Frontend build missing index.html${NC}"
  echo "  Expected: client/out/index.html"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} index.html found"

# Check for common mistakes
if [ -d "$PROJECT_DIR/client/out/node_modules" ]; then
  echo -e "${YELLOW}Warning: node_modules found in build output - this will bloat deployment${NC}"
  echo "  Check client/.gitignore and vite.config.ts"
fi

# Validate app.yaml exists
if [ ! -f "$PROJECT_DIR/app.yaml" ]; then
  echo -e "${RED}Error: app.yaml not found. Copy from app.yaml.example and configure.${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} app.yaml found"

# Verify app.yaml has required fields
if ! grep -q "DATABRICKS_HOST" "$PROJECT_DIR/app.yaml"; then
  echo -e "${YELLOW}Warning: DATABRICKS_HOST not found in app.yaml${NC}"
fi
if ! grep -q "DATABASE_URL" "$PROJECT_DIR/app.yaml"; then
  echo -e "${YELLOW}Warning: DATABASE_URL not found in app.yaml${NC}"
fi
if ! grep -q "DATABRICKS_APP_PORT" "$PROJECT_DIR/app.yaml"; then
  echo -e "${YELLOW}Warning: Command should use \$DATABRICKS_APP_PORT for port binding${NC}"
fi

echo ""

# Prepare staging directory
echo -e "${YELLOW}[4/6] Preparing deployment package...${NC}"

# Clean and create staging directory
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

# Copy server code
echo "  Copying server code..."
cp -r server "$STAGING_DIR/"
cp app.yaml "$STAGING_DIR/"
cp requirements.txt "$STAGING_DIR/"

# Copy alembic (database migrations)
if [ -f "alembic.ini" ] && [ -d "alembic" ]; then
  echo "  Copying alembic migrations..."
  cp alembic.ini "$STAGING_DIR/"
  cp -r alembic "$STAGING_DIR/"
fi

# Copy package.json for Claude Code CLI (installed via npm)
if [ -f "package.json" ]; then
  echo "  Copying package.json for npm dependencies..."
  cp package.json "$STAGING_DIR/"
fi

# Copy frontend build
echo "  Copying frontend build..."
cp -r client/out "$STAGING_DIR/client/"

# Copy packages (databricks-tools-core and databricks-mcp-server)
echo "  Copying Databricks packages..."
mkdir -p "$STAGING_DIR/packages"

# Copy databricks-tools-core (only Python source, no tests)
mkdir -p "$STAGING_DIR/packages/databricks_tools_core"
cp -r "$REPO_ROOT/databricks-tools-core/databricks_tools_core/"* "$STAGING_DIR/packages/databricks_tools_core/"

# Copy databricks-mcp-server (only Python source)
mkdir -p "$STAGING_DIR/packages/databricks_mcp_server"
cp -r "$REPO_ROOT/databricks-mcp-server/databricks_mcp_server/"* "$STAGING_DIR/packages/databricks_mcp_server/"

# Copy skills
echo "  Copying skills..."
mkdir -p "$STAGING_DIR/skills"
SKILLS_DIR="$REPO_ROOT/databricks-skills"
if [ -d "$SKILLS_DIR" ]; then
  for skill_dir in "$SKILLS_DIR"/*/; do
    skill_name=$(basename "$skill_dir")
    # Skip template and non-skill directories
    if [ "$skill_name" != "TEMPLATE" ] && [ -f "$skill_dir/SKILL.md" ]; then
      cp -r "$skill_dir" "$STAGING_DIR/skills/"
    fi
  done
fi

# Remove __pycache__ directories
find "$STAGING_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$STAGING_DIR" -type f -name "*.pyc" -delete 2>/dev/null || true

echo -e "  ${GREEN}✓${NC} Deployment package prepared"
echo ""

# Upload to workspace
echo -e "${YELLOW}[5/6] Uploading to Databricks workspace...${NC}"
echo "  Target: ${WORKSPACE_PATH}"
databricks workspace import-dir "$STAGING_DIR" "$WORKSPACE_PATH" --overwrite 2>&1 | tail -5
echo -e "  ${GREEN}✓${NC} Upload complete"
echo ""

# Deploy the app
echo -e "${YELLOW}[6/6] Deploying app...${NC}"
DEPLOY_OUTPUT=$(databricks apps deploy "$APP_NAME" --source-code-path "$WORKSPACE_PATH" 2>&1)
echo "$DEPLOY_OUTPUT"

# Check deployment status
if echo "$DEPLOY_OUTPUT" | grep -q '"state":"SUCCEEDED"'; then
  echo ""
  echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║                 Deployment Successful!                     ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  
  # Get app URL
  APP_INFO=$(databricks apps get "$APP_NAME" --output json 2>/dev/null)
  APP_URL=$(echo "$APP_INFO" | python3 -c "import sys, json; print(json.load(sys.stdin).get('url', 'N/A'))" 2>/dev/null || echo "N/A")
  
  echo -e "  App URL: ${GREEN}${APP_URL}${NC}"
  echo ""
  if [ "$APP_URL" != "N/A" ]; then
    echo -e "  ${GREEN}Open app:${NC} ${APP_URL}"
    echo ""
  fi
  echo "  Next steps:"
  echo "    1. Open the app URL in your browser (link above)"
  echo "    2. (Optional) For PAT fallback when token forwarding fails, run:"
  echo "       ./scripts/setup_pat_secret.sh"
  echo "       Then uncomment USE_PAT_FALLBACK and DATABRICKS_TOKEN valueFrom in app.yaml"
  echo ""
  echo "    3. If this is first deployment, add Lakebase as an app resource:"
  echo "       databricks apps add-resource $APP_NAME --resource-type database \\"
  echo "         --resource-name lakebase --database-instance <instance-name>"
  echo ""
  echo "    4. If tables were created by another user (e.g., local development),"
  echo "       grant permissions to the app's service principal:"
  echo "       ./scripts/grant_lakebase_permissions.sh $APP_NAME"
  echo ""
  echo "       This is required because CAN_CONNECT_AND_CREATE only grants CONNECT"
  echo "       and CREATE privileges, not access to existing tables."
  echo ""
else
  echo ""
  echo -e "${RED}Deployment may have issues. Check the output above.${NC}"
  exit 1
fi
