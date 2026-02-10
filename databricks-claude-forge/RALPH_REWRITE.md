# Task: Rewrite Databricks Builder IDE with Node.js Backend

## Objective

Rewrite the backend from Python to Node.js for native Claude Code CLI integration. The Claude Code CLI is a Node.js application - running it natively eliminates PTY/subprocess spawning issues.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Databricks App (Node.js + React)                │
├─────────────────────────────────────────────────────────────┤
│  Static: React + Vite build (served by Express)             │
├─────────────────────────────────────────────────────────────┤
│  Backend: Express + TypeScript                              │
│  ├── /api/projects - Project CRUD                           │
│  ├── /api/files - File operations                           │
│  ├── /api/terminal - WebSocket Claude Code terminal         │
│  └── /api/health - Health check                             │
├─────────────────────────────────────────────────────────────┤
│  Database: Lakebase (PostgreSQL)                            │
└─────────────────────────────────────────────────────────────┘
```

## Execution Strategy

Work in `server-node/` directory. Keep existing Python backend as reference. Test each task before proceeding.

---

## Phase 1: Backend Foundation

### Task 1.1: Create server-node directory structure

Create the Node.js backend scaffold.

```bash
mkdir -p server-node/src/routes
mkdir -p server-node/src/middleware
mkdir -p server-node/src/services
```

Create `server-node/package.json`:
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

Create `server-node/tsconfig.json`:
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
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Verification:**
```bash
cd server-node && npm install && npm run typecheck
```

**Completion criteria:**
- [ ] `server-node/package.json` exists
- [ ] `server-node/tsconfig.json` exists
- [ ] `npm install` completes without errors
- [ ] Directory structure created

---

### Task 1.2: Create Express server entry point

Create `server-node/src/index.ts`:

```typescript
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import projectsRouter from './routes/projects.js';
import filesRouter from './routes/files.js';
import { setupTerminalWebSocket } from './services/terminal.js';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// WebSocket server for terminal
const wss = new WebSocketServer({ server, path: '/api/terminal' });
setupTerminalWebSocket(wss);

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// User info (from Databricks headers)
app.get('/api/me', (req, res) => {
  const user = req.headers['x-forwarded-user'] as string || 'dev-user@local';
  res.json({ email: user });
});

// API routes
app.use('/api/projects', projectsRouter);
app.use('/api', filesRouter);

// Serve static files in production
const clientDir = path.join(__dirname, '../../client');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDir));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDir, 'index.html'));
    }
  });
}

const PORT = process.env.DATABRICKS_APP_PORT || process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

**Verification:**
```bash
cd server-node && npm run dev
# In another terminal:
curl http://localhost:8000/api/health
```

**Completion criteria:**
- [ ] Server starts without errors
- [ ] `GET /api/health` returns `{"status":"ok",...}`
- [ ] `GET /api/me` returns user info

---

### Task 1.3: Implement projects routes

Create `server-node/src/routes/projects.ts`:

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

// In-memory store (replace with database in Task 2.x)
const projects: Map<string, Project> = new Map();

function getUserEmail(req: Request): string {
  return (req.headers['x-forwarded-user'] as string) || 'dev-user@local';
}

// List projects for current user
router.get('/', async (req: Request, res: Response) => {
  const userEmail = getUserEmail(req);
  const userProjects = Array.from(projects.values())
    .filter(p => p.user_email === userEmail)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  res.json(userProjects);
});

// Create project
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const userEmail = getUserEmail(req);
    const id = uuid();
    const projectDir = path.join(PROJECTS_DIR, id);

    await fs.mkdir(projectDir, { recursive: true });

    // Create default CLAUDE.md
    const claudeMd = `# ${name}\n\nProject created ${new Date().toISOString()}\n`;
    await fs.writeFile(path.join(projectDir, 'CLAUDE.md'), claudeMd);

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
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Get single project
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const project = projects.get(id);

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const userEmail = getUserEmail(req);
  if (project.user_email !== userEmail) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json(project);
});

