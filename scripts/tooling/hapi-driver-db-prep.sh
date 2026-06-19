#!/usr/bin/env bash
# Prepare ~/.hapi/hapi.db for activation of <target-worktree>.
#
# Operator-fork soup helper (not used by upstream CI). See driver-soup.md.
#
# Known downgrade transitions (extend as new schema-bumping layers are added):
#   v10 -> v9 : DROP TABLE fcm_devices + its 2 indexes
#   v11 -> v10: DROP events/event_links/FTS5 (feat/overseer-events-substrate #22)

set -euo pipefail

DRY_RUN=0
TARGET=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
        *)
            if [[ -z "$TARGET" ]]; then TARGET="$1"; shift
            else echo "Unexpected arg: $1" >&2; exit 2; fi
            ;;
    esac
done

[[ -n "$TARGET" ]] || { echo "Usage: hapi-driver-db-prep.sh <target-worktree>" >&2; exit 2; }
TARGET="$(realpath "$TARGET")"

PRIMARY="${HAPI_PRIMARY:-$HOME/coding/hapi}"
DB_PATH="${HAPI_DB_PATH:-$HOME/.hapi/hapi.db}"

[[ -f "$DB_PATH" ]] || { echo "ERROR: DB not found at $DB_PATH" >&2; exit 1; }
[[ -f "$TARGET/hub/src/store/index.ts" ]] || {
    echo "ERROR: target $TARGET missing hub/src/store/index.ts" >&2
    exit 1
}

extract_schema_version() {
    grep -E "^const SCHEMA_VERSION:\s*number\s*=\s*[0-9]+" "$1" \
        | head -1 \
        | grep -oE "[0-9]+$"
}

target_schema="$(extract_schema_version "$TARGET/hub/src/store/index.ts" || true)"
[[ -n "$target_schema" ]] || { echo "ERROR: could not parse SCHEMA_VERSION in $TARGET" >&2; exit 1; }

base_schema="$(git -C "$PRIMARY" show upstream/main:hub/src/store/index.ts 2>/dev/null \
    | grep -E "^const SCHEMA_VERSION:\s*number\s*=\s*[0-9]+" | head -1 | grep -oE "[0-9]+$" || true)"
base_schema="${base_schema:-?}"

live_schema="$(sqlite3 "$DB_PATH" "PRAGMA user_version;" 2>/dev/null || true)"
[[ -n "$live_schema" ]] || { echo "ERROR: could not read PRAGMA user_version from $DB_PATH" >&2; exit 1; }

echo "hapi-driver-db-prep:"
echo "  target_schema = $target_schema  (from $TARGET/hub/src/store/index.ts)"
echo "  base_schema   = $base_schema  (from upstream/main)"
echo "  live_schema   = $live_schema  (from $DB_PATH)"

if [[ "$live_schema" -eq "$target_schema" ]]; then
    decision="match -- no migration needed"
elif [[ "$live_schema" -lt "$target_schema" ]]; then
    decision="forward -- hub will auto-migrate $live_schema -> $target_schema via stepMigrations on boot"
else
    decision="downgrade -- need to step DB back from $live_schema down to $target_schema"
fi
echo "  decision: $decision"

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  (dry-run; exiting)"
    exit 0
fi

if systemctl is-active --quiet hapi-hub.service; then
    echo "ERROR: hapi-hub.service is active. Stop it first:" >&2
    echo "         sudo systemctl stop hapi-hub.service" >&2
    exit 1
fi

if [[ "${HAPI_DB_PREP_NO_BACKUP:-}" != "1" ]]; then
    BACKUP="${DB_PATH}.bak.pre-activate-$(date -u +%Y%m%d-%H%M%SZ)"
    echo "  backup: $DB_PATH -> $BACKUP"
    cp -a "$DB_PATH" "$BACKUP"
fi

apply_downgrade_step() {
    local from="$1" to="$2"
    case "${from}_to_${to}" in
        10_to_9)
            echo "  applying v10 -> v9 downgrade: DROP fcm_devices + indexes"
            sqlite3 "$DB_PATH" <<'SQL'
BEGIN IMMEDIATE;
DROP INDEX IF EXISTS idx_fcm_devices_token;
DROP INDEX IF EXISTS idx_fcm_devices_namespace;
DROP TABLE IF EXISTS fcm_devices;
PRAGMA user_version = 9;
COMMIT;
SQL
            ;;
        11_to_10)
            echo "  applying v11 -> v10 downgrade: DROP events substrate + FTS5"
            sqlite3 "$DB_PATH" <<'SQL'
BEGIN IMMEDIATE;
DROP TRIGGER IF EXISTS events_fts_delete;
DROP TRIGGER IF EXISTS events_fts_update;
DROP TRIGGER IF EXISTS events_fts_insert;
DROP TABLE IF EXISTS events_fts;
DROP INDEX IF EXISTS idx_events_idempotency_key;
DROP INDEX IF EXISTS idx_event_links_to;
DROP INDEX IF EXISTS idx_event_links_from;
DROP TABLE IF EXISTS event_links;
DROP INDEX IF EXISTS idx_events_dedupe_key;
DROP INDEX IF EXISTS idx_events_type_ts;
DROP INDEX IF EXISTS idx_events_session_ts;
DROP TABLE IF EXISTS events;
PRAGMA user_version = 10;
COMMIT;
SQL
            ;;
        *)
            echo "ERROR: no known downgrade for v${from} -> v${to}" >&2
            echo "       Add a case to apply_downgrade_step() in $0" >&2
            echo "       OR restore from a v${to} backup manually" >&2
            return 1
            ;;
    esac
}

if [[ "$live_schema" -gt "$target_schema" ]]; then
    cur="$live_schema"
    while [[ "$cur" -gt "$target_schema" ]]; do
        prev=$((cur - 1))
        apply_downgrade_step "$cur" "$prev" || exit 1
        cur="$prev"
    done
    new_live="$(sqlite3 "$DB_PATH" "PRAGMA user_version;")"
    if [[ "$new_live" -ne "$target_schema" ]]; then
        echo "ERROR: downgrade left DB at v${new_live}, expected v${target_schema}" >&2
        exit 1
    fi
    echo "  downgrade done: DB now at v${new_live}"
    sqlite3 "$DB_PATH" "VACUUM;"
fi

echo "  db-prep complete; safe to start hub on $TARGET"
