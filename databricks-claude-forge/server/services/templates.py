"""Project templates for quick-start scaffolding.

Defines starter files and CLAUDE.md content for each template type.
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

TEMPLATES: dict[str, dict] = {
  'chatbot': {
    'files': {
      'app.py': """\
import os

from databricks.sdk import WorkspaceClient
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from openai import OpenAI
from pydantic import BaseModel

app = FastAPI()
w = WorkspaceClient()

client = OpenAI(
  api_key=w.config.token,
  base_url=f"{w.config.host}/serving-endpoints",
)

MODEL = os.getenv("DATABRICKS_MODEL", "databricks-meta-llama-3-3-70b-instruct")


class ChatRequest(BaseModel):
  message: str


@app.post("/chat")
async def chat(req: ChatRequest):
  response = client.chat.completions.create(
    model=MODEL,
    messages=[{"role": "user", "content": req.message}],
  )
  return {"response": response.choices[0].message.content}


@app.get("/")
async def root():
  return {"status": "running", "model": MODEL}
""",
      'requirements.txt': """\
fastapi
uvicorn
databricks-sdk
openai
""",
      'app.yaml': """\
command:
  - uvicorn
  - app:app
  - --host
  - 0.0.0.0
  - --port
  - "$DATABRICKS_APP_PORT"

env:
  - name: DATABRICKS_MODEL
    value: "databricks-meta-llama-3-3-70b-instruct"
""",
    },
    'claude_md': """\
# Chatbot project

## Architecture
- FastAPI backend using Databricks Foundation Model API
- OpenAI-compatible client via Databricks serving endpoints
- User auth provided by Databricks Apps (X-Forwarded headers)

## Key patterns
- Use `databricks-sdk` WorkspaceClient for auth
- Foundation Model API is OpenAI-compatible
- Available models: databricks-claude-sonnet-4-5, databricks-claude-opus-4-6
- For function calling, use the OpenAI tools/functions format

## Resources created
(none yet)
""",
  },
  'dashboard': {
    'files': {
      'app.py': """\
import os

import dash
import dash_mantine_components as dmc
import plotly.express as px
from dash import Input, Output, callback, dcc, html
from databricks import sql

app = dash.Dash(__name__)

WAREHOUSE_HTTP_PATH = os.getenv("DATABRICKS_WAREHOUSE_HTTP_PATH", "")
DATABRICKS_HOST = os.getenv("DATABRICKS_HOST", "")
DATABRICKS_TOKEN = os.getenv("DATABRICKS_TOKEN", "")


def query_data(query: str):
  with sql.connect(
    server_hostname=DATABRICKS_HOST.replace("https://", ""),
    http_path=WAREHOUSE_HTTP_PATH,
    access_token=DATABRICKS_TOKEN,
  ) as conn:
    with conn.cursor() as cursor:
      cursor.execute(query)
      columns = [desc[0] for desc in cursor.description]
      rows = cursor.fetchall()
      return [dict(zip(columns, row)) for row in rows]


app.layout = dmc.MantineProvider(
  html.Div([
    html.H1("Dashboard"),
    dcc.Graph(id="main-chart"),
  ])
)

server = app.server
""",
      'requirements.txt': """\
dash
dash-mantine-components
plotly
databricks-sql-connector
""",
      'app.yaml': """\
command:
  - gunicorn
  - app:server
  - --bind
  - "0.0.0.0:$DATABRICKS_APP_PORT"

env:
  - name: DATABRICKS_WAREHOUSE_HTTP_PATH
    value: ""
""",
    },
    'claude_md': """\
# Dashboard project

## Architecture
- Dash/Plotly app with Mantine components
- Databricks SQL connector for data queries
- Gunicorn for production serving

## Key patterns
- Use `databricks-sql-connector` for SQL warehouse queries
- Plotly Express for quick chart creation
- Dash callbacks for interactivity
- Mantine components for polished UI

## Resources created
(none yet)
""",
  },
  'internal-tool': {
    'files': {
      'app.py': """\
import os

import psycopg2
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI()

DATABASE_URL = os.getenv("DATABASE_URL", "")


def get_db():
  return psycopg2.connect(DATABASE_URL)


class Item(BaseModel):
  name: str
  description: str = ""


