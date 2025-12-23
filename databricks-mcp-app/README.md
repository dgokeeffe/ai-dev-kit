# Databricks Natural Language Builder

A production-ready FastAPI application that allows users to create and manage Databricks resources through natural language chat. Built on top of `databricks-mcp-core` and powered by Databricks Model Serving endpoints.

## Features

- **Natural Language Interface**: Create Unity Catalog resources, Spark pipelines, and synthetic data using plain English
- **Powered by Databricks Model Serving**: Uses Claude or OpenAI models via Databricks endpoints
- **Session Management**: Maintains conversation history for contextual interactions
- **Modern Chat UI**: Single-file Vue.js (CDN) + Tailwind CSS - no build pipeline required
- **Tool Calling**: Automatic conversion of MCP tools to OpenAI function calling format
- **Production Ready**: FastAPI backend with proper error handling and CORS support

## Supported Operations

### Unity Catalog (11 tools)
- List, get, create catalogs
- List, get, create, update, delete schemas
- List, get, create, delete tables

### Spark Declarative Pipelines (15 tools)
- Create, get, update, delete pipelines
- Start/stop pipeline updates
- Validate pipeline configuration
- Get pipeline events and status
- Workspace file operations (list, read, write, delete)

### Synthetic Data Generation (3 tools)
- Get data generation templates
- Write generation scripts to workspace
- Execute data generation on clusters

## Project Structure

```
databricks-mcp-app/
├── app.py                    # FastAPI entry point
├── app.yaml                  # Databricks App deployment config
├── requirements.txt          # Python dependencies
├── README.md                 # This file
├── static/
│   └── index.html           # Vue.js chat UI
├── llm/
│   ├── __init__.py
│   ├── client.py            # Databricks Model Serving client
│   └── orchestrator.py      # LLM + tool calling orchestration
└── tools/
    ├── __init__.py
    └── registry.py          # Tool definitions (OpenAI format)
```

## Setup

### Prerequisites

1. **Databricks Model Serving Endpoint**: You need a deployed model serving endpoint with Claude or OpenAI
2. **Databricks Authentication**: Configure Databricks SDK authentication
3. **Permissions**: Service principal with:
   - Query Model Serving endpoint
   - Unity Catalog CREATE privileges
   - Workspace file write access
   - Pipeline creation permissions

### Quick Test (No Auth Required)

Test the app locally without full Databricks authentication:

```bash
cd databricks-mcp-app
pip install -r requirements.txt
pip install -e ../databricks-mcp-core ../databricks-mcp-server

# Run tests and start app
python3 test_local.py
```

This will:

- Install dependencies
- Test all endpoints
- Start the app on <http://localhost:8080>
- Show you the UI is working

Note: LLM features require Databricks auth (see below).

### Local Development (Full Setup)

1. **Install dependencies**:
```bash
cd databricks-mcp-app
pip install -r requirements.txt

# Install databricks-mcp-core and server
pip install -e ../databricks-mcp-core
pip install -e ../databricks-mcp-server
```

2. **Configure environment**:
```bash
# Set your Databricks profile
export DATABRICKS_CONFIG_PROFILE=ffe

# Optionally override LLM endpoint name
export LLM_ENDPOINT=databricks-claude-sonnet-4-5
```

3. **Run locally**:
```bash
# Option 1: Quick start script
./start.sh

# Option 2: Direct Python
python app.py

# Option 3: Uvicorn with auto-reload
uvicorn app:app --reload --port 8080
```

