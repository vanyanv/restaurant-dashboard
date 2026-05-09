#!/usr/bin/env bash
set -euo pipefail

method="${1:?method is required}"
url="${2:?url is required}"
max_time="${CRON_MAX_TIME:-90}"

body_file="$(mktemp)"
status="$(
  curl -sS -X "$method" "$url" \
    -H "Authorization: Bearer ${CRON_SECRET:?CRON_SECRET is required}" \
    --max-time "$max_time" \
    -o "$body_file" \
    -w "%{http_code}"
)"

body="$(cat "$body_file")"
rm -f "$body_file"

if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
  if command -v jq >/dev/null 2>&1; then
    jq . <<< "$body" 2>/dev/null || printf '%s\n' "$body"
  else
    printf '%s\n' "$body"
  fi
  exit 0
fi

echo "HTTP $status from $method $url" >&2
if [[ -n "$body" ]]; then
  echo "Response body:" >&2
  printf '%s\n' "$body" >&2
fi
exit 22
