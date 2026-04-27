# Gherkin Patterns for Databricks

Reusable Gherkin patterns for common Databricks testing scenarios. Copy and adapt these to feature files.

> **WARNING: Curly braces in step text break Behave's `parse` matcher.**
>
> Behave uses Python's `parse` library for step matching. Any `{...}` in step text
> is interpreted as a capture group. Writing `{test_schema}.customers` in a step line
> will **silently fail to match** your step definition.
>
> **The correct pattern:**
> - Step text uses **short table names in quotes**: `"customers"`, `"orders"`
> - SQL inside **docstrings** (triple-quoted blocks) can safely use `{schema}` because
>   docstrings are accessed via `context.text`, not step matching
> - Step definitions prepend `context.test_schema + "."` internally to build the FQN
>
> ```python
> # WRONG - step text with curly braces
> @given('a table "{test_schema}.customers" exists')   # BROKEN - parse eats {test_schema}
>
> # RIGHT - short name in step text, FQN built in the step body
> @given('a managed table "{table_name}" exists')
> def step_impl(context, table_name):
>     fqn = f"{context.test_schema}.{table_name}"
>     # ... use fqn
> ```
>
> **Docstring SQL pattern** (safe because `context.text` is just a string):
> ```python
> @when('I execute SQL:')
> def step_impl(context):
>     sql = context.text.replace("{schema}", context.test_schema)
>     # ... execute sql
> ```

## Common Background

Most Databricks feature files share this Background:

```gherkin
Background:
  Given a Databricks workspace connection is established
  And a test schema is provisioned
```

---

## Unity Catalog

### Table permissions

```gherkin
@catalog @permissions
Feature: Unity Catalog table permissions
  As a data engineer
  I want to verify table-level permissions
  So that sensitive data is properly protected

  Background:
    Given a Databricks workspace connection is established
    And a test schema is provisioned

  Scenario: Grant SELECT to a group
    Given a managed table "customers" exists
    When I execute SQL:
      """sql
      GRANT SELECT ON TABLE {schema}.customers TO `data_readers`
      """
    And I execute SQL:
      """sql
      SHOW GRANTS ON TABLE {schema}.customers
      """
    Then the result should contain a row where "ActionType" is "SELECT" and "Principal" is "data_readers"

  Scenario Outline: Verify multiple privilege types
    Given a managed table "sales" exists
    When I execute SQL:
      """sql
      GRANT <privilege> ON TABLE {schema}.sales TO `<group>`
      """
    And I execute SQL:
      """sql
      SHOW GRANTS ON TABLE {schema}.sales
      """
    Then the result should contain a row where "ActionType" is "<privilege>" and "Principal" is "<group>"

    Examples:
      | privilege | group         |
      | SELECT    | data_readers  |
      | MODIFY    | data_writers  |
```

### Column masks

```gherkin
@catalog @security
Feature: Column-level security

  Background:
    Given a Databricks workspace connection is established
    And a test schema is provisioned

  Scenario: Mask PII columns for analysts
    Given a managed table "customers" with columns:
      | column_name | data_type | contains_pii |
      | id          | BIGINT    | false        |
      | name        | STRING    | true         |
      | email       | STRING    | true         |
      | region      | STRING    | false        |
    And a column mask function "mask_pii" is applied to "name" and "email" on "customers"
    When I query "customers" as group "analysts"
    Then columns "name" and "email" should return masked values
    But columns "id" and "region" should return actual values
```

### Row filters

```gherkin
@catalog @security
Feature: Row-level security

  Background:
    Given a Databricks workspace connection is established
    And a test schema is provisioned

  Scenario: Row filter restricts by region
    Given a managed table "regional_sales" with data:
      | region | revenue | quarter |
      | APAC   | 50000   | Q1      |
      | EMEA   | 75000   | Q1      |
      | AMER   | 100000  | Q1      |
    And a row filter on "regional_sales" restricts "apac_analysts" to region "APAC"
    When I query "regional_sales" as group "apac_analysts"
    Then I should only see rows where "region" is "APAC"
    And the result should have 1 row
```

