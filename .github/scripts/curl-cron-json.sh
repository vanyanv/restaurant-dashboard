#!/usr/bin/env bash
set -euo pipefail

method="${1:?method is required}"
url="${2:?url is required}"
max_time="${CRON_MAX_TIME:-90}"

body_file="$(mktemp)"
curl_rc=0
status="$(
  curl -sS -X "$method" "$url" \
    -H "Authorization: Bearer ${CRON_SECRET:?CRON_SECRET is required}" \
    --max-time "$max_time" \
    -o "$body_file" \
    -w "%{http_code}"
)" || curl_rc=$?

# curl 28 = our own --max-time ran out. The request reached the server and it
# may well still be working on it (the COGS sweep's max-time sits 5s under its
# 300s maxDuration), so this is NOT a transient failure to retry: a retry
# would start a second run beside the first. Exit 124, which
# run-with-cron-logging.sh never retries. Connection errors (6, 7, 35, 52,
# 56...) keep their own code and stay retryable.
if [[ "$curl_rc" -eq 28 ]]; then
  rm -f "$body_file"
  echo "Timed out after ${max_time}s waiting for $method $url; the server may still be running it — not retried" >&2
  exit 124
fi
if [[ "$curl_rc" -ne 0 ]]; then
  rm -f "$body_file"
  echo "curl failed (exit $curl_rc) on $method $url" >&2
  exit "$curl_rc"
fi

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
