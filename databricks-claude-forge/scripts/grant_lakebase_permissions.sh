#!/bin/bash
# Grant Lakebase permissions to Databricks App service principal
#
# Promotes the app's service principal to DATABRICKS_SUPERUSER on the Lakebase
# instance via the Lakebase API. This is the correct way to grant permissions -
# raw Postgres GRANT statements get revoked by Lakebase's ACL reconciliation.
#
# The DATABRICKS_SUPERUSER membership is managed at the Lakebase API level and
# persists across deployments, unlike table-level Postgres grants.
#
# Safe to run multiple times (idempotent).

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Arguments
APP_NAME="${1:-}"
LAKEBASE_INSTANCE="${2:-daveok}"

usage() {
  echo "Usage: $0 <app-name> [lakebase-instance]"
  echo ""
  echo "Grant the app's service principal DATABRICKS_SUPERUSER on a Lakebase instance."
  echo "This gives the SP full table access that persists across deployments."
  echo ""
  echo "Arguments:"
  echo "  app-name           Name of the Databricks App (required)"
  echo "  lakebase-instance  Lakebase instance name (default: daveok)"
  echo ""
  echo "Example:"
  echo "  $0 databricks-builder-app"
  echo "  $0 databricks-builder-app my-lakebase-instance"
}

if [ -z "$APP_NAME" ]; then
  echo -e "${RED}Error: App name is required${NC}"
  echo ""
  usage
  exit 1
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║    Grant Lakebase Permissions to App Service Principal     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  App Name:           ${GREEN}${APP_NAME}${NC}"
echo -e "  Lakebase Instance:  ${LAKEBASE_INSTANCE}"
echo ""

# Step 1: Get service principal ID
echo -e "${YELLOW}[1/2] Fetching app service principal...${NC}"
SERVICE_PRINCIPAL_ID=$(databricks apps get "$APP_NAME" --output json 2>/dev/null | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
sp = data.get('service_principal_client_id') or data.get('servicePrincipalClientId', '')
if not sp:
  sp = data.get('effective_service_principal_client_id', '')
print(sp)
" 2>/dev/null || echo "")

if [ -z "$SERVICE_PRINCIPAL_ID" ]; then
  echo -e "${YELLOW}Could not auto-detect service principal ID.${NC}"
  echo "Check: databricks apps get $APP_NAME -o json | jq -r .service_principal_client_id"
  echo ""
  read -p "Service Principal Client ID: " SERVICE_PRINCIPAL_ID
  if [ -z "$SERVICE_PRINCIPAL_ID" ]; then
    echo -e "${RED}Error: Service principal ID is required${NC}"
    exit 1
  fi
fi

echo -e "  Service Principal:  ${GREEN}${SERVICE_PRINCIPAL_ID}${NC}"
echo ""

# Step 2: Create role (if needed) and promote to DATABRICKS_SUPERUSER
echo -e "${YELLOW}[2/2] Ensuring role exists with DATABRICKS_SUPERUSER membership...${NC}"

python3 -c "
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
sp_id = '${SERVICE_PRINCIPAL_ID}'
instance = '${LAKEBASE_INSTANCE}'

# Try to get existing role first
try:
    role = w.database.get_database_instance_role(instance_name=instance, name=sp_id)
    current = role.as_dict()
    membership = current.get('membership_role')

    if membership == 'DATABRICKS_SUPERUSER':
        print(f'  SP already has DATABRICKS_SUPERUSER membership - no change needed')
    else:
        # Role exists but needs promotion
        resp = w.api_client.do(
            'PATCH',
            f'/api/2.0/database/instances/{instance}/roles/{sp_id}',
            body={'membership_role': 'DATABRICKS_SUPERUSER'},
        )
        new_membership = resp.get('membership_role', 'unknown')
        print(f'  Updated membership_role: {membership or \"(none)\"} -> {new_membership}')

except Exception as e:
    if 'does not exist' in str(e) or '404' in str(e) or 'NOT_FOUND' in str(e):
        # Role does not exist yet - create it
        print(f'  Role does not exist, creating with DATABRICKS_SUPERUSER...')
        resp = w.api_client.do(
            'POST',
            f'/api/2.0/database/instances/{instance}/roles',
            body={
                'name': sp_id,
                'identity_type': 'SERVICE_PRINCIPAL',
                'membership_role': 'DATABRICKS_SUPERUSER',
            },
        )
        new_membership = resp.get('membership_role', 'unknown')
        print(f'  Created role with membership_role: {new_membership}')
    else:
        raise
" 2>&1

if [ $? -eq 0 ]; then
  echo ""
  echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║              Permissions Granted Successfully!             ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "  The app's service principal (${SERVICE_PRINCIPAL_ID}) now has"
  echo "  DATABRICKS_SUPERUSER membership on Lakebase instance '${LAKEBASE_INSTANCE}'."
  echo ""
  echo "  This grants:"
  echo "    - Full access to all existing and future tables"
  echo "    - Managed at the Lakebase API level (persists across deployments)"
  echo "    - No need to re-run after each deployment"
  echo ""
else
  echo ""
  echo -e "${RED}Error updating instance role. Check the output above.${NC}"
  exit 1
fi
