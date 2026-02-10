"""Templates API router.

Provides endpoints for listing and fetching project templates.
"""

import logging
from typing import Any

from fastapi import APIRouter

from ..services.templates import TEMPLATES

logger = logging.getLogger(__name__)
router = APIRouter()


def _format_template(template_id: str, template_data: dict) -> dict[str, Any]:
  """Format template data for API response.

  Args:
      template_id: Template identifier
      template_data: Raw template data from TEMPLATES dict

  Returns:
      Formatted template dict with id, name, description, files
  """
  return {
    'id': template_id,
    'name': template_data.get('name', template_id.replace('-', ' ').title()),
    'description': template_data.get('description', ''),
    'files': template_data.get('files', {}),
    'claude_md': template_data.get('claude_md', ''),
  }


@router.get('/templates')
async def get_templates() -> list[dict[str, Any]]:
  """Get list of available project templates.

  Returns:
      List of template objects with id, name, description, files
  """
  return [_format_template(tid, tdata) for tid, tdata in TEMPLATES.items()]


@router.get('/templates/{template_id}')
async def get_template(template_id: str) -> dict[str, Any]:
  """Get a specific template by ID.

  Args:
      template_id: Template identifier

  Returns:
      Template object with id, name, description, files

  Raises:
      HTTPException: If template not found
  """
  from fastapi import HTTPException

  if template_id not in TEMPLATES:
    raise HTTPException(status_code=404, detail=f'Template {template_id} not found')

  return _format_template(template_id, TEMPLATES[template_id])
