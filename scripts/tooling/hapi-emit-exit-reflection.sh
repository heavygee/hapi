#!/usr/bin/env bash
# hapi-emit-exit-reflection — POST a first-class peer-exit-reflection channel SystemEvent
#
# Fork-local Overseer prep (soup): lives on :3006 via feat/contrib-state-channel-ingest.
# Not an upstream tiann/hapi surface. Canon:
#   docs/plans/2026-08-08-peer-exit-reflection-events.md
#   docs/tooling/feature-work-lifecycle.md § Exit reflection
#
# Usage:
#   hapi-emit-exit-reflection --session <id|prefix> --retro <path> \
#       [--pr <n>] [--repo owner/name] [--judgment applied|none|pending|skip] \
#       [--promote tooling-doc|high-signal|issue|none] [--commit <sha>] [--dry-run]
#   hapi-emit-exit-reflection --session <id> --skip '<reason>' [--judgment skip] ...
#
# Meta MUST call this (or equivalent POST) when closing Gate A' — markdown alone is
# not enough for the Overseer improve loop. Idempotent on session×PR×path/skip hash.
#
# Env: HAPI_HOST (default http://127.0.0.1:3006), HAPI_SETTINGS (~/.hapi/settings.json)
set -euo pipefail

HAPI_HOST="${HAPI_HOST:-http://127.0.0.1:3006}"
SETTINGS="${HAPI_SETTINGS:-$HOME/.hapi/settings.json}"
CURL_BIN="${CURL_BIN:-curl}"

SESSION_ARG=""
RETRO=""
SKIP=""
PR=""
REPO="tiann/hapi"
JUDGMENT="pending"
PROMOTE="none"
META_COMMIT=""
DRY_RUN=0
PROVENANCE="peer-exit-reflection@meta"

die() { echo "hapi-emit-exit-reflection: $*" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --session) SESSION_ARG="${2:-}"; shift 2 ;;
        --retro) RETRO="${2:-}"; shift 2 ;;
        --skip) SKIP="${2:-}"; shift 2 ;;
        --pr) PR="${2:-}"; shift 2 ;;
        --repo) REPO="${2:-}"; shift 2 ;;
        --judgment) JUDGMENT="${2:-}"; shift 2 ;;
        --promote) PROMOTE="${2:-}"; shift 2 ;;
        --commit) META_COMMIT="${2:-}"; shift 2 ;;
        --provenance) PROVENANCE="${2:-}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        --help|-h) sed -n '2,24p' "$0"; exit 0 ;;
        *) die "unexpected arg: $1" ;;
    esac
done

[[ -n "$SESSION_ARG" ]] || die "missing --session"
if [[ -n "$RETRO" && -n "$SKIP" ]]; then
    die "use --retro OR --skip, not both"
fi
if [[ -z "$RETRO" && -z "$SKIP" ]]; then
    die "missing --retro <path> or --skip <reason>"
fi
case "$JUDGMENT" in
    applied|none|pending|skip) ;;
    *) die "--judgment must be applied|none|pending|skip" ;;
esac

[[ -f "$SETTINGS" ]] || die "settings not found: $SETTINGS"
RAW_TOKEN=$(jq -r '.cliApiToken // empty' "$SETTINGS")
[[ -n "$RAW_TOKEN" ]] || die "no cliApiToken in $SETTINGS"

JWT=$(curl -sS --max-time 5 -X POST -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg t "$RAW_TOKEN:default" '{accessToken:$t}')" \
    "$HAPI_HOST/api/auth" | jq -r '.token // empty')
[[ -n "$JWT" ]] || die "auth failed against $HAPI_HOST"

# Resolve session by prefix
SESSIONS_JSON=$(curl -sS --max-time 10 -H "Authorization: Bearer $JWT" \
    "$HAPI_HOST/api/sessions?limit=200")
SESSION_ID=$(printf '%s' "$SESSIONS_JSON" | jq -r --arg p "$SESSION_ARG" '
    (.sessions // .)[] | select(.id | startswith($p)) | .id' | head -1)
[[ -n "$SESSION_ID" ]] || die "no session matching prefix: $SESSION_ARG"

ARTIFACT_KEY="$RETRO"
[[ -n "$SKIP" ]] && ARTIFACT_KEY="skip:$SKIP"
HASH=$(printf '%s' "$ARTIFACT_KEY" | sha256sum | awk '{print $1}')
PR_PART="${PR:-0}"
IDEM="exit-reflection:${SESSION_ID}:${PR_PART}:${HASH}"
DEDUPE="exit-reflection:${SESSION_ID}:${PR_PART}"

# Taxonomy (plan): skip/none → completed + attention 0 unless Meta marked applied
# promote ≠ none → attention 1; operatorActionRequired while judgment=pending
ATTENTION=0
OAR=0
EVENT_TYPE="completed"
case "$PROMOTE" in
    none|skip|"")
        ATTENTION=0
        ;;
    *)
        ATTENTION=1
        if [[ "$JUDGMENT" == "pending" ]]; then
            EVENT_TYPE="needs_decision"
            OAR=1
        fi
        ;;
