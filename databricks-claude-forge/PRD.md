# Databricks Builder App - Product Requirements Document

## Executive Summary

An in-browser IDE powered by Claude Code that runs as a Databricks App. Developers can build, test, and deploy Databricks applications with AI assistance directly in their browser.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Databricks App (Node.js)                     │
├──────────────────────────────────────┬──────────────────────────┤
│           React Frontend             │    Claude Code Terminal   │
│  ┌────────────┬─────────────────┐   │    (xterm.js + WebSocket) │
│  │   File     │   Code Editor   │   │                          │
│  │  Explorer  │   (CodeMirror)  │   │    > claude              │
│  │            │                 │   │    How can I help?       │
│  │  📁 src    │  app.py         │   │                          │
│  │  📁 tests  │  from fastapi.. │   │    > Create a FastAPI    │
│  │  📄 app.ya │                 │   │      app with SQL...     │
│  └────────────┴─────────────────┘   │                          │
├──────────────────────────────────────┴──────────────────────────┤
│  Express Backend (TypeScript)                                    │
│  ├── REST API: /api/projects, /api/files                        │
│  ├── WebSocket: /api/terminal (node-pty + Claude CLI)           │
│  └── Static file serving (React build)                          │
├─────────────────────────────────────────────────────────────────┤
│  Resources                                                       │
│  ├── Lakebase (PostgreSQL) - Project persistence                │
│  └── Foundation Models (anthropic endpoint) - Claude API        │
└─────────────────────────────────────────────────────────────────┘
```

## Why Node.js Backend

The Claude Code CLI is a Node.js application. Using a Node.js backend enables:
1. **Native integration** - No subprocess/PTY spawning issues
2. **Single runtime** - Simpler deployment and debugging
3. **node-pty** - Robust terminal emulation library
4. **Shared dependencies** - Claude CLI and backend use same Node.js

## Key Requirements

### Authentication
- **Databricks Apps** injects `X-Forwarded-User` and `X-Forwarded-Access-Token` headers
- **Workspace URL** must be derived (not from `X-Forwarded-Host` which is the app URL)
- **Foundation Model access** requires serving endpoint resource with `CAN_QUERY`

### App Resources (databricks.yml)
```yaml
resources:
  - name: lakebase
    database:
      instance_name: builder-app-db
      database_name: databricks_postgres
      permission: CAN_CONNECT_AND_CREATE
  - name: anthropic-gateway
    serving_endpoint:
      name: anthropic
      permission: CAN_QUERY
```

### Environment Variables for Claude
```bash
ANTHROPIC_AUTH_TOKEN=$X_FORWARDED_ACCESS_TOKEN
ANTHROPIC_BASE_URL=https://<workspace>/serving-endpoints/anthropic
ANTHROPIC_MODEL=databricks-claude-sonnet-4
```

---

# Implementation Tasks

Execute tasks sequentially. Test each before proceeding.

---

## Phase 1: Node.js Backend Setup

### Task 1.1: Initialize project structure

Create `server-node/` directory with package.json and tsconfig.json.

**Create `server-node/package.json`:**
```json
{
  "name": "databricks-builder-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/claude-code": "^1.0.0",
    "express": "^4.21.0",
    "ws": "^8.18.0",
    "node-pty": "^1.0.0",
    "pg": "^8.13.0",
    "dotenv": "^16.4.0",
    "uuid": "^10.0.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/ws": "^8.5.12",
    "@types/node": "^22.0.0",
    "@types/pg": "^8.11.0",
    "@types/uuid": "^10.0.0",
    "@types/cors": "^2.8.17",
    "typescript": "^5.6.0",
    "tsx": "^4.19.0"
  }
}
```

**Create `server-node/tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Verify:**
```bash
cd server-node && npm install && npm run typecheck
```

**Done when:** `npm install` succeeds, no TypeScript errors

---

### Task 1.2: Create Express server entry point

**Create `server-node/src/index.ts`:**
```typescript
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// User info endpoint
app.get('/api/me', (req, res) => {
  const user = req.headers['x-forwarded-user'] as string || 'dev-user@local';
  res.json({ email: user });
});

// Serve static files in production
const clientDir = path.join(__dirname, '../../client');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

const PORT = process.env.DATABRICKS_APP_PORT || process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { app, server };
```

