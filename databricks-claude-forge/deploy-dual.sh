#!/bin/bash
# deploy-dual.sh - Deploy dual-app architecture using git-based deployments
#
# Prerequisites:
#   1. Code pushed to git repository
#   2. Databricks Repo created at WORKSPACE_REPO_PATH synced from git
#
# Deploys:
#   - 2 backend instances (for PTY session distribution)
#   - 1 frontend instance (static files with backend routing)
#
# Usage:
#   ./deploy-dual.sh [app-prefix]
#
# Environment variables:
#   DATABRICKS_HOST      - Workspace URL (required)
#   APP_PREFIX           - Prefix for app names (default: "builder")
#   WORKSPACE_REPO_PATH  - Workspace path to synced repo (required)
#                          e.g., /Workspace/Repos/someone@example.com/ai-dev-kit/databricks-claude-forge
#
# The script will deploy:
#   - {prefix}-backend-1: First backend instance
#   - {prefix}-backend-2: Second backend instance
#   - {prefix}: Frontend (static files)

set -euo pipefail

# Configuration
APP_PREFIX="${1:-${APP_PREFIX:-builder}}"
WORKSPACE_HOST="${DATABRICKS_HOST:?DATABRICKS_HOST is required}"
WORKSPACE_REPO_PATH="${WORKSPACE_REPO_PATH:?WORKSPACE_REPO_PATH is required (e.g., /Workspace/Repos/user@example.com/repo/path)}"

# Strip protocol from workspace host for app URL construction
WORKSPACE_DOMAIN="${WORKSPACE_HOST#https://}"
WORKSPACE_DOMAIN="${WORKSPACE_DOMAIN#http://}"

echo "=== Dual-App Git-Based Deployment ==="
echo "Prefix:         ${APP_PREFIX}"
echo "Workspace:      ${WORKSPACE_HOST}"
echo "Repo Path:      ${WORKSPACE_REPO_PATH}"
echo ""

# Ensure apps exist (create if needed)
ensure_app_exists() {
    local app_name="$1"
    local description="$2"

    if ! databricks apps get "$app_name" &>/dev/null; then
        echo "Creating app: $app_name"
        databricks apps create "$app_name" --description "$description" --no-compute
    else
        echo "App exists: $app_name"
    fi
}

echo "=== Ensuring Apps Exist ==="
ensure_app_exists "${APP_PREFIX}-backend-1" "Backend instance 1 for high-concurrency deployment"
ensure_app_exists "${APP_PREFIX}-backend-2" "Backend instance 2 for high-concurrency deployment"
ensure_app_exists "${APP_PREFIX}" "Frontend for high-concurrency deployment"

# Deploy backend 1
echo ""
echo "=== Deploying Backend 1 (from git) ==="
databricks apps deploy "${APP_PREFIX}-backend-1" \
    --source-code-path "${WORKSPACE_REPO_PATH}" \
    --mode AUTO_SYNC

BACKEND_1_URL="https://${APP_PREFIX}-backend-1.${WORKSPACE_DOMAIN}"
echo "Backend 1 URL: ${BACKEND_1_URL}"

# Deploy backend 2
echo ""
echo "=== Deploying Backend 2 (from git) ==="
databricks apps deploy "${APP_PREFIX}-backend-2" \
    --source-code-path "${WORKSPACE_REPO_PATH}" \
    --mode AUTO_SYNC

BACKEND_2_URL="https://${APP_PREFIX}-backend-2.${WORKSPACE_DOMAIN}"
echo "Backend 2 URL: ${BACKEND_2_URL}"

# Deploy frontend
echo ""
echo "=== Deploying Frontend (from git) ==="
databricks apps deploy "${APP_PREFIX}" \
    --source-code-path "${WORKSPACE_REPO_PATH}" \
    --mode AUTO_SYNC

FRONTEND_URL="https://${APP_PREFIX}.${WORKSPACE_DOMAIN}"
echo "Frontend URL: ${FRONTEND_URL}"

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "URLs:"
echo "  Frontend:  ${FRONTEND_URL}"
echo "  Backend 1: ${BACKEND_1_URL}"
echo "  Backend 2: ${BACKEND_2_URL}"
echo ""
echo "Health endpoints:"
echo "  curl ${BACKEND_1_URL}/api/health"
echo "  curl ${BACKEND_2_URL}/api/health"
echo ""
echo "Note: Using AUTO_SYNC mode - apps will automatically update when git repo changes."
echo "      Users are automatically routed to backends based on email hash."
echo "      PTY sessions are local to each backend instance."
echo ""
echo "To update apps after git push:"
echo "  1. Push changes to git"
echo "  2. Sync Databricks Repo: databricks repos update ${WORKSPACE_REPO_PATH} --branch main"
echo "  3. Apps will auto-sync from the repo"
