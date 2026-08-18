#!/usr/bin/env bash
set -u -o pipefail

log_file="${LOG_FILE:-logs/cron.log}"
summary_file="${GITHUB_STEP_SUMMARY:-}"
output_file="${GITHUB_OUTPUT:-}"

# Extra attempts after the first. Default 0 so a workflow that hasn't opted in
# behaves exactly as before. Set CRON_RETRIES on jobs whose failures are
# usually transient (expired JWT, upstream 5xx, Neon cold start) — not on
# detectors, where retrying a true negative verdict just delays the alert.
retries="${CRON_RETRIES:-0}"
retry_delay="${CRON_RETRY_DELAY:-30}"

mkdir -p "$(dirname "$log_file")"

{
  echo "## Cron command"
  echo
  printf '```sh\n'
  printf '%q ' "$@"
  printf '\n```\n\n'
} > "$log_file"

status=0
attempt=0
while :; do
  attempt=$((attempt + 1))
  if [[ "$attempt" -gt 1 ]]; then
    echo "--- retry $((attempt - 1))/$retries ---" | tee -a "$log_file"
  fi

  set +e
  "$@" 2>&1 | tee -a "$log_file"
  status=${PIPESTATUS[0]}
  set -e

  [[ "$status" -eq 0 ]] && break
  [[ "$attempt" -gt "$retries" ]] && break

  # 30s, then 90s. Long enough for a rate limit or a cold start to clear,
  # short enough to stay well inside the job timeout.
  delay=$((retry_delay * (3 ** (attempt - 1))))
  echo "Attempt $attempt failed with exit $status; retrying in ${delay}s" | tee -a "$log_file"
  [[ "$delay" -gt 0 ]] && sleep "$delay"
done

if [[ "$attempt" -gt 1 ]]; then
  echo "Ran $attempt attempt(s); final exit $status" | tee -a "$log_file"
fi

if [[ -n "$output_file" ]]; then
  echo "status=$status" >> "$output_file"
fi

if [[ -n "$summary_file" ]]; then
  {
    if [[ "$status" -eq 0 ]]; then
      echo "### Cron command succeeded"
    else
      echo "### Cron command failed"
    fi
    echo
    echo "- Exit code: $status"
    echo "- Attempts: $attempt"
    echo "- Log file: $log_file"
    echo
    echo '```'
    tail -n 80 "$log_file"
    echo '```'
  } >> "$summary_file"
fi

exit "$status"
