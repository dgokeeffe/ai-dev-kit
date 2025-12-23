#!/bin/bash
# Quick start script for Databricks Natural Language Builder

echo "🚀 Starting Databricks Natural Language Builder..."
echo ""

# Check if .env exists, if not copy from example
if [ ! -f .env ]; then
    echo "📝 Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env and set your DATABRICKS_CONFIG_PROFILE"
    echo ""
fi

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check if databricks-mcp-core is installed
echo "🔍 Checking dependencies..."
python3 -c "import databricks_mcp_core" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "📦 Installing databricks-mcp-core..."
    pip install -e ../databricks-mcp-core
fi

# Install requirements
echo "📦 Installing requirements..."
pip install -r requirements.txt

echo ""
echo "✅ Setup complete!"
echo ""
echo "🌐 Starting application on http://localhost:8080"
echo "   Press Ctrl+C to stop"
echo ""

# Start the application
uvicorn app:app --host 0.0.0.0 --port ${DATABRICKS_APP_PORT:-8080}
