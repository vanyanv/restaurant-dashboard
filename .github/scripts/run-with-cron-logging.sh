#!/usr/bin/env bash
set -u -o pipefail

log_file="${LOG_FILE:-logs/cron.log}"
summary_file="${GITHUB_STEP_SUMMARY:-}"
output_file="${GITHUB_OUTPUT:-}"

mkdir -p "$(dirname "$log_file")"

{
  echo "## Cron command"
  echo
  printf '```sh\n'
  printf '%q ' "$@"
  printf '\n```\n\n'
} > "$log_file"

set +e
"$@" 2>&1 | tee -a "$log_file"
status=${PIPESTATUS[0]}
set -e

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
    echo "- Log file: $log_file"
    echo
    echo '```'
    tail -n 80 "$log_file"
    echo '```'
  } >> "$summary_file"
fi

exit "$status"
