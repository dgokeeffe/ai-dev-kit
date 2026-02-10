"""Tests for templates functionality."""

from fastapi.testclient import TestClient


def test_get_templates_endpoint():
  """Verify `/api/templates` returns list of templates."""
  from server.app import app

  client = TestClient(app)
  response = client.get('/api/templates')

  assert response.status_code == 200
  data = response.json()
  assert isinstance(data, list)
  assert len(data) > 0


def test_template_has_required_fields():
  """Verify each template has id, name, description, files."""
  from server.app import app

  client = TestClient(app)
  response = client.get('/api/templates')
  data = response.json()

  required_fields = ['id', 'name', 'description', 'files']

  for template in data:
    for field in required_fields:
      tid = template.get('id', 'unknown')
      assert field in template, f"Template '{tid}' missing field '{field}'"


def test_templates_include_streamlit_hello_world():
  """Verify streamlit-hello-world-app template is included."""
  from server.app import app

  client = TestClient(app)
  response = client.get('/api/templates')
  data = response.json()

  template_ids = [t['id'] for t in data]
  assert 'streamlit-hello-world-app' in template_ids


def test_templates_include_dash_hello_world():
  """Verify dash-hello-world-app template is included."""
  from server.app import app

  client = TestClient(app)
  response = client.get('/api/templates')
  data = response.json()

  template_ids = [t['id'] for t in data]
  assert 'dash-hello-world-app' in template_ids


def test_templates_include_flask_hello_world():
  """Verify flask-hello-world-app template is included."""
  from server.app import app

  client = TestClient(app)
  response = client.get('/api/templates')
  data = response.json()

  template_ids = [t['id'] for t in data]
  assert 'flask-hello-world-app' in template_ids


def test_template_files_are_dict():
  """Verify template files field is a dictionary."""
  from server.app import app

  client = TestClient(app)
  response = client.get('/api/templates')
  data = response.json()

  for template in data:
    assert isinstance(template['files'], dict), f"Template '{template['id']}' files is not a dict"
