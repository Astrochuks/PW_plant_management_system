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
# Local thresholds for the 'Slow query' / 'Slow request' warnings: from this
# laptop the Frankfurt round trip alone is 0.5–1.2 s, so the same-region
# defaults (1000 / 2000 ms) would flag everything. Production keeps the defaults.
export SLOW_QUERY_MS="${SLOW_QUERY_MS:-2500}"
export SLOW_REQUEST_MS="${SLOW_REQUEST_MS:-4000}"

exec uvicorn app.main:app \
  --reload --reload-dir app \
  --host 127.0.0.1 --port "${PORT:-8000}" \
  --timeout-graceful-shutdown 5
