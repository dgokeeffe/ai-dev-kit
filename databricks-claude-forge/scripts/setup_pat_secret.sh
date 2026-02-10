#!/bin/bash
# Store a Databricks PAT in a secret scope for the Builder App.
#
# Use this when X-Forwarded-Access-Token is not forwarded by the app proxy
# and you need the PAT fallback (USE_PAT_FALLBACK=1) for debugging.
#
# Prerequisites:
#   - databricks auth login (or DATABRICKS_HOST, DATABRICKS_TOKEN in env)
#
# The bundle creates the scope (databricks bundle deploy). If you haven't deployed
# yet, this script will create the scope so you can store the PAT first.
#
# Usage:
#   ./scripts/setup_pat_secret.sh              # Prompts for PAT
#   DATABRICKS_TOKEN=dapi... ./scripts/setup_pat_secret.sh  # Use env var
#   echo "dapi..." | ./scripts/setup_pat_secret.sh          # From stdin
#
# After running, ensure app.yaml has:
#   - name: USE_PAT_FALLBACK
#     value: "1"
#   - name: DATABRICKS_TOKEN
#     valueFrom: databricks-token
# (The bundle already adds the secret resource; valueFrom references it.)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Default scope - must match databricks.yml var.pat_secret_scope
SCOPE="${PAT_SECRET_SCOPE:-builder-app-pat}"
KEY="databricks_token"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "PAT Secret Setup for Builder App"
echo "================================"
echo "Scope: $SCOPE"
echo "Key:   $KEY"
echo ""

# Get PAT: from env, stdin, or prompt
if [ -n "$DATABRICKS_TOKEN" ]; then
  PAT="$DATABRICKS_TOKEN"
  echo -e "${GREEN}Using PAT from DATABRICKS_TOKEN env var${NC}"
elif [ ! -t 0 ]; then
  read -r PAT
  echo -e "${GREEN}Using PAT from stdin${NC}"
else
  echo -e "${YELLOW}Enter your Databricks PAT (input hidden):${NC}"
  read -rs PAT
  echo ""
fi

if [ -z "$PAT" ]; then
  echo -e "${RED}Error: No PAT provided${NC}"
  exit 1
fi

# Create scope if it doesn't exist (bundle also creates it on first deploy)
if ! databricks secrets list-scopes --output json 2>/dev/null | grep -q "\"name\":\"$SCOPE\""; then
  echo "Creating secret scope $SCOPE..."
  databricks secrets create-scope "$SCOPE"
  echo -e "${GREEN}Scope created${NC}"
else
  echo -e "${GREEN}Scope $SCOPE exists${NC}"
fi

# Store the PAT
echo "Storing PAT in $SCOPE/$KEY..."
databricks secrets put-secret "$SCOPE" "$KEY" --string-value "$PAT"

echo ""
echo -e "${GREEN}✓ PAT stored successfully${NC}"
echo ""
echo "Next steps:"
echo "  1. In the app UI: Configure > Add resource > Secret"
echo "     Scope: $SCOPE, Key: $KEY, Resource key: databricks-token"
echo "  2. In app.yaml: uncomment USE_PAT_FALLBACK and DATABRICKS_TOKEN valueFrom"
echo "  3. Redeploy: databricks bundle deploy -t dev"
echo ""
echo "The app will use this PAT when X-Forwarded-Access-Token is missing."
echo "For production, fix proxy forwarding and remove USE_PAT_FALLBACK."
