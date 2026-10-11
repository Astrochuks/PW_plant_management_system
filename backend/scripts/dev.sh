#!/usr/bin/env sh
# Local backend dev server — the ONE way to start it.
#
# The flags are not optional:
#   --reload-dir app                 only app/ triggers a reload (not docs,
#                                    tests, scripts or the fixtures folder)
#   --timeout-graceful-shutdown 5    a reload waits at most 5s for in-flight
#                                    requests. Browsers keep an SSE stream
#                                    open forever and auto-reconnect, so
#                                    without this cap a reload hangs with the
#                                    port held and nothing answering
#                                    (2026-10-11: login "stopped working").
#
# Usage:  backend/scripts/dev.sh          (PORT=8001 backend/scripts/dev.sh)
set -eu
cd "$(dirname "$0")/.."
exec uvicorn app.main:app \
  --reload --reload-dir app \
  --host 127.0.0.1 --port "${PORT:-8000}" \
  --timeout-graceful-shutdown 5