esac
if [[ -n "$SKIP" ]]; then
    JUDGMENT="skip"
    PROMOTE="none"
    ATTENTION=0
    OAR=0
    EVENT_TYPE="completed"
fi

if [[ -n "$SKIP" ]]; then
    SUMMARY="Exit reflection skip: $SKIP — session ${SESSION_ID:0:8} | Meta: $JUDGMENT"
else
    SUMMARY="Exit reflection${PR:+ #$PR}: promote=$PROMOTE — $RETRO | Meta bar: $JUDGMENT"
fi
# clamp ≤280
SUMMARY=$(printf '%s' "$SUMMARY" | head -c 280)

FILLER=false
[[ "$JUDGMENT" == "none" && "$PROMOTE" == "none" && -z "$SKIP" ]] && FILLER=true

ARTIFACT_JSON='[]'
if [[ -n "$PR" ]]; then
    ARTIFACT_JSON=$(jq -n \
        --arg repo "$REPO" \
        --argjson num "$PR" \
        --arg url "https://github.com/${REPO}/pull/${PR}" \
        '[{
            kind: "github_pr",
            url: $url,
            repo: $repo,
            number: $num,
            target_id: (if ($repo|startswith("tiann/")) then "upstream" else "fork" end),
            control: (if ($repo|startswith("tiann/")) then "theirs" else "ours" end),
            github_state: "merged",
            source: "external"
        }]')
fi

BODY=$(jq -n \
    --arg sid "$SESSION_ID" \
    --arg summary "$SUMMARY" \
    --arg prov "$PROVENANCE" \
    --arg idem "$IDEM" \
    --arg dedupe "$DEDUPE" \
    --arg et "$EVENT_TYPE" \
    --argjson att "$ATTENTION" \
    --argjson oar "$OAR" \
    --arg judgment "$JUDGMENT" \
    --arg promote "$PROMOTE" \
    --arg retro "$RETRO" \
    --arg skip "$SKIP" \
    --arg commit "$META_COMMIT" \
    --argjson filler "$FILLER" \
    --argjson arts "$ARTIFACT_JSON" \
    '{
        sourceKind: "channel",
        sourceRef: ("peer-exit-reflection:" + $sid),
        provenance: $prov,
        eventType: $et,
        attentionCandidate: $att,
        operatorActionRequired: $oar,
        summary: $summary,
        relatedSessionId: $sid,
        artifactRefs: $arts,
        payload: {
            promote: (if $promote == "none" or $promote == "" then [] else [$promote] end),
            highSignal: ($promote == "high-signal"),
            metaJudgment: $judgment,
            metaCommit: (if $commit == "" then null else $commit end),
            filler: $filler,
            retroPath: (if $retro == "" then null else $retro end),
            skip: (if $skip == "" then null else $skip end)
        },
        tags: ["exit-reflection", "gate-a-prime"],
        idempotencyKey: $idem,
        dedupeKey: $dedupe,
        severity: 2
    }')

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "$BODY" | jq .
    exit 0
fi

RESP=$(curl -sS --max-time 15 -X POST \
    -H "Authorization: Bearer $JWT" \
    -H 'Content-Type: application/json' \
    -d "$BODY" \
    "$HAPI_HOST/api/system-events") || die "POST transport failed"

if ! printf '%s' "$RESP" | jq -e '.event.id' >/dev/null 2>&1; then
    die "POST rejected: $(printf '%s' "$RESP" | jq -c '.' 2>/dev/null || echo "$RESP")"
fi

EID=$(printf '%s' "$RESP" | jq -r '.event.id')
DEDUPED=$(printf '%s' "$RESP" | jq -r '.deduped // false')
echo "hapi-emit-exit-reflection: OK event=$EID deduped=$DEDUPED session=${SESSION_ID:0:8} judgment=$JUDGMENT promote=$PROMOTE"
printf '%s\n' "$RESP" | jq -c '{id:.event.id, deduped, sourceRef:.event.sourceRef, eventType:.event.eventType, summary:.event.summary}'
