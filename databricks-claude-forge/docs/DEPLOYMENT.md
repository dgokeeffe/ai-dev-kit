# Deployment guide

This guide covers deploying Databricks Claude Forge to Databricks Apps using three different methods.

## Prerequisites

Before deploying, ensure you have:

- [ ] **Databricks CLI** installed and authenticated (`databricks auth login`)
- [ ] **Node.js 18+** and npm installed
- [ ] **Python 3.11+** installed
- [ ] **Access to Databricks workspace** with App creation permissions
- [ ] **uv** package installer (`pip install uv`)

Verify prerequisites:

```bash
databricks --version          # Should show v0.200+
node --version                # Should show v18+
python --version              # Should show 3.11+
databricks auth describe      # Should show current workspace
```

## Build process

The application uses a hybrid runtime with:

- **Frontend**: React + Vite → builds to `client/out/` as static assets
- **Backend**: FastAPI → serves API endpoints + static files  
- **Runtime**: Node.js (for Claude Code CLI) + Python (FastAPI server)

### Databricks Apps deployment logic

Databricks Apps automatically detects your runtime based on files present:

**If `package.json` is present** (this project):
1. Run `npm install`
2. Run `pip install -r requirements.txt` (if it exists)
3. Run `npm run build` (if build script defined)
4. Run command from `app.yaml`, or `npm run start` if no command specified

**If `package.json` is NOT present**:
1. Run `pip install -r requirements.txt` (if it exists)  
2. Run command from `app.yaml`, or `python <my-app>.py` if no command specified

### This project's build flow

```
1. Databricks detects package.json → enables Node.js + Python
   ↓
2. npm install → installs @anthropic-ai/claude-code
   ↓
3. pip install -r requirements.txt → installs FastAPI, SQLAlchemy, etc.
   ↓
4. npm run build → runs "cd client && npm install && npm run build"
   → Vite bundles React app to client/out/
   ↓
5. uvicorn server.app:app (from app.yaml command)
   ↓
6. FastAPI serves:
   - /api/* → API endpoints
   - /* → static files (SPA fallback to index.html)
```

**Important**: The build script in root `package.json` automatically builds the frontend during deployment. This means:
- ✅ **Git-based deployments**: Deploy directly from Git without pre-building locally
- ✅ **Asset Bundles**: Can skip `--prep-only` step (Databricks will build)
- ⚠️ **CLI deployments**: Still recommended to pre-build locally for faster iteration

### What gets deployed

```
databricks-claude-forge/
├── server/                 # FastAPI backend
├── client/out/            # Built React app (static assets)
├── skills/                # Custom skills
├── requirements.txt       # Python dependencies
├── package.json           # Node.js dependencies (triggers hybrid mode)
└── app.yaml              # Runtime configuration
```

## Deployment methods

Choose based on your use case:

| Method | Best for | Pros | Cons |
|--------|----------|------|------|
| **CLI Deploy** | Fast iteration, development | Quick, simple | Manual, no IaC |
| **Git-based** | Auto-updates from Git | No uploads, version control | Beta, requires Git setup |
| **Asset Bundles (DAB)** | Production, multi-env | IaC, atomic deploys | More complex |

---

## Method 1: CLI deployment (fastest)

Best for development and quick iterations.

### Step 1: Configure app.yaml

```bash
# Copy template and edit
cp app.yaml.example app.yaml

# Edit app.yaml - set your workspace details
vim app.yaml
```

Required fields in `app.yaml`:

```yaml
env:
  - name: DATABRICKS_HOST
    value: "https://your-workspace.cloud.databricks.com"
  - name: ANTHROPIC_API_KEY
    valueFrom:
      secretScope: my-scope
      secretKey: anthropic-api-key  # ✅ Best practice - use secrets
  - name: DATABASE_URL
    value: "databricks://your-workspace.cloud.databricks.com:443/lakebase-database?http_path=/sql/1.0/warehouses/abc123"
```

See "Best practice: Using secrets" section below for more details.

### Step 2: Deploy

```bash
# Deploy to workspace
./scripts/deploy.sh my-app-name

# The script will:
# 1. Build frontend (npm run build)
# 2. Clean Python cache files
# 3. Upload to workspace folder
# 4. Create/update the app
```

