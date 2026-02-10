#!/bin/bash
# End-to-end install script for git-backed Databricks Builder App deployment.
#
# This script chains together every step needed to go from zero to a running
# app deployed from a Git repository:
#
#   1. Validate prerequisites (CLI, auth, git)
#   2. Provision infrastructure via DABs (Lakebase + App with git_repository)
#   3. Generate a PAT token and store it as an app secret
#   4. Deploy the app from Git (platform builds frontend automatically)
#   5. Grant Lakebase permissions (create role + DATABRICKS_SUPERUSER)
#   6. Wait for the app to be healthy
#
# Usage:
#   ./scripts/install_git.sh <app-name> [options]
#
# Safe to re-run — each step is idempotent.

set -e

# ── Colors ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Script paths ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$PROJECT_DIR")"

# ── Defaults ─────────────────────────────────────────────────────────────
APP_NAME=""
GIT_REPO_URL=""
GIT_BRANCH=""
LAKEBASE_INSTANCE="builder-app-db"
BUNDLE_TARGET="dev"
SECRET_SCOPE="builder-app-pat"
SECRET_KEY="claude-api-token"
PAT_LIFETIME=7776000  # 90 days
SKIP_BUNDLE=false
SKIP_PAT=false

# ── Usage ────────────────────────────────────────────────────────────────
usage() {
  echo ""
  echo -e "${BOLD}Usage:${NC} $0 <app-name> [options]"
  echo ""
  echo "End-to-end install for a git-backed Databricks Builder App."
  echo ""
  echo -e "${BOLD}Arguments:${NC}"
  echo "  app-name                 Name for the Databricks App (required)"
  echo ""
  echo -e "${BOLD}Options:${NC}"
  echo "  --repo URL               Git repository URL (default: auto-detect from git remote)"
  echo "  --branch BRANCH          Git branch to deploy (default: current branch)"
  echo "  --lakebase NAME          Lakebase instance name (default: builder-app-db)"
  echo "  --target TARGET          DABs target: dev, existing, prod (default: dev)"
  echo "  --skip-bundle            Skip DABs deploy (app already exists)"
  echo "  --skip-pat               Skip PAT generation (already configured)"
  echo "  -h, --help               Show this help"
  echo ""
  echo -e "${BOLD}Examples:${NC}"
  echo "  $0 my-builder-app"
  echo "  $0 my-builder-app --repo https://github.com/me/ai-dev-kit --branch main"
  echo "  $0 my-builder-app --lakebase my-lakebase --skip-bundle"
  echo ""
}

# ── Parse arguments ──────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help)    usage; exit 0 ;;
    --repo)       GIT_REPO_URL="$2"; shift 2 ;;
    --branch)     GIT_BRANCH="$2"; shift 2 ;;
    --lakebase)   LAKEBASE_INSTANCE="$2"; shift 2 ;;
    --target)     BUNDLE_TARGET="$2"; shift 2 ;;
    --skip-bundle) SKIP_BUNDLE=true; shift ;;
    --skip-pat)   SKIP_PAT=true; shift ;;
    -*)           echo -e "${RED}Unknown option: $1${NC}"; usage; exit 1 ;;
    *)
      if [ -z "$APP_NAME" ]; then
        APP_NAME="$1"
      else
        echo -e "${RED}Unexpected argument: $1${NC}"; usage; exit 1
      fi
      shift ;;
  esac
done

if [ -z "$APP_NAME" ]; then
  echo -e "${RED}Error: App name is required${NC}"
  usage
  exit 1
fi

# ── Auto-detect defaults ─────────────────────────────────────────────────
cd "$REPO_ROOT"

if [ -z "$GIT_BRANCH" ]; then
  GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
fi

if [ -z "$GIT_REPO_URL" ]; then
  # Try origin, then fork
  for remote in origin fork upstream; do
    url=$(git remote get-url "$remote" 2>/dev/null || true)
    if [ -n "$url" ]; then
      # Convert SSH to HTTPS
      GIT_REPO_URL=$(echo "$url" | sed 's|git@github.com:|https://github.com/|' | sed 's|\.git$||')
      break
    fi
  done
fi

if [ -z "$GIT_REPO_URL" ]; then
  echo -e "${RED}Error: Could not detect git repo URL. Pass --repo <url>${NC}"
  exit 1
fi

