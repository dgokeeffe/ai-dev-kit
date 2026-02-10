# Troubleshooting deployment issues

This guide covers common deployment issues and their solutions.

## Frontend not loading

### Symptom
App shows blank page, 404 errors, or "Cannot GET /" message

### Causes
1. Frontend not built before deployment
2. Build output in wrong directory
3. Static file serving misconfigured
4. SPA fallback routing not working

### Solution

**Step 1: Rebuild frontend**
```bash
cd client
npm run build
ls -la out/index.html  # Verify file exists
```

**Step 2: Check build output**
```bash
# Should see these files
client/out/
├── index.html
├── assets/
│   ├── index-[hash].js
│   └── index-[hash].css
└── vite.svg
```

**Step 3: Verify FastAPI static file serving**
```bash
# In server/app.py, should have:
app.mount("/", StaticFiles(directory="client/out", html=True), name="static")
```

**Step 4: Re-deploy**
```bash
./scripts/deploy.sh my-app-name
```

---

## API endpoints failing with 500 errors

### Symptom
`/api/*` routes return 500 Internal Server Error

### Causes
1. Missing environment variables in `app.yaml`
2. Database connection failure
3. Missing Python dependencies
4. Service principal permissions

### Solution

**Step 1: Check app logs**
```bash
databricks apps logs my-app-name

# Or in UI: Apps → my-app-name → Logs tab
```

**Step 2: Verify environment variables**
```yaml
# In app.yaml - all these are required
env:
  - name: DATABRICKS_HOST
    value: "https://your-workspace.cloud.databricks.com"
  - name: DATABASE_URL
    value: "databricks://..."
  - name: ANTHROPIC_API_KEY
    value: "sk-ant-..."
```

**Step 3: Test database connection**
```bash
# From app logs, look for:
# "Database connection successful" ✅
# "Database connection failed" ❌

# If failed, check DATABASE_URL format:
# databricks://workspace:443/catalog.schema?http_path=/sql/1.0/warehouses/xxx
```

**Step 4: Verify service principal permissions**
```bash
# Grant Lakebase permissions
./scripts/grant_lakebase_permissions.sh my-app-name
```

---

## Database connection errors

### Symptom
```
sqlalchemy.exc.OperationalError: (databricks.sql.exc.Error) 
Error during connection: 403 Client Error: Forbidden
```

### Causes
1. Service principal lacks database permissions
2. Warehouse is stopped or doesn't exist
3. Incorrect DATABASE_URL format
4. Network/firewall issues

### Solution

**Step 1: Grant permissions**
```bash
# Run permission script
./scripts/grant_lakebase_permissions.sh my-app-name

# This grants CAN_CONNECT_AND_CREATE to app's service principal
```

**Step 2: Verify warehouse is running**
```bash
databricks sql warehouses list

# Check warehouse state:
# RUNNING ✅
# STOPPED ❌ (start it)
# DELETED ❌ (create new one)
```

**Step 3: Validate DATABASE_URL format**
```bash
# Correct format:
databricks://workspace.cloud.databricks.com:443/catalog.schema?http_path=/sql/1.0/warehouses/abc123def456

# Common mistakes:
# ❌ Missing port :443
# ❌ Wrong catalog/schema
# ❌ Invalid warehouse ID
# ❌ Missing http_path parameter
```

**Step 4: Test connection manually**
```python
# Run in Databricks notebook
from databricks import sql

connection = sql.connect(
    server_hostname="workspace.cloud.databricks.com",
    http_path="/sql/1.0/warehouses/abc123",
    access_token="<token>"
)
cursor = connection.cursor()
cursor.execute("SELECT 1")
print(cursor.fetchall())  # Should print [(1,)]
```

---

## Authentication errors

### Symptom
```
Error: 401 Unauthorized
Token validation failed
```

### Causes
1. Missing or invalid `ANTHROPIC_API_KEY`
2. Expired Databricks token
3. Service principal misconfiguration
4. OAuth scope issues

### Solution

**Step 1: Verify Anthropic API key**
```bash
# Test key directly
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'

# Should return valid response (not 401)
```

