#!/usr/bin/env bash
# Unattended Harri refresh-token rotation.
#
# Runs the headed + auto-submit login (scripts/refresh-harri-jwt.ts --auto),
# which passes Harri's reCAPTCHA v3 *only from a residential IP* and mints +
# persists a fresh 30-day refresh token to .env.local / Vercel / GitHub secrets.
#
# Designed to be driven by a scheduler ON A RESIDENTIAL-IP MACHINE WITH A
# DISPLAY (e.g. this WSL box via WSLg). The systemd user units in
# scripts/harri-rotation/ run it weekly. A headed browser needs DISPLAY /
# WAYLAND_DISPLAY / XDG_RUNTIME_DIR — the scheduler unit provides them; when run
# by hand from a graphical shell they're already set.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Make node/npx reachable from a non-login shell (nvm).
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi
if ! command -v npx >/dev/null 2>&1; then
  latest_node="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "$latest_node" ] && export PATH="$latest_node:$PATH"
fi

mkdir -p "$REPO_ROOT/logs"
LOG="$REPO_ROOT/logs/harri-token-rotation.log"

{
  echo "=== rotation start $(date -u +%FT%TZ) (DISPLAY=${DISPLAY:-unset}) ==="
  npx tsx scripts/refresh-harri-jwt.ts --auto
  status=$?
  echo "=== rotation exit ${status} $(date -u +%FT%TZ) ==="
  exit $status
} >>"$LOG" 2>&1
