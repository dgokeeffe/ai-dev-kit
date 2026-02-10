# Task: Build Databricks Builder IDE with Claude Code

## Overview

Build an in-browser IDE that runs as a Databricks App with full Claude Code terminal integration. The app enables developers to build, test, and deploy Databricks applications with AI assistance.

## Architecture Decision

**Use Node.js for the entire backend** because:
1. Claude Code CLI is a Node.js application - native integration
2. No PTY/subprocess spawning issues
3. Databricks SDK for JavaScript works well
4. Single runtime simplifies deployment

```
┌─────────────────────────────────────────────────────────────┐
│                    Databricks App (Node.js)                  │
├─────────────────────────────────────────────────────────────┤
│  Frontend: React + Vite + TypeScript                        │
│  - CodeMirror 6 editor                                      │
│  - xterm.js terminal                                        │
│  - Tailwind CSS                                             │
├─────────────────────────────────────────────────────────────┤
│  Backend: Express/Fastify + TypeScript                      │
│  - Claude Code CLI integration (native Node.js)             │
│  - WebSocket for terminal streaming                         │
│  - Databricks SDK (JavaScript)                              │
│  - PostgreSQL (Lakebase) for persistence                    │
└─────────────────────────────────────────────────────────────┘
```

## Current State

The existing Python/React app has:
- ✅ Working React frontend with IDE layout
- ✅ CodeMirror editor with multi-tab support
- ✅ xterm.js terminal component
- ✅ File explorer with CRUD operations
- ❌ Claude Code terminal not working (Python can't spawn Node CLI properly)
- ❌ Project creation broken
- ⚠️ Mixed Python/Node architecture causing issues

## Target State

A fully functional IDE where:
1. Users can create/open projects
2. Claude Code terminal works in the browser
3. Files can be edited with syntax highlighting
4. Databricks operations work (SQL, clusters, deployments)

---

## Phase 1: Node.js Backend Foundation

### Task 1.1: Initialize Node.js backend
**File:** `server-node/package.json`

Create a new Node.js backend alongside the existing Python one.

```json
{
  "name": "databricks-builder-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@anthropic-ai/claude-code": "^1.0.0",
    "@databricks/sql": "^1.0.0",
    "express": "^4.18.0",
    "ws": "^8.16.0",
    "node-pty": "^1.0.0",
    "pg": "^8.11.0",
    "dotenv": "^16.0.0",
    "uuid": "^9.0.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/ws": "^8.5.0",
    "@types/node": "^20.0.0",
    "@types/pg": "^8.10.0",
    "@types/uuid": "^9.0.0",
    "@types/cors": "^2.8.0",
    "typescript": "^5.3.0",
    "tsx": "^4.7.0"
  }
}
```

**Completion criteria:**
- [ ] `server-node/package.json` exists with all dependencies
- [ ] `npm install` succeeds in `server-node/`
- [ ] TypeScript compiles without errors

### Task 1.2: Create Express server with basic routes
**File:** `server-node/src/index.ts`

```typescript
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from 'dotenv';

config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/api/terminal' });

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Projects API placeholder
app.get('/api/projects', (req, res) => {
  res.json({ projects: [] });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

**Completion criteria:**
- [ ] Server starts without errors
- [ ] `GET /api/health` returns 200
- [ ] WebSocket server initializes

### Task 1.3: Implement Claude Code terminal WebSocket
**File:** `server-node/src/terminal.ts`

Use `node-pty` to spawn Claude Code CLI and stream to WebSocket.

```typescript
import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import * as path from 'path';

interface TerminalSession {
  pty: pty.IPty;
  projectDir: string;
}

const sessions = new Map<string, TerminalSession>();

export function createTerminalSession(
  ws: WebSocket,
  projectId: string,
  projectDir: string,
  env: Record<string, string>
): void {
  // Spawn Claude Code CLI
  const shell = pty.spawn('claude', ['--dangerously-skip-permissions'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: projectDir,
    env: {
      ...process.env,
      ...env,
      TERM: 'xterm-256color',
    },
  });

  sessions.set(projectId, { pty: shell, projectDir });

  // PTY -> WebSocket
  shell.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // WebSocket -> PTY
  ws.on('message', (data) => {
    const message = data.toString();
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'resize') {
        shell.resize(parsed.cols, parsed.rows);
      } else if (parsed.type === 'input') {
        shell.write(parsed.data);
      }
    } catch {
      // Raw input
      shell.write(message);
    }
  });

  ws.on('close', () => {
    shell.kill();
    sessions.delete(projectId);
  });
}
```

**Completion criteria:**
- [ ] WebSocket connection accepted
- [ ] Claude Code CLI spawns via node-pty
- [ ] Terminal input/output streams bidirectionally
- [ ] Terminal resize works
- [ ] Session cleanup on disconnect

### Task 1.4: Implement projects API
**File:** `server-node/src/routes/projects.ts`

```typescript
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';

