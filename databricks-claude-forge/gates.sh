#!/usr/bin/env bash
# gates.sh - Verification gates for Ralph Loop
# Generated: 2026-02-11
#
# These gates MUST all pass before FORGE_COMPLETE can be declared.

set -uo pipefail

PASSED=0
FAILED=0
FAILURES=""

run_gate() {
    local name="$1"
    local cmd="$2"
    printf "  %-24s " "$name"
    if eval "$cmd" > /dev/null 2>&1; then
        echo "ok"
        ((PASSED++))
    else
        echo "FAIL"
        ((FAILED++))
        FAILURES="${FAILURES}\n  - ${name}"
    fi
}

# Get script directory for absolute paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Build Gates ==="
run_gate "Lint" "ruff check $SCRIPT_DIR/server"
run_gate "Types" "cd $SCRIPT_DIR/client && npx tsc --noEmit"
run_gate "Build" "cd $SCRIPT_DIR/client && npm run build"

echo ""
echo "=== Phase 2: Resizable Panels ==="
run_gate "ResizePanels-Pkg" "grep -q 'react-resizable-panels' $SCRIPT_DIR/client/package.json"
run_gate "ResizePanels-Import" "grep -rq 'from.*react-resizable-panels' $SCRIPT_DIR/client/src/"
run_gate "ResizePanels-Usage" "grep -rq '<Group\|<Panel' $SCRIPT_DIR/client/src/"
# Panel sizes must persist to localStorage
run_gate "LocalStorage-Save" "grep -rq 'localStorage.*setItem.*panel\|localStorage.*setItem.*sidebar\|localStorage.*setItem.*width\|localStorage.*setItem.*height' $SCRIPT_DIR/client/src/"
run_gate "LocalStorage-Load" "grep -rq 'localStorage.*getItem.*panel\|localStorage.*getItem.*sidebar\|localStorage.*getItem.*width\|localStorage.*getItem.*height' $SCRIPT_DIR/client/src/"

echo ""
echo "=== Phase 6: code-server Integration ==="
# Backend service
run_gate "CodeServer-Service" "test -f $SCRIPT_DIR/server/services/code_server.py"
run_gate "CodeServer-Methods" "grep -q 'async def start' $SCRIPT_DIR/server/services/code_server.py"
# API router exposing the service
run_gate "CodeServer-Router" "test -f $SCRIPT_DIR/server/routers/code_server.py"
run_gate "CodeServer-Endpoints" "grep -q '@router\.\(get\|post\)' $SCRIPT_DIR/server/routers/code_server.py 2>/dev/null"
# Frontend component
run_gate "CodeServer-Panel" "test -f $SCRIPT_DIR/client/src/components/editor/CodeServerPanel.tsx"
run_gate "CodeServer-Iframe" "grep -q 'iframe' $SCRIPT_DIR/client/src/components/editor/CodeServerPanel.tsx 2>/dev/null"

echo ""
if [[ $FAILED -eq 0 ]]; then
    echo "All $PASSED gate(s) passed ✓"
    exit 0
else
    echo "$FAILED gate(s) failed, $PASSED passed"
    printf "$FAILURES\n"
    exit 1
fi
