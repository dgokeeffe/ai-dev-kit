"""File management endpoints for the code editor.

Provides file listing, reading, writing, and deletion for project directories.
All endpoints are scoped to the current authenticated user's projects.
"""

import fnmatch
import logging
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from ..services.backup_manager import ensure_project_directory, mark_for_backup
from ..services.storage import ProjectStorage
from ..services.user import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


class FileContent(BaseModel):
  """Request/response model for file content."""
  content: str


class CreateDirectoryRequest(BaseModel):
  """Request model for creating a directory."""
  path: str


class RenameFileRequest(BaseModel):
  """Request model for renaming/moving a file."""
  old_path: str
  new_path: str


class SearchResult(BaseModel):
  """Search result model."""
  path: str
  line_number: int
  line_content: str
  match_start: int
  match_end: int


def _get_file_info(file_path: Path, base_path: Path) -> dict:
  """Get file/directory info as a dict.

  Args:
      file_path: Absolute path to the file/directory
      base_path: Base project directory for relative path calculation

  Returns:
      Dict with file info (name, path, type, size, modified)
  """
  relative_path = str(file_path.relative_to(base_path))
  stat = file_path.stat()

  return {
    'name': file_path.name,
    'path': relative_path,
    'type': 'directory' if file_path.is_dir() else 'file',
    'size': stat.st_size if file_path.is_file() else None,
    'modified': stat.st_mtime,
  }


def _build_file_tree(directory: Path, base_path: Path, max_depth: int = 10) -> list[dict]:
  """Recursively build a file tree structure.

  Args:
      directory: Directory to scan
      base_path: Base project directory for relative path calculation
      max_depth: Maximum recursion depth

  Returns:
      List of file/directory info dicts with nested children
  """
  if max_depth <= 0:
    return []

  items = []

  try:
    # Sort: directories first, then files, both alphabetically
    entries = sorted(
      directory.iterdir(),
      key=lambda p: (not p.is_dir(), p.name.lower())
    )

    for entry in entries:
      # Skip hidden files and common ignored directories
      ignored = ('__pycache__', 'node_modules', '.git', 'venv', '.venv')
      if entry.name.startswith('.') or entry.name in ignored:
        continue

      info = _get_file_info(entry, base_path)

      if entry.is_dir():
        info['children'] = _build_file_tree(entry, base_path, max_depth - 1)

      items.append(info)
  except PermissionError:
    logger.warning(f'Permission denied accessing {directory}')
  except Exception as e:
    logger.error(f'Error scanning directory {directory}: {e}')

  return items


async def _verify_project_access(request: Request, project_id: str) -> Path:
  """Verify the user has access to the project and return the project directory.

  Args:
      request: FastAPI request object
      project_id: Project UUID

  Returns:
      Path to the project directory

  Raises:
      HTTPException: If project not found or access denied
  """
  user_email = await get_current_user(request)
  storage = ProjectStorage(user_email)

  project = await storage.get(project_id)
  if not project:
    raise HTTPException(status_code=404, detail=f'Project {project_id} not found')

  return ensure_project_directory(project_id)


def _validate_path(project_dir: Path, relative_path: str) -> Path:
  """Validate and resolve a file path within the project directory.

  Prevents path traversal attacks by ensuring the resolved path
  is within the project directory.

  Args:
      project_dir: Base project directory
      relative_path: Relative path within the project

  Returns:
      Resolved absolute path

  Raises:
      HTTPException: If path is invalid or outside project directory
  """
  # Normalize the path and resolve it
  try:
    # Remove leading slash if present
    clean_path = relative_path.lstrip('/')
    resolved = (project_dir / clean_path).resolve()

    # Ensure it's within the project directory
    if not str(resolved).startswith(str(project_dir.resolve())):
      raise HTTPException(
        status_code=400,
        detail='Invalid path: path traversal not allowed'
      )

    return resolved
  except Exception as e:
    raise HTTPException(status_code=400, detail=f'Invalid path: {e}')


@router.get('/projects/{project_id}/files')
async def list_files(request: Request, project_id: str):
  """List all files in a project directory as a tree structure.

  Returns a nested tree of files and directories with metadata.
  Hidden files (starting with .) are excluded.
  """
  project_dir = await _verify_project_access(request, project_id)

  logger.info(f'Listing files for project {project_id}')

  tree = _build_file_tree(project_dir, project_dir)

  return tree


