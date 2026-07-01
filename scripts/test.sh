#!/usr/bin/env bash
# Smoke-test the BabyLog Apps Script backend.
# Reads TOKEN and EXEC_URL from a local .env file (gitignored):
#   TOKEN=your-long-random-token
#   EXEC_URL=https://script.google.com/macros/s/XXXX/exec
#
# Usage:  ./scripts/test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ No .env file found at $ENV_FILE" >&2
  echo "  Create it with:  TOKEN=... and EXEC_URL=..." >&2
  exit 1
fi

set -a; source "$ENV_FILE"; set +a

: "${TOKEN:?TOKEN not set in .env}"
: "${EXEC_URL:?EXEC_URL not set in .env}"

pass=0; fail=0
check() { # check "<description>" "<expected substring>" "<actual>"
  local desc="$1" want="$2" got="$3"
  if [[ "$got" == *"$want"* ]]; then
    echo "✓ $desc"
    echo "    → $got"
    pass=$((pass + 1))
  else
    echo "✗ $desc"
    echo "    expected to contain: $want"
    echo "    got:                 $got"
    fail=$((fail + 1))
  fi
}

echo "Testing $EXEC_URL"
echo

# 1. Write a row (should append to the log tab).
# NB: no `-X POST` — Apps Script 302-redirects to googleusercontent, and forcing
# POST through the redirect makes it fail. `--data` posts, then follows as GET.
r=$(curl -sL "$EXEC_URL" \
      -H "Content-Type: text/plain" \
      --data "{\"token\":\"$TOKEN\",\"type\":\"pee\"}")
check "write pee (POST)" '"ok":true' "$r"

# 2. Read today's rows.
r=$(curl -sL "$EXEC_URL?token=$TOKEN&date=today")
check "read today" '"ok":true' "$r"

# 3. Read a date range (used by Insights).
r=$(curl -sL "$EXEC_URL?token=$TOKEN&days=14")
check "read range (days=14)" '"ok":true' "$r"

# 4. Wrong token must be rejected.
r=$(curl -sL "$EXEC_URL?token=WRONG&date=today")
check "reject wrong token" '"error":"unauthorized"' "$r"

echo
echo "── $pass passed, $fail failed ──"
if [[ $fail -eq 0 ]]; then
  echo "Backend looks good. Make sure index.html's API_URL matches EXEC_URL, then reload the app."
else
  exit 1
fi