### Step 3: Grant permissions

```bash
# Grant Lakebase database permissions to app's service principal
./scripts/grant_lakebase_permissions.sh my-app-name
```

### Step 4: Access your app

1. Open Databricks workspace
2. Navigate to **Apps** in left sidebar
3. Click your app name
4. Click **Open App** button

---

## Method 2: Git-based deployment (beta)

Deploy directly from GitHub/GitLab without workspace uploads.

### Prerequisites

- Repository hosted on GitHub, GitLab, or Bitbucket
- Git credentials configured in Databricks

### Step 1: Fork repository

```bash
# Fork to your GitHub account
# Example: github.com/dgokeeffe/databricks-claude-forge
```

### Step 2: Configure Git credentials

In Databricks workspace:

1. Go to **Settings** → **Developer** → **Git Credentials**
2. Add credentials for your Git provider
3. Note the credential ID

### Step 3: Create app with Git source

**Via Databricks UI**:

1. Navigate to **Apps** → **Create App**
2. Select **Git** as source
3. Enter repository URL: `https://github.com/dgokeeffe/databricks-claude-forge`
4. Choose Git reference (branch, tag, or commit):
   - Branch: `main` (auto-updates on push)
   - Tag: `v1.0.0` (specific version)
   - Commit: `abc123` (pinned commit)
5. Configure `app.yaml` settings
6. Click **Create**

**Via CLI**:

```bash
# Create app from Git
databricks apps create my-app \
  --git-url https://github.com/dgokeeffe/databricks-claude-forge \
  --git-ref main \
  --git-credential-id <credential-id>
```

### Step 4: Auto-updates

When deploying from a branch (e.g., `main`):
- App automatically pulls latest code on restart
- Push to branch → restart app → code updates

When deploying from tag/commit:
- App stays pinned to that version
- Update via UI or CLI to change reference

### Benefits

- ✅ No manual uploads
- ✅ **Automatic frontend build** during deployment (no pre-build needed)
- ✅ Version control integration
- ✅ Automatic updates (branch mode)
- ✅ Easy rollback (change Git ref)

### Limitations (Beta)

- Requires Git credential setup per service principal
- Initial setup more complex than CLI deploy
- Beta feature (may have changes)

---

## Method 3: Asset Bundles (recommended for production)

Infrastructure-as-code deployment with multi-environment support.

### Why Asset Bundles?

- **Infrastructure-as-code**: Resources defined in `databricks.yml`
- **Multi-environment**: dev, staging, prod targets
- **Atomic deployments**: All-or-nothing updates
- **Resource provisioning**: Automatically creates Lakebase, permissions, endpoints

### Step 1: Prepare build (optional)

```bash
# Option A: Pre-build locally (faster validation, recommended for development)
./scripts/deploy.sh --prep-only

# Option B: Let Databricks build during deployment
# Skip this step - Databricks will run "npm run build" automatically
```

**Note**: Since `package.json` includes a build script, Databricks Apps will automatically build the frontend during deployment. Pre-building locally is optional but recommended for faster feedback on build errors.

**Note on dependencies**: If your build script uses tools like Vite or TypeScript, ensure they're in `dependencies`, not `devDependencies`:

```json
{
  "dependencies": {
    "vite": "^6.0.0",           // ✅ Available in production build
    "typescript": "^5.2.2"
  },
  "devDependencies": {
    // ❌ These won't be installed during Databricks build
  }
}
```

When `NODE_ENV=production`, npm skips `devDependencies` entirely.

### Step 2: Configure target

Edit `databricks.yml` for your target:

```yaml
targets:
  dev:
    mode: development
    workspace:
      host: https://your-workspace.cloud.databricks.com

    resources:
      apps:
        databricks-claude-forge-dev:
          name: "claude-forge-dev"
          # ... rest of configuration
```

### Step 3: Deploy with DAB

```bash
# Validate bundle
databricks bundle validate -t dev

# Deploy to dev
databricks bundle deploy -t dev

# Deploy to prod
databricks bundle deploy -t prod
```

### Step 4: Grant permissions

```bash
# Grant Lakebase permissions (same as CLI method)
./scripts/grant_lakebase_permissions.sh claude-forge-dev
```

### Multi-environment workflow