@router.get('/projects/{project_id}/files/{file_path:path}')
async def read_file(request: Request, project_id: str, file_path: str):
  """Read a file's content.

  Args:
      request: FastAPI request object
      project_id: Project UUID
      file_path: Relative path to the file within the project

  Returns:
      File content and metadata
  """
  project_dir = await _verify_project_access(request, project_id)
  resolved_path = _validate_path(project_dir, file_path)

  if not resolved_path.exists():
    raise HTTPException(status_code=404, detail=f'File not found: {file_path}')

  if resolved_path.is_dir():
    raise HTTPException(status_code=400, detail='Cannot read directory as file')

  try:
    # Read file content
    content = resolved_path.read_text(encoding='utf-8')
    stat = resolved_path.stat()

    return {
      'path': file_path,
      'content': content,
      'encoding': 'utf-8',
      'size': stat.st_size,
      'modified': stat.st_mtime,
    }
  except UnicodeDecodeError:
    # Binary file - return base64 encoded
    import base64
    content = resolved_path.read_bytes()
    return {
      'path': file_path,
      'content': base64.b64encode(content).decode('ascii'),
      'encoding': 'base64',
      'size': len(content),
      'modified': resolved_path.stat().st_mtime,
    }
  except Exception as e:
    logger.error(f'Error reading file {file_path}: {e}')
    raise HTTPException(status_code=500, detail=f'Error reading file: {e}')


@router.put('/projects/{project_id}/files/{file_path:path}')
async def write_file(request: Request, project_id: str, file_path: str, body: FileContent):
  """Write content to a file (create or update).

  Creates parent directories if they don't exist.

  Args:
      request: FastAPI request object
      project_id: Project UUID
      file_path: Relative path to the file within the project
      body: File content to write
  """
  project_dir = await _verify_project_access(request, project_id)
  resolved_path = _validate_path(project_dir, file_path)

  # Create parent directories if needed
  resolved_path.parent.mkdir(parents=True, exist_ok=True)

  try:
    resolved_path.write_text(body.content, encoding='utf-8')

    # Mark project for backup
    mark_for_backup(project_id)

    logger.info(f'Wrote file {file_path} in project {project_id}')

    return {
      'path': file_path,
      'size': len(body.content.encode('utf-8')),
      'modified': resolved_path.stat().st_mtime,
    }
  except Exception as e:
    logger.error(f'Error writing file {file_path}: {e}')
    raise HTTPException(status_code=500, detail=f'Error writing file: {e}')


@router.delete('/projects/{project_id}/files/{file_path:path}')
async def delete_file(request: Request, project_id: str, file_path: str):
  """Delete a file or empty directory.

  Args:
      request: FastAPI request object
      project_id: Project UUID
      file_path: Relative path to the file within the project
  """
  project_dir = await _verify_project_access(request, project_id)
  resolved_path = _validate_path(project_dir, file_path)

  if not resolved_path.exists():
    raise HTTPException(status_code=404, detail=f'File not found: {file_path}')

  try:
    if resolved_path.is_dir():
      # Only allow deleting empty directories
      if any(resolved_path.iterdir()):
        raise HTTPException(
          status_code=400,
          detail='Cannot delete non-empty directory'
        )
      resolved_path.rmdir()
    else:
      resolved_path.unlink()

    # Mark project for backup
    mark_for_backup(project_id)

    logger.info(f'Deleted {file_path} from project {project_id}')

    return {'success': True, 'deleted_path': file_path}
  except HTTPException:
    raise
  except Exception as e:
    logger.error(f'Error deleting {file_path}: {e}')
    raise HTTPException(status_code=500, detail=f'Error deleting file: {e}')


@router.post('/projects/{project_id}/directories')
async def create_directory(request: Request, project_id: str, body: CreateDirectoryRequest):
  """Create a new directory.

  Creates parent directories if they don't exist.

  Args:
      request: FastAPI request object
      project_id: Project UUID
      body: Directory path to create
  """
  project_dir = await _verify_project_access(request, project_id)
  resolved_path = _validate_path(project_dir, body.path)

  if resolved_path.exists():
    raise HTTPException(status_code=400, detail='Path already exists')

  try:
    resolved_path.mkdir(parents=True, exist_ok=True)

    # Mark project for backup
    mark_for_backup(project_id)

    logger.info(f'Created directory {body.path} in project {project_id}')

    return {'success': True, 'path': body.path}
  except Exception as e:
    logger.error(f'Error creating directory {body.path}: {e}')
    raise HTTPException(status_code=500, detail=f'Error creating directory: {e}')


