export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  starterFiles: Record<string, string>;
  claudeMd: string;
  suggestedPrompts: string[];
  skills: string[];
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'chatbot',
    name: 'Chatbot / AI agent',
    description: 'Build a conversational AI agent with Databricks Foundation Models',
    icon: 'MessageSquare',
    color: 'border-l-purple-500',
    starterFiles: {
      'app.py': `import os

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
`,
      'requirements.txt': `fastapi
uvicorn
databricks-sdk
openai
`,
      'app.yaml': `command:
  - uvicorn
  - app:app
  - --host
  - 0.0.0.0
  - --port
  - "$DATABRICKS_APP_PORT"

env:
  - name: DATABRICKS_MODEL
    value: "databricks-meta-llama-3-3-70b-instruct"
`,
    },
    claudeMd: `# Chatbot project

## Architecture
- FastAPI backend using Databricks Foundation Model API
- OpenAI-compatible client via Databricks serving endpoints
- User auth provided by Databricks Apps (X-Forwarded headers)

## Key patterns
- Use \`databricks-sdk\` WorkspaceClient for auth
- Foundation Model API is OpenAI-compatible
- Available models: databricks-meta-llama-3-3-70b-instruct, databricks-claude-sonnet-4
- For function calling, use the OpenAI tools/functions format

## Resources created
(none yet)
`,
    suggestedPrompts: [
      'Add a knowledge base from Unity Catalog tables',
      'Add function calling to query sales data',
      'Deploy this chatbot as a Databricks App',
    ],
    skills: ['agent-bricks', 'databricks-app-python', 'databricks-unity-catalog'],
  },
  {
    id: 'dashboard',
    name: 'Dashboard app',
    description: 'Create an interactive data dashboard with charts and filters',
    icon: 'BarChart3',
    color: 'border-l-blue-500',
    starterFiles: {
      'app.py': `import os

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
`,
      'requirements.txt': `dash
dash-mantine-components
plotly
databricks-sql-connector
`,
      'app.yaml': `command:
  - gunicorn
  - app:server
  - --bind
  - "0.0.0.0:$DATABRICKS_APP_PORT"

env:
  - name: DATABRICKS_WAREHOUSE_HTTP_PATH
    value: ""
`,
    },
    claudeMd: `# Dashboard project

## Architecture
- Dash/Plotly app with Mantine components
- Databricks SQL connector for data queries
- Gunicorn for production serving

## Key patterns
- Use \`databricks-sql-connector\` for SQL warehouse queries
- Plotly Express for quick chart creation
- Dash callbacks for interactivity
- Mantine components for polished UI

## Resources created
(none yet)
`,
    suggestedPrompts: [
      'Connect to my sales table and show revenue trends',
      'Add date range filters and product category breakdown',
      'Add a SQL-powered search across inventory',
    ],
    skills: ['aibi-dashboards', 'databricks-unity-catalog', 'databricks-app-python'],
  },
  {
    id: 'internal-tool',
    name: 'Internal tool',
    description: 'Build a full-stack internal tool with database and auth',
    icon: 'Wrench',
    color: 'border-l-green-500',
    starterFiles: {
      'app.py': `import os

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
`,
      'frontend/index.html': `<!DOCTYPE html>
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
    // Simple vanilla JS app - replace with React if needed
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
`,
      'requirements.txt': `fastapi
uvicorn
psycopg2-binary
`,
      'app.yaml': `command:
  - uvicorn
  - app:app
  - --host
  - 0.0.0.0
  - --port
  - "$DATABRICKS_APP_PORT"

env:
  - name: DATABASE_URL
    value: ""
`,
    },
    claudeMd: `# Internal tool project

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
`,
    suggestedPrompts: [
      'Add a data entry form that saves to Lakebase',
      'Build an approval workflow with status tracking',
      'Add role-based access control',
    ],
    skills: ['databricks-app-python', 'databricks-unity-catalog', 'databricks-config'],
  },
  {
    id: 'pipeline',
    name: 'Data pipeline',
    description: 'Build and orchestrate Spark data pipelines',
    icon: 'GitBranch',
    color: 'border-l-orange-500',
    starterFiles: {
      'pipeline.py': `import dlt
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
`,
      'config.yml': `# Pipeline configuration
pipeline:
  name: my-data-pipeline
  target_catalog: main
  target_schema: default

source:
  format: csv
  path: /Volumes/catalog/schema/volume/raw/
`,
      'README.md': `# Data pipeline

Bronze-silver-gold medallion architecture using Databricks DLT.

## Structure
- \`pipeline.py\` - DLT pipeline definitions
- \`config.yml\` - Pipeline configuration

## Deploy
Use the Databricks CLI or the deploy panel to create and run this pipeline.
`,
    },
    claudeMd: `# Data pipeline project

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
`,
    suggestedPrompts: [
      'Create a bronze-silver-gold pipeline for CSV ingestion',
      'Add data quality expectations and quarantine',
      'Schedule this pipeline to run hourly',
    ],
    skills: ['spark-declarative-pipelines', 'databricks-jobs', 'databricks-unity-catalog'],
  },
  {
    id: 'blank',
    name: 'Blank project',
    description: 'Start from scratch with a blank workspace',
    icon: 'File',
    color: 'border-l-gray-500',
    starterFiles: {},
    claudeMd: '',
    suggestedPrompts: [
      'Help me build an app on Databricks',
      'What can I build with Databricks?',
    ],
    skills: [],
  },
];

export function getTemplate(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}