```bash
# Development
databricks bundle deploy -t dev

# Staging (if configured)
databricks bundle deploy -t staging

# Production
databricks bundle deploy -t prod
```

### Asset Bundle + Git (hybrid)

Combine Asset Bundles with Git source:

```yaml
# In databricks.yml
targets:
  prod:
    resources:
      apps:
        my-app:
          source:
            git:
              url: https://github.com/dgokeeffe/databricks-claude-forge
              ref: v1.0.0
              credential: ${var.git_credential_id}
```

Benefits:
- ✅ IaC resource management
- ✅ Git-based source control
- ✅ Multi-environment deployment
- ✅ No workspace folder uploads

---

## First-time setup

### 1. Create Lakebase database

The app requires a Lakebase database for persistent storage.

**Via Asset Bundles** (automatic):

```yaml
# In databricks.yml - already configured
resources:
  sql_endpoints:
    lakebase-warehouse:
      # Warehouse for Lakebase

  databases:
    lakebase:
      catalog: lakebase
      name: databricks_claude_forge
```

**Via CLI** (manual):

```sql
-- In Databricks SQL editor
CREATE CATALOG IF NOT EXISTS lakebase;
CREATE DATABASE IF NOT EXISTS lakebase.databricks_claude_forge;
```

### 2. Get database connection string

```bash
# Get warehouse HTTP path
databricks sql warehouses list

# Format: databricks://workspace-url:443/catalog.schema?http_path=/sql/1.0/warehouses/xxx
```

### 3. Configure environment variables

Add to `app.yaml`:

```yaml
env:
  - name: DATABASE_URL
    value: "databricks://your-workspace:443/lakebase.databricks_claude_forge?http_path=/sql/1.0/warehouses/xxx"

  - name: ANTHROPIC_API_KEY
    valueFrom:
      secretScope: my-scope
      secretKey: anthropic-api-key  # ✅ References secret

  - name: DATABRICKS_HOST
    value: "https://your-workspace.cloud.databricks.com"
```

**Best practice: Using secrets**

⚠️ **Never hardcode sensitive values in app.yaml**

Instead of:
```yaml
env:
  - name: ANTHROPIC_API_KEY
    value: "sk-ant-..."  # ❌ Exposed in version control
```

Use Databricks secrets:
```yaml
env:
  - name: ANTHROPIC_API_KEY
    valueFrom:
      secretScope: my-scope
      secretKey: anthropic-api-key  # ✅ References secret
```

Create secrets via CLI:
```bash
databricks secrets create-scope my-scope
databricks secrets put-secret my-scope anthropic-api-key
```

**When to use each approach:**
- **Hardcode** (`value:`): Static, non-sensitive (NODE_ENV, feature flags, regions)
- **Reference** (`valueFrom:`): Secrets, tokens, passwords, API keys

### 4. Grant permissions (two layers)

Lakebase uses two separate permission systems:

**Layer 1: Project permissions** (platform management)
```sql
-- Grant app's service principal project-level access
GRANT CAN MANAGE ON CATALOG lakebase TO SERVICE_PRINCIPAL `<app-service-principal>`;
```

**Layer 2: Database permissions** (data access)
```bash
# Grant database-level access via Postgres roles
./scripts/grant_lakebase_permissions.sh <app-name>
```

The script grants:
- `CONNECT` - Connect to database
- `CREATE` - Create tables/schemas
- Table permissions - Read/write access

**Both layers required** for full database access.

---

## Configuration reference

### app.yaml structure

```yaml
# Runtime configuration for the app

# Environment variables (injected at runtime)
env:
  - name: DATABRICKS_HOST
    value: "https://workspace.databricks.com"

  - name: ANTHROPIC_API_KEY
    value: "sk-ant-..."

  - name: DATABASE_URL
    value: "databricks://..."

  - name: NODE_ENV
    value: "production"

# App command (how to start the server)
# CRITICAL REQUIREMENTS:
# 1. With package.json present, explicit command is REQUIRED
#    (Otherwise Databricks runs "npm run start")
# 2. App MUST bind to $DATABRICKS_APP_PORT environment variable
#    (Databricks routes traffic to this port)
command:
  - "uvicorn"
  - "server.app:app"
  - "--host"
  - "0.0.0.0"
  - "--port"
  - "$DATABRICKS_APP_PORT"  # ⚠️ Required - do not hardcode port
```