**Verify:**
```bash
cd server-node && npm run dev &
curl http://localhost:8000/api/health
curl http://localhost:8000/api/me
```

**Done when:** Both endpoints return valid JSON

---

### Task 1.3: Implement projects API

**Create `server-node/src/routes/projects.ts`:**
```typescript
import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

const router = Router();
const PROJECTS_DIR = process.env.PROJECTS_DIR || './projects';

interface Project {
  id: string;
  name: string;
  user_email: string;
  created_at: string;
  updated_at: string;
}

// In-memory store (Phase 2 adds database)
const projects = new Map<string, Project>();

function getUserEmail(req: Request): string {
  return (req.headers['x-forwarded-user'] as string) || 'dev-user@local';
}

// List projects
router.get('/', async (req, res) => {
  const userEmail = getUserEmail(req);
  const userProjects = Array.from(projects.values())
    .filter(p => p.user_email === userEmail)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  res.json(userProjects);
});

// Create project
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    const userEmail = getUserEmail(req);
    const id = uuid();
    const projectDir = path.join(PROJECTS_DIR, id);

    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'CLAUDE.md'),
      `# ${name}\n\nProject created ${new Date().toISOString()}\n`
    );

    const project: Project = {
      id,
      name,
      user_email: userEmail,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    projects.set(id, project);
    res.status(201).json(project);
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Get project
router.get('/:id', async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });

  const userEmail = getUserEmail(req);
  if (project.user_email !== userEmail) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json(project);
});

// Delete project
router.delete('/:id', async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });

  const userEmail = getUserEmail(req);
  if (project.user_email !== userEmail) {
    return res.status(403).json({ error: 'Access denied' });
  }

  await fs.rm(path.join(PROJECTS_DIR, req.params.id), { recursive: true, force: true });
  projects.delete(req.params.id);
  res.status(204).send();
});

export default router;
```

**Add to index.ts:**
```typescript
import projectsRouter from './routes/projects.js';
app.use('/api/projects', projectsRouter);
```

**Verify:**
```bash
# Create
curl -X POST http://localhost:8000/api/projects -H "Content-Type: application/json" -d '{"name":"Test"}'
# List
curl http://localhost:8000/api/projects
```

**Done when:** Can create, list, get, and delete projects

---

### Task 1.4: Implement files API

**Create `server-node/src/routes/files.ts`:**
```typescript
import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();
const PROJECTS_DIR = process.env.PROJECTS_DIR || './projects';

function validatePath(projectId: string, filePath: string): string | null {
  const projectDir = path.resolve(PROJECTS_DIR, projectId);
  const fullPath = path.resolve(projectDir, filePath);
  return fullPath.startsWith(projectDir) ? fullPath : null;
}

async function buildFileTree(dir: string, relativePath = ''): Promise<any[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const skip = [/^\./, /^node_modules$/, /^__pycache__$/, /^\.venv$/, /^dist$/];
  const items: any[] = [];

  for (const entry of entries) {
    if (skip.some(p => p.test(entry.name))) continue;

    const relPath = path.join(relativePath, entry.name);
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      items.push({
        name: entry.name,
        path: relPath,
        type: 'directory',
        children: await buildFileTree(fullPath, relPath),
      });
    } else {
      items.push({ name: entry.name, path: relPath, type: 'file' });
    }
  }

  return items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// List files
router.get('/projects/:projectId/files', async (req, res) => {
  try {
    const projectDir = path.join(PROJECTS_DIR, req.params.projectId);
    await fs.access(projectDir);
    res.json({ files: await buildFileTree(projectDir) });
  } catch {
    res.status(404).json({ error: 'Project not found' });
  }
});