const router = Router();
const PROJECTS_DIR = process.env.PROJECTS_DIR || './projects';

interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

// List projects
router.get('/', async (req, res) => {
  // TODO: Filter by user from X-Forwarded-User header
  const userEmail = req.headers['x-forwarded-user'] as string || 'dev-user';
  // Query from database
  res.json({ projects: [] });
});

// Create project
router.post('/', async (req, res) => {
  const { name } = req.body;
  const id = uuid();
  const projectDir = path.join(PROJECTS_DIR, id);

  await fs.mkdir(projectDir, { recursive: true });

  // Create default CLAUDE.md
  await fs.writeFile(
    path.join(projectDir, 'CLAUDE.md'),
    `# ${name}\n\nProject created ${new Date().toISOString()}\n`
  );

  const project: Project = {
    id,
    name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // TODO: Save to database
  res.status(201).json(project);
});

// Get project
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  // TODO: Fetch from database
  res.json({ id, name: 'Test Project' });
});

// Delete project
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const projectDir = path.join(PROJECTS_DIR, id);
  await fs.rm(projectDir, { recursive: true, force: true });
  // TODO: Delete from database
  res.status(204).send();
});

export default router;
```

**Completion criteria:**
- [ ] `POST /api/projects` creates project directory
- [ ] `GET /api/projects` lists projects
- [ ] `GET /api/projects/:id` returns project
- [ ] `DELETE /api/projects/:id` removes project

### Task 1.5: Implement files API
**File:** `server-node/src/routes/files.ts`

```typescript
import { Router } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';

const router = Router();
const PROJECTS_DIR = process.env.PROJECTS_DIR || './projects';

// List files in project
router.get('/:projectId/files', async (req, res) => {
  const { projectId } = req.params;
  const projectDir = path.join(PROJECTS_DIR, projectId);

  async function buildTree(dir: string, relativePath = ''): Promise<any[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      // Skip hidden files and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        items.push({
          name: entry.name,
          path: relPath,
          type: 'directory',
          children: await buildTree(fullPath, relPath),
        });
      } else {
        items.push({
          name: entry.name,
          path: relPath,
          type: 'file',
        });
      }
    }

    return items;
  }

  const tree = await buildTree(projectDir);
  res.json({ files: tree });
});

// Get file content
router.get('/:projectId/files/*', async (req, res) => {
  const { projectId } = req.params;
  const filePath = req.params[0];
  const fullPath = path.join(PROJECTS_DIR, projectId, filePath);

  // Security: prevent path traversal
  if (!fullPath.startsWith(path.join(PROJECTS_DIR, projectId))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const content = await fs.readFile(fullPath, 'utf-8');
  res.json({ content });
});

// Save file content
router.put('/:projectId/files/*', async (req, res) => {
  const { projectId } = req.params;
  const filePath = req.params[0];
  const { content } = req.body;
  const fullPath = path.join(PROJECTS_DIR, projectId, filePath);

  // Security: prevent path traversal
  if (!fullPath.startsWith(path.join(PROJECTS_DIR, projectId))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);
  res.json({ success: true });
});

// Create file
router.post('/:projectId/files', async (req, res) => {
  const { projectId } = req.params;
  const { path: filePath, content = '' } = req.body;
  const fullPath = path.join(PROJECTS_DIR, projectId, filePath);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);
  res.status(201).json({ success: true });
});

// Delete file
router.delete('/:projectId/files/*', async (req, res) => {
  const { projectId } = req.params;
  const filePath = req.params[0];
  const fullPath = path.join(PROJECTS_DIR, projectId, filePath);

  await fs.rm(fullPath, { recursive: true });
  res.status(204).send();
});