---

## Lakeflow Spark Declarative Pipelines

### Pipeline lifecycle

```gherkin
@pipeline @lakeflow
Feature: Events pipeline processing
  As a data engineer
  I want to verify the events pipeline processes data correctly
  So that downstream consumers get accurate aggregations

  Background:
    Given a Databricks workspace connection is established
    And a test schema is provisioned

  @integration @slow
  Scenario: Full refresh produces expected tables
    Given a pipeline "events_pipeline" exists targeting the test schema
    When I trigger a full refresh of the pipeline
    Then the pipeline update should succeed within 600 seconds
    And the streaming table "bronze_events" should exist
    And the materialized view "silver_events_agg" should exist
    And the table "silver_events_agg" should have more than 0 rows

  @integration
  Scenario: Incremental refresh picks up new data
    Given the pipeline "events_pipeline" has completed a full refresh
    When I insert test records into the source
    And I trigger an incremental refresh of the pipeline
    Then the pipeline update should succeed within 300 seconds
    And the new records should appear in "bronze_events"

  Scenario: Pipeline handles empty source gracefully
    Given a pipeline "events_pipeline" exists targeting the test schema
    And the source table is empty
    When I trigger a full refresh of the pipeline
    Then the pipeline update should succeed within 300 seconds
    And the streaming table "bronze_events" should have 0 rows
```

### Pipeline failure handling

```gherkin
  Scenario: Pipeline surfaces schema mismatch errors
    Given a pipeline "events_pipeline" exists targeting the test schema
    And the source table has an unexpected column "extra_col" of type "BINARY"
    When I trigger a full refresh of the pipeline
    Then the pipeline update should fail
    And the pipeline error should mention schema
```

---

## Jobs and Notebooks

### Notebook execution

```gherkin
@jobs @notebook
Feature: Customer ETL notebook
  As a data engineer
  I want to verify the ETL notebook produces correct output

  Background:
    Given a Databricks workspace connection is established
    And a test schema is provisioned

  @integration @slow
  Scenario: Dedup notebook removes duplicates
    Given a managed table "raw_customers" with data:
      | customer_id | name     | email             | updated_at          |
      | 1           | Alice    | alice@example.com | 2024-01-01T00:00:00 |
      | 1           | Alice B. | alice@example.com | 2024-06-01T00:00:00 |
      | 2           | Bob      | bob@example.com   | 2024-03-15T00:00:00 |
    When I run the notebook "/Repos/team/etl/customer_dedup" with parameters:
      | key          | value          |
      | source_table | raw_customers  |
      | target_table | clean_customers|
    Then the job should complete with status "SUCCESS" within 300 seconds
    And the table "clean_customers" should have 2 rows
    And the table "clean_customers" should contain a row where "customer_id" is "1" and "name" is "Alice B."

  Scenario: Notebook fails gracefully on missing source
    When I run the notebook "/Repos/team/etl/customer_dedup" with parameters:
      | key          | value          |
      | source_table | nonexistent    |
      | target_table | output         |
    Then the job should complete with status "FAILED" within 120 seconds
```

---

## Databricks Apps (FastAPI)

### API endpoint testing

```gherkin
@app @fastapi
Feature: Databricks App API
  As a user
  I want the app endpoints to work correctly

  Background:
    Given the app is running at the configured base URL
    And the test user is "testuser@databricks.com"

  @smoke
  Scenario: Health check
    When I GET "/health"
    Then the response status should be 200
    And the response JSON should contain "status" with value "healthy"

  Scenario: Authenticated user can list resources
    When I GET "/api/dashboards" with auth headers
    Then the response status should be 200
    And the response should be a JSON list

  Scenario: Unauthenticated request is rejected
    When I GET "/api/dashboards" without auth headers
    Then the response status should be 401

  Scenario: POST creates a resource
    When I POST "/api/items" with auth headers and body:
      """json
      {"name": "Test Item", "description": "Created by BDD test"}
      """
    Then the response status should be 201
    And the response JSON should contain "name" with value "Test Item"
```