// Get file content
router.get('/projects/:projectId/files/*', async (req, res) => {
  const fullPath = validatePath(req.params.projectId, req.params[0] || '');
  if (!fullPath) return res.status(403).json({ error: 'Access denied' });

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    res.json({ content, path: req.params[0] });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

// Save file
router.put('/projects/:projectId/files/*', async (req, res) => {
  const fullPath = validatePath(req.params.projectId, req.params[0] || '');
  if (!fullPath) return res.status(403).json({ error: 'Access denied' });

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, req.body.content || '');
  res.json({ success: true });
});

// Create file
router.post('/projects/:projectId/files', async (req, res) => {
  const { path: filePath, content = '', type = 'file' } = req.body;
  const fullPath = validatePath(req.params.projectId, filePath);
  if (!fullPath) return res.status(403).json({ error: 'Access denied' });

  if (type === 'directory') {
    await fs.mkdir(fullPath, { recursive: true });
  } else {
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }
  res.status(201).json({ success: true });
});

// Delete file
router.delete('/projects/:projectId/files/*', async (req, res) => {
  const fullPath = validatePath(req.params.projectId, req.params[0] || '');
  if (!fullPath) return res.status(403).json({ error: 'Access denied' });

  await fs.rm(fullPath, { recursive: true });
  res.status(204).send();
});

export default router;
```

**Add to index.ts:**
```typescript
import filesRouter from './routes/files.js';
app.use('/api', filesRouter);
```

**Done when:** All file CRUD operations work

---

### Task 1.5: Implement Claude Code terminal

**Create `server-node/src/services/terminal.ts`:**
```typescript
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import path from 'path';
import { IncomingMessage } from 'http';

const PROJECTS_DIR = process.env.PROJECTS_DIR || './projects';

function getWorkspaceUrl(): string {
  // Priority: explicit env var > DATABRICKS_HOST > derive from app URL
  return process.env.DATABRICKS_WORKSPACE_URL
    || process.env.DATABRICKS_HOST
    || '';
}

export function setupTerminalWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const projectId = url.searchParams.get('projectId');

    if (!projectId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Project ID required' }));
      ws.close();
      return;
    }

    const projectDir = path.join(PROJECTS_DIR, projectId);
    const token = req.headers['x-forwarded-access-token'] as string;
    const workspaceUrl = getWorkspaceUrl();

    // Build environment for Claude
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TERM: 'xterm-256color',
    };

    if (workspaceUrl && token) {
      env.ANTHROPIC_AUTH_TOKEN = token;
      env.ANTHROPIC_BASE_URL = `${workspaceUrl.replace(/\/$/, '')}/serving-endpoints/anthropic`;
      env.ANTHROPIC_MODEL = process.env.DATABRICKS_CLAUDE_MODEL || 'databricks-claude-sonnet-4';
    }

    console.log(`Terminal: project=${projectId}, workspace=${workspaceUrl || 'not set'}, hasToken=${!!token}`);

    try {
      const shell = pty.spawn('claude', ['--dangerously-skip-permissions'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: projectDir,
        env,
      });

      ws.send(JSON.stringify({ type: 'connected', project_dir: projectDir }));

      shell.onData(data => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });

      shell.onExit(({ exitCode }) => {
        console.log(`Claude exited: ${exitCode}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
        }
      });

      ws.on('message', data => {
        const msg = data.toString();
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === 'resize') {
            shell.resize(parsed.cols, parsed.rows);
            return;
          }
        } catch {}
        shell.write(msg);
      });

      ws.on('close', () => {
        shell.kill();
      });

    } catch (error) {
      console.error('Terminal spawn error:', error);
      ws.send(JSON.stringify({ type: 'error', message: String(error) }));
      ws.close();
    }
  });
}
```

**Add to index.ts:**
```typescript
import { WebSocketServer } from 'ws';
import { setupTerminalWebSocket } from './services/terminal.js';

const wss = new WebSocketServer({ server, path: '/api/terminal' });
setupTerminalWebSocket(wss);
```

**Done when:** WebSocket connects and Claude CLI spawns

---

## Phase 2: Database Integration

### Task 2.1: Create database service

**Create `server-node/src/services/database.ts`:**
```typescript
import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.PGHOST,
      port: parseInt(process.env.PGPORT || '5432'),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export async function initDatabase(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        user_email VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_email);
    `);
    console.log('Database initialized');
  } finally {
    client.release();
  }
}
```

**Done when:** Tables created on startup

---

### Task 2.2: Wire projects to database

Update `server-node/src/routes/projects.ts` to use PostgreSQL:
- Replace Map with database queries
- Use `INSERT INTO projects` for create
- Use `SELECT * FROM projects WHERE user_email = $1` for list
- Use `DELETE FROM projects WHERE id = $1` for delete

**Done when:** Projects persist across server restarts

---

## Phase 3: Frontend Integration

### Task 3.1: Update WebSocket URL

**Edit `client/src/components/terminal/ClaudeTerminal.tsx`:**

Change:
```typescript
const wsUrl = `${protocol}//${window.location.host}/api/projects/${projectId}/claude-terminal`;
```

To:
```typescript
const wsUrl = `${protocol}//${window.location.host}/api/terminal?projectId=${projectId}`;
```

**Done when:** Frontend connects to new WebSocket endpoint

---

### Task 3.2: Verify API compatibility

Test all frontend API calls against new backend:
- `GET /api/me`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `DELETE /api/projects/:id`
- `GET /api/projects/:id/files`
- `GET /api/projects/:id/files/*`
- `PUT /api/projects/:id/files/*`
- `POST /api/projects/:id/files`
- `DELETE /api/projects/:id/files/*`

**Done when:** No 404/405 errors in browser console

---

## Phase 4: Deployment

### Task 4.1: Create app.yaml

**Create `app.yaml`:**
```yaml
command:
  - "node"
  - "dist/index.js"

env:
  - name: NODE_ENV
    value: "production"
  - name: PROJECTS_DIR
    value: "./projects"
  - name: DATABRICKS_WORKSPACE_URL
    valueFrom:
      servingEndpoint: anthropic-gateway
  - name: DATABRICKS_CLAUDE_MODEL
    value: "databricks-claude-sonnet-4"
```

**Done when:** app.yaml configured correctly

---

### Task 4.2: Create deploy script

**Create `scripts/deploy-node.sh`:**
```bash
#!/bin/bash
set -e

APP_NAME="${1:-databricks-builder-app}"

echo "=== Building ==="
cd server-node && npm ci && npm run build && cd ..
cd client && npm ci && npm run build && cd ..

echo "=== Staging ==="
STAGING=/tmp/${APP_NAME}-deploy
rm -rf "$STAGING" && mkdir -p "$STAGING"

cp -r server-node/dist "$STAGING/"
cp server-node/package.json server-node/package-lock.json "$STAGING/"
cp -r client/out "$STAGING/client/"
cp app.yaml "$STAGING/"

echo "=== Uploading ==="
USER=$(databricks current-user me --output json | python3 -c 'import sys,json; print(json.load(sys.stdin)["userName"])')
WORKSPACE_PATH="/Workspace/Users/${USER}/apps/${APP_NAME}"
databricks workspace import-dir "$STAGING" "$WORKSPACE_PATH" --overwrite

echo "=== Adding resources ==="
databricks api patch /api/2.0/apps/${APP_NAME} --json '{
  "resources": [
    {"name": "lakebase", "database": {"instance_name": "builder-app-db", "database_name": "databricks_postgres", "permission": "CAN_CONNECT_AND_CREATE"}},
    {"name": "anthropic-gateway", "serving_endpoint": {"name": "anthropic", "permission": "CAN_QUERY"}}
  ]
}'

echo "=== Deploying ==="
databricks apps deploy "$APP_NAME" --source-code-path "$WORKSPACE_PATH"

echo "=== Done ==="
databricks apps get "$APP_NAME" --output json | python3 -c 'import sys,json; print("URL:", json.load(sys.stdin).get("url"))'
```

**Done when:** Script deploys successfully

---

## Verification Checklist

When ALL pass, output: `<promise>DATABRICKS BUILDER IDE COMPLETE</promise>`

### Backend
- [ ] `npm run build` succeeds in server-node
- [ ] `npm run dev` starts server
- [ ] `GET /api/health` returns 200
- [ ] `GET /api/me` returns user email

### Projects
- [ ] Can create project via API
- [ ] Can list projects
- [ ] Can delete project
- [ ] Projects filtered by user

### Files
- [ ] File tree lists correctly
- [ ] Can read file content
- [ ] Can save file changes
- [ ] Can create new files
- [ ] Path traversal blocked

### Terminal
- [ ] WebSocket connects
- [ ] Claude CLI starts
- [ ] Can send input
- [ ] Can see output
- [ ] Resize works

### Deployment
- [ ] Deploys to Databricks
- [ ] App starts successfully
- [ ] Foundation Model API works (no 403)
- [ ] All features work in production
