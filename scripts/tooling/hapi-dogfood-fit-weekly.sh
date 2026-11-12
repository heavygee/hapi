#!/usr/bin/env bash
# hapi-dogfood-fit-weekly — wake the Dogfood-fit HAPI session for its triage pass.
#
# Fork-local (heavygee estate). NOT upstream. NOT Tier-1.
# Install: sudo bash scripts/tooling/install-hapi-dogfood-fit-timer.sh
#
# WHAT IT DOES:
#   Pings the dedicated Dogfood-fit session (HAPI_DOGFOOD_FIT_SESSION_ID) with
#   the pasteable tick prompt from
#   docs/plans/2026-10-21-dogfood-fit-triage-rubric.md § 3 — scoring OPEN
#   tiann/hapi PRs NOT authored by heavygee for estate dogfood priority
#   (fit for the project, not just CI health). Resumes inactive sessions.
#
#   Deliberately NOT folded into hapi-meta-daily.sh: that tick is chip-cache +
#   ping-backoff over our own chipped sessions and is state-gated to no-op on
#   re-run. A ~200-PR fit sweep at 3-4 gh calls per candidate is minutes of API
#   per hour producing nothing hourly-actionable. See the plan § 5 Cadence.
#
# WHAT IT WILL NEVER DO:
#   Merge · close · comment on GitHub · apply any label · score the PRs itself.
#   It only wakes the session that does the scoring. `dogfooded` is applied
#   solely by whoever actually ran the PR on a live install.
#
# Env (~/.hapi/dogfood-fit.env):
#   HAPI_DOGFOOD_FIT_SESSION_ID=<full-uuid>   # required
#   HAPI_DOGFOOD_FIT_SESSION_NAME=…           # optional From: name
#   HAPI_HOST / HAPI_SETTINGS — same as other timers
#
# Usage:
#   hapi-dogfood-fit-weekly.sh             # weekly deep pass (timer default)
#   hapi-dogfood-fit-weekly.sh --thin      # daily thin slice (last 24h, max 10)
#   hapi-dogfood-fit-weekly.sh --dry-run   # print message, no ping

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ENV_FILE="${HAPI_DOGFOOD_FIT_ENV:-/home/heavygee/.hapi/dogfood-fit.env}"
# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

DRY=0
MODE=deep
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY=1 ;;
        --thin) MODE=thin ;;
        -h|--help)
            sed -n '2,33p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown arg: $arg" >&2
            exit 2
            ;;
    esac
done

SID="${HAPI_DOGFOOD_FIT_SESSION_ID:-}"
if [[ -z "$SID" ]]; then
    echo "ERROR: HAPI_DOGFOOD_FIT_SESSION_ID unset (set in $ENV_FILE)" >&2
    exit 1
fi

NAME="${HAPI_DOGFOOD_FIT_SESSION_NAME:-Dogfood-fit triage (tiann/hapi)}"
PING_BIN="${HAPI_DOGFOOD_FIT_PING_BIN:-}"
if [[ -z "$PING_BIN" ]]; then
    if [[ -x "$SCRIPT_DIR/hapi-ping-peer.sh" ]]; then
        PING_BIN="$SCRIPT_DIR/hapi-ping-peer.sh"
    elif command -v hapi-ping-peer >/dev/null 2>&1; then
        PING_BIN="$(command -v hapi-ping-peer)"
    else
        echo "ERROR: hapi-ping-peer not found" >&2
        exit 1
    fi
fi

TODAY="$(date -u +%Y-%m-%d)"
if [[ "$MODE" == thin ]]; then
    SCOPE_LINE=' - THIN SLICE: only PRs opened or state-changed in the last 24h. Max 10 scored.'
else
    SCOPE_LINE=' - DEEP PASS: candidates whose staleness is <=60d, plus the oldest 10 untriaged.'
fi

# Quoted heredoc: the prompt contains backticks and jq \(...) — must not expand.
MSG="$(
    printf 'DOGFOOD-FIT PASS (%s UTC, %s pass)\n\n' "$TODAY" "$MODE"
    cat <<'PROMPT'
Open tiann/hapi PRs not authored by heavygee. Selection only.
PREPARE-ONLY on upstream: no merge, no close, no public comment, no label from
this pass. Rubric: docs/plans/2026-10-21-dogfood-fit-triage-rubric.md

INPUTS (fetch fresh; do not trust cached or remembered values)
 1. Write collaborators — re-derive, never hardcode:
    gh api repos/tiann/hapi/collaborators --paginate \
      --jq '.[]|select(.permissions.push)|"\(.login) admin=\(.permissions.admin)"'
 2. Candidate set:
    gh pr list --repo tiann/hapi --state open --limit 500 \
      --json number,title,author,createdAt,updatedAt,isDraft,additions,deletions,\