### App deployment testing

```gherkin
@app @deployment @slow
Feature: App deployment lifecycle
  Scenario: Deploy and verify app is running
    Given a bundle project at the repository root
    When I deploy using Asset Bundles with target "dev"
    Then the deployment should succeed
    And the app should reach "RUNNING" state within 120 seconds
    And the app health endpoint should return 200
```

---

## SQL Data Quality

### Row counts and data validation

```gherkin
@sql @data-quality
Feature: Data quality checks

  Background:
    Given a Databricks workspace connection is established
    And a test schema is provisioned

  @smoke
  Scenario: Table is not empty
    Given the table "orders" has been loaded
    Then the table "orders" should have more than 0 rows

  Scenario: No duplicate primary keys
    Given the table "orders" has been loaded
    When I execute SQL:
      """sql
      SELECT order_id, COUNT(*) as cnt
      FROM {schema}.orders
      GROUP BY order_id
      HAVING COUNT(*) > 1
      """
    Then the result should have 0 rows

  Scenario: Foreign key integrity
    Given the tables "orders" and "customers" have been loaded
    When I execute SQL:
      """sql
      SELECT o.customer_id
      FROM {schema}.orders o
      LEFT JOIN {schema}.customers c ON o.customer_id = c.customer_id
      WHERE c.customer_id IS NULL
      """
    Then the result should have 0 rows

  Scenario: No null values in required columns
    When I execute SQL:
      """sql
      SELECT COUNT(*) as null_count
      FROM {schema}.orders
      WHERE order_id IS NULL OR customer_id IS NULL OR order_date IS NULL
      """
    Then the first row column "null_count" should be "0"

  Scenario: Verify GRANT was applied via SQL
    Given a managed table "products" exists
    When I execute SQL:
      """sql
      GRANT SELECT ON TABLE {schema}.products TO `reporting_team`
      """
    And I execute SQL:
      """sql
      SHOW GRANTS ON TABLE {schema}.products
      """
    Then the result should contain a row where "ActionType" is "SELECT" and "Principal" is "reporting_team"
```

---

## Lakebase branching

For Databricks Apps backed by Lakebase (managed PostgreSQL), create a short-lived branch
off `production` for each test run instead of provisioning a separate database. Branches
use copy-on-write storage — seeding is effectively free and tearing down is one API call.

```gherkin
@app @lakebase
Feature: Application backed by Lakebase
  As a developer
  I want each test run to use an isolated database branch
  So that tests do not contaminate production data

  Background:
    Given a Lakebase project "my-app" exists
    And a test branch is provisioned from "production"

  @smoke
  Scenario: New user is persisted to the test branch
    When I POST "/api/users" with auth headers and body:
      """json
      {"email": "alice@example.com", "name": "Alice"}
      """
    Then the response status should be 201
    And the table "users" in the test branch should contain a row where "email" is "alice@example.com"

  Scenario: Test branch isolates writes from production
    Given the production branch has 100 rows in "users"
    When I POST "/api/users" with auth headers and body:
      """json
      {"email": "bob@example.com", "name": "Bob"}
      """
    Then the table "users" in the test branch should have 101 rows
    And the table "users" in the production branch should still have 100 rows
```

The corresponding `environment.py` lifecycle:

