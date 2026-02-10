#!/usr/bin/env bash
# gates.sh - Frontend Performance Verification Gates
# Generated: 2026-02-11
#
# All gates must pass before declaring TASK COMPLETE

set -uo pipefail

PASSED=0
FAILED=0
FAILURES=""

run_gate() {
    local name="$1"
    local cmd="$2"
    printf "  %-20s " "$name"
    if eval "$cmd" > /dev/null 2>&1; then
        echo "ok"
        ((PASSED++))
    else
        echo "FAIL"
        ((FAILED++))
        FAILURES="${FAILURES}\n  - ${name}"
    fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Build Gates ==="
run_gate "Lint-Backend" "ruff check $SCRIPT_DIR/server"
run_gate "Types" "cd $SCRIPT_DIR/client && npx tsc --noEmit"
run_gate "Build" "cd $SCRIPT_DIR/client && npm run build"

echo ""
echo "=== Performance Gates ==="

# Build and capture output for size analysis
BUILD_OUTPUT=$(cd $SCRIPT_DIR/client && npm run build 2>&1)

# Extract largest chunk gzip size
MAX_GZIP=$(echo "$BUILD_OUTPUT" | grep -oE 'gzip: +[0-9]+\.[0-9]+ kB' | sed 's/gzip: *//' | sed 's/ kB//' | sort -rn | head -1)

if [ -n "$MAX_GZIP" ]; then
    MAX_INT=$(echo "$MAX_GZIP" | cut -d. -f1)
    # Target: No chunk > 150KB gzipped (currently ProjectPage is 276KB)
    if [ "$MAX_INT" -lt 150 ]; then
        printf "  %-20s ok (max: ${MAX_GZIP}kB)\n" "MaxChunk<150KB"
        ((PASSED++))
    else
        printf "  %-20s FAIL (max: ${MAX_GZIP}kB, target: <150kB)\n" "MaxChunk<150KB"
        ((FAILED++))
        FAILURES="${FAILURES}\n  - MaxChunk<150KB: largest chunk is ${MAX_GZIP}kB"
    fi
else
    printf "  %-20s FAIL (parse error)\n" "MaxChunk<150KB"
    ((FAILED++))
    FAILURES="${FAILURES}\n  - MaxChunk<150KB: couldn't parse"
fi

# Check Vite manual chunking is configured
run_gate "ViteChunks" "grep -q 'manualChunks' $SCRIPT_DIR/client/vite.config.ts"

# Check React.lazy is used for code splitting
run_gate "ReactLazy" "grep -rq 'React\.lazy\|const.*=.*lazy(' $SCRIPT_DIR/client/src/"

# Check Suspense fallbacks exist
run_gate "Suspense" "grep -rq '<Suspense' $SCRIPT_DIR/client/src/"

echo ""
if [[ $FAILED -eq 0 ]]; then
    echo "All $PASSED gate(s) passed ✓"
    exit 0
else
    echo "$FAILED gate(s) failed, $PASSED passed"
    printf "$FAILURES\n"
    exit 1
fi
