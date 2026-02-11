#!/usr/bin/env bash
# deploy-workshop.sh — Deploy N workshop worker apps + verify.
#
# Usage:
#   ./scripts/deploy-workshop.sh --prefix vibe --workers 10
#   ./scripts/deploy-workshop.sh --prefix vibe --workers 1          # single-instance dev
#   ./scripts/deploy-workshop.sh --prefix vibe --workers 10 --destroy  # tear down
#
# Each worker app handles ~30-50 concurrent Claude Code sessions.
# For 300 sessions (100 users x 3), deploy 10 workers.
#
# Prerequisites:
#   - Databricks CLI authenticated
#   - Changes pushed to the remote git branch
#   - CLAUDE_API_TOKEN set (or use --token to set the secret)
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ---- Defaults ----
PREFIX="vibe-workshop"
NUM_WORKERS=1
GIT_BRANCH=""
GIT_URL="https://github.com/databricks-solutions/ai-dev-kit"
SOURCE_PATH="databricks-workshop"
CLAUDE_TOKEN=""
DESTROY=false
MAX_SESSIONS_PER_WORKER=50
SECRET_SCOPE="workshop-pat"
SECRET_KEY="claude-api-token"
PAT_LIFETIME=7776000  # 90 days
LAKEBASE_INSTANCE=""

# ---- Parse args ----
while [[ $# -gt 0 ]]; do
  case $1 in
    --prefix)    PREFIX="$2"; shift 2 ;;
    --workers)   NUM_WORKERS="$2"; shift 2 ;;
    --branch)    GIT_BRANCH="$2"; shift 2 ;;
    --git-url)   GIT_URL="$2"; shift 2 ;;
    --source-path) SOURCE_PATH="$2"; shift 2 ;;
    --token)     CLAUDE_TOKEN="$2"; shift 2 ;;
    --lakebase)  LAKEBASE_INSTANCE="$2"; shift 2 ;;
    --destroy)   DESTROY=true; shift ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --prefix <name>     App name prefix (default: vibe-workshop)"
      echo "  --workers <n>       Number of worker apps (default: 1)"
      echo "  --branch <branch>   Git branch to deploy (default: current)"
      echo "  --git-url <url>     Git repo URL"
      echo "  --source-path <p>   Path within repo (default: databricks-workshop)"
      echo "  --token <token>     Claude API token to set as secret"
      echo "  --lakebase <name>   Lakebase instance for session memory persistence"
      echo "  --destroy           Tear down all workshop apps"
      echo ""
      echo "Examples:"
      echo "  $0 --prefix vibe --workers 10              # Full workshop"
      echo "  $0 --prefix vibe --workers 1               # Dev/test"
      echo "  $0 --prefix vibe --workers 10 --destroy    # Cleanup"
      echo ""
      echo "Git-based deploy workflow:"
      echo "  1. git add . && git commit -m 'Update' && git push"
      echo "  2. databricks bundle deploy -t dev"
      echo "  3. databricks apps deploy <app-name> --json '{\"git_source\": {\"branch\": \"main\", \"source_code_path\": \"databricks-workshop\"}}'"
      exit 0
      ;;
    *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
  esac
done

