#!/usr/bin/env bash
# Serve the BabyLog PWA locally and open it in the browser.
# Usage:  ./scripts/start.sh [port]     (default port 8000)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root (parent of scripts/)
cd "$DIR"

PORT="${1:-8000}"

# If the requested port is busy, walk forward until a free one is found.
is_free() { ! lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
while ! is_free "$PORT"; do
  echo "port $PORT is in use, trying $((PORT + 1))…"
  PORT=$((PORT + 1))
done

URL="http://localhost:$PORT"
echo "Serving $DIR at $URL  (Ctrl-C to stop)"

# Open the browser shortly after the server comes up (macOS: open; Linux: xdg-open).
( sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi ) >/dev/null 2>&1 &

exec python3 -m http.server "$PORT" --bind 127.0.0.1
