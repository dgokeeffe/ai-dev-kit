---
name: databricks-dev
description: Guide for Databricks development using CLI, Databricks Connect, SDK and REST API.
---

# Databricks Development

- Use a recent Databricks CLI version, prompt for upgrade if lower than 0.278.0.
- Use existing virtual environment at `.venv` or use `uv` to create an environment that includes library `databricks-connect`.

## Configuration
- Default profile name: `DEFAULT`
- Config file location: `~/.databrickscfg`
- Environment variables: `DATABRICKS_HOST`, `DATABRICKS_TOKEN`

## Databricks Connect (alias: dbconnect)
Use Python library databricks.connect.
```python
from databricks.connect import DatabricksSession

# The DatabricksSession.builder.getOrCreate() method automatically uses 
# the 'DEFAULT' profile from your ~/.databrickscfg file.
spark = DatabricksSession.builder.getOrCreate()
```

* Note: Do not set spark master, this `.master("local[*]")` will cause issues.

## SDK Usage

### Preferred WorkspaceClient Authentication
```python
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
databricks_token = w.tokens.create(lifetime_seconds=360).token_value
```

This is the preferred method for getting a WorkspaceClient instance and generating a temporary token.

### Common SDK Patterns
- Use `WorkspaceClient()` for workspace operations
- Use `DatabricksSession` for Spark operations
- Configuration automatically loaded from environment or profile

## CLI Usage
- Use `databricks` CLI for automation and scripting
- Configuration via `~/.databrickscfg` or environment variables
- Profile-based authentication: `databricks --profile <profile-name>`

## REST API Usage
- Base URL: `https://<workspace-url>/api/2.0/` or `/api/2.1/`
- Authentication via Bearer token in headers: `Authorization: Bearer <token>`
- Prefer SDK over direct REST calls when possible
- Prefer to make REST API calls using `WorkspaceClient().api_client.do` for operations not yet available in SDK or that are overly complex (high risk of getting it wrong using SDK)