# ── Banner ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      Databricks Builder App — Git Install                   ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  App Name:       ${GREEN}${APP_NAME}${NC}"
echo -e "  Git Repo:       ${CYAN}${GIT_REPO_URL}${NC}"
echo -e "  Branch:         ${GIT_BRANCH}"
echo -e "  Lakebase:       ${LAKEBASE_INSTANCE}"
echo -e "  Bundle Target:  ${BUNDLE_TARGET}"
echo ""

# ═════════════════════════════════════════════════════════════════════════
# Step 1: Prerequisites
# ═════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"

if ! command -v databricks &> /dev/null; then
  echo -e "${RED}  ✗ Databricks CLI not found. Install: pip install databricks-cli${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Databricks CLI installed"

if ! databricks auth describe &> /dev/null; then
  echo -e "${RED}  ✗ Not authenticated. Run: databricks auth login${NC}"
  exit 1
fi
WORKSPACE_HOST=$(databricks auth describe --output json 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('details',{}).get('host','') or d.get('host',''))" 2>/dev/null)
echo -e "  ${GREEN}✓${NC} Authenticated to ${WORKSPACE_HOST}"

if ! command -v python3 &> /dev/null; then
  echo -e "${RED}  ✗ python3 not found${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} python3 available"

# Check latest commit is pushed
LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null)
REMOTE_SHA=""
for remote in origin fork upstream; do
  REMOTE_SHA=$(git rev-parse "${remote}/${GIT_BRANCH}" 2>/dev/null || true)
  [ -n "$REMOTE_SHA" ] && break
