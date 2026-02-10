"""Project management endpoints.

All endpoints are scoped to the current authenticated user.
"""

import logging

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from ..services.backup_manager import ensure_project_directory
from ..services.storage import ProjectStorage
from ..services.user import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateProjectRequest(BaseModel):
  """Request to create a new project."""

  name: str
  template: str | None = None


class UpdateProjectRequest(BaseModel):
  """Request to update a project."""

  name: str


@router.get('/projects')
async def get_all_projects(
  request: Request,
  limit: int = Query(50, ge=1, le=100, description="Maximum number of projects to return"),
  offset: int = Query(0, ge=0, description="Number of projects to skip")
):
  """Get all projects for the current user sorted by created_at (newest first).

  Supports pagination via limit and offset parameters for improved performance with large datasets.
  """
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)

  logger.info(f'Fetching projects for user: {user_email} (limit={limit}, offset={offset})')
  projects = await storage.get_all(limit=limit, offset=offset)
  logger.info(f'Retrieved {len(projects)} projects for user: {user_email}')

  return [project.to_dict() for project in projects]


@router.get('/projects/{project_id}')
async def get_project(request: Request, project_id: str):
  """Get a specific project by ID."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)

  logger.info(f'Fetching project {project_id} for user: {user_email}')

  project = await storage.get(project_id)
  if not project:
    logger.warning(f'Project not found: {project_id} for user: {user_email}')
    raise HTTPException(status_code=404, detail=f'Project {project_id} not found')

  return project.to_dict()


@router.post('/projects')
async def create_project(request: Request, body: CreateProjectRequest):
  """Create a new project."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)

  logger.info(f"Creating project '{body.name}' for user: {user_email}")

  project = await storage.create(name=body.name)
  logger.info(f'Created project {project.id} for user: {user_email}')

  # Initialize project directory
  project_dir = ensure_project_directory(project.id)

  # Copy skills to project
  from ..services.skills_manager import copy_skills_to_project, get_skills_summary

  copy_skills_to_project(project_dir)

  # Write template files if specified
  if body.template:
    from ..services.templates import write_template_files

    write_template_files(project_dir, body.template)

  # Update project CLAUDE.md with skills summary
  claude_md_path = project_dir / 'CLAUDE.md'
  skills_summary = get_skills_summary()
  if skills_summary:
    if claude_md_path.exists():
      # Append skills to existing CLAUDE.md from template
      existing_content = claude_md_path.read_text()
      if skills_summary not in existing_content:
        claude_md_path.write_text(existing_content + '\n\n' + skills_summary)
    else:
      # Create new CLAUDE.md with just skills
      claude_md_path.write_text(skills_summary)

  return project.to_dict()


@router.patch('/projects/{project_id}')
async def update_project(request: Request, project_id: str, body: UpdateProjectRequest):
  """Update a project's name."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)

  logger.info(f'Updating project {project_id} for user: {user_email}')

  success = await storage.update_name(project_id, body.name)
  if not success:
    logger.warning(f'Project not found for update: {project_id} for user: {user_email}')
    raise HTTPException(status_code=404, detail=f'Project {project_id} not found')

  logger.info(f'Updated project {project_id} for user: {user_email}')
  return {'success': True, 'project_id': project_id}


@router.delete('/projects/{project_id}')
async def delete_project(request: Request, project_id: str):
  """Delete a project and all its conversations."""
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)

  logger.info(f'Deleting project {project_id} for user: {user_email}')

  success = await storage.delete(project_id)
  if not success:
    logger.warning(f'Project not found for deletion: {project_id} for user: {user_email}')
    raise HTTPException(status_code=404, detail=f'Project {project_id} not found')

  logger.info(f'Deleted project {project_id} for user: {user_email}')
  return {'success': True, 'deleted_project_id': project_id}