@app.get("/api/items")
async def list_items():
  with get_db() as conn:
    with conn.cursor() as cur:
      cur.execute("SELECT id, name, description FROM items ORDER BY id DESC")
      rows = cur.fetchall()
      return [{"id": r[0], "name": r[1], "description": r[2]} for r in rows]


@app.post("/api/items")
async def create_item(item: Item):
  with get_db() as conn:
    with conn.cursor() as cur:
      cur.execute(
        "INSERT INTO items (name, description) VALUES (%s, %s) RETURNING id",
        (item.name, item.description),
      )
      item_id = cur.fetchone()[0]
      conn.commit()
      return {"id": item_id, "name": item.name, "description": item.description}


@app.get("/", response_class=HTMLResponse)
async def root():
  return open("frontend/index.html").read()
""",
      'frontend/index.html': """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Internal Tool</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 p-8">
  <div class="max-w-2xl mx-auto">
    <h1 class="text-2xl font-bold mb-4">Internal Tool</h1>
    <div id="app">Loading...</div>
  </div>
  <script>
    async function loadItems() {
      const res = await fetch('/api/items');
      const items = await res.json();
      const app = document.getElementById('app');
      app.innerHTML = items.map(i =>
        '<div class="p-3 bg-white rounded shadow mb-2">' +
        '<strong>' + i.name + '</strong> - ' + i.description +
        '</div>'
      ).join('') || '<p class="text-gray-500">No items yet</p>';
    }
    loadItems();
  </script>
</body>
</html>
""",
      'requirements.txt': """\
fastapi
uvicorn
psycopg2-binary
""",
      'app.yaml': """\
command:
  - uvicorn
  - app:app
  - --host
  - 0.0.0.0
  - --port
  - "$DATABRICKS_APP_PORT"

env:
  - name: DATABASE_URL
    value: ""
""",
    },
    'claude_md': """\
# Internal tool project

## Architecture
- FastAPI backend with Lakebase (Postgres) database
- Simple HTML frontend (can upgrade to React)
- CRUD API pattern

## Key patterns
- Use Lakebase for persistent storage (Postgres-compatible)
- FastAPI for REST endpoints
- Databricks Apps auth via X-Forwarded headers
- psycopg2 for database connections

## Resources created
(none yet)
""",
  },
  'pipeline': {
    'files': {
      'pipeline.py': """\
import dlt
from pyspark.sql.functions import col, current_timestamp


@dlt.table(comment="Raw ingested data")
def bronze_raw():
  return (
    spark.readStream.format("cloudFiles")
    .option("cloudFiles.format", "csv")
    .option("cloudFiles.inferColumnTypes", "true")
    .load("/Volumes/catalog/schema/volume/raw/")
  )


@dlt.table(comment="Cleaned and validated data")
@dlt.expect_or_drop("valid_id", "id IS NOT NULL")
def silver_cleaned():
  return (
    dlt.read_stream("bronze_raw")
    .withColumn("processed_at", current_timestamp())
    .dropDuplicates(["id"])
  )


@dlt.table(comment="Aggregated business metrics")
def gold_metrics():
  return (
    dlt.read("silver_cleaned")
    .groupBy("category")
    .count()
  )
""",
      'config.yml': """\
# Pipeline configuration
pipeline:
  name: my-data-pipeline
  target_catalog: main
  target_schema: default

source:
  format: csv
  path: /Volumes/catalog/schema/volume/raw/
""",
      'README.md': """\
# Data pipeline

Bronze-silver-gold medallion architecture using Databricks DLT.

## Structure
- `pipeline.py` - DLT pipeline definitions
- `config.yml` - Pipeline configuration

## Deploy
Use the Databricks CLI or the deploy panel to create and run this pipeline.
""",
    },
    'claude_md': """\
# Data pipeline project

## Architecture
- Databricks DLT (Delta Live Tables) pipeline
- Medallion architecture: bronze -> silver -> gold
- Auto Loader for incremental ingestion

## Key patterns
- Use @dlt.table decorator for table definitions
- @dlt.expect for data quality constraints
- Auto Loader (cloudFiles) for streaming ingestion
- Target a Unity Catalog schema for output

## Resources created
(none yet)
""",
  },
  'databricks-app': {
    'files': {
      'app.py': """\