changedFiles,labels,mergeable,reviewDecision \
      | jq '[.[]|select(.author.login!="heavygee")]'
 3. Per candidate you intend to score:
    gh pr view <N> --repo tiann/hapi --json commits,comments,files
    gh api repos/tiann/hapi/issues/<N>/comments --jq '.[]|select(.user.login=="tiann")|.body'
    gh api repos/tiann/hapi/pulls/<N>/reviews  --jq '.[]|select(.user.login=="tiann")|"\(.state) \(.body)"'
 4. Revealed preference baseline (re-read each pass, ~1 min):
    gh pr list --repo tiann/hapi --state merged --limit 120 \
      --json number,title,author,mergedAt,additions,deletions,changedFiles

SCOPE THE PASS (do not score 200 PRs)
__SCOPE__
 - Staleness = max(last non-bot comment, last commit committedDate). NEVER updatedAt
   (a repo-wide mergeability recompute bumped every stale PR to 2026-09-12).

GATES — any hit => SKIP with the gate id, stop scoring that PR
 G1 standing @tiann objection unaddressed   G4 fails the #1583 core-value test
 G2 duplicate / superseded                  G5 not runnable on this estate (iOS/Android/macOS/Windows-only)
 G3 draft / WIP                             G6 touches maintainer canon (AGENTS/CONTRIBUTING/LICENSE/SECURITY/README/.github/website)

SCORE (0-3 each, weights in brackets; max 60)
 F1 maintainer alignment [3]   F6 blast radius, inverted [2]
 F2 problem clarity [2]        F7 dogfoodable here [3]
 F3 default-path impact [2]    F8 liveness [1]
 F4 user-visible value [2]     F9 collision with in-flight work, inverted [2]
 F5 scope proportionality [2]  F10 etiquette cost [1]

 Anchor F1 and F5 on quotes, not vibes. The spine:
  - #1583 "HAPI exists to fill a gap: terminal-native agents lose controllability the
    moment you step away ... remote control with seamless local<->remote switching"
  - #1309 "The problem is real; the framework is disproportionate"
  - #1798 "a global Display setting is itself hard to discover"
  - #553  "I won't accept this PR since we've already supported ... in #515"
  - Discussions #1258 "skills + CLI is a better solution than MCP"; A2A endorsed as
    "the perfect pragmatic first step"
  - CONTRIBUTING.md "We do not accept oversized pull requests"
 heavygee's own Discussions are NOT direction evidence. Only @tiann's replies are.

OUTPUT — exactly these four sections, highest score first, max 3 in DOGFOOD NEXT

 ## DOGFOOD NEXT  (FIT>=42, no gate, F7=3, chip green or green-able)
 #<N> <title>  @<author>  FIT <x>/60  chip <emoji>  +a/-d f=<n>
   fit: <one line, quoting the tier-0/1 source that justifies it>
   run: <what to actually exercise on the estate to call it dogfooded>
   next: live run -> whoever ran it applies `dogfooded` + "dogfooded since <ISO UTC>"
         -> 48h window (discussions/2083) -> operator/Meta `hapi-laneb-authorise` + merge

 ## WATCH  (FIT 30-41, or high FIT blocked)
 #<N> FIT <x>  blocked-on: <single unblocking condition>

 ## ADOPT-OR-CLOSE  (stale >60d and (conflicting or FIT<30)) - RECOMMENDATION ONLY
 #<N> FIT <x>  stale <d>d  <ADOPT|RECOMMEND CLOSE>  — <one line>
   draft-for-operator: <plain-language note the operator could post as heavygee,
                        first person singular, zero estate jargon, or "none needed">

 ## SKIP
 #<N> gate <G#> — <one line>

HARD RULES
 - No gh pr merge / gh pr close / gh pr comment / gh issue comment / gh pr edit on tiann/hapi.
 - No label from this pass. `dogfooded` is applied ONLY by whoever actually ran it live.
 - `low-impact` on a community PR needs the author/operator ask - not this pass.
 - Any public wording goes to the operator as a draft first (AGENTS.md § Public GitHub voice):
   first person singular "I", never "we"; no soup/Meta/remat/chip/lane A/B/C/:3006.
 - Do not police other contributors. Treat silence as time lag, not neglect.
 - Report what you did NOT score and why (budget, scope) - no silent truncation.

Report back to the operator. Do NOT ping Meta PR watcher with the result
(AGENTS.md § quieter Meta) unless it is a hard block needing operator judgment.
PROMPT
)"

# Inject the mode-specific scope line into the static prompt.
MSG="${MSG/__SCOPE__/$SCOPE_LINE}"

if [[ "$DRY" -eq 1 ]]; then
    echo "Would ping $SID ($NAME) via $PING_BIN:"
    echo "----"
    printf '%s\n' "$MSG"
    exit 0
fi

# Timer is not a broker descendant — mint verified peer attribution.
export HAPI_ESTATE_PEER_ATTRIBUTE=1
export HAPI_SESSION_ID="$SID"
export HAPI_SESSION_NAME="$NAME"

echo "[dogfood-fit-weekly] pinging $SID ($MODE) …"
"$PING_BIN" "$SID" --message-file - <<<"$MSG"
echo "[dogfood-fit-weekly] done"