**Step 2: Update app.yaml**
```yaml
env:
  - name: ANTHROPIC_API_KEY
    value: "sk-ant-..."  # Starts with sk-ant-
```

**Step 3: Check service principal**
```bash
# Get app's service principal ID
databricks apps describe my-app-name

# Should show:
# service_principal_id: "..." ✅
```

---

## Build errors during deployment

### Symptom
```
Error: npm run build failed
Error: Command 'vite build' exited with code 1
```

### Causes
1. Node.js version mismatch
2. Missing dependencies
3. TypeScript errors
4. Import path issues

### Solution

**Step 1: Check Node.js version**
```bash
node --version  # Should be v18+

# If not, update:
# nvm install 18
# nvm use 18
```

**Step 2: Clean install dependencies**
```bash
cd client
rm -rf node_modules package-lock.json
npm install
npm run build
```

**Step 3: Fix TypeScript errors**
```bash
cd client
npm run type-check  # Shows all TS errors

# Common issues:
# - Missing type definitions: npm install --save-dev @types/...
# - Import path errors: check relative paths
# - Unused variables: remove or prefix with _
```

**Step 4: Check Vite config**
```typescript
// client/vite.config.ts
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'out',  // ✅ Must be 'out'
  },
})
```

---

## App not starting

### Symptom
App status shows "FAILED" or "STOPPED"

### Causes
1. Port binding issues
2. Command misconfiguration in `app.yaml`
3. Missing dependencies
4. Startup timeout

### Solution

**Step 1: Check app logs**
```bash
databricks apps logs my-app-name --tail 100

# Look for:
# "Uvicorn running on..." ✅
# "Error: ..." ❌
```

**Step 2: Verify app.yaml command**
```yaml
command:
  - "uvicorn"
  - "server.app:app"
  - "--host"
  - "0.0.0.0"
  - "--port"
  - "$DATABRICKS_APP_PORT"  # MUST use this variable

# ❌ Wrong:
# - "--port"
# - "8000"  # Don't hardcode port!
```

**Step 3: Check dependencies installed**
```bash
# From app logs, should see:
# "Running pip install -r requirements.txt" ✅
# "Successfully installed fastapi uvicorn ..." ✅

# If missing:
# - Verify requirements.txt exists
# - Check for syntax errors in requirements.txt
```

**Step 4: Increase startup timeout**
```yaml
# In databricks.yml
resources:
  apps:
    my-app:
      name: "my-app"
      startup_timeout: 600  # 10 minutes (default: 5 min)
```

---

## Permission denied errors

### Symptom
```
Error: Permission denied
403 Forbidden
User does not have required permissions
```

### Causes
1. User lacks App creation permissions
2. Service principal lacks database permissions
3. Warehouse permissions missing
4. Lakebase catalog permissions

### Solution

**Step 1: Check user permissions**
```bash
# Need these workspace permissions:
# - CAN_CREATE_APPS
# - CAN_USE (on warehouse)

# Ask workspace admin to grant via:
# Workspace settings → Admin Console → User Management
```

**Step 2: Grant service principal permissions**
```bash
# After app is created, grant database access
./scripts/grant_lakebase_permissions.sh my-app-name

# This grants:
# - USE CATALOG lakebase
# - USE SCHEMA databricks_claude_forge
# - CREATE TABLE
# - MODIFY
# - SELECT
```

**Step 3: Verify warehouse permissions**
```sql
-- In Databricks SQL, check warehouse permissions
SHOW GRANT ON SQL WAREHOUSE <warehouse-id>

-- App's service principal should have CAN_USE
```

---

## Deployment taking too long

### Symptom
Deployment hangs or takes >10 minutes

### Causes
1. Large file uploads (node_modules, .git)
2. Slow network connection
3. Many small files
4. Build step running during deploy

### Solution

**Step 1: Check what's being uploaded**
```bash
# List files being deployed
cd databricks-claude-forge
find . -type f | grep -v node_modules | grep -v .git | wc -l

# Should be ~500-1000 files
# If >5000, check excludes
```

