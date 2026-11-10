#!/usr/bin/env bash
# hapi-pr-status — the fork Codex dimension must read `codex-review-state:v1`.
#
# The ChatGPT Codex connector stopped emitting the legacy "Reviewed commit: `sha`"
# prose and now posts a machine-readable summary comment instead, edited in place
# as the review runs. While this script matched only the old prose, dimension 3
# reported UNKNOWN for *every* fork PR — and because `cold-review-clean` refuses
# to invent a tip-match, the fork-stage gate became un-passable, pushing agents
# toward habitual `--skip-fork-stage`. A gate that can only ever say "unknown" is
# worse than none, so both directions are asserted here, offline, against stubs.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$DIR/hapi-pr-status.sh"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); }; bad(){ FAIL=$((FAIL+1)); echo "FAIL: $1" >&2; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
TIP="21de8a3ef6a22e2257ac3380e9e24d5de7a3bc59"
OTHER="0000000000000000000000000000000000000abc"

# A `gh` stub standing in for the real CLI: enough surface for the fork path
# (version gate, labels, checks, graphql threads, reviews, comments).
mkdir -p "$W/bin"
cat > "$W/bin/gh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
    --version*)                 echo "gh version 2.80.0 (2026-01-01)" ;;
    *--json\ labels*)           echo "$GH_LABELS" ;;
    *pr\ checks*)               echo "$GH_CHECKS" ;;
    *--json\ headRefOid*)       echo "$GH_HEAD_SHA" ;;
    *graphql*)                  echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}' ;;
    *pulls/*/reviews*)          echo '[[]]' ;;
    *issues/*/comments*)        echo "$GH_COMMENTS" ;;
    *)                          echo "null" ;;
esac
STUB
chmod +x "$W/bin/gh"

export GH_LABELS='[]'
export GH_CHECKS='[{"name":"test","bucket":"pass"}]'
export GH_HEAD_SHA="$TIP"

# Build the summary comment the connector actually posts. `created_at` is
# deliberately older than `updated_at`: the comment is edited in place, so a
# selector keying on creation time would rank a finished review as stale.
state_comment() {
    local sha="$1" status="$2" findings="$3"
    jq -nc --arg sha "$sha" --arg status "$status" --argjson findings "$findings" '
        [[{
            user: {login: "chatgpt-codex-connector"},
            created_at: "2026-11-10T02:04:22Z",
            updated_at: "2026-11-10T02:07:55Z",
            body: ("<!-- codex-review-state:v1 " + ({
                code_review: {
                    commit_sha: $sha,
                    has_any_findings: $findings,
                    has_unresolved_findings: $findings,
                    status: $status
                },
                security_review: {commit_sha: null, status: null}
            } | tostring) + " -->\n\nCodex Review Summary")
        }]]'
}

run() { (PATH="$W/bin:$PATH" bash "$S" 324 --repo heavygee/hapi 2>&1); }

# 1. The case that was silently broken: review completed on the tip, no findings.
GH_COMMENTS="$(state_comment "$TIP" completed false)" ; export GH_COMMENTS
if out="$(run)"; then ok; else bad "tip-matched clean v1 state must exit 0:
$out"; fi
printf '%s' "$out" | grep -q "codex-review-state:v1" && ok || bad "v1 verdict not reported: $out"
printf '%s' "$out" | grep -qi "No .*review/comment with a reviewed commit" \
    && bad "v1 state must not read as a missing review: $out" || ok

# 2. Positive control for the other direction — findings present must still fail,
#    or test 1 only proves the script stopped looking.
GH_COMMENTS="$(state_comment "$TIP" completed true)" ; export GH_COMMENTS
if out="$(run)"; then bad "completed-with-findings must exit non-zero: $out"; else ok; fi
printf '%s' "$out" | grep -q "FINDINGS PRESENT" && ok || bad "findings verdict not reported: $out"

# 3. An in-flight review is not a verdict. This is the dangerous shape: mid-run
#    the JSON carries has_any_findings=null, which must never read as clean.
GH_COMMENTS="$(state_comment "$TIP" running null)" ; export GH_COMMENTS
if out="$(run)"; then bad "running review must not pass: $out"; else ok; fi
printf '%s' "$out" | grep -qi "not completed" && ok || bad "in-flight state not diagnosed: $out"

# 4. Tip-ahead must still be caught via the v1 commit_sha, not just the old prose.
GH_COMMENTS="$(state_comment "$OTHER" completed false)" ; export GH_COMMENTS
if out="$(run)"; then bad "stale-tip review must not pass: $out"; else ok; fi
printf '%s' "$out" | grep -qi "Tip moved past" && ok || bad "tip-ahead not diagnosed from v1 sha: $out"

# 5. cold-review-clean must NOT rescue an in-flight review — the label is an
#    operator override for addressed findings, not a way to skip a running wave.
GH_COMMENTS="$(state_comment "$TIP" running null)" ; export GH_COMMENTS
export GH_LABELS='[{"name":"cold-review-clean"}]'
if out="$(run)"; then bad "label must not override a running review: $out"; else ok; fi
export GH_LABELS='[]'

# 6. Legacy prose must keep working — this fix adds a format, it does not
#    replace one, and older PRs still carry the old shape.
GH_COMMENTS="$(jq -nc --arg sha "$TIP" '
    [[{user: {login: "chatgpt-codex-connector"},
       created_at: "2026-10-01T00:00:00Z",
       updated_at: "2026-10-01T00:00:00Z",
       body: ("### 💡 Codex Review: Didn'"'"'t find any major issues.\n\nReviewed commit: `" + $sha + "`")}]]')"
export GH_COMMENTS
if out="$(run)"; then ok; else bad "legacy Reviewed-commit prose regressed:
$out"; fi

echo "hapi-pr-status-codex-state: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