**Note on hybrid apps**: Since this project has `package.json`, Databricks expects Node.js. We override with explicit `command` in `app.yaml` to run the Python FastAPI server. The frontend is pre-built static files served by FastAPI, so no Node.js runtime process is needed.

### databricks.yml structure

```yaml
bundle:
  name: databricks-claude-forge

# File sync configuration
sync:
  include:
    - server/
    - client/out/      # Built frontend
    - skills/
    - requirements.txt
    - package.json
    - app.yaml

  exclude:
    - client/src/      # Source files not needed
    - client/node_modules/
    - "**/__pycache__/"
    - "**/*.pyc"

# Environment-specific targets
targets:
  dev:
    mode: development
    resources:
      apps:
        my-app-dev:
          name: "my-app-dev"
          # ...

  prod:
    mode: production
    resources:
      apps:
        my-app-prod:
          name: "my-app-prod"
          # ...
```

---

## Production best practices

### Security

1. **Never commit secrets**:
   ```yaml
   # Use Databricks secrets instead
   env:
     - name: ANTHROPIC_API_KEY
       valueFrom:
         secretScope: my-scope
         secretKey: anthropic-api-key
   ```

2. **Use service principal tokens**:
   - App automatically gets `X-Forwarded-Access-Token`
   - Use for Databricks API calls
   - Don't hardcode PAT tokens

3. **Least privilege permissions**:
   - Grant only `CAN_CONNECT_AND_CREATE` on Lakebase database
   - Limit service principal permissions

### Performance

1. **Build optimizations**:
   - Code splitting (see `vite.config.ts`)
   - Disable source maps in production
   - Compress static assets

2. **Caching**:
   - Static assets have cache headers
   - API responses cache appropriately

3. **Database connections**:
   - Use connection pooling (SQLAlchemy handles this)
   - Close connections properly

### Monitoring

1. **Check app logs**:
   ```bash
   # View logs via CLI
   databricks apps logs my-app

   # Or in UI: Apps → my-app → Logs tab
   ```

2. **Health checks**:
   - App includes `/health` endpoint
   - Monitor via Databricks app status

3. **Error tracking**:
   - FastAPI logs to stdout (captured by Databricks)
   - Frontend errors logged to console

---

## Comparison: CLI vs Git vs DAB

### CLI deployment

```bash
./scripts/deploy.sh my-app
```

**When to use**:
- Local development
- Fast iteration
- Testing changes quickly

**Pros**:
- Fastest deployment (30-60s)
- Simple one-command deploy
- No infrastructure setup

**Cons**:
- Manual process
- No version control
- No multi-environment
- No resource management

---

### Git-based deployment

```bash
databricks apps create my-app \
  --git-url https://github.com/user/repo \
  --git-ref main
```

**When to use**:
- Team collaboration
- CI/CD integration
- Auto-updates from Git

**Pros**:
- No manual uploads
- Version control built-in
- Automatic updates (branch mode)
- Easy rollback (change ref)

**Cons**:
- Beta feature
- Git credential setup
- Initial configuration more complex

---

### Asset Bundles (DAB)

```bash
./scripts/deploy.sh --prep-only
databricks bundle deploy -t prod
```

**When to use**:
- Production deployments
- Multi-environment (dev/staging/prod)
- Infrastructure-as-code
- Resource provisioning

**Pros**:
- Full IaC capabilities
- Multi-environment support
- Atomic deployments
- Resource management
- Rollback support

**Cons**:
- More complex setup
- Requires `databricks.yml` configuration
- Slower initial deployment

---

## Next steps

1. **Choose deployment method** based on your use case
2. **Follow setup steps** in this guide
3. **Test deployment** in development environment
4. **Review troubleshooting guide** (`docs/TROUBLESHOOTING.md`)
5. **Set up CI/CD** for automated deployments (optional)

## Additional resources

- [Databricks Apps Documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/)
- [Asset Bundles Tutorial](https://docs.databricks.com/aws/en/dev-tools/bundles/apps-tutorial)
- [Git-based Deployment](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy#deploy-from-git)
- Project README: `../README.md`
- Troubleshooting: `TROUBLESHOOTING.md`
