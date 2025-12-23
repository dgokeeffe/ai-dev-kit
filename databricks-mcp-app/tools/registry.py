"""
Tool Registry

Converts MCP tool definitions to OpenAI function calling format
and maps tool names to databricks-mcp-core handler functions.
"""
import os
import sys

# Add databricks-mcp-core to path
sys.path.insert(
    0, os.path.join(os.path.dirname(__file__), "../../databricks-mcp-core")
)

from databricks_mcp_core.unity_catalog import catalogs, schemas, tables
from databricks_mcp_core.spark_declarative_pipelines import pipelines, workspace_files
from databricks_mcp_core.synthetic_data_generation import (
    get_template,
    generate_and_upload_on_cluster
)


def fix_array_schemas(schema: dict) -> dict:
    """Fix array schemas to include items for OpenAI compatibility."""
    import copy
    schema = copy.deepcopy(schema)

    if isinstance(schema, dict):
        if schema.get("type") == "array" and "items" not in schema:
            # Add default items schema for arrays without items
            schema["items"] = {"type": "string"}

        # Recursively fix nested schemas
        for key, value in schema.items():
            if isinstance(value, dict):
                schema[key] = fix_array_schemas(value)
            elif isinstance(value, list):
                schema[key] = [fix_array_schemas(item) if isinstance(item, dict) else item for item in value]

    return schema


def mcp_to_openai_format(mcp_tool: dict) -> dict:
    """
    Convert MCP tool definition to OpenAI function format.

    MCP format:
    {
        "name": "tool_name",
        "description": "Tool description",
        "inputSchema": {"type": "object", "properties": {...}}
    }

    OpenAI format:
    {
        "type": "function",
        "function": {
            "name": "tool_name",
            "description": "Tool description",
            "parameters": {"type": "object", "properties": {...}}
        }
    }
    """
    # Fix array schemas for OpenAI compatibility
    input_schema = fix_array_schemas(mcp_tool["inputSchema"])

    return {
        "type": "function",
        "function": {
            "name": mcp_tool["name"],
            "description": mcp_tool["description"],
            "parameters": input_schema
        }
    }


def get_unity_catalog_tools():
    """Get Unity Catalog tool definitions in OpenAI format."""
    from databricks_mcp_server.tools import unity_catalog
    mcp_tools = unity_catalog.get_tool_definitions()
    return [mcp_to_openai_format(tool) for tool in mcp_tools]


def get_pipeline_tools():
    """Get Spark Declarative Pipeline tool definitions in OpenAI format."""
    from databricks_mcp_server.tools import spark_declarative_pipelines
    mcp_tools = spark_declarative_pipelines.get_tool_definitions()
    return [mcp_to_openai_format(tool) for tool in mcp_tools]


def get_synthetic_data_tools():
    """Get synthetic data generation tool definitions in OpenAI format."""
    from databricks_mcp_server.tools import synthetic_data_generation
    mcp_tools = synthetic_data_generation.get_tool_definitions()
    return [mcp_to_openai_format(tool) for tool in mcp_tools]


def get_all_tool_definitions():
    """
    Return all tool definitions in OpenAI function format.

    Returns:
        List of tool definitions ready for OpenAI function calling
    """
    tools = []
    tools.extend(get_unity_catalog_tools())
    tools.extend(get_pipeline_tools())
    tools.extend(get_synthetic_data_tools())
    return tools


def get_tool_handlers():
    """
    Map tool names to databricks-mcp-core handler functions.

    Returns:
        Dict mapping tool name -> handler function
    """
    # Import MCP server tool handlers
    from databricks_mcp_server.tools import (
        unity_catalog,
        spark_declarative_pipelines,
        synthetic_data_generation
    )

    # Combine all tool handlers
    handlers = {}
    handlers.update(unity_catalog.TOOL_HANDLERS)
    handlers.update(spark_declarative_pipelines.TOOL_HANDLERS)
    handlers.update(synthetic_data_generation.TOOL_HANDLERS)

    return handlers
