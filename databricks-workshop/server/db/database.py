"""Async database connection and session management.

Uses PostgreSQL via Lakebase with async SQLAlchemy and psycopg3 driver.

Implements automatic OAuth token refresh for Databricks Apps deployment:
- Tokens are refreshed every 50 minutes (before 1-hour expiry)
- SQLAlchemy's do_connect event injects fresh tokens into connections
- Falls back to static LAKEBASE_PG_URL for local development

Note: Uses psycopg3 (postgresql+psycopg) driver which supports hostaddr
parameter for DNS resolution workaround on macOS.
"""

import asyncio
import logging
import os
import socket
import subprocess
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional
from urllib.parse import urlparse

from sqlalchemy import URL, event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .models import Base

logger = logging.getLogger(__name__)

# Global engine and session factory
_engine: Optional[AsyncEngine] = None
_async_session_maker: Optional[async_sessionmaker[AsyncSession]] = None

# Token refresh state
_current_token: Optional[str] = None
_token_refresh_task: Optional[asyncio.Task] = None
_lakebase_instance_name: Optional[str] = None

# Token refresh interval (50 minutes - tokens expire after 1 hour)
TOKEN_REFRESH_INTERVAL_SECONDS = 50 * 60

# Cached resolved hostaddr for DNS workaround
_resolved_hostaddr: Optional[str] = None


def _resolve_hostname(hostname: str) -> Optional[str]:
    """Resolve hostname to IP address using system DNS tools.

    Python's socket.getaddrinfo() fails on macOS with long hostnames like
    Lakebase instance hostnames. This function uses the 'dig' command as
    a fallback to resolve the hostname.
    """
    try:
        result = socket.getaddrinfo(hostname, 5432)
        if result:
            return result[0][4][0]
    except socket.gaierror:
        pass

    try:
        result = subprocess.run(
            ['dig', '+short', hostname, 'A'],
            capture_output=True,
            text=True,
            timeout=10,
        )
        ips = [line for line in result.stdout.strip().split('\n') if line and line[0].isdigit()]
        if ips:
            logger.info(f'Resolved {hostname} -> {ips[0]} via dig (Python DNS failed)')
            return ips[0]
    except Exception as e:
        logger.warning(f'dig resolution failed for {hostname}: {e}')

    return None


def _get_workspace_client():
    """Get Databricks WorkspaceClient for token generation.

    Returns None if not running in a Databricks environment.
    """
    try:
        from databricks.sdk import WorkspaceClient

        if not os.environ.get('HOME'):
            os.environ['HOME'] = '/tmp'
            logger.info('Set HOME=/tmp for Databricks SDK config file lookup')

        return WorkspaceClient()
    except Exception as e:
        logger.error(f'Could not create WorkspaceClient: {e}', exc_info=True)
        return None


def _generate_lakebase_token(instance_name: str) -> Optional[str]:
    """Generate a fresh OAuth token for Lakebase connection."""
    client = _get_workspace_client()
    if not client:
        return None

    try:
        cred = client.database.generate_database_credential(
            request_id=str(uuid.uuid4()),
            instance_names=[instance_name],
        )
        logger.info(f'Generated new Lakebase token for instance: {instance_name}')
        return cred.token
    except Exception as e:
        logger.error(f'Failed to generate Lakebase token: {e}')
        return None


async def _token_refresh_loop():
    """Background task to refresh Lakebase OAuth token every 50 minutes."""
    global _current_token, _lakebase_instance_name

    while True:
        try:
            await asyncio.sleep(TOKEN_REFRESH_INTERVAL_SECONDS)

            if _lakebase_instance_name:
                new_token = await asyncio.to_thread(
                    _generate_lakebase_token, _lakebase_instance_name
                )
                if new_token:
                    _current_token = new_token
                    logger.info('Lakebase token refreshed successfully')
                else:
                    logger.warning('Failed to refresh Lakebase token')
        except asyncio.CancelledError:
            logger.info('Token refresh task cancelled')
            break
        except Exception as e:
            logger.error(f'Error in token refresh loop: {e}')


async def start_token_refresh():
    """Start the background token refresh task."""
    global _token_refresh_task

    if _token_refresh_task is not None:
        logger.warning('Token refresh task already running')
        return

    _token_refresh_task = asyncio.create_task(_token_refresh_loop())
    logger.info('Started Lakebase token refresh background task')


async def stop_token_refresh():
    """Stop the background token refresh task."""
    global _token_refresh_task

    if _token_refresh_task is not None:
        _token_refresh_task.cancel()
        try:
            await _token_refresh_task
        except asyncio.CancelledError:
            pass
        _token_refresh_task = None
        logger.info('Stopped Lakebase token refresh background task')


def get_database_url() -> Optional[str]:
    """Get database URL from environment.

    Converts standard PostgreSQL URL to psycopg3 async format if needed.
    """
    url = os.environ.get('LAKEBASE_PG_URL')
    if url and url.startswith('postgresql://'):
        url = url.replace('postgresql://', 'postgresql+psycopg://', 1)
    return url


def _prepare_async_url(url: str) -> tuple[str, dict]:
    """Prepare URL for psycopg3 async driver."""
    global _resolved_hostaddr

    if url.startswith('postgresql://'):
        url = url.replace('postgresql://', 'postgresql+psycopg://', 1)
    elif url.startswith('postgresql+asyncpg://'):
        url = url.replace('postgresql+asyncpg://', 'postgresql+psycopg://', 1)

    parsed = urlparse(url)
    connect_args = {}

    if parsed.hostname:
        hostaddr = _resolve_hostname(parsed.hostname)
        if hostaddr:
            connect_args['hostaddr'] = hostaddr
            _resolved_hostaddr = hostaddr
            logger.info(f'Static URL: resolved {parsed.hostname} -> {hostaddr}')

    return url, connect_args


