#!/usr/bin/env bash
# gates.sh - Verification gates for Ralph Loop
# Generated: 2026-02-06T21:12:48Z
# Gates: Lint
#
# Regenerate with: discover-gates.sh --force

set -uo pipefail

PASSED=0
FAILED=0
FAILURES=""

run_gate() {
    local name="$1"
    local cmd="$2"
    printf "  %-12s " "$name"
    if eval "$cmd" > /dev/null 2>&1; then
        echo "ok"
        ((PASSED++))
    else
        echo "FAIL"
        ((FAILED++))
        FAILURES="${FAILURES}\n  - ${name}: ${cmd}"
    fi
}

run_gate "Lint" "ruff check ."

echo ""
if [[ $FAILED -eq 0 ]]; then
    echo "All $PASSED gate(s) passed"
    exit 0
else
    echo "$FAILED gate(s) failed, $PASSED passed"
    printf "$FAILURES\n"
    exit 1
fi
