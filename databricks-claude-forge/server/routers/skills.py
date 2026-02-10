"""Skills explorer API endpoints."""

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from ..services import get_project_directory, reload_project_skills

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_skills_dir(project_id: str) -> Path:
  """Get the skills directory for a project."""
  project_dir = get_project_directory(project_id)
  return project_dir / '.claude' / 'skills'


def _build_tree_node(path: Path, base_path: Path) -> dict:
  """Build a tree node for a file or directory."""
  relative_path = str(path.relative_to(base_path))
  name = path.name

  if path.is_dir():
    children = []
    # Sort: directories first, then files, alphabetically
    items = sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
    for item in items:
      # Skip hidden files and __pycache__
      if item.name.startswith('.') or item.name == '__pycache__':
        continue
      children.append(_build_tree_node(item, base_path))
    return {
      'name': name,
      'path': relative_path,
      'type': 'directory',
      'children': children,
    }
  else:
    return {
      'name': name,
      'path': relative_path,
      'type': 'file',
    }


@router.get('/projects/{project_id}/skills/tree')
async def get_skills_tree(project_id: str):
  """Get the skills directory tree for a project.

  Returns a nested structure representing the skills folder:
  {
    "tree": [
      {
        "name": "skill-folder",
        "path": "skill-folder",
        "type": "directory",
        "children": [
          {"name": "SKILL.md", "path": "skill-folder/SKILL.md", "type": "file"},
          ...
        ]
      },
      ...
    ]
  }
  """
  skills_dir = _get_skills_dir(project_id)

  if not skills_dir.exists():
    return {'tree': []}

  tree = []
  # Sort: directories first, then files, alphabetically
  items = sorted(skills_dir.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))

  for item in items:
    # Skip hidden files
    if item.name.startswith('.'):
      continue
    tree.append(_build_tree_node(item, skills_dir))

  return {'tree': tree}


@router.get('/projects/{project_id}/skills/file')
async def get_skill_file(
  project_id: str,
  path: str = Query(..., description='Relative path to the file within the skills folder'),
):
  """Get the content of a skill file.

  Only allows reading files within the .claude/skills directory.
  Returns the raw content of the file.
  """
  skills_dir = _get_skills_dir(project_id)

  # Security: resolve the path and ensure it's within skills_dir
  try:
    # Normalize the path to prevent directory traversal
    requested_path = (skills_dir / path).resolve()

    # Ensure the resolved path is within the skills directory
    if not str(requested_path).startswith(str(skills_dir.resolve())):
      raise HTTPException(status_code=403, detail='Access denied: path outside skills directory')

    if not requested_path.exists():
      raise HTTPException(status_code=404, detail='File not found')

    if not requested_path.is_file():
      raise HTTPException(status_code=400, detail='Path is not a file')

    # Read and return the content
    content = requested_path.read_text(encoding='utf-8')
    return {
      'path': path,
      'content': content,
      'filename': requested_path.name,
    }

  except HTTPException:
    raise
  except Exception as e:
    logger.error(f'Failed to read skill file: {e}')
    raise HTTPException(status_code=500, detail=f'Failed to read file: {str(e)}')


@router.post('/projects/{project_id}/skills/reload')
async def reload_skills(project_id: str):
  """Reload skills for a project.

  This will:
  1. Refresh the app's skills cache from the source repo
  2. Remove the project's existing skills
  3. Copy the updated skills to the project

  Returns success status.
  """
  try:
    project_dir = get_project_directory(project_id)
    success = reload_project_skills(project_dir)

    if success:
      return {'success': True, 'message': 'Skills reloaded successfully'}
    else:
      raise HTTPException(status_code=500, detail='Failed to reload skills')

  except Exception as e:
    logger.error(f'Failed to reload skills: {e}')
    raise HTTPException(status_code=500, detail=f'Failed to reload skills: {str(e)}')