def _get_current_user_email() -> Optional[str]:
    """Get the current user's email from Databricks SDK."""
    client = _get_workspace_client()
    if client:
        try:
            me = client.current_user.me()
            return me.user_name
        except Exception as e:
            logger.debug(f'Could not get current user: {e}')
    return None


def init_database(database_url: Optional[str] = None) -> AsyncEngine:
    """Initialize async database connection.

    Supports two modes:
    1. Static URL mode (local dev): Uses LAKEBASE_PG_URL with embedded password
    2. Dynamic token mode (production): Uses Databricks SDK for OAuth tokens
    """
    global _engine, _async_session_maker, _current_token, _lakebase_instance_name

    url = database_url or get_database_url()

    if url:
        logger.info('Using static LAKEBASE_PG_URL for database connection')
        url, connect_args = _prepare_async_url(url)
    else:
        instance_name = os.environ.get('LAKEBASE_INSTANCE_NAME')
        database_name = os.environ.get('LAKEBASE_DATABASE_NAME')

        if not instance_name or not database_name:
            raise ValueError(
                'No database configuration found. Set either:\n'
                '  - LAKEBASE_PG_URL (static URL with password), or\n'
                '  - LAKEBASE_INSTANCE_NAME and LAKEBASE_DATABASE_NAME (dynamic OAuth)'
            )

        _lakebase_instance_name = instance_name

        client = _get_workspace_client()
        if not client:
            raise ValueError('Could not create Databricks WorkspaceClient')

        instance = client.database.get_database_instance(name=instance_name)
        host = instance.read_write_dns

        _current_token = _generate_lakebase_token(instance_name)
        if not _current_token:
            raise ValueError(
                f'Failed to generate initial Lakebase token for instance: {instance_name}'
            )

        username = (
            os.environ.get('LAKEBASE_USERNAME')
            or os.environ.get('PGUSER')
            or os.environ.get('DATABRICKS_CLIENT_ID')
            or _get_current_user_email()
            or instance_name
        )
        used_auto_client_id = (
            not os.environ.get('LAKEBASE_USERNAME')
            and not os.environ.get('PGUSER')
            and os.environ.get('DATABRICKS_CLIENT_ID')
        )
        if used_auto_client_id:
            logger.info(f'Using DATABRICKS_CLIENT_ID as Lakebase username: {username}')

        global _resolved_hostaddr
        _resolved_hostaddr = _resolve_hostname(host)
        if _resolved_hostaddr:
            logger.info(f'Resolved {host} -> {_resolved_hostaddr}')

        url = URL.create(
            drivername='postgresql+psycopg',
            username=username,
            password='',
            host=host,
            port=int(os.environ.get('DATABRICKS_DATABASE_PORT', '5432')),
            database=database_name,
        )
        logger.info(f'Using dynamic OAuth tokens for Lakebase instance: {instance_name} ({host})')

        connect_args = {
            'sslmode': 'require',
        }
        if _resolved_hostaddr:
            connect_args['hostaddr'] = _resolved_hostaddr

    _engine = create_async_engine(
        url,
        pool_size=int(os.environ.get('DB_POOL_SIZE', '10')),
        max_overflow=int(os.environ.get('DB_MAX_OVERFLOW', '20')),
        pool_pre_ping=True,
        pool_recycle=int(os.environ.get('DB_POOL_RECYCLE_INTERVAL', '1800')),
        pool_timeout=int(os.environ.get('DB_POOL_TIMEOUT', '10')),
        echo=False,
        connect_args=connect_args,
    )

    if _lakebase_instance_name:
        @event.listens_for(_engine.sync_engine, 'do_connect')
        def provide_token(dialect, conn_rec, cargs, cparams):
            """Inject current OAuth token into connection parameters."""
            if _current_token:
                cparams['password'] = _current_token

    _async_session_maker = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )

    return _engine


def get_engine() -> AsyncEngine:
    """Get the database engine, initializing if needed."""
    global _engine
    if _engine is None:
        init_database()
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Get the async session factory, initializing if needed."""
    global _async_session_maker
    if _async_session_maker is None:
        init_database()
    return _async_session_maker


async def get_session() -> AsyncSession:
    """Create a new async database session."""
    factory = get_session_factory()
    return factory()


@asynccontextmanager
async def session_scope() -> AsyncGenerator[AsyncSession, None]:
    """Provide a transactional scope around a series of operations."""
    session = await get_session()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def create_tables():
    """Create all database tables asynchronously."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def is_postgres_configured() -> bool:
    """Check if PostgreSQL is configured (either static URL or dynamic OAuth)."""
    return bool(
        os.environ.get('LAKEBASE_PG_URL')
        or (
            os.environ.get('LAKEBASE_INSTANCE_NAME')
            and os.environ.get('LAKEBASE_DATABASE_NAME')
        )
    )


def is_dynamic_token_mode() -> bool:
    """Check if using dynamic OAuth token mode (vs static URL)."""
    return bool(
        not os.environ.get('LAKEBASE_PG_URL')
        and os.environ.get('LAKEBASE_INSTANCE_NAME')
        and os.environ.get('LAKEBASE_DATABASE_NAME')
    )
