---
name: databricks-app-git-deploy
description: "Deploy Databricks Apps using Git integration. Use when scaffolding, pushing, and deploying apps via git source."
---

# Databricks App Git Deployment

Deploy Databricks Apps directly from a Git repository — no file uploads needed.

## Quick Start

### 1. Scaffold an App

Use `dbx-new` to scaffold from a template:

```bash
dbx-new streamlit my-analytics-app
# or: dbx-new dash my-dashboard
# or: dbx-new flask my-api
```

This creates a project directory with `app.py`, `requirements.txt`, and `app.yaml`.

### 2. Initialize Git and Push

```bash
cd my-analytics-app
git init
git add .
git commit -m "Initial app scaffold"

# Create a GitHub repo and push
gh repo create my-analytics-app --public --source=. --push
# or push to an existing remote:
# git remote add origin https://github.com/<user>/<repo>.git
# git push -u origin main
```

### 3. Create the App (first time only)

```bash
databricks apps create my-analytics-app \
  --json '{
    "description": "My analytics dashboard",
    "resources": [
      {
        "name": "claude-sonnet",
        "serving_endpoint": {
          "name": "databricks-claude-sonnet-4-5",
          "permission": "CAN_QUERY"
        }
      }
    ]
  }'
```

### 4. Deploy from Git

```bash
databricks apps deploy my-analytics-app \
  --json '{
    "git_source": {
      "branch": "main",
      "provider": "gitHub",
      "url": "https://github.com/<user>/<repo>"
    }
  }'
```

If the app code is in a subdirectory of the repo, add `"source_code_path"`:

```bash
databricks apps deploy my-analytics-app \
  --json '{
    "git_source": {
      "branch": "main",
      "provider": "gitHub",
      "url": "https://github.com/<user>/<repo>",
      "source_code_path": "apps/my-analytics-app"
    }
  }'
```

### 5. Monitor Deployment

```bash
# Check app status
databricks apps get my-analytics-app

# View logs
databricks apps logs my-analytics-app

# Get the app URL
databricks apps get my-analytics-app --output json | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))"
```

## Common Patterns

### Iterative Development Loop

```bash
# Make changes → commit → push → deploy
git add . && git commit -m "Update dashboard" && git push
databricks apps deploy my-analytics-app --json '{"git_source": {"branch": "main"}}'
```

### App with Serving Endpoint Resources

Apps that call Foundation Model API need serving endpoint resources:

```yaml
# app.yaml
command:
  - streamlit
  - run
  - app.py
  - --server.port
  - $DATABRICKS_APP_PORT
  - --server.address
  - 0.0.0.0

env:
  - name: DATABRICKS_MODEL
    value: "databricks-claude-sonnet-4-5"
```

### App with SQL Warehouse

```bash
databricks apps create my-app --json '{
  "resources": [
    {
      "name": "sql-warehouse",
      "sql_warehouse": {
        "name": "<warehouse-id>",
        "permission": "CAN_USE"
      }
    }
  ]
}'
```

### App with Secrets

Never hardcode tokens. Use `secretKeyRef`:

```yaml
env:
  - name: MY_API_KEY
    valueFrom:
      secretKeyRef: my-api-key
```

Set the secret:

```bash
databricks apps set-secret my-analytics-app my-api-key "sk-..."
```

## Using dbx-deploy Helper

For quick deploys from the current directory (uses source upload, not git):

```bash
cd my-app
dbx-deploy my-analytics-app
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| App not starting | Check `databricks apps logs <name>` for errors |
| Port binding error | Ensure your app uses `$DATABRICKS_APP_PORT` |
| Git deploy says "no changes" | Ensure changes are pushed to the remote branch |
| Permission denied on serving endpoint | Add the endpoint as a resource in app config |
| App not updating after deploy | The app caches; wait 30s or check deployment status |

## Reference

- `databricks apps create <name>` - Create a new app
- `databricks apps deploy <name>` - Deploy (git or source)
- `databricks apps get <name>` - Get app details and URL
- `databricks apps logs <name>` - View app logs
- `databricks apps list` - List all apps
- `databricks apps delete <name>` - Delete an app
- `databricks apps set-secret <name> <key> <value>` - Set a secret
