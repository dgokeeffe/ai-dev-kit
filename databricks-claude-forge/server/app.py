"""FastAPI app for the Claude Code MCP application."""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

# Configure logging BEFORE importing other modules
logging.basicConfig(
  level=logging.INFO,
  format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
  handlers=[
    logging.StreamHandler(),
  ],
)

from dotenv import load_dotenv  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402

from .db import (  # noqa: E402
  ensure_table_permissions,
  init_database,
  is_dynamic_token_mode,
  is_postgres_configured,
  run_migrations,
  start_token_refresh,
  stop_token_refresh,
)
from .routers import (  # noqa: E402
  agent_router,
  clusters_router,
  config_router,
  conversations_router,
  deploy_router,
  files_router,
  git_router,
  health_router,
  preview_router,
  projects_router,
  pty_router,
  skills_router,
  terminal_router,
  warehouses_router,
)
from .services.backup_manager import start_backup_worker, stop_backup_worker  # noqa: E402
from .services.claude_setup import ensure_micro_installed  # noqa: E402
from .services.skills_manager import copy_skills_to_app  # noqa: E402

logger = logging.getLogger(__name__)

# Load environment variables
env_local_loaded = load_dotenv(dotenv_path='.env.local')
env = os.getenv('ENV', 'development' if env_local_loaded else 'production')

if env_local_loaded:
  logger.info(f'Loaded .env.local (ENV={env})')
else:
  logger.info(f'Using system environment variables (ENV={env})')

# Databricks Apps injects DATABRICKS_CLIENT_ID/SECRET for service principal auth.
# Keep these - they're needed for Lakebase token generation and workspace API calls.
# Foundation Model API calls use the user's X-Forwarded-Access-Token, not these creds.
# Also ensure HOME is set so the SDK can locate (and skip) .databrickscfg.
if env == 'production' and not os.environ.get('HOME'):
  os.environ['HOME'] = '/tmp'


@asynccontextmanager
async def lifespan(app: FastAPI):
  """Async lifespan context manager for startup/shutdown events."""
  logger.info('Starting application...')

  # Copy skills from databricks-skills to local cache
  copy_skills_to_app()

  # Install micro text editor (one-time, non-blocking)
  home_dir = os.environ.get('HOME', '/tmp')
  ensure_micro_installed(home_dir)

  # Create ~/.claude/settings.json with Databricks credentials
  # This configures Claude Code CLI for all sessions (PTY and agent)
  from .services.claude_setup import setup_claude_settings
  databricks_host = os.environ.get('DATABRICKS_HOST')
  claude_token = os.environ.get('CLAUDE_API_TOKEN')
  if databricks_host and claude_token:
    setup_claude_settings(
      home_dir,
      databricks_host,
      claude_token,
      os.environ.get('DATABRICKS_CLAUDE_MODEL', 'databricks-claude-sonnet-4-5'),
    )
  else:
    logger.warning('DATABRICKS_HOST or CLAUDE_API_TOKEN not set - Claude settings not created')

  # Initialize database if configured
  app.state.database_available = False
  if is_postgres_configured():
    logger.info('Initializing database...')
    try:
      init_database()
      app.state.database_available = True

      # Start token refresh for dynamic OAuth mode (Databricks Apps)
      if is_dynamic_token_mode():
        await start_token_refresh()

      # Run migrations synchronously before serving requests
      try:
        await asyncio.to_thread(run_migrations)
      except Exception as e:
        logger.warning(f'Migration failed (will try create_tables fallback): {e}')
        # Fallback: create tables directly if migrations fail
        try:
          from .db import create_tables
          await create_tables()
          logger.info('Created tables via fallback (create_tables)')
        except Exception as e2:
          logger.warning(f'create_tables fallback also failed: {e2}')

      # Ensure the current DB user (service principal) has table permissions.
      # This handles the case where tables were created by a different user.
      try:
        await asyncio.to_thread(ensure_table_permissions)
      except Exception as e:
        logger.warning(f'Permission grant failed (non-fatal): {e}')

      # Start backup worker
      start_backup_worker()
    except Exception as e:
      logger.warning(
        f'Database initialization failed: {e}\n'
        "App will continue without database features (conversations won't be persisted)."
      )
  else:
    logger.warning(
      'Database not configured. Set either:\n'
      '  - LAKEBASE_PG_URL (static URL with password), or\n'
      '  - LAKEBASE_INSTANCE_NAME and LAKEBASE_DATABASE_NAME (dynamic OAuth)'
    )

  yield

  logger.info('Shutting down application...')

  # Stop token refresh if running
  await stop_token_refresh()

  stop_backup_worker()


app = FastAPI(
  title='Claude Code MCP App',
  description='Project-based Claude Code agent application',
  lifespan=lifespan,
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
  """Log all unhandled exceptions."""
  logger.exception(f'Unhandled exception for {request.method} {request.url}: {exc}')
  return JSONResponse(
    status_code=500,
    content={'detail': 'Internal Server Error', 'error': str(exc)},
  )


# Configure CORS - only needed in development
# (production serves frontend as static files from same origin)
if env == 'development':
  allowed_origins = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173']
  logger.info(f'CORS allowed origins: {allowed_origins}')
  app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
  )
else:
  logger.info('Production mode: CORS middleware not added (same-origin)')

API_PREFIX = '/api'

# Include routers
app.include_router(config_router, prefix=API_PREFIX, tags=['configuration'])
app.include_router(clusters_router, prefix=API_PREFIX, tags=['clusters'])
app.include_router(warehouses_router, prefix=API_PREFIX, tags=['warehouses'])
app.include_router(projects_router, prefix=API_PREFIX, tags=['projects'])
app.include_router(conversations_router, prefix=API_PREFIX, tags=['conversations'])
app.include_router(agent_router, prefix=API_PREFIX, tags=['agent'])
app.include_router(skills_router, prefix=API_PREFIX, tags=['skills'])
app.include_router(files_router, prefix=API_PREFIX, tags=['files'])
app.include_router(git_router, prefix=API_PREFIX, tags=['git'])
app.include_router(deploy_router, prefix=API_PREFIX, tags=['deploy'])
app.include_router(terminal_router, prefix=API_PREFIX, tags=['terminal'])
app.include_router(pty_router, prefix=API_PREFIX, tags=['pty'])
app.include_router(preview_router, prefix=API_PREFIX, tags=['preview'])
app.include_router(health_router, prefix=API_PREFIX, tags=['health'])

# Production: Serve Vite static build with SPA fallback
# Check both paths: 'client/out' (local dev) and 'client' (deployed via deploy.sh)
build_path = Path('.') / 'client/out'
if not build_path.exists():
  build_path = Path('.') / 'client'
if build_path.exists() and (build_path / 'index.html').exists():
  logger.info(f'Serving static files from {build_path} with SPA fallback')

  @app.get('/{path:path}')
  async def serve_spa(path: str):
    """Serve static files or fall back to index.html for SPA routing."""
    # Don't serve SPA for API routes - they should 404 if not found
    if path.startswith('api/'):
      return JSONResponse(status_code=404, content={'detail': f'API route not found: /{path}'})
    file_path = build_path / path
    if file_path.exists() and file_path.is_file():
      return FileResponse(file_path)
    # Fall back to index.html for client-side routing
    return FileResponse(build_path / 'index.html')
else:
  logger.warning(
    f'Build directory {build_path} not found. '
    'In development, run Vite separately: cd client && npm run dev'
  )
