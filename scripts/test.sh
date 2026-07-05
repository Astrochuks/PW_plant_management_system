#!/usr/bin/env bash
# Run the backend test suite — in Docker when the daemon is up, else in the local venv.
# Usage: ./scripts/test.sh [pytest args...]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if docker info >/dev/null 2>&1; then
  echo "==> Running tests in Docker"
  exec docker compose -f "$ROOT/docker-compose.yml" run --rm backend pytest "$@"
elif [ -x "$ROOT/backend/venv/bin/pytest" ]; then
  echo "==> Docker daemon not running; falling back to local venv"
  cd "$ROOT/backend"
  exec ./venv/bin/pytest "$@"
else
  echo "ERROR: neither Docker daemon nor backend/venv/bin/pytest available" >&2
  exit 1
fi