export default router;
```

**Completion criteria:**
- [ ] `GET /api/projects/:id/files` returns file tree
- [ ] `GET /api/projects/:id/files/*` returns file content
- [ ] `PUT /api/projects/:id/files/*` saves file content
- [ ] `POST /api/projects/:id/files` creates new file
- [ ] `DELETE /api/projects/:id/files/*` deletes file
- [ ] Path traversal attacks are prevented

---

## Phase 2: Database Integration

### Task 2.1: Set up PostgreSQL connection
**File:** `server-node/src/db.ts`

```typescript
import { Pool } from 'pg';

// Lakebase connection (Databricks Apps injects PG* env vars)
export const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

export async function initDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      user_email VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_email)
  `);
}
```

**Completion criteria:**
- [ ] Database connection works
- [ ] Tables created on startup
- [ ] Connection handles Lakebase OAuth tokens

### Task 2.2: Integrate database with projects API
**File:** Update `server-node/src/routes/projects.ts`

Wire up the projects API to use PostgreSQL instead of in-memory storage.

**Completion criteria:**
- [ ] Projects saved to database
- [ ] Projects filtered by user_email
- [ ] CRUD operations persist

---

## Phase 3: Databricks Integration

### Task 3.1: Add Databricks authentication
**File:** `server-node/src/middleware/auth.ts`

```typescript
import { Request, Response, NextFunction } from 'express';

export interface DatabricksAuth {
  host: string;
  token: string;
  userEmail: string;
}

declare global {
  namespace Express {
    interface Request {
      databricks?: DatabricksAuth;
    }
  }
}

export function databricksAuth(req: Request, res: Response, next: NextFunction) {
  // Production: headers from Databricks Apps proxy
  const host = req.headers['x-forwarded-host'] as string;
  const token = req.headers['x-forwarded-access-token'] as string;
  const userEmail = req.headers['x-forwarded-user'] as string;

  if (host && token) {
    req.databricks = {
      host: host.startsWith('http') ? host : `https://${host}`,
      token,
      userEmail: userEmail || 'unknown',
    };
  } else if (process.env.DATABRICKS_HOST && process.env.DATABRICKS_TOKEN) {
    // Development fallback
    req.databricks = {
      host: process.env.DATABRICKS_HOST,
      token: process.env.DATABRICKS_TOKEN,
      userEmail: 'dev-user@local',
    };
  }

  next();
}
```

**Completion criteria:**
- [ ] Production auth extracts from headers
- [ ] Development auth uses env vars
- [ ] Auth available on all routes

### Task 3.2: Pass auth to Claude Code terminal
**File:** Update `server-node/src/terminal.ts`

Configure Claude Code to use Databricks Foundation Model API.

```typescript
const claudeEnv = {
  ANTHROPIC_AUTH_TOKEN: auth.token,
  ANTHROPIC_BASE_URL: `${auth.host}/serving-endpoints/anthropic`,
  ANTHROPIC_MODEL: 'databricks-claude-sonnet-4',
};
```

**Completion criteria:**
- [ ] Claude Code uses Databricks token
- [ ] Foundation Model API endpoint configured
- [ ] Model name set correctly

---

## Phase 4: Frontend Updates

### Task 4.1: Update API client for new backend
**File:** `client/src/lib/api.ts`

Ensure the React frontend works with the new Node.js backend (API should be compatible).

**Completion criteria:**
- [ ] All API calls work
- [ ] WebSocket connects to new endpoint
- [ ] Error handling works

### Task 4.2: Fix project creation UI
**File:** `client/src/pages/HomePage.tsx`

Debug and fix the project creation flow.

**Completion criteria:**
- [ ] Create Project button works
- [ ] Project appears in list after creation
- [ ] Navigation to project works

---

## Phase 5: Deployment

### Task 5.1: Create app.yaml for Node.js
**File:** `app.yaml`

```yaml
command:
  - "node"
  - "dist/index.js"

env:
  - name: NODE_ENV
    value: "production"
  - name: PORT
    value: "$DATABRICKS_APP_PORT"
  - name: PROJECTS_DIR
    value: "./projects"
```

**Completion criteria:**
- [ ] App deploys successfully
- [ ] Server starts on correct port
- [ ] Static files served

### Task 5.2: Create deploy script
**File:** `scripts/deploy-node.sh`

```bash
#!/bin/bash
set -e

# Build frontend
cd client && npm run build && cd ..

# Build backend
cd server-node && npm run build && cd ..

# Copy to staging
STAGING=/tmp/builder-deploy
rm -rf $STAGING
mkdir -p $STAGING

cp -r server-node/dist $STAGING/
cp -r server-node/node_modules $STAGING/
cp -r client/out $STAGING/client/
cp app.yaml $STAGING/
cp server-node/package.json $STAGING/

# Deploy
databricks apps deploy $APP_NAME --source-code-path ...
```

**Completion criteria:**
- [ ] Script builds frontend
- [ ] Script builds backend
- [ ] Script deploys to Databricks
- [ ] App runs successfully

---

## Verification Checklist

When ALL of the following pass, output: `<promise>IDE COMPLETE</promise>`

1. **Project Management**
   - [ ] Can create new project from homepage
   - [ ] Projects list shows all user projects
   - [ ] Can delete projects

2. **File Operations**
   - [ ] File tree displays correctly
   - [ ] Can create new files
   - [ ] Can edit and save files
   - [ ] Syntax highlighting works

3. **Claude Code Terminal**
   - [ ] Terminal connects and shows Claude prompt
   - [ ] Can type commands and see responses
   - [ ] Claude can read/write project files
   - [ ] Terminal resize works

4. **Deployment**
   - [ ] App deploys to Databricks
   - [ ] App accessible via URL
   - [ ] Auth works (user identified correctly)

---

## Execution Notes

- Work through tasks sequentially within each phase
- Test each task before moving to the next
- If a task fails, debug before proceeding
- Use `npm test` or manual testing as appropriate
- Commit working code frequently
