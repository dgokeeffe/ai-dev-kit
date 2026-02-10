"""Tests for deploy router functionality."""

import tempfile
from pathlib import Path


def test_detect_app_yaml_uses_apps_deploy():
  """Verify projects with app.yaml use `databricks apps deploy`."""
  from server.routers.deploy import detect_deploy_command

  with tempfile.TemporaryDirectory() as tmpdir:
    project_dir = Path(tmpdir)
    # Create app.yaml
    (project_dir / 'app.yaml').write_text('command:\n  - python\n  - app.py\n')

    result = detect_deploy_command(project_dir)

    assert result['type'] == 'apps', f"Expected 'apps', got '{result['type']}'"
    assert 'databricks' in result['command'][0]
    assert 'apps' in result['command']
    assert 'deploy' in result['command']


def test_detect_databricks_yml_uses_bundle_deploy():
  """Verify projects with databricks.yml use `databricks bundle deploy`."""
  from server.routers.deploy import detect_deploy_command

  with tempfile.TemporaryDirectory() as tmpdir:
    project_dir = Path(tmpdir)
    # Create databricks.yml
    (project_dir / 'databricks.yml').write_text('bundle:\n  name: test\n')

    result = detect_deploy_command(project_dir)

    assert result['type'] == 'bundle', f"Expected 'bundle', got '{result['type']}'"
    assert 'databricks' in result['command'][0]
    assert 'bundle' in result['command']
    assert 'deploy' in result['command']


def test_detect_both_files_prefers_apps_deploy():
  """When both app.yaml and databricks.yml exist, prefer apps deploy."""
  from server.routers.deploy import detect_deploy_command

  with tempfile.TemporaryDirectory() as tmpdir:
    project_dir = Path(tmpdir)
    # Create both files
    (project_dir / 'app.yaml').write_text('command:\n  - python\n  - app.py\n')
    (project_dir / 'databricks.yml').write_text('bundle:\n  name: test\n')

    result = detect_deploy_command(project_dir)

    # app.yaml takes precedence for simple apps
    assert result['type'] == 'apps', f"Expected 'apps' when both exist, got '{result['type']}'"


def test_generate_app_name_from_project():
  """Verify app name generation is valid (lowercase, hyphenated, max length)."""
  from server.routers.deploy import _generate_app_name

  # Basic test
  result = _generate_app_name('My Project', 'dev')
  assert result == 'my-project-dev'

  # With special characters
  result = _generate_app_name('Project_Test!@#$%', 'dev')
  assert result == 'project-test-dev'
  assert not any(c in result for c in '!@#$%_')

  # With spaces
  result = _generate_app_name('Multiple   Spaces', 'prod')
  assert '--' not in result  # No double hyphens

  # Max length (50 chars total including target)
  long_name = 'a' * 100
  result = _generate_app_name(long_name, 'dev')
  assert len(result) <= 50


def test_generate_app_name_handles_edge_cases():
  """Test edge cases for app name generation."""
  from server.routers.deploy import _generate_app_name

  # Empty name should still produce valid result with target
  result = _generate_app_name('', 'dev')
  assert result == 'dev' or result.endswith('-dev')

  # All special characters
  result = _generate_app_name('!!!', 'dev')
  # Should fall back to just the target
  assert 'dev' in result


def test_detect_no_config_returns_none():
  """Verify projects without config files return None."""
  from server.routers.deploy import detect_deploy_command

  with tempfile.TemporaryDirectory() as tmpdir:
    project_dir = Path(tmpdir)
    # No config files

    result = detect_deploy_command(project_dir)

    assert result is None
