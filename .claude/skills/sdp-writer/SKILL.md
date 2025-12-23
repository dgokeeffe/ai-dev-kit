---
name: sdp-writer
description: "Create, configure, or update Databricks' Lakeflow Spark Declarative Pipelines (SDP), also known as LDP, or historically Delta Live Tables (DLT). User should guide on using SQL or Python syntax.

This skill leverages modern best practices for cost, performance, and scalability. Use when working with: (1) Creating new Databricks Declarative Pipeline projects in SQL or Python, (2) Updating existing pipelines, (3) Migrating to SDP from legacy systems, (4) Comparing approaches (serverless vs classic compute, SQL vs Python).
---

# Lakeflow Spark Declarative Pipelines (SDP) Writer

## Overview
Create SDP pipelines in SQL or Python with 2025 best practices.

**Language Selection** (prompt if not specified):
- **SQL**: Simple transformations, SQL team, declarative style
- **Python**: Complex logic, UDFs, Python team (see [python-api-versions.md](python-api-versions.md) for modern `dp` API)

**Modern Approach (2025)**:
- Use `CLUSTER BY` (Liquid Clustering) not `PARTITION BY`
- Use serverless compute for auto-scaling
- Always generate DABs configuration via **dabs-writer** skill for deployment


## Reference Documentation

Load these modules for detailed patterns:

- **[ingestion-patterns.md](ingestion-patterns.md)** - Auto Loader, Kafka, Event Hub, file formats
- **[streaming-patterns.md](streaming-patterns.md)** - Deduplication, windowing, stateful operations
- **[scd-query-patterns.md](scd-query-patterns.md)** - Querying SCD2 history tables
- **[dlt-migration-guide.md](dlt-migration-guide.md)** - Migrating from DLT Python to SDP SQL
- **[performance-tuning.md](performance-tuning.md)** - Liquid Clustering, optimization, compute config

---

## Development Environment

### Lakeflow Pipelines Editor (Recommended)

**Use the new Pipelines Editor** (not DLT notebooks):
- Multi-file tabbed editor with .sql/.py files
- Interactive DAG with data preview
- Selective execution (single file or full pipeline)
- Dry run validation without materializing data

**Medallion folder structure**:
```
PipelineName/
└── transformations/
    ├── bronze/    # Raw ingestion
    ├── silver/    # Cleaned, validated
    └── gold/      # Aggregated analytics
```

### ⚠️ API: Always Preserve root_path

When updating pipelines via API, **always include `root_path`**:
- Required for folder structure display in UI
- Required for Python imports from utilities
- Easily lost during PUT requests

```json
{
  "name": "Pipeline",
  "catalog": "my_catalog",
  "target": "my_schema",
  "root_path": "/Workspace/Users/.../PipelineName",  // Critical!
  "libraries": [...]
}
```

### ⚠️ Use .sql/.py Files, Not DLT Notebooks

**Old approach** (avoid):
```python
# MAGIC %sql
# MAGIC CREATE OR REFRESH STREAMING TABLE my_table
# MAGIC AS SELECT * FROM source
```

**New approach** (use):
```sql
-- File: transformations/bronze/my_table.sql
CREATE OR REFRESH STREAMING TABLE my_table
AS SELECT * FROM source;
```

Use `"file"` library type in pipeline config, not `"notebook"` library type.

---

## Core Patterns

All examples use Unity Catalog three-part names: `catalog.schema.table`

### Bronze Layer (Ingestion)

```sql
CREATE OR REPLACE STREAMING TABLE catalog.schema.bronze_orders
CLUSTER BY (order_date, region)
AS
SELECT *, current_timestamp() AS _ingested_at
FROM read_files('/mnt/raw/orders/', format => 'json',
  schemaHints => 'order_id STRING, amount DECIMAL(10,2)');
```

**See [ingestion-patterns.md](ingestion-patterns.md)** for Auto Loader options, Kafka/Event Hub sources, schema evolution

### Silver Layer (Cleansing)

```sql
CREATE OR REPLACE STREAMING TABLE catalog.schema.silver_orders
CLUSTER BY (customer_id, order_date)
AS
SELECT
  CAST(order_id AS STRING) AS order_id,
  customer_id,
  CAST(order_date AS DATE) AS order_date,
  CAST(total_amount AS DECIMAL(10,2)) AS total_amount
FROM STREAM catalog.schema.bronze_orders
WHERE total_amount IS NOT NULL AND order_id IS NOT NULL;
```

**Data Quality**: Use WHERE for filtering. **See [ingestion-patterns.md](ingestion-patterns.md)** for quarantine patterns

### Gold Layer (Aggregation)

```sql
CREATE OR REPLACE MATERIALIZED VIEW catalog.schema.gold_sales_summary
CLUSTER BY (order_day)
AS
SELECT
  date_trunc('day', order_date) AS order_day,
  COUNT(DISTINCT order_id) AS order_count,
  SUM(total_amount) AS daily_sales
FROM catalog.schema.silver_orders
GROUP BY date_trunc('day', order_date);
```