```python
# features/environment.py — Lakebase branch hooks (sketch)
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.postgres import Branch, BranchSpec, Duration


def before_all(context):
    context.workspace = WorkspaceClient()
    context.lakebase_project = "projects/my-app"
    branch_id = f"behave-{int(time.time())}"

    branch = context.workspace.postgres.create_branch(
        parent=context.lakebase_project,
        branch=Branch(spec=BranchSpec(
            source_branch=f"{context.lakebase_project}/branches/production",
            ttl=Duration(seconds=3600),  # 1h safety net
        )),
        branch_id=branch_id,
    ).wait()
    context.test_branch = branch.name  # e.g. projects/my-app/branches/behave-...


def after_all(context):
    if hasattr(context, "test_branch"):
        context.workspace.postgres.delete_branch(name=context.test_branch)
```

Notes:

- The `ttl` is a safety net — if the test process crashes, Lakebase auto-deletes the branch.
- Connect through the branch's primary endpoint, not production's, when running tests.
  See `databricks-lakebase-autoscale` skill for the OAuth + `psycopg` connection pattern.
- For row-level assertions, expose two cursors — one bound to the test branch endpoint and
  one bound to production — so scenarios can verify isolation directly.

---

## Asset Bundles Deployment

```gherkin
@deployment @dabs
Feature: Bundle lifecycle
  @smoke
  Scenario: Bundle validates successfully
    When I run "databricks bundle validate" with target "dev"
    Then the command should exit with code 0

  @integration @slow
  Scenario: Deploy and destroy lifecycle
    When I run "databricks bundle deploy" with target "dev"
    Then the command should exit with code 0
    When I run "databricks bundle destroy" with target "dev" and auto-approve
    Then the command should exit with code 0
```

---

## Scenario Outline patterns

Use Scenario Outlines for testing multiple variations of the same behavior.

Note: table names in the Examples table are short names (no schema prefix). The step
definition prepends `context.test_schema` to build the fully-qualified name.

```gherkin
  Scenario Outline: Verify table existence after pipeline run
    Then the <table_type> "<table_name>" should exist

    Examples: Streaming tables
      | table_type      | table_name         |
      | streaming table | bronze_events      |
      | streaming table | bronze_transactions|

    Examples: Materialized views
      | table_type        | table_name       |
      | materialized view | silver_events_agg|
      | materialized view | gold_summary     |
```

---

## Steps with data tables and docstrings

Steps that accept a data table or docstring **must** end with a trailing colon. The colon
is part of the step text that Behave matches against your `@given`/`@when`/`@then` decorator.

```gherkin
# CORRECT - colon before data table
Given a managed table "customers" with data:
  | id | name  | region |
  | 1  | Alice | APAC   |
  | 2  | Bob   | EMEA   |

# CORRECT - colon before docstring
When I execute SQL:
  """sql
  SELECT * FROM {schema}.customers
  """

# WRONG - missing colon, Behave will not match the step
Given a managed table "customers" with data
  | id | name  | region |
```

---

## SHOW GRANTS column names

`SHOW GRANTS` returns PascalCase column names. Use these exact names when asserting
on grant results:

| Column       | Description                                    |
|--------------|------------------------------------------------|
| `Principal`  | The user, group, or service principal           |
| `ActionType` | The privilege (SELECT, MODIFY, ALL PRIVILEGES) |
| `ObjectType` | TABLE, SCHEMA, CATALOG, etc.                   |
| `ObjectKey`  | The fully-qualified object name                |

---

## Tag strategy

| Tag | Purpose | Typical runtime |
|-----|---------|----------------|
| `@smoke` | Critical path, must always pass | < 30s per scenario |
| `@regression` | Full coverage | Minutes |
| `@integration` | Needs live workspace | Varies |
| `@slow` | Pipeline/job execution | > 2 min |
| `@wip` | Work in progress, skip by default | N/A |
| `@skip` | Explicitly disabled | N/A |
| `@catalog` | Unity Catalog tests | Varies |
| `@pipeline` | Lakeflow SDP tests | Minutes |
| `@jobs` | Job/notebook tests | Minutes |
| `@app` | Databricks Apps tests | Seconds |
| `@sql` | SQL/data quality tests | Seconds |
| `@deployment` | DABs lifecycle tests | Minutes |