// Delete project
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const project = projects.get(id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const userEmail = getUserEmail(req);
    if (project.user_email !== userEmail) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const projectDir = path.join(PROJECTS_DIR, id);
    await fs.rm(projectDir, { recursive: true, force: true });
    projects.delete(id);

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;
```

**Verification:**
```bash
# Create project
curl -X POST http://localhost:8000/api/projects -H "Content-Type: application/json" -d '{"name":"Test Project"}'
# List projects
curl http://localhost:8000/api/projects
```

**Completion criteria:**
- [ ] `POST /api/projects` creates project and directory
- [ ] `GET /api/projects` lists user's projects
- [ ] `GET /api/projects/:id` returns single project
- [ ] `DELETE /api/projects/:id` removes project

---

### Task 1.4: Implement files routes

Create `server-node/src/routes/files.ts`:

```typescript
import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = Router();
const PROJECTS_DIR = process.env.PROJECTS_DIR || './projects';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

// Security: validate path doesn't escape project directory
function validatePath(projectId: string, filePath: string): string | null {
  const projectDir = path.resolve(PROJECTS_DIR, projectId);
  const fullPath = path.resolve(projectDir, filePath);

  if (!fullPath.startsWith(projectDir)) {
    return null; // Path traversal attempt
  }
  return fullPath;
}

// Build file tree recursively
async function buildFileTree(dir: string, relativePath = ''): Promise<FileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const items: FileNode[] = [];

  // Patterns to skip
  const skipPatterns = [/^\./, /^node_modules$/, /^__pycache__$/, /^\.venv$/, /^dist$/];

  for (const entry of entries) {
    if (skipPatterns.some(p => p.test(entry.name))) continue;

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
      items.push({
        name: entry.name,
        path: relPath,
        type: 'file',
      });
    }
  }

  // Sort: directories first, then alphabetically
  return items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// List files in project
