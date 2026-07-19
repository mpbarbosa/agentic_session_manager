#!/usr/bin/env bash
#
# run_tests_docker.sh — run every agentic_session_manager check inside a clean
# throwaway Docker container, so the full suite can be exercised on any machine
# that has Docker without installing Node/npm locally.
#
# Suites (in order):
#   1. Type-check         (tsc -b --noEmit)
#   2. Unit tests         (vitest run — server/pure + src/adapters)
#   3. Production build    (tsc -b && vite build)
#
# Usage:
#   scripts/run_tests_docker.sh [OPTIONS]
#
# Options:
#   --no-build   Skip the production build (suites 1 + 2 only, fastest).
#   --keep       Do not remove the container after the run.
#   -h, --help   Show this help and exit.
#
# Environment:
#   NODE_IMAGE   Base image to use (default: node:22-bookworm).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_IMAGE="${NODE_IMAGE:-node:22-bookworm}"

RUN_BUILD=true
KEEP_CONTAINER=false

usage() {
    sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --no-build) RUN_BUILD=false ;;
        --keep)     KEEP_CONTAINER=true ;;
        -h|--help)  usage 0 ;;
        *) echo "Unknown option: $1" >&2; usage 1 ;;
    esac
    shift
done

if ! command -v docker >/dev/null 2>&1; then
    echo "error: docker is not installed or not on PATH" >&2
    exit 1
fi

# In-container driver. A single `bash -euo pipefail` script so a failure in any
# suite aborts with a non-zero exit code that docker propagates.
build_runner() {
    cat <<'RUNNER'
set -euo pipefail
section() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

cd /work

section "Installing dependencies (npm ci)"
npm ci --no-audit --no-fund

section "Type-check (tsc -b --noEmit)"
npm run typecheck

section "Unit tests (vitest run)"
npm test

if [ "${RUN_BUILD:-true}" = true ]; then
    section "Production build (tsc -b && vite build)"
    npm run build
fi

section "All selected suites passed"
RUNNER
}

DOCKER_RM=(--rm)
if [ "$KEEP_CONTAINER" = true ]; then
    DOCKER_RM=(--name asm-tests)
fi

echo "Image:  $NODE_IMAGE"
echo "Repo:   $REPO_ROOT"
echo "Suites: typecheck + vitest$([ "$RUN_BUILD" = true ] && echo ' + build')"

# Mount the repo read-only, copy it to a writable /work inside the container so
# node_modules / build artifacts never leak back onto the host tree, then run the
# suite driver (passed via env to avoid nested-quoting headaches).
exec docker run "${DOCKER_RM[@]}" \
    -e RUN_BUILD="$RUN_BUILD" \
    -e CI=true \
    -e ASM_TEST_RUNNER="$(build_runner)" \
    -v "$REPO_ROOT":/repo:ro \
    "$NODE_IMAGE" \
    bash -euo pipefail -c 'cp -a /repo /work && cd /work && rm -rf node_modules && bash -euo pipefail -c "$ASM_TEST_RUNNER"'
