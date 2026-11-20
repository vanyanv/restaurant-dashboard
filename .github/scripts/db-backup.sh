#!/usr/bin/env bash
# Nightly logical backup of the production database to the private R2 bucket.
# Run by .github/workflows/db-backup.yml; see docs/backup-and-restore.md.
#
# The repository is PUBLIC. This script therefore never echoes DATABASE_URL or
# any credential, never runs with `set -x`, scrubs connection strings out of
# anything pg_dump/psql print, and the workflow never uploads the dump (or
# anything else) as a GitHub artifact. The dump goes to R2 only.
#
# Needs: DATABASE_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME,
# and R2_ENDPOINT or R2_ACCOUNT_ID (the same names src/lib/blob.ts reads).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
: "${R2_BUCKET_NAME:?R2_BUCKET_NAME is required}"

# Neon's pooled host (ep-...-pooler.<region>...) runs PgBouncer in transaction
# mode, which pg_dump should not go through; the same host without "-pooler"
# is the direct endpoint. Rewritten in memory only, never printed.
DATABASE_URL="${DATABASE_URL/-pooler./.}"

# The secret is written for Prisma and node-postgres, which accept query
# parameters libpq refuses outright (pgbouncer=true, connection_limit=...,
# pool_timeout=..., schema=...). Keep only the parameters libpq knows that a
# Neon URL uses, and always require TLS. In memory only, never printed.
if [[ "$DATABASE_URL" == *\?* ]]; then
  base="${DATABASE_URL%%\?*}"
  query="${DATABASE_URL#*\?}"
  kept=()
  IFS='&' read -r -a params <<<"$query"
  for p in "${params[@]}"; do
    case "${p%%=*}" in
      sslmode|channel_binding|options|application_name|connect_timeout) kept+=("$p") ;;
    esac
  done
  DATABASE_URL="$base"
  if [[ ${#kept[@]} -gt 0 ]]; then
    DATABASE_URL="${base}?$(IFS='&'; echo "${kept[*]}")"
  fi
fi
if [[ "$DATABASE_URL" != *sslmode=* ]]; then
  if [[ "$DATABASE_URL" == *\?* ]]; then DATABASE_URL="${DATABASE_URL}&sslmode=require"; else DATABASE_URL="${DATABASE_URL}?sslmode=require"; fi
fi

PREFIX="backups/db/"
KEEP="${BACKUP_KEEP:-30}"
endpoint="${R2_ENDPOINT:-}"
if [[ -z "$endpoint" ]]; then
  : "${R2_ACCOUNT_ID:?R2_ENDPOINT or R2_ACCOUNT_ID is required}"
  endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
fi

# Anything a Postgres tool prints goes through this first.
# The incident issue a failure opens quotes this job's log, and the repo is
# public, so the R2 endpoint (it carries the account id) is scrubbed too.
scrub() {
  sed -E 's#postgres(ql)?://[^[:space:]"'"'"']+#[redacted-url]#g; s#password=[^[:space:]]+#password=[redacted]#g; s#https://[A-Za-z0-9.-]*r2\.cloudflarestorage\.com#[r2-endpoint]#g'
}

# --- 1. Match pg_dump to the server's major version -------------------------
# pg_dump refuses a server newer than itself, and an older-major dump is not
# guaranteed to restore cleanly, so read the server's major and install that
# client from the PGDG apt repository.
echo "Installing the PGDG apt repository"
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsS -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
. /etc/os-release
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
sudo apt-get update -qq >/dev/null

# Any psql can ask the version; the runner image ships one. Fall back to the
# newest PGDG client if it does not.
if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get install -y -qq postgresql-client >/dev/null
fi
server_num="$(psql "$DATABASE_URL" -Atqc 'SHOW server_version_num' 2>&1 | scrub)" || {
  echo "Could not read the server version: $server_num" >&2
  exit 1
}
if ! [[ "$server_num" =~ ^[0-9]+$ ]]; then
  echo "Unexpected server_version_num: $server_num" >&2
  exit 1
fi
major=$(( server_num / 10000 ))
echo "Server is Postgres ${major}; installing postgresql-client-${major}"
sudo apt-get install -y -qq "postgresql-client-${major}" >/dev/null
PG_DUMP="/usr/lib/postgresql/${major}/bin/pg_dump"
PG_RESTORE="/usr/lib/postgresql/${major}/bin/pg_restore"
"$PG_DUMP" --version

# --- 2. Dump ----------------------------------------------------------------
day="$(date -u +%F)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
dump="$workdir/${day}.dump"

echo "Dumping (custom format, compression 9)"
started=$(date +%s)
# --no-owner/--no-privileges: a restore goes into a NEW Neon branch whose
# roles differ; ownership is reassigned there.
if ! "$PG_DUMP" --dbname="$DATABASE_URL" --format=custom --compress=9 \
    --no-owner --no-privileges --file="$dump" 2> >(scrub >&2); then
  echo "pg_dump failed" >&2
  exit 1
fi
size=$(stat -c %s "$dump")
echo "Dump finished in $(( $(date +%s) - started ))s, ${size} bytes"
if [[ "$size" -lt 1024 ]]; then
  echo "Dump is implausibly small (${size} bytes); not uploading" >&2
  exit 1
fi

# A dump pg_restore cannot read is not a backup.
tables=$("$PG_RESTORE" --list "$dump" | grep -c ' TABLE DATA ' || true)
echo "Archive lists ${tables} table(s) of data"
if [[ "$tables" -eq 0 ]]; then
  echo "Archive has no table data; not uploading" >&2
  exit 1
fi

# --- 3. Upload to R2 --------------------------------------------------------
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${R2_REGION:-auto}"
# Newer AWS CLIs add checksums R2 does not always accept; only send them when
# the operation requires one.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
# --only-show-errors belongs to the `s3` transfer commands only; `s3api`
# refuses it, so it is passed on the cp/rm calls, not here.
s3() { aws --endpoint-url "$endpoint" "$@" 2> >(scrub >&2); }

key="${PREFIX}${day}.dump"
echo "Uploading ${key}"
s3 s3 cp --only-show-errors "$dump" "s3://${R2_BUCKET_NAME}/${key}" --content-type application/octet-stream

remote_size=$(s3 s3api head-object --bucket "$R2_BUCKET_NAME" --key "$key" --query ContentLength --output text)
if [[ "$remote_size" != "$size" ]]; then
  echo "Uploaded object is ${remote_size} bytes, expected ${size}" >&2
  exit 1
fi

# --- 4. Keep the newest $KEEP ------------------------------------------------
# Keys are YYYY-MM-DD.dump, so name order is date order. Only keys under the
# prefix matching that pattern are ever considered for deletion.
# Listed into a variable first: a failure inside `< <(...)` would not stop
# the script, and a failed listing must not read as "nothing to prune".
if ! listing=$(s3 s3api list-objects-v2 --bucket "$R2_BUCKET_NAME" --prefix "$PREFIX" \
    --query 'Contents[].Key' --output text); then
  echo "Could not list ${PREFIX} for retention" >&2
  exit 1
fi
mapfile -t keys < <(
  printf '%s\n' "$listing" | tr '\t' '\n' \
    | grep -E "^${PREFIX}[0-9]{4}-[0-9]{2}-[0-9]{2}\.dump$" | sort || true
)
echo "${#keys[@]} backup(s) under ${PREFIX}; keeping the newest ${KEEP}"
if [[ "${#keys[@]}" -gt "$KEEP" ]]; then
  for old in "${keys[@]:0:${#keys[@]}-KEEP}"; do
    echo "Deleting ${old}"
    s3 s3 rm --only-show-errors "s3://${R2_BUCKET_NAME}/${old}"
  done
fi

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Database backup"
    echo
    echo "- Object: \`${key}\` (${size} bytes, Postgres ${major}, ${tables} tables of data)"
    echo "- Retained: newest ${KEEP} under \`${PREFIX}\`"
  } >> "$GITHUB_STEP_SUMMARY"
fi
echo "Backup complete: ${key}"