router.get('/projects/:projectId/files', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const projectDir = path.join(PROJECTS_DIR, projectId);

    try {
      await fs.access(projectDir);
    } catch {
      return res.status(404).json({ error: 'Project not found' });
    }

    const files = await buildFileTree(projectDir);
    res.json({ files });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// Get file content
router.get('/projects/:projectId/files/*', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const filePath = req.params[0] || '';

    const fullPath = validatePath(projectId, filePath);
    if (!fullPath) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    res.json({ content, path: filePath });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    console.error('Error reading file:', error);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Save file content
router.put('/projects/:projectId/files/*', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const filePath = req.params[0] || '';
    const { content } = req.body;

    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const fullPath = validatePath(projectId, filePath);
    if (!fullPath) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
    res.json({ success: true, path: filePath });
  } catch (error) {
    console.error('Error saving file:', error);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// Create new file
router.post('/projects/:projectId/files', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { path: filePath, content = '', type = 'file' } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const fullPath = validatePath(projectId, filePath);
    if (!fullPath) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (type === 'directory') {
      await fs.mkdir(fullPath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }

    res.status(201).json({ success: true, path: filePath });
  } catch (error) {
    console.error('Error creating file:', error);
    res.status(500).json({ error: 'Failed to create file' });
  }
});

// Delete file
router.delete('/projects/:projectId/files/*', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const filePath = req.params[0] || '';

    const fullPath = validatePath(projectId, filePath);
    if (!fullPath) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await fs.rm(fullPath, { recursive: true });
    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

export default router;
```

**Verification:**
```bash
# After creating a project with id $PROJECT_ID:
# List files
curl http://localhost:8000/api/projects/$PROJECT_ID/files
# Read file
curl http://localhost:8000/api/projects/$PROJECT_ID/files/CLAUDE.md
# Create file
curl -X POST http://localhost:8000/api/projects/$PROJECT_ID/files -H "Content-Type: application/json" -d '{"path":"test.py","content":"print(\"hello\")"}'
```

**Completion criteria:**
- [ ] `GET /api/projects/:id/files` returns file tree
- [ ] `GET /api/projects/:id/files/*` returns file content
- [ ] `PUT /api/projects/:id/files/*` saves file
- [ ] `POST /api/projects/:id/files` creates file
- [ ] `DELETE /api/projects/:id/files/*` deletes file
- [ ] Path traversal attacks blocked

---

### Task 1.5: Implement Claude Code terminal service

Create `server-node/src/services/terminal.ts`:

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import path from 'path';
import { IncomingMessage } from 'http';

const PROJECTS_DIR = process.env.PROJECTS_DIR || './projects';

interface TerminalSession {
  pty: pty.IPty;
  projectId: string;
}

const sessions = new Map<WebSocket, TerminalSession>();

function getWorkspaceUrl(): string {
  // Try explicit env var first
  if (process.env.DATABRICKS_WORKSPACE_URL) {
    return process.env.DATABRICKS_WORKSPACE_URL;
  }
  if (process.env.DATABRICKS_HOST) {
    return process.env.DATABRICKS_HOST;
  }
  return '';
}

export function setupTerminalWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Extract project ID from URL: /api/terminal?projectId=xxx
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const projectId = url.searchParams.get('projectId');

    if (!projectId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Project ID required' }));
      ws.close();
      return;
    }

    const projectDir = path.join(PROJECTS_DIR, projectId);

    // Get Databricks credentials from headers
    const token = req.headers['x-forwarded-access-token'] as string;
    const workspaceUrl = getWorkspaceUrl();

    // Build environment for Claude Code
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TERM: 'xterm-256color',
      HOME: process.env.HOME || '/tmp',
    };

    // Configure Claude to use Databricks Foundation Model API
    if (workspaceUrl && token) {
      env.ANTHROPIC_AUTH_TOKEN = token;
      env.ANTHROPIC_BASE_URL = `${workspaceUrl.replace(/\/$/, '')}/serving-endpoints/anthropic`;
      env.ANTHROPIC_MODEL = process.env.DATABRICKS_CLAUDE_MODEL || 'databricks-claude-sonnet-4';
    }

    console.log(`Starting Claude terminal for project ${projectId}`);
    console.log(`  Workspace URL: ${workspaceUrl || '(not set)'}`);
    console.log(`  Has token: ${!!token}`);

    try {
      // Spawn Claude Code CLI
      const shell = pty.spawn('claude', ['--dangerously-skip-permissions'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: projectDir,
        env,
      });

      sessions.set(ws, { pty: shell, projectId });

      // Send connected message
      ws.send(JSON.stringify({ type: 'connected', project_dir: projectDir }));

      // PTY output -> WebSocket
      shell.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      shell.onExit(({ exitCode }) => {
        console.log(`Claude process exited with code ${exitCode}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
        }
      });

      // WebSocket input -> PTY
      ws.on('message', (data) => {
        const message = data.toString();

        // Try to parse as JSON for control messages
        try {
          const parsed = JSON.parse(message);
          if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
            shell.resize(parsed.cols, parsed.rows);
            return;
          }
        } catch {
          // Not JSON, treat as raw terminal input
        }

        // Send raw input to PTY
        shell.write(message);
      });

      ws.on('close', () => {
        console.log(`Terminal disconnected for project ${projectId}`);
        shell.kill();
        sessions.delete(ws);
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error for project ${projectId}:`, error);
        shell.kill();
        sessions.delete(ws);
      });

    } catch (error) {
      console.error('Failed to spawn Claude:', error);
      ws.send(JSON.stringify({ type: 'error', message: `Failed to start Claude: ${error}` }));
      ws.close();
    }
  });
}
```

**Verification:**
```bash
# Start server
cd server-node && npm run dev

# Test WebSocket with wscat (install: npm install -g wscat)
wscat -c "ws://localhost:8000/api/terminal?projectId=$PROJECT_ID"
```

**Completion criteria:**
- [ ] WebSocket accepts connection with projectId
- [ ] Claude Code CLI spawns successfully
- [ ] Terminal input/output streams work
- [ ] Resize messages handled
- [ ] Session cleanup on disconnect

---

## Phase 2: Database Integration

### Task 2.1: Create database service

Create `server-node/src/services/database.ts`:

```typescript
import { Pool, PoolClient } from 'pg';

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
      max: 10,
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
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_user_email ON projects(user_email)
    `);

    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}

export async function query(text: string, params?: any[]): Promise<any> {
  return getPool().query(text, params);
}
```

**Verification:**
```bash
# With PGHOST, PGUSER, etc. set:
cd server-node && npm run dev
# Check logs for "Database initialized successfully"
```

**Completion criteria:**
- [ ] Database connection established
- [ ] Tables created on startup
- [ ] Connection pooling works

---

### Task 2.2: Update projects to use database

Update `server-node/src/routes/projects.ts` to use PostgreSQL instead of in-memory Map.

Replace the in-memory storage with database queries:
- `INSERT INTO projects` for create
- `SELECT * FROM projects WHERE user_email = $1` for list
- `SELECT * FROM projects WHERE id = $1` for get
- `DELETE FROM projects WHERE id = $1` for delete

**Completion criteria:**
- [ ] Projects persisted to database
- [ ] Projects survive server restart
- [ ] User filtering works

---

## Phase 3: Frontend Integration

### Task 3.1: Update API client for new endpoints

Review `client/src/lib/api.ts` and ensure all endpoints match the new Node.js backend.

Key endpoints:
- `GET /api/me` - User info
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Get project
- `DELETE /api/projects/:id` - Delete project
- `GET /api/projects/:id/files` - List files
- `GET /api/projects/:id/files/*` - Get file
- `PUT /api/projects/:id/files/*` - Save file
- `POST /api/projects/:id/files` - Create file
- `DELETE /api/projects/:id/files/*` - Delete file
- `WS /api/terminal?projectId=xxx` - Terminal WebSocket

**Completion criteria:**
- [ ] All API calls work with new backend
- [ ] No 404/405 errors

---

### Task 3.2: Update terminal WebSocket connection

Update `client/src/components/terminal/ClaudeTerminal.tsx`:

Change WebSocket URL from:
```typescript
const wsUrl = `${protocol}//${window.location.host}/api/projects/${projectId}/claude-terminal`;
```

To:
```typescript
const wsUrl = `${protocol}//${window.location.host}/api/terminal?projectId=${projectId}`;
```

**Completion criteria:**
- [ ] Terminal connects to new WebSocket endpoint
- [ ] Claude Code responds to input

---

## Phase 4: Deployment

### Task 4.1: Create app.yaml for Node.js

Create `app.yaml`:

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
    value: "https://adb-984752964297111.11.azuredatabricks.net"
  - name: DATABRICKS_CLAUDE_MODEL
    value: "databricks-claude-sonnet-4"
```

**Completion criteria:**
- [ ] app.yaml created with correct command
- [ ] Environment variables set

---

### Task 4.2: Create deployment script

Create `scripts/deploy-node.sh`:

```bash
#!/bin/bash
set -e

APP_NAME="${1:-databricks-builder-app}"

echo "Building backend..."
cd server-node
npm ci
npm run build
cd ..

echo "Building frontend..."
cd client
npm ci
npm run build
cd ..

echo "Preparing deployment..."
STAGING=/tmp/${APP_NAME}-deploy
rm -rf "$STAGING"
mkdir -p "$STAGING"

# Copy backend
cp -r server-node/dist "$STAGING/"
cp server-node/package.json "$STAGING/"
cp server-node/package-lock.json "$STAGING/"

# Copy frontend build
cp -r client/out "$STAGING/client/"

# Copy app.yaml
cp app.yaml "$STAGING/"

echo "Uploading to Databricks..."
WORKSPACE_PATH="/Workspace/Users/$(databricks current-user me --output json | python3 -c 'import sys,json; print(json.load(sys.stdin)["userName"])')/apps/${APP_NAME}"
databricks workspace import-dir "$STAGING" "$WORKSPACE_PATH" --overwrite

echo "Deploying..."
databricks apps deploy "$APP_NAME" --source-code-path "$WORKSPACE_PATH"

echo "Done! App URL:"
databricks apps get "$APP_NAME" --output json | python3 -c 'import sys,json; print(json.load(sys.stdin).get("url", "N/A"))'
```

**Completion criteria:**
- [ ] Script builds both frontend and backend
- [ ] Script deploys to Databricks
- [ ] App starts successfully

---

## Final Verification

When ALL of the following pass, output: `<promise>NODE REWRITE COMPLETE</promise>`

1. **Backend**
   - [ ] `npm run build` succeeds in server-node
   - [ ] Server starts without errors
   - [ ] All API endpoints respond correctly

2. **Projects**
   - [ ] Can create new project
   - [ ] Projects list shows user's projects
   - [ ] Can delete project

3. **Files**
   - [ ] File tree displays
   - [ ] Can read files
   - [ ] Can save files
   - [ ] Can create new files

4. **Terminal**
   - [ ] WebSocket connects
   - [ ] Claude Code starts
   - [ ] Can send commands
   - [ ] Can see responses
   - [ ] Terminal resize works

5. **Deployment**
   - [ ] Deploys to Databricks successfully
   - [ ] App accessible via URL
   - [ ] All features work in production

---

## Notes for Execution

- Execute tasks sequentially within each phase
- Test each task before proceeding to next
- If a task fails, debug before continuing
- Keep Python backend as reference for business logic
- Use `git diff` to see changes before committing
