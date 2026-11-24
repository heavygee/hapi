#!/usr/bin/env bash
# hapi-session-metadata-audit — validate every stored session row against the
# MetadataSchema of the build the hub is ACTUALLY RUNNING.
#
# WHY THIS EXISTS (2026-11-24)
#   `MetadataSchema` fails wholesale: if any one optional sub-object no longer
#   parses, the hub discards the session's ENTIRE metadata — path, flavor,
#   machineId, lifecycleState. The row is intact on disk, but the hub serves
#   `metadata: null`, `resume` answers "Session metadata missing path", and the
#   session is permanently unrestartable. It fails silently: nothing alerts,
#   the session simply stops being resumable.
#
#   This has now happened twice, both times because a REQUIRED field was added
#   INSIDE AN OPTIONAL OBJECT, retroactively invalidating rows written before
#   the field existed:
#     - `externalRefs`  — "at most one primary GitHub PR" (#1163, 2026-11-18)
#                         killed 2 sessions holding refs linked in October.
#     - `lastModelError.eventId` — became required (#987 line, 2026-11-13;
#                         firmed 2026-11-22) and killed 96 sessions.
#
#   The codebase already knows the hazard: see the comment beside
#   `claudeRewind` in shared/src/schemas.ts, which is deliberately lenient so
#   "the hub would otherwise drop the whole session metadata".
#
# THE RULE THIS TOOL ENFORCES
#   Any change to session MetadataSchema — especially adding a required field,
#   tightening an enum, or adding a superRefine — is a DATA MIGRATION, not just
#   a code change. Run this audit before and after. If rows go invalid, migrate
#   them (or make the new constraint lenient) in the SAME change.
#
# Usage:
#   hapi-session-metadata-audit [--quiet] [--json FILE] [--db PATH] [--driver PATH]
#
# Exit: 0 all rows valid · 1 invalid rows found · 2 usage/infra error
set -euo pipefail

err() { echo "hapi-session-metadata-audit: $*" >&2; }
die() { err "$*"; exit 2; }

QUIET=0
JSON_OUT=""
DB="${HAPI_HUB_DB:-/var/lib/hapi/hapi.db}"
DRIVER=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --quiet) QUIET=1; shift ;;
        --json) JSON_OUT="$2"; shift 2 ;;
        --db) DB="$2"; shift 2 ;;
        --driver) DRIVER="$2"; shift 2 ;;
        -h|--help) sed -n '2,36p' "$0"; exit 0 ;;
        *) die "unexpected arg: $1" ;;
    esac
done

command -v bun >/dev/null     || die "bun not on PATH"
command -v sqlite3 >/dev/null || die "sqlite3 not on PATH"
[[ -f "$DB" ]]                || die "hub db not found: $DB"

# Validate against the RUNNING build, not a mirror checkout. The two drift:
# on 2026-11-24 the mirror's ExternalRefSchema was PR-only while the running
# driver carried a discriminated union including github_issue — auditing the
# wrong file invents failures that do not exist.
if [[ -z "$DRIVER" ]]; then
    DRIVER="$(readlink -f "${HAPI_ACTIVE:-$HOME/coding/hapi/active}" 2>/dev/null || true)"
    [[ -n "$DRIVER" && -d "$DRIVER" ]] || DRIVER="$HOME/coding/hapi/driver"
fi
SCHEMA="$DRIVER/shared/src/schemas.ts"
[[ -f "$SCHEMA" ]] || die "schema not found in running build: $SCHEMA (pass --driver)"

say() { [[ "$QUIET" == "1" ]] || echo "$*"; }

ROWS="$(mktemp -t hapi-meta-rows-XXXXXX.json)"
RUNNER="$DRIVER/.hapi-session-metadata-audit.tmp.ts"
trap 'rm -f "$ROWS" "$RUNNER"' EXIT

sqlite3 "file:$DB?mode=ro" \
  "SELECT json_group_array(json_object('id',id,'m',json(metadata)))
     FROM sessions WHERE metadata IS NOT NULL;" > "$ROWS"

cat > "$RUNNER" <<'TS'
import { MetadataSchema } from './shared/src/schemas'
const rowsPath = process.env.HAPI_AUDIT_ROWS!
const rows = JSON.parse(await Bun.file(rowsPath).text())
const bad: Array<{ id: string; issues: string[] }> = []
for (const r of rows) {
    const res = MetadataSchema.safeParse(r.m)
    if (!res.success) {
        bad.push({
            id: r.id,
            issues: res.error.issues.map((i: any) =>
                `${(i.path || []).join('.') || '<root>'}: ${i.message}`)
        })
    }
}
// Self-check: the validator must be able to REJECT. A schema that accepts
// everything would report a clean estate and prove nothing.
const control = MetadataSchema.safeParse({ path: 42 })
if (control.success) {
    console.error('CONTROL FAILED: MetadataSchema accepted a deliberately bad row')
    process.exit(2)
}
console.log(JSON.stringify({ total: rows.length, invalid: bad.length, bad }))
TS

OUT="$(cd "$DRIVER" && HAPI_AUDIT_ROWS="$ROWS" bun "$RUNNER")" || die "validator failed to run"

TOTAL="$(jq -r '.total'   <<<"$OUT")"
INVALID="$(jq -r '.invalid' <<<"$OUT")"
[[ -n "$JSON_OUT" ]] && jq '.' <<<"$OUT" > "$JSON_OUT"

if [[ "$INVALID" -eq 0 ]]; then
    say "ok   $TOTAL session rows, all metadata valid against $(basename "$DRIVER")"
    exit 0
fi

echo "DRIFT: $INVALID of $TOTAL session rows fail MetadataSchema" >&2
echo "       (the hub serves these as metadata:null — they are NOT restartable)" >&2
jq -r '[.bad[].issues[]] | group_by(.) | map({issue: .[0], n: length})
       | sort_by(-.n)[] | "  \(.n) x  \(.issue)"' <<<"$OUT" >&2
echo "  --- affected sessions (first 15) ---" >&2
jq -r '.bad[0:15][] | "  \(.id)  \(.issues[0])"' <<<"$OUT" >&2
echo >&2
echo "  Fix forward: migrate the rows, or relax the new constraint so legacy" >&2
echo "  shapes parse as undefined instead of failing the whole object." >&2
exit 1