# ---- Resolve branch ----
if [ -z "$GIT_BRANCH" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  GIT_BRANCH=$(cd "$REPO_ROOT" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
fi

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          Vibe Coding Workshop — Deployment              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Prefix:       ${GREEN}${PREFIX}${NC}"
echo -e "  Workers:      ${GREEN}${NUM_WORKERS}${NC}"
echo -e "  Git Branch:   ${GREEN}${GIT_BRANCH}${NC}"
echo -e "  Git URL:      ${GIT_URL}"
echo -e "  Source Path:  ${SOURCE_PATH}"
if [ -n "$LAKEBASE_INSTANCE" ]; then
  echo -e "  Lakebase:     ${GREEN}${LAKEBASE_INSTANCE}${NC}"
fi
echo -e "  Total Capacity: ~$(( NUM_WORKERS * MAX_SESSIONS_PER_WORKER )) sessions"
echo ""

# ---- Prereq check ----
echo -e "${YELLOW}[1/4] Checking prerequisites...${NC}"
if ! command -v databricks &>/dev/null; then
  echo -e "${RED}Error: Databricks CLI not found${NC}"
  exit 1
fi
if ! databricks auth describe &>/dev/null; then
  echo -e "${RED}Error: Not authenticated. Run: databricks auth login${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Databricks CLI authenticated"

# ---- Destroy mode ----
if [ "$DESTROY" = true ]; then
  echo -e "${YELLOW}[2/4] Destroying workshop apps...${NC}"
  for i in $(seq 1 "$NUM_WORKERS"); do
    APP_NAME="${PREFIX}-worker-${i}"
    echo -n "  Deleting ${APP_NAME}... "
    if databricks apps delete "$APP_NAME" 2>/dev/null; then
      echo -e "${GREEN}done${NC}"
    else
      echo -e "${YELLOW}not found${NC}"
    fi
  done
  echo -e "${GREEN}Cleanup complete.${NC}"
  exit 0
fi

# ---- Create & deploy workers ----
echo -e "${YELLOW}[2/4] Creating worker apps...${NC}"
DEPLOY_JSON="{\"git_source\": {\"branch\": \"${GIT_BRANCH}\", \"source_code_path\": \"${SOURCE_PATH}\"}}"

for i in $(seq 1 "$NUM_WORKERS"); do
  APP_NAME="${PREFIX}-worker-${i}"
  echo -e "  ${CYAN}--- Worker ${i}/${NUM_WORKERS}: ${APP_NAME} ---${NC}"

  # Check if app exists
  if databricks apps get "$APP_NAME" &>/dev/null 2>&1; then
    echo -e "    ${GREEN}✓${NC} App exists"
  else
    echo -n "    Creating app... "
    # Build resources JSON - always include model endpoints
    APP_RESOURCES='[
        {"name": "claude-sonnet-45", "serving_endpoint": {"name": "databricks-claude-sonnet-4-5", "permission": "CAN_QUERY"}},
        {"name": "claude-opus-46", "serving_endpoint": {"name": "databricks-claude-opus-4-6", "permission": "CAN_QUERY"}}'
    # Add Lakebase resource if configured
    if [ -n "$LAKEBASE_INSTANCE" ]; then
      APP_RESOURCES="${APP_RESOURCES},
        {\"name\": \"lakebase\", \"database\": {\"instance_name\": \"${LAKEBASE_INSTANCE}\", \"permission\": \"READ_WRITE\"}}"
    fi
    APP_RESOURCES="${APP_RESOURCES}]"

    databricks apps create "$APP_NAME" --json "{
      \"description\": \"Vibe Workshop Worker ${i}\",
      \"resources\": ${APP_RESOURCES}
    }" 2>&1 || {
      echo -e "${RED}failed${NC}"
      continue
    }
    echo -e "${GREEN}done${NC}"
  fi

  # Configure OAuth scopes for full workshop capabilities
  echo -n "    Setting OAuth scopes... "
  SCOPES='["sql","pipelines","jobs","workspace.files","serving-endpoints","iam.current-user:read","iam.access-control:read"]'
  databricks api patch "/api/2.0/apps/${APP_NAME}" \
    --json "{\"api_scopes\": ${SCOPES}}" 2>/dev/null \
    && echo -e "${GREEN}done${NC}" \
    || echo -e "${YELLOW}skipped (set scopes manually in app settings)${NC}"

  # Set Lakebase env var if configured
  if [ -n "$LAKEBASE_INSTANCE" ]; then
    echo -n "    Setting LAKEBASE_INSTANCE_NAME env var... "
    databricks api patch "/api/2.0/apps/${APP_NAME}" \
      --json "{\"env\": [{\"name\": \"LAKEBASE_INSTANCE_NAME\", \"value\": \"${LAKEBASE_INSTANCE}\"}, {\"name\": \"LAKEBASE_DATABASE_NAME\", \"value\": \"databricks_postgres\"}]}" 2>/dev/null \
      && echo -e "${GREEN}done${NC}" \
      || echo -e "${YELLOW}skipped (set env vars manually)${NC}"
  fi

  # Provision Claude API token using secret scope + app resource
  # (follows Databricks best practice: never expose raw secrets as env vars)
  if [ -n "$CLAUDE_TOKEN" ]; then
    # Create scope (idempotent) and store the token
    databricks secrets create-scope "$SECRET_SCOPE" 2>/dev/null || true
    databricks secrets put-secret "$SECRET_SCOPE" "$SECRET_KEY" \
      --string-value "$CLAUDE_TOKEN" 2>/dev/null

    # Add secret as an app resource named "claude-pat"
    echo -n "    Adding secret resource 'claude-pat'... "
    APP_JSON=$(databricks api get "/api/2.0/apps/${APP_NAME}" 2>/dev/null || echo "{}")
    UPDATED_RESOURCES=$(echo "$APP_JSON" | python3 -c "
import sys, json
app = json.load(sys.stdin)
resources = app.get('resources', [])
result = [r for r in resources if r.get('name') != 'claude-pat']
result.append({
    'name': 'claude-pat',
    'secret': {
        'scope': '${SECRET_SCOPE}',
        'key': '${SECRET_KEY}',
        'permission': 'READ'
    }
})
print(json.dumps(result))
" 2>/dev/null || echo "[]")

    if [ "$UPDATED_RESOURCES" != "[]" ]; then
      databricks api patch "/api/2.0/apps/${APP_NAME}" \
        --json "{\"resources\": ${UPDATED_RESOURCES}}" 2>/dev/null \
        && echo -e "${GREEN}done${NC}" \
        || echo -e "${YELLOW}failed (add manually)${NC}"
    else
      echo -e "${YELLOW}skipped (could not read app resources)${NC}"
    fi
  elif [ "$i" -eq 1 ]; then
    # Only warn once
    echo -e "    ${YELLOW}⚠ No --token provided. Set the secret manually:${NC}"
    echo "      databricks secrets create-scope ${SECRET_SCOPE}"
    echo "      databricks secrets put-secret ${SECRET_SCOPE} ${SECRET_KEY} --string-value <token>"
    echo "      Then add the secret resource 'claude-pat' to each app."
  fi

  # Deploy from git
  echo -n "    Deploying from git... "
  databricks apps deploy "$APP_NAME" --json "$DEPLOY_JSON" 2>&1 \
    && echo -e "${GREEN}done${NC}" \
    || echo -e "${RED}failed${NC}"
done

# ---- Collect URLs ----
echo ""
echo -e "${YELLOW}[3/4] Collecting app URLs...${NC}"
WORKER_URLS=""
for i in $(seq 1 "$NUM_WORKERS"); do
  APP_NAME="${PREFIX}-worker-${i}"
  URL=$(databricks apps get "$APP_NAME" --output json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))" 2>/dev/null \
    || echo "")
  if [ -n "$URL" ]; then
    echo -e "  Worker ${i}: ${GREEN}${URL}${NC}"
    if [ -n "$WORKER_URLS" ]; then
      WORKER_URLS="${WORKER_URLS},${URL}"
    else
      WORKER_URLS="${URL}"
    fi
  else
    echo -e "  Worker ${i}: ${YELLOW}URL not yet available${NC}"
  fi
done

# ---- Summary ----
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Workshop Deployment Complete!                  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Workers deployed: ${GREEN}${NUM_WORKERS}${NC}"
echo -e "  Max sessions:     ${GREEN}$(( NUM_WORKERS * MAX_SESSIONS_PER_WORKER ))${NC}"
echo ""
if [ -n "$WORKER_URLS" ]; then
  echo -e "  ${CYAN}Worker URLs (for hub VITE_BACKEND_URLS):${NC}"
  echo -e "  ${WORKER_URLS}"
fi
echo ""
echo "  Monitor:"
echo "    databricks apps logs ${PREFIX}-worker-1"
echo ""
echo "  Tear down:"
echo "    $0 --prefix ${PREFIX} --workers ${NUM_WORKERS} --destroy"
echo ""