done
if [ -n "$REMOTE_SHA" ] && [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo -e "${YELLOW}  ⚠ Local HEAD differs from remote/${GIT_BRANCH}${NC}"
  echo -e "    Push first: ${CYAN}git push${NC}"
  echo ""
  read -p "  Continue anyway? (y/N) " -n 1 -r
  echo
  [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi
echo ""

# ═════════════════════════════════════════════════════════════════════════
# Step 2: Provision infrastructure via DABs
# ═════════════════════════════════════════════════════════════════════════
if [ "$SKIP_BUNDLE" = true ]; then
  echo -e "${YELLOW}[2/6] Skipping bundle deploy (--skip-bundle)${NC}"
  echo ""
else
  echo -e "${YELLOW}[2/6] Deploying infrastructure via DABs...${NC}"
  cd "$PROJECT_DIR"

  # Check if Lakebase instance already exists — bind instead of recreate
  INSTANCE_EXISTS=$(databricks api get "/api/2.0/database/instances/${LAKEBASE_INSTANCE}" 2>/dev/null | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('name') else 'no')" 2>/dev/null || echo "no")

  if [ "$INSTANCE_EXISTS" = "yes" ]; then
    echo -e "  Lakebase instance '${LAKEBASE_INSTANCE}' exists — binding to bundle"

    # Clear stale state if the app was previously deleted
    STALE_STATE="$PROJECT_DIR/.databricks/bundle/${BUNDLE_TARGET}/terraform/terraform.tfstate"
    if [ -f "$STALE_STATE" ]; then
      APP_IN_STATE=$(python3 -c "
import json
with open('${STALE_STATE}') as f:
    state = json.load(f)
for r in state.get('resources', {}).get('databricks_app', {}).get('builder_app', {}).get('instances', []):
    name = r.get('attributes', {}).get('name', '')
    if name:
        print(name)
" 2>/dev/null || true)
      if [ -n "$APP_IN_STATE" ]; then
        # Verify the app still exists; if not, clear state
        if ! databricks apps get "$APP_IN_STATE" &>/dev/null 2>&1; then
          echo -e "  ${YELLOW}Clearing stale terraform state (app '${APP_IN_STATE}' was deleted)${NC}"
          rm -f "$STALE_STATE" "${STALE_STATE}.backup"
        fi
      fi
    fi

    databricks bundle deployment bind builder_db "$LAKEBASE_INSTANCE" \
      -t "$BUNDLE_TARGET" --auto-approve \
      --var="git_repo_url=${GIT_REPO_URL}" \
      --var="lakebase_instance_name=${LAKEBASE_INSTANCE}" \
      --var="app_name=${APP_NAME}" 2>&1 | sed 's/^/  /'
  fi

  echo "  Running: databricks bundle deploy -t ${BUNDLE_TARGET}"
  databricks bundle deploy -t "$BUNDLE_TARGET" \
    --var="git_repo_url=${GIT_REPO_URL}" \
    --var="lakebase_instance_name=${LAKEBASE_INSTANCE}" \
    --var="app_name=${APP_NAME}" \
    --auto-approve 2>&1 | sed 's/^/  /'

  echo -e "  ${GREEN}✓${NC} Infrastructure provisioned"
  echo ""
fi

# ═════════════════════════════════════════════════════════════════════════
# Step 3: Generate PAT and configure secret
# ═════════════════════════════════════════════════════════════════════════
if [ "$SKIP_PAT" = true ]; then
  echo -e "${YELLOW}[3/6] Skipping PAT generation (--skip-pat)${NC}"
  echo ""
else
  echo -e "${YELLOW}[3/6] Configuring Claude API token...${NC}"

  # Create secret scope (idempotent)
  databricks secrets create-scope "$SECRET_SCOPE" 2>/dev/null || true

  # Generate PAT
  TOKEN_VALUE=$(databricks tokens create \
    --comment "${APP_NAME} Claude API" \
    --lifetime-seconds "$PAT_LIFETIME" \
    --output json 2>/dev/null | \
    python3 -c "import sys,json; print(json.load(sys.stdin).get('token_value',''))" 2>/dev/null)

  if [ -z "$TOKEN_VALUE" ]; then
    echo -e "${YELLOW}  ⚠ Could not generate PAT (may already have max tokens)${NC}"
    echo "  Skipping — set the secret manually if needed:"
    echo "    databricks secrets put-secret ${SECRET_SCOPE} ${SECRET_KEY} --string-value <token>"
  else
    # Store in secret scope
    databricks secrets put-secret "$SECRET_SCOPE" "$SECRET_KEY" \
      --string-value "$TOKEN_VALUE" 2>/dev/null
    echo -e "  ${GREEN}✓${NC} PAT generated (90-day lifetime) and stored in scope '${SECRET_SCOPE}'"

    # Add secret as app resource
    APP_JSON=$(databricks api get "/api/2.0/apps/${APP_NAME}" 2>/dev/null)
    EXISTING_RESOURCES=$(echo "$APP_JSON" | python3 -c "
import sys, json
app = json.load(sys.stdin)
resources = app.get('resources', [])
# Keep existing resources, add/update claude-pat
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
" 2>/dev/null)

    databricks api patch "/api/2.0/apps/${APP_NAME}" \
      --json "{\"resources\": ${EXISTING_RESOURCES}}" 2>/dev/null
    echo -e "  ${GREEN}✓${NC} Secret resource 'claude-pat' added to app"
  fi
  echo ""
fi

# ═════════════════════════════════════════════════════════════════════════
# Step 4: Deploy from Git
# ═════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}[4/6] Deploying app from Git...${NC}"

# Ensure compute is active before deploying
COMPUTE_STATE=$(databricks api get "/api/2.0/apps/${APP_NAME}" 2>/dev/null | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('compute_status',{}).get('state','UNKNOWN'))" 2>/dev/null)

if [ "$COMPUTE_STATE" = "STOPPED" ]; then
  echo "  Starting app compute..."
  databricks apps start "$APP_NAME" --no-wait 2>/dev/null || true
  for i in $(seq 1 20); do
    sleep 15
    STATE=$(databricks api get "/api/2.0/apps/${APP_NAME}" 2>/dev/null | \
      python3 -c "import sys,json; print(json.load(sys.stdin).get('compute_status',{}).get('state','?'))" 2>/dev/null)
    echo -e "  Compute: ${STATE}"
    [ "$STATE" = "ACTIVE" ] && break
  done
fi

# Deploy from git
DEPLOY_JSON="{\"git_source\": {\"branch\": \"${GIT_BRANCH}\", \"source_code_path\": \"databricks-claude-forge\"}}"
echo "  Source: ${GIT_REPO_URL} @ ${GIT_BRANCH}"

DEPLOY_RESULT=$(databricks apps deploy "$APP_NAME" --json "$DEPLOY_JSON" --no-wait 2>&1)
if echo "$DEPLOY_RESULT" | grep -q "deployment_id"; then
  DEPLOY_ID=$(echo "$DEPLOY_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('deployment_id',''))" 2>/dev/null)
  COMMIT=$(echo "$DEPLOY_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('git_source',{}).get('resolved_commit','')[:12])" 2>/dev/null)
  echo -e "  ${GREEN}✓${NC} Deployment ${DEPLOY_ID} started (commit: ${COMMIT})"
else
  echo -e "${RED}  ✗ Deploy failed: ${DEPLOY_RESULT}${NC}"
  exit 1
fi
echo ""

# ═════════════════════════════════════════════════════════════════════════
# Step 5: Grant Lakebase permissions
# ═════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}[5/6] Granting Lakebase permissions...${NC}"

SERVICE_PRINCIPAL_ID=$(databricks apps get "$APP_NAME" --output json 2>/dev/null | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('service_principal_client_id',''))" 2>/dev/null)

if [ -n "$SERVICE_PRINCIPAL_ID" ]; then
  python3 -c "
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
sp_id = '${SERVICE_PRINCIPAL_ID}'
instance = '${LAKEBASE_INSTANCE}'

try:
    role = w.database.get_database_instance_role(instance_name=instance, name=sp_id)
    current = role.as_dict().get('membership_role')
    if current == 'DATABRICKS_SUPERUSER':
        print(f'  Already DATABRICKS_SUPERUSER — no change needed')
    else:
        w.api_client.do('PATCH', f'/api/2.0/database/instances/{instance}/roles/{sp_id}',
                        body={'membership_role': 'DATABRICKS_SUPERUSER'})
        print(f'  Promoted existing role to DATABRICKS_SUPERUSER')
except Exception as e:
    if 'does not exist' in str(e) or 'NOT_FOUND' in str(e):
        w.api_client.do('POST', f'/api/2.0/database/instances/{instance}/roles',
                        body={'name': sp_id, 'identity_type': 'SERVICE_PRINCIPAL',
                              'membership_role': 'DATABRICKS_SUPERUSER'})
        print(f'  Created role with DATABRICKS_SUPERUSER')
    else:
        raise
" 2>&1
  echo -e "  ${GREEN}✓${NC} SP ${SERVICE_PRINCIPAL_ID} has DATABRICKS_SUPERUSER on '${LAKEBASE_INSTANCE}'"
else
  echo -e "${YELLOW}  ⚠ Could not detect service principal — run grant_lakebase_permissions.sh manually${NC}"
fi
echo ""

# ═════════════════════════════════════════════════════════════════════════
# Step 6: Wait for healthy deployment
# ═════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}[6/6] Waiting for deployment to complete...${NC}"

MAX_WAIT=300  # 5 minutes
ELAPSED=0
INTERVAL=15

while [ $ELAPSED -lt $MAX_WAIT ]; do
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))

  STATUS=$(databricks api get "/api/2.0/apps/${APP_NAME}" 2>/dev/null | python3 -c "
import sys, json
app = json.load(sys.stdin)
app_state = app.get('app_status', {}).get('state', '?')
ad = app.get('active_deployment', {}) or app.get('pending_deployment', {})
deploy_state = ad.get('status', {}).get('state', '?') if ad else '?'
deploy_msg = ad.get('status', {}).get('message', '')[:80] if ad else ''
print(f'{app_state}|{deploy_state}|{deploy_msg}')
" 2>/dev/null)

  APP_STATE=$(echo "$STATUS" | cut -d'|' -f1)
  DEPLOY_STATE=$(echo "$STATUS" | cut -d'|' -f2)
  DEPLOY_MSG=$(echo "$STATUS" | cut -d'|' -f3)

  echo -e "  [${ELAPSED}s] App: ${APP_STATE} | Deploy: ${DEPLOY_STATE} — ${DEPLOY_MSG}"

  if [ "$DEPLOY_STATE" = "SUCCEEDED" ] && [ "$APP_STATE" = "RUNNING" ]; then
    break
  fi
  if [ "$DEPLOY_STATE" = "FAILED" ]; then
    echo ""
    echo -e "${RED}  ✗ Deployment failed. Check logs:${NC}"
    echo "    databricks apps logs ${APP_NAME}"
    exit 1
  fi
done

# ═════════════════════════════════════════════════════════════════════════
# Done
# ═════════════════════════════════════════════════════════════════════════
APP_URL=$(databricks apps get "$APP_NAME" --output json 2>/dev/null | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('url','N/A'))" 2>/dev/null)

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Install Complete!                               ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  App URL:    ${GREEN}${APP_URL}${NC}"
echo -e "  App Name:   ${APP_NAME}"
echo -e "  Branch:     ${GIT_BRANCH}"
echo -e "  Lakebase:   ${LAKEBASE_INSTANCE}"
echo ""
echo -e "  ${BOLD}Redeploy after code changes:${NC}"
echo "    git push && databricks apps deploy ${APP_NAME} \\"
echo "      --json '{\"git_source\": {\"branch\": \"${GIT_BRANCH}\", \"source_code_path\": \"databricks-claude-forge\"}}'"
echo ""
echo -e "  ${BOLD}View logs:${NC}"
echo "    databricks apps logs ${APP_NAME}"
echo ""
