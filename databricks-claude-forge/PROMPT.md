# Task: Fix deployment and add official Databricks templates

## Objective

Fix the Deploy functionality to properly deploy Databricks Apps using `databricks apps deploy` (not bundle deploy), and integrate templates from the official `databricks/app-templates` repository. The deploy button should work for simple apps with `app.yaml`.

## Context

Read these files to understand the current state:
- `server/routers/deploy.py` - Current deploy logic (uses `databricks bundle deploy` - wrong for simple apps)
- `server/services/templates.py` - Backend template definitions
- `client/src/lib/templates.ts` - Frontend template definitions
- `client/src/components/editor/DeployPanel.tsx` - Deploy UI component
- `client/src/pages/HomePage.tsx` - Template selection UI

Also read `progress.txt` if it exists - it contains learnings from previous iterations.

Check recent changes:
```bash
git log --oneline -10 -- server/routers/deploy.py server/services/templates.py
```

## Technical constraints

- Use `databricks apps deploy` for projects with `app.yaml` (simple Databricks Apps)
- Use `databricks bundle deploy` only for projects with `databricks.yml` (Asset Bundles)
- Templates should come from or be synced with https://github.com/databricks/app-templates
- Keep backward compatibility with existing projects
- Do NOT change the frontend React framework or major UI components

## Requirements

1. **Fix deploy command selection**: Detect whether project has `app.yaml` vs `databricks.yml` and use the appropriate deploy command:
   - `app.yaml` -> `databricks apps deploy <app-name> --source-code-path <project-dir>`
   - `databricks.yml` -> `databricks bundle deploy --target <target>`

2. **Add templates API endpoint**: Create `/api/templates` endpoint that returns available templates. Initially can be hardcoded, but structure should support future GitHub fetching.

3. **Update templates with official Databricks examples**: Update the template definitions to match the official `databricks/app-templates` repo structure. Include at minimum:
   - `streamlit-hello-world-app` - Simple Streamlit app
   - `dash-hello-world-app` - Simple Dash app
   - `flask-hello-world-app` - Simple Flask API
   - Keep existing templates (chatbot, dashboard, internal-tool, pipeline, databricks-app)

4. **Add app name configuration**: When deploying with `databricks apps deploy`, need to specify or auto-generate app name. Add UI field or auto-generate from project name.

5. **Fix deploy status parsing**: The current deploy status parsing expects bundle output format. Update to handle both bundle and apps deploy output.

## Test plan (write these FIRST)

Follow TDD - write failing tests before writing implementation code.

### Tests to create

- [ ] `server/tests/test_deploy.py`: `test_detect_app_yaml_uses_apps_deploy` - Verify projects with app.yaml use `databricks apps deploy`
- [ ] `server/tests/test_deploy.py`: `test_detect_databricks_yml_uses_bundle_deploy` - Verify projects with databricks.yml use `databricks bundle deploy`
- [ ] `server/tests/test_deploy.py`: `test_generate_app_name_from_project` - Verify app name generation is valid (lowercase, hyphenated, max length)
- [ ] `server/tests/test_templates.py`: `test_get_templates_endpoint` - Verify `/api/templates` returns list of templates
- [ ] `server/tests/test_templates.py`: `test_template_has_required_fields` - Verify each template has id, name, description, files

## Gates

Run `bash gates.sh` to verify all completion criteria at once. This script runs these checks:

| Gate | Command |
|------|---------|
| Lint | `ruff check server/` |
| Types | `cd client && npx tsc --noEmit` |
| Build | `cd client && npm run build` |

Output looks like:
```
  Lint         ok
  Types        ok
  Build        ok

All 3 gate(s) passed
```

## Completion criteria

The task is COMPLETE only when:
- [ ] `bash gates.sh` exits with code 0
- [ ] All tests from the test plan above are written and passing
- [ ] Deploy button works for a project with `app.yaml` (manually verified)

Do NOT assess completion subjectively. Run `bash gates.sh` and check the exit code.

## Instructions

Follow TDD (red-green-refactor) for each requirement:

1. Read the context files listed above
2. Read `progress.txt` if it exists to learn from previous iterations
3. **Red**: Write failing tests for requirement 1 (see test plan above)
4. Run `bash gates.sh` - the test gate should fail (this is expected)
5. **Green**: Write the minimum implementation to make the tests pass
6. Run `bash gates.sh` - all gates should pass now
7. **Refactor**: Clean up while keeping gates green
8. Repeat steps 3-7 for each remaining requirement
9. Commit working changes with clear messages
10. Append to `progress.txt` what you learned this iteration:
    - What you implemented
    - What worked / what didn't
    - Patterns discovered
    - Gotchas for future iterations

When `bash gates.sh` exits 0 AND all tests from the test plan are written, output:
<promise>TASK COMPLETE</promise>

CRITICAL RULES:
- Only output the promise AFTER running `bash gates.sh` and seeing it exit 0
- Do NOT output the promise based on your judgment alone - gates.sh must pass
- Do NOT lie or output a false promise to escape the loop, even if you feel stuck
- If gates fail, fix the code and re-run until they pass
- If genuinely stuck after sustained effort, append your blockers to `progress.txt` instead of declaring completion. Do NOT output the promise tag.

## Reference: Databricks CLI commands

```bash
# Deploy simple Databricks App (app.yaml)
databricks apps deploy <app-name> --source-code-path /path/to/project

# Deploy Asset Bundle (databricks.yml)
databricks bundle deploy --target dev

# Get app info
databricks apps get <app-name>

# List apps
databricks apps list
```

## Reference: Template structure from databricks/app-templates

Each template folder contains:
- `app.yaml` - Databricks Apps config
- `app.py` or `main.py` - Main application file
- `requirements.txt` - Python dependencies
- Optional: `README.md`, frontend files, etc.