@router.post('/projects/{project_id}/files/rename')
async def rename_file(request: Request, project_id: str, body: RenameFileRequest):
  """Rename or move a file/directory.

  Args:
      request: FastAPI request object
      project_id: Project UUID
      body: Old and new paths
  """
  project_dir = await _verify_project_access(request, project_id)
  old_resolved = _validate_path(project_dir, body.old_path)
  new_resolved = _validate_path(project_dir, body.new_path)

  if not old_resolved.exists():
    raise HTTPException(status_code=404, detail=f'File not found: {body.old_path}')

  if new_resolved.exists():
    raise HTTPException(status_code=400, detail=f'Destination already exists: {body.new_path}')

  try:
    # Create parent directories for new path if needed
    new_resolved.parent.mkdir(parents=True, exist_ok=True)

    old_resolved.rename(new_resolved)

    # Mark project for backup
    mark_for_backup(project_id)

    logger.info(f'Renamed {body.old_path} to {body.new_path} in project {project_id}')

    return {
      'success': True,
      'old_path': body.old_path,
      'new_path': body.new_path,
    }
  except Exception as e:
    logger.error(f'Error renaming {body.old_path} to {body.new_path}: {e}')
    raise HTTPException(status_code=500, detail=f'Error renaming file: {e}')


def _search_file(
  file_path: Path,
  base_path: Path,
  pattern: re.Pattern,
  max_results: int = 100
) -> list[SearchResult]:
  """Search a single file for matches.

  Args:
      file_path: Path to the file to search
      base_path: Base project directory
      pattern: Compiled regex pattern
      max_results: Maximum results per file

  Returns:
      List of search results
  """
  results = []
  relative_path = str(file_path.relative_to(base_path))

  try:
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
      for line_num, line in enumerate(f, 1):
        if len(results) >= max_results:
          break

        for match in pattern.finditer(line):
          results.append(SearchResult(
            path=relative_path,
            line_number=line_num,
            line_content=line.rstrip('\n\r')[:500],  # Limit line length
            match_start=match.start(),
            match_end=match.end()
          ))

          if len(results) >= max_results:
            break
  except Exception as e:
    logger.debug(f'Error searching file {file_path}: {e}')

  return results


def _get_searchable_files(
  directory: Path,
  glob_pattern: Optional[str] = None,
  max_depth: int = 10
) -> list[Path]:
  """Get list of searchable files in directory.

  Args:
      directory: Directory to search
      glob_pattern: Optional glob pattern to filter files (e.g., "*.py")
      max_depth: Maximum recursion depth

  Returns:
      List of file paths
  """
  files = []
  ignored_dirs = {'.git', '__pycache__', 'node_modules', 'venv', '.venv', '.idea', '.vscode'}
  ignored_extensions = {'.pyc', '.pyo', '.so', '.o', '.a', '.exe', '.dll', '.dylib',
                        '.jpg', '.jpeg', '.png', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz'}

  def _walk(path: Path, depth: int):
    if depth > max_depth:
      return

    try:
      for entry in path.iterdir():
        if entry.name.startswith('.'):
          continue

        if entry.is_dir():
          if entry.name not in ignored_dirs:
            _walk(entry, depth + 1)
        elif entry.is_file():
          # Check extension
          if entry.suffix.lower() in ignored_extensions:
            continue

          # Check glob pattern
          if glob_pattern:
            if not fnmatch.fnmatch(entry.name, glob_pattern):
              # Also check full relative path
              rel_path = str(entry.relative_to(directory))
              if not fnmatch.fnmatch(rel_path, glob_pattern):
                continue

          files.append(entry)
    except PermissionError:
      pass

  _walk(directory, 0)
  return files


@router.get('/projects/{project_id}/files/search')
async def search_files(
  request: Request,
  project_id: str,
  query: str = Query(..., min_length=1, description='Search query'),
  case_sensitive: bool = Query(False, description='Case sensitive search'),
  regex: bool = Query(False, description='Treat query as regex'),
  glob: Optional[str] = Query(None, description='File glob pattern (e.g., *.py)')
) -> list[SearchResult]:
  """Search for text in project files.

  Args:
      request: FastAPI request object
      project_id: Project UUID
      query: Search query string
      case_sensitive: Whether search is case sensitive
      regex: Whether query is a regex pattern
      glob: Optional glob pattern to filter files

  Returns:
      List of search results with file path, line number, and match info
  """
  project_dir = await _verify_project_access(request, project_id)

  logger.info(f'Searching files in project {project_id} for: {query}')

  # Compile pattern
  try:
    flags = 0 if case_sensitive else re.IGNORECASE
    if regex:
      pattern = re.compile(query, flags)
    else:
      pattern = re.compile(re.escape(query), flags)
  except re.error as e:
    raise HTTPException(status_code=400, detail=f'Invalid regex pattern: {e}')

  # Get searchable files
  files = _get_searchable_files(project_dir, glob)

  # Search files
  all_results: list[SearchResult] = []
  max_total_results = 500

  for file_path in files:
    if len(all_results) >= max_total_results:
      break

    remaining = max_total_results - len(all_results)
    results = _search_file(file_path, project_dir, pattern, remaining)
    all_results.extend(results)

  return all_results