**Step 2: Verify .gitignore and sync excludes**
```yaml
# In databricks.yml
sync:
  exclude:
    - "client/node_modules/"
    - "client/src/"  # Don't need source, only built files
    - ".git/"
    - "**/__pycache__/"
    - "**/*.pyc"
    - ".env*"
    - "*.log"
```

**Step 3: Use --prep-only for DAB**
```bash
# Pre-build locally (fast)
./scripts/deploy.sh --prep-only

# Then deploy (no build step)
databricks bundle deploy -t dev
```

**Step 4: Compress before upload**
```bash
# For CLI deploy, could tar first
tar czf app.tar.gz \
  server/ \
  client/out/ \
  skills/ \
  requirements.txt \
  package.json \
  app.yaml

# But usually not needed - deploy.sh is optimized
```

---

## Git-based deployment issues

### Symptom
```
Error: Git authentication failed
Error: Repository not found
```

### Causes
1. Git credentials not configured
2. Repository is private
3. Invalid Git URL
4. Branch/tag doesn't exist

### Solution

**Step 1: Configure Git credentials**
```bash
# In Databricks UI:
# Settings → Developer → Git Credentials → Add Credentials

# For GitHub:
# - Username: <your-username>
# - Token: ghp_... (Personal Access Token)

# For GitLab:
# - Username: oauth2
# - Token: glpat-... (Project Access Token)
```

**Step 2: Verify repository access**
```bash
# Test clone manually
git clone https://github.com/dgokeeffe/databricks-claude-forge
cd databricks-claude-forge

# If fails:
# - Check repo is public OR credentials are correct
# - Verify URL is exact (case-sensitive)
```

**Step 3: Check Git reference exists**
```bash
# List branches
git branch -a

# List tags
git tag -l

# Verify ref you're deploying exists
```

**Step 4: Use correct Git URL format**
```bash
# ✅ Correct:
https://github.com/user/repo
https://github.com/user/repo.git

# ❌ Wrong:
git@github.com:user/repo  # SSH not supported
github.com/user/repo       # Missing https://
```

---

## Common error messages

### "Error: app.yaml not found"

**Solution**:
```bash
cp app.yaml.example app.yaml
# Edit app.yaml with your settings
```

### "Error: client/out/index.html not found"

**Solution**:
```bash
cd client && npm run build
```

### "Error: Database table already exists"

**Solution**:
```python
# In server code, use:
Base.metadata.create_all(bind=engine, checkfirst=True)
# The checkfirst=True prevents errors on existing tables
```

### "Error: Module 'anthropic' not found"

**Solution**:
```bash
# Add to requirements.txt
anthropic>=0.39.0

# Re-deploy
./scripts/deploy.sh my-app-name
```

### "Error: Port 8000 already in use"

**Solution**:
```yaml
# Don't hardcode port in app.yaml!
# Use: $DATABRICKS_APP_PORT

command:
  - "uvicorn"
  - "server.app:app"
  - "--port"
  - "$DATABRICKS_APP_PORT"  # ✅
```

---

## Debugging checklist

When deployment fails, check these in order:

- [ ] **Databricks CLI authenticated**: `databricks auth describe`
- [ ] **Frontend built**: `ls client/out/index.html`
- [ ] **app.yaml exists**: `ls app.yaml`
- [ ] **Environment variables set** in app.yaml
- [ ] **Database URL format correct**
- [ ] **Warehouse running**: `databricks sql warehouses list`
- [ ] **Service principal permissions**: `./scripts/grant_lakebase_permissions.sh`
- [ ] **Dependencies installed**: Check app logs for pip/npm install
- [ ] **Port binding correct**: Using `$DATABRICKS_APP_PORT`
- [ ] **Logs reviewed**: `databricks apps logs <app-name>`

---

## Getting help

If issues persist:

1. **Review app logs**: `databricks apps logs <app-name> --tail 200`
2. **Check Databricks status**: https://status.databricks.com
3. **Review docs**: `docs/DEPLOYMENT.md`
4. **File issue**: Include logs, app.yaml (redacted), and error messages

## Additional resources

- [Databricks Apps Documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/)
- [Databricks Apps Troubleshooting](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/troubleshooting)
- Deployment guide: `DEPLOYMENT.md`
- Project README: `../README.md`
