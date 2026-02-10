"""API routers module."""

from .agent import router as agent_router
from .clusters import router as clusters_router
from .config import router as config_router
from .conversations import router as conversations_router
from .deploy import router as deploy_router
from .files import router as files_router
from .git import router as git_router
from .health import router as health_router
from .preview import router as preview_router
from .projects import router as projects_router
from .pty import router as pty_router
from .skills import router as skills_router
from .templates import router as templates_router
from .terminal import router as terminal_router
from .warehouses import router as warehouses_router

__all__ = [
  'agent_router',
  'clusters_router',
  'config_router',
  'conversations_router',
  'deploy_router',
  'files_router',
  'git_router',
  'health_router',
  'preview_router',
  'projects_router',
  'pty_router',
  'skills_router',
  'templates_router',
  'terminal_router',
  'warehouses_router',
]
