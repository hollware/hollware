#!/bin/bash
# Starts `wrangler dev` (or, with SPIKE_SERVER=vp, `vp dev -c vite.dev.config.ts`) on a spike port,
# waits until it answers, runs ONE command against it, then stops exactly the processes it started
# (the server PID and its own descendants, never by name).
#
# Usage: [SPIKE_SERVER=vp] scripts/with-dev-server.sh <port 5240-5249> <ready-path> "<extra args>" -- <command...>
# The command gets the base URL in $SPIKE_URL.
set -u
# This project keeps wrangler's anonymous telemetry off.
export WRANGLER_SEND_METRICS=false
PORT="$1"; READY_PATH="$2"; WRANGLER_ARGS="$3"; shift 4
INSPECTOR_PORT=$((PORT + 1))
mkdir -p .wrangler/dev-logs
LOG=".wrangler/dev-logs/dev-$PORT-$(date +%H%M%S).log"

if [ "${SPIKE_SERVER:-wrangler}" = vp ]; then
  echo "+ WRANGLER_SEND_METRICS=false ../../node_modules/.bin/vp dev -c vite.dev.config.ts --host 127.0.0.1 --port $PORT --strictPort $WRANGLER_ARGS" >&2
  ../../node_modules/.bin/vp dev -c vite.dev.config.ts --host 127.0.0.1 --port "$PORT" --strictPort \
    $WRANGLER_ARGS >"$LOG" 2>&1 &
else
  echo "+ WRANGLER_SEND_METRICS=false ../../node_modules/.bin/wrangler dev --local --ip 127.0.0.1 --port $PORT --inspector-port $INSPECTOR_PORT --show-interactive-dev-session=false --log-level warn $WRANGLER_ARGS" >&2
  ../../node_modules/.bin/wrangler dev --local --ip 127.0.0.1 --port "$PORT" \
    --inspector-port "$INSPECTOR_PORT" --show-interactive-dev-session=false \
    --log-level warn $WRANGLER_ARGS >"$LOG" 2>&1 &
fi
PID=$!
echo "  started PID=$PID, port=$PORT, log=$LOG" >&2

descendants() { # prints the PIDs below $1, depth first
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do echo "$child"; descendants "$child"; done
}
cleanup() {
  local kids; kids="$(descendants "$PID" | tr '\n' ' ')"
  kill -INT "$PID" 2>/dev/null
  for _ in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
  kill -0 "$PID" 2>/dev/null && kill -TERM "$PID" 2>/dev/null
  for kid in $kids; do kill -0 "$kid" 2>/dev/null && { echo "stopping leftover child $kid" >&2; kill -TERM "$kid" 2>/dev/null; }; done
  sleep 0.5
  for kid in $PID $kids; do kill -0 "$kid" 2>/dev/null && echo "STILL RUNNING $kid" >&2; done
  true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for _ in $(seq 1 150); do
  if curl -fsS "http://127.0.0.1:$PORT$READY_PATH" -o /dev/null 2>/dev/null; then READY=1; break; fi
  kill -0 "$PID" 2>/dev/null || { echo "wrangler dev exited early:" >&2; cat "$LOG" >&2; exit 1; }
  sleep 0.4
done
[ "${READY:-0}" = 1 ] || { echo "timed out waiting for the dev server:" >&2; cat "$LOG" >&2; exit 1; }

export SPIKE_URL="http://127.0.0.1:$PORT"
"$@"
STATUS=$?
echo "--- wrangler dev log (warn+) ---" >&2; cat "$LOG" >&2
exit $STATUS
