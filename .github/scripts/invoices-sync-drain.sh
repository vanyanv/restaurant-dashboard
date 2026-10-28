#!/usr/bin/env bash
# POST /api/invoices/sync, then keep calling while the run reports emails
# deferred to the next run. One call reads at most six emails, and GitHub runs
# scheduled workflows hours late on this repo, so a backlog left to the
# schedule waited most of a day. The server carries a backfill's lookback
# forward while `deferred > 0`, so later passes need no query string.
set -euo pipefail

url="${1:?url is required}"
max_passes="${SYNC_MAX_PASSES:-10}"
here="$(dirname "$0")"

pass=0
while :; do
  pass=$((pass + 1))
  out="$(bash "$here/curl-cron-json.sh" POST "$url")"
  printf '%s\n' "$out"
  deferred="$(jq -r '.deferred // 0' <<< "$out" 2>/dev/null || echo 0)"
  [[ "$deferred" =~ ^[0-9]+$ ]] || deferred=0
  if [[ "$deferred" -eq 0 ]]; then break; fi
  if [[ "$pass" -ge "$max_passes" ]]; then
    echo "Stopping after $pass passes with $deferred email(s) still deferred"
    break
  fi
  echo "--- pass $pass left $deferred email(s) deferred; running again ---"
  url="${url%%\?*}"
  # The route allows two calls a minute.
  sleep 30
done
