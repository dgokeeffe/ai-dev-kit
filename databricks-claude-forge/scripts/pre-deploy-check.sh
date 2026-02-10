#!/bin/bash

# Pre-deployment validation checklist
# Checks prerequisites and configurations before deploying to Databricks Apps

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "================================================"
echo "Pre-Deployment Validation Checklist"
echo "================================================"
echo ""

ERRORS=0
WARNINGS=0

# Check Databricks CLI authentication
echo -n "Checking Databricks CLI authentication... "
if databricks auth describe &>/dev/null; then
  echo -e "${GREEN}✓ Authenticated${NC}"
  WORKSPACE=$(databricks auth describe | grep -i host | awk '{print $2}')
  echo "  Workspace: $WORKSPACE"
else
  echo -e "${RED}✗ Not authenticated${NC}"
  echo "  Run: databricks auth login"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Check Node.js version
echo -n "Checking Node.js version... "
if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version | sed 's/v//')
  MAJOR_VERSION=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$MAJOR_VERSION" -ge 18 ]; then
    echo -e "${GREEN}✓ Node.js $NODE_VERSION${NC}"
  else
    echo -e "${YELLOW}⚠ Node.js $NODE_VERSION (v18+ recommended)${NC}"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  echo -e "${RED}✗ Node.js not found${NC}"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Check Python version
echo -n "Checking Python version... "
if command -v python &>/dev/null; then
  PYTHON_VERSION=$(python --version 2>&1 | awk '{print $2}')
  MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
  MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)
  if [ "$MAJOR" -eq 3 ] && [ "$MINOR" -ge 11 ]; then
    echo -e "${GREEN}✓ Python $PYTHON_VERSION${NC}"
  else
    echo -e "${YELLOW}⚠ Python $PYTHON_VERSION (3.11+ recommended)${NC}"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  echo -e "${RED}✗ Python not found${NC}"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Check frontend can build
echo -n "Checking frontend build... "
cd client 2>/dev/null || { echo -e "${RED}✗ client/ directory not found${NC}"; ERRORS=$((ERRORS + 1)); cd ..; }
if [ -d "$(pwd)/client" ]; then
  if npm run build &>/dev/null; then
    echo -e "${GREEN}✓ Build successful${NC}"
    
    # Check build output
    if [ -f "out/index.html" ]; then
      echo "  Output: client/out/index.html exists"
    else
      echo -e "${YELLOW}  ⚠ Build succeeded but index.html not found${NC}"
      WARNINGS=$((WARNINGS + 1))
    fi
  else
    echo -e "${RED}✗ Build failed${NC}"
    echo "  Run: cd client && npm run build"
    ERRORS=$((ERRORS + 1))
  fi
  cd ..
fi
echo ""

# Check Python dependencies
echo -n "Checking Python dependencies... "
if [ -f "requirements.txt" ]; then
  if python -c "import fastapi, uvicorn, sqlalchemy" &>/dev/null; then
    echo -e "${GREEN}✓ Core dependencies available${NC}"
  else
    echo -e "${YELLOW}⚠ Some dependencies missing${NC}"
    echo "  Will be installed during deployment"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  echo -e "${RED}✗ requirements.txt not found${NC}"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Check app.yaml exists
echo -n "Checking app.yaml configuration... "
if [ -f "app.yaml" ]; then
  echo -e "${GREEN}✓ app.yaml exists${NC}"
  
  # Check for required environment variables
  if grep -q "DATABRICKS_HOST" app.yaml && \
     grep -q "ANTHROPIC_API_KEY" app.yaml && \
     grep -q "DATABASE_URL" app.yaml; then
    echo "  Required environment variables found"
  else
    echo -e "${YELLOW}  ⚠ Missing required environment variables${NC}"
    echo "  Required: DATABRICKS_HOST, ANTHROPIC_API_KEY, DATABASE_URL"
    WARNINGS=$((WARNINGS + 1))
  fi
  
  # Check command uses $DATABRICKS_APP_PORT
  if grep -q "DATABRICKS_APP_PORT" app.yaml; then
    echo "  Port binding configured correctly"
  else
    echo -e "${YELLOW}  ⚠ Command should use \$DATABRICKS_APP_PORT${NC}"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  echo -e "${RED}✗ app.yaml not found${NC}"
  echo "  Run: cp app.yaml.example app.yaml"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Check package.json exists (for hybrid app)
echo -n "Checking package.json... "
if [ -f "package.json" ]; then
  echo -e "${GREEN}✓ package.json exists${NC}"
  echo "  Hybrid Node.js + Python app detected"
  
  # Verify command in app.yaml is explicit
  if [ -f "app.yaml" ] && grep -q "command:" app.yaml; then
    echo "  Explicit command in app.yaml (good for hybrid app)"
  else
    echo -e "${YELLOW}  ⚠ No explicit command in app.yaml${NC}"
    echo "  With package.json, Databricks will run 'npm run start' by default"
    echo "  Add 'command:' section to app.yaml to run Python backend"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  echo -e "${YELLOW}⚠ package.json not found${NC}"
  echo "  Python-only app (Node.js build steps will be skipped)"
  WARNINGS=$((WARNINGS + 1))
fi
echo ""

# Check for common mistakes
echo "Checking for common mistakes..."

# Check if node_modules is in build output
if [ -d "client/out/node_modules" ]; then
  echo -e "${RED}✗ node_modules found in client/out/${NC}"
  echo "  This will bloat deployment. Check .gitignore and vite config"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}✓ No node_modules in build output${NC}"
fi

# Check if .git is excluded
if [ -d ".git" ] && grep -q ".git" databricks.yml 2>/dev/null; then
  echo -e "${GREEN}✓ .git excluded in databricks.yml${NC}"
else
  echo -e "${YELLOW}⚠ .git should be excluded from sync${NC}"
  WARNINGS=$((WARNINGS + 1))
fi

# Check if __pycache__ is excluded
if grep -q "__pycache__" databricks.yml 2>/dev/null; then
  echo -e "${GREEN}✓ __pycache__ excluded in databricks.yml${NC}"
else
  echo -e "${YELLOW}⚠ __pycache__ should be excluded from sync${NC}"
  WARNINGS=$((WARNINGS + 1))
fi

echo ""
echo "================================================"
echo "Validation Summary"
echo "================================================"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed!${NC}"
  echo ""
  echo "Ready to deploy. Run:"
  echo "  ./scripts/deploy.sh <app-name>"
  echo ""
  echo "Or for Asset Bundles:"
  echo "  ./scripts/deploy.sh --prep-only"
  echo "  databricks bundle deploy -t dev"
  exit 0
elif [ $ERRORS -eq 0 ]; then
  echo -e "${YELLOW}⚠ $WARNINGS warning(s) found${NC}"
  echo ""
  echo "Deployment may succeed but review warnings above."
  echo "Continue? (y/n)"
  read -r CONTINUE
  if [ "$CONTINUE" = "y" ] || [ "$CONTINUE" = "Y" ]; then
    exit 0
  else
    exit 1
  fi
else
  echo -e "${RED}✗ $ERRORS error(s) found, $WARNINGS warning(s)${NC}"
  echo ""
  echo "Fix errors before deploying."
  exit 1
fi