import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI()

@app.get("/api/health")
async def health():
  return {"status": "healthy"}

# Serve static frontend
app.mount("/", StaticFiles(directory="client/out", html=True), name="static")

if __name__ == "__main__":
  import uvicorn
  port = int(os.getenv("DATABRICKS_APP_PORT", "8000"))
  uvicorn.run(app, host="0.0.0.0", port=port)
""",
      'client/package.json': """\
{
  "name": "databricks-app-frontend",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
""",
      'client/vite.config.ts': """\
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'out' },
  server: {
    proxy: {
      '/api': 'http://localhost:8000'
    }
  }
})
""",
      'client/tsconfig.json': """\
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
""",
      'client/src/App.tsx': """\
import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Databricks App</h1>
      <p>Full-stack application running on Databricks Apps</p>
      <button onClick={() => setCount(c => c + 1)}>
        Count: {count}
      </button>
    </div>
  )
}

export default App
""",
      'client/src/main.tsx': """\
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
""",
      'client/index.html': """\
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Databricks App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
""",
      'requirements.txt': """\
fastapi>=0.104.0
uvicorn>=0.24.0
databricks-sdk>=0.39.0
""",
      'app.yaml': """\
command:
  - uvicorn
  - app:app
  - --host
  - 0.0.0.0
  - --port
  - $DATABRICKS_APP_PORT

env:
  - name: DATABRICKS_HOST
    value: ""
""",
      'package.json': """\
{
  "name": "my-databricks-app",
  "version": "1.0.0",
  "scripts": {
    "build": "cd client && npm install && npm run build"
  }
}
""",
      'README.md': """\
# Databricks App

Full-stack Databricks App with React frontend and FastAPI backend.

## Development

```bash
# Install backend dependencies
pip install -r requirements.txt

# Install frontend dependencies
cd client && npm install

# Run backend (in one terminal)
uvicorn app:app --reload

# Run frontend (in another terminal)
cd client && npm run dev
```

## Deploy

```bash
# Build frontend
cd client && npm run build

# Deploy to Databricks Apps
databricks apps deploy my-app --source-code-path .
```

## Architecture

```
React Frontend → FastAPI Backend → Databricks APIs
```

The frontend builds to `client/out/` and is served by FastAPI as static files.
""",
    },
    'claude_md': """\
# Databricks App Project

This is a full-stack Databricks App with:
- **Frontend**: React + Vite (builds to client/out/)
- **Backend**: FastAPI (serves API + static files)
- **Deploy**: Databricks Apps platform

## Architecture

```
React Frontend → FastAPI Backend → Databricks APIs
```

## Development Workflow

1. Edit frontend in `client/src/`
2. Edit backend in `app.py`
3. Use Claude terminal to test locally:
   - Backend: `uvicorn app:app --reload`
   - Frontend: `cd client && npm run dev`
4. Deploy when ready using deploy panel

## Key Patterns

- Frontend dev server proxies API requests to backend
- Production: FastAPI serves both API and static files
- Databricks Apps automatically runs `npm run build` during deployment
- Auth via X-Forwarded headers (in production) or env vars (dev)

## Resources

- Catalog: main
- Schema: default
- Tables: []
""",
  },
}


def write_template_files(project_dir: Path, template_id: str) -> None:
  """Write template starter files and CLAUDE.md to project directory.

  Args:
      project_dir: Path to the project directory
      template_id: Template identifier (chatbot, dashboard, etc.)
  """
  template = TEMPLATES.get(template_id)
  if not template:
    logger.warning(f'Unknown template: {template_id}')
    return

  # Write starter files
  for file_path, content in template['files'].items():
    full_path = project_dir / file_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    try:
      full_path.write_text(content)
      logger.debug(f'Wrote template file: {full_path}')
    except Exception as e:
      logger.warning(f'Failed to write template file {full_path}: {e}')

  # Write template-specific CLAUDE.md
  claude_md = template.get('claude_md', '')
  if claude_md:
    claude_md_path = project_dir / 'CLAUDE.md'
    try:
      claude_md_path.write_text(claude_md)
      logger.info(f'Wrote template CLAUDE.md in {project_dir}')
    except Exception as e:
      logger.warning(f'Failed to write CLAUDE.md: {e}')