**See [performance-tuning.md](performance-tuning.md)** for clustering strategies, MV refresh optimization

### Temporary View (Intermediate)

```sql
CREATE TEMPORARY VIEW filtered_orders
AS SELECT * FROM catalog.schema.silver_orders
WHERE order_date >= CURRENT_DATE() - INTERVAL 30 DAYS;
```

**Python**:
```python
@dp.temporary_view()
def filtered_orders():
    return spark.read.table("catalog.schema.silver_orders").filter("order_date >= current_date() - interval 30 days")
```

**Use for**: Intermediate transformations not persisted to storage

### Multiple Sources to One Target

```python
dp.create_streaming_table("all_events")

@dp.append_flow(target="all_events")
def source_a_events():
    return spark.readStream.table("catalog.schema.source_a")

@dp.append_flow(target="all_events")
def source_b_events():
    return spark.readStream.table("catalog.schema.source_b")
```

**Use for**: Combining multiple streams into unified table

### SCD Type 1 (Current State Only)

```sql
CREATE OR REFRESH STREAMING TABLE catalog.schema.customers;

CREATE FLOW catalog.schema.customers_cdc_flow AS
AUTO CDC INTO catalog.schema.customers
FROM stream(catalog.schema.customers_cdc_clean)
KEYS (customer_id)
SEQUENCE BY event_timestamp
APPLY AS DELETE WHEN operation = "DELETE"
COLUMNS * EXCEPT (operation, event_timestamp, _rescued_data)
STORED AS SCD TYPE 1;
```

### SCD Type 2 (History Tracking)

```sql
CREATE OR REFRESH STREAMING TABLE catalog.schema.customers_history;

CREATE FLOW catalog.schema.customers_history_cdc AS
AUTO CDC INTO catalog.schema.customers_history
FROM stream(catalog.schema.customers_cdc_clean)
KEYS (customer_id)
SEQUENCE BY event_timestamp
APPLY AS DELETE WHEN operation = "DELETE"
COLUMNS * EXCEPT (operation, event_timestamp, _rescued_data)
STORED AS SCD TYPE 2
TRACK HISTORY ON *;
```

Auto-generates START_AT/END_AT columns. **See [scd-query-patterns.md](scd-query-patterns.md)** for querying patterns

**Selective tracking**: Use `TRACK HISTORY ON price, cost` to track only specific columns

**See [streaming-patterns.md](streaming-patterns.md)** for deduplication, windowing, late-arriving data, joins

### Execution Modes

- **Triggered**: Scheduled batch (lower cost, configure in pipeline settings)
- **Continuous**: Real-time streaming (sub-second latency, configure in pipeline settings)

### Deployment with DABs

**Always create DABs configuration** for SDP pipelines to enable multi-environment deployment and CI/CD.

**Use dabs-writer skill** to generate proper bundle configuration:

```bash
databricks bundle deploy -t dev
databricks bundle run my_pipeline -t dev
```

**See dabs-writer skill** for complete multi-environment setup, permissions, and CI/CD patterns

---

## Platform Constraints

| Constraint | Details |
|------------|---------|
| **CDC Features** | Requires serverless or Pro/Advanced edition |
| **Schema Evolution** | Streaming tables require full refresh for incompatible changes |
| **Stream Joins** | Don't recompute when dimension tables change (use MV for that) |
| **Sinks** | Python only, streaming only, append flows only |
| **SQL Limitations** | PIVOT clause unsupported in pipelines |

---

## Common Issues

| Issue | Solution |
|-------|----------|
| **Streaming reads fail** | Use `FROM stream(...)` for append-only sources |
| **Misordered CDC updates** | Use strictly increasing SEQUENCE BY field (non-NULL timestamp) |
| **SCD2 schema errors** | Let SDP infer START_AT/END_AT or include both with SEQUENCE BY type |
| **AUTO CDC target conflicts** | Keep CDC targets exclusive to AUTO CDC flows |
| **MV doesn't refresh incrementally** | Enable Delta row tracking on source, avoid row filters |
| **High latency/cost** | Use triggered mode for batch; continuous only for sub-second SLA |
| **Slow startups** | Use serverless compute (not classic clusters) |
| **Deletes not honored** | Increase `pipelines.cdc.tombstoneGCThresholdInSeconds` |

**For detailed troubleshooting**, see individual reference files

## Resources

- [Lakeflow Spark Declarative Pipeline Documentation](https://docs.databricks.com/aws/en/ldp/)
- [Change Data Capture Documentation] (https://docs.databricks.com/aws/en/ldp/cdc) 
- [Lakeflow Spark Declarative Pipeline load data](https://docs.databricks.com/aws/en/ldp/load)
- [Reference Architecture ](https://www.databricks.com/resources/architectures/build-production-etl-with-lakeflow-declarative-pipelines)
- [Legacy - Delta Live Tables Documentation](https://docs.databricks.com/workflows/delta-live-tables/)