4. **Access the app**:
Open [http://localhost:8080](http://localhost:8080)

### Deploy to Databricks

1. **Create Databricks App**:
```bash
databricks apps create databricks-builder
```

2. **Deploy**:
```bash
databricks apps deploy databricks-builder \
  --source-dir ./databricks-mcp-app
```

3. **Access**:
Your app will be available at: `https://<workspace>.databricksapps.com/<app-id>`

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_ENDPOINT` | Model Serving endpoint name | `databricks-claude-sonnet-4-5` |
| `DATABRICKS_CONFIG_PROFILE` | Auth profile for local dev | `ffe` |
| `DATABRICKS_APP_PORT` | Port to listen on | `8080` |

### Auto-Configured (Databricks App)

These are automatically set when deployed as a Databricks App:
- `DATABRICKS_HOST` - Workspace URL
- `DATABRICKS_TOKEN` - Service principal token

## API Endpoints

### Chat
- `POST /api/chat` - Send chat message
  ```json
  {
    "message": "Create a schema called dev in catalog main",
    "session_id": "optional-session-id"
  }
  ```

### Sessions
- `GET /api/sessions` - List all sessions
- `GET /api/sessions/{session_id}` - Get session info
- `DELETE /api/sessions/{session_id}` - Delete session

### System
- `GET /api/health` - Health check
- `GET /api/tools` - List available tools
- `GET /` - Chat UI

## Usage Examples

### Create Schema
```
User: Create a schema called dev in catalog main
Assistant: ✅ Schema created successfully!

📁 Schema: dev
   Full Name: main.dev
   Catalog: main
   Owner: user@example.com
```

### Create Table
```
User: Create a table called users in schema main.dev with columns id, name, email
Assistant: ✅ Table created successfully!

📊 Table: users
   Full Name: main.dev.users
   Columns (3):
     - id: INT
     - name: STRING
     - email: STRING
```

### Generate Synthetic Data
```
User: Generate 1000 rows of customer test data
Assistant: I'll create a synthetic data generation script and execute it.

✅ Synthetic Data Generation
Cluster: xxxx-xxxxxx-xxxxxxxx
Volume: /Volumes/main/dev/test_data
Duration: 12.34s
```

## Architecture

### Tool Calling Flow

1. **User Input** → FastAPI endpoint
2. **Session Management** → Load/create conversation history
3. **Orchestrator** → Send to LLM with tool definitions
4. **LLM Response** → Tool calls or final answer
5. **Tool Execution** → Call MCP handlers via `databricks-mcp-core`
6. **Result Formatting** → Convert MCP response to OpenAI format
7. **Loop** → Continue until LLM has final answer
8. **Return** → Update session and send response to UI

### MCP to OpenAI Format Conversion

The app converts MCP tool schemas to OpenAI function calling format:

**MCP Format** (from `databricks-mcp-server`):
```python
{
    "name": "create_schema",
    "description": "Create a new schema",
    "inputSchema": {
        "type": "object",
        "properties": {...}
    }
}
```

**OpenAI Format** (for Model Serving):
```python
{
    "type": "function",
    "function": {
        "name": "create_schema",
        "description": "Create a new schema",
        "parameters": {
            "type": "object",
            "properties": {...}
        }
    }
}
```

## Development

### Adding New Tools

1. Add tool definition to `databricks-mcp-server/tools/`
2. Implement handler in `databricks-mcp-core/`
3. Tools are automatically discovered via `get_tool_definitions()`

### Testing

```bash
# Test health endpoint
curl http://localhost:8080/api/health

# Test chat
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "List all catalogs"}'

# List available tools
curl http://localhost:8080/api/tools
```

## Troubleshooting

### LLM Client Not Initialized

**Error**: `LLM client not initialized`

**Solutions**:
1. Check that `DATABRICKS_CONFIG_PROFILE` is set correctly
2. Verify Model Serving endpoint exists and is accessible
3. Check server logs for detailed error messages

### Tool Execution Errors

**Error**: `Tool execution failed`

**Solutions**:
1. Verify permissions for Unity Catalog operations
2. Check that resources referenced exist (catalogs, schemas)
3. Review tool parameters in the error message

### Session Issues

**Error**: `Session not found`

**Note**: Sessions are stored in-memory. For production, consider:
- Redis for distributed session storage
- PostgreSQL for persistent history
- Databricks SQL for native integration

## Production Considerations

### Session Storage

Current implementation uses in-memory storage. For production:

```python
# Option 1: Redis
import redis
session_store = redis.Redis(host='localhost', port=6379)

# Option 2: PostgreSQL
from sqlalchemy import create_engine
engine = create_engine('postgresql://...')

# Option 3: Databricks SQL
from databricks.sql import connect
connection = connect(...)
```

### Security

1. **Rate Limiting**: Add rate limiting middleware
2. **Authentication**: Integrate with Databricks OAuth
3. **Input Validation**: Validate user input before processing
4. **CORS**: Configure CORS for production domains

### Monitoring

1. **Logging**: Add structured logging
2. **Metrics**: Track request counts, latency, errors
3. **Alerts**: Set up alerts for failures

## License

Copyright (2024) Databricks, Inc.

## Support

For issues and questions:
- File issues in the project repository
- Refer to Databricks documentation
- Contact your Databricks representative
