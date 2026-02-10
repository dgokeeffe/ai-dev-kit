#!/usr/bin/env python3
"""Grant Lakebase table permissions to the app's service principal.

Uses Databricks SDK to connect to Lakebase via OAuth and run GRANT statements.
Run with: uv run python scripts/grant_lakebase_permissions.py

Requires: databricks-sdk, psycopg[binary]
"""
import uuid
import sys
from pathlib import Path

# Add parent so we can import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

def main():
    from databricks.sdk import WorkspaceClient
    import psycopg

    # Config - matches app.yaml
    instance_name = "daveok"
    database = "databricks_postgres"
    service_principal_id = "1e02dfbd-e494-4329-8eb4-2c85373754f5"

    w = WorkspaceClient()
    host = w.database.get_database_instance(name=instance_name).read_write_dns
    user = w.current_user.me().user_name
    token = w.database.generate_database_credential(
        request_id=str(uuid.uuid4()),
        instance_names=[instance_name],
    ).token

    conninfo = f"host={host} dbname={database} user={user} password={token} sslmode=require"
    quoted_sp = f'"{service_principal_id}"'

    grants = [
        f'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {quoted_sp}',
        f'GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO {quoted_sp}',
        f'GRANT USAGE, CREATE ON SCHEMA public TO {quoted_sp}',
        f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO {quoted_sp}',
        f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO {quoted_sp}',
    ]

    print(f"Connecting as {user} to {instance_name} ({host})...")
    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            for sql in grants:
                print(f"  Running: {sql[:60]}...")
                cur.execute(sql)
        conn.commit()
    print("✓ Permissions granted successfully.")


if __name__ == "__main__":
    main()
