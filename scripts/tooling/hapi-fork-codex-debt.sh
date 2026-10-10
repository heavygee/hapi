#!/usr/bin/env bash
# hapi-fork-codex-debt.sh — inventory unpaid chatgpt-codex-connector feedback on
# open heavygee/hapi PRs, and optionally escalate / close cold-review corpses.
#
# Why: Codex Cloud reviews every fork PR. If we leave open PRs with unresolved
# threads and no owning HAPI chip, we burn review quota for nothing.
#
# Usage:
#   hapi-fork-codex-debt.sh                 # human table (default)
#   hapi-fork-codex-debt.sh --json          # machine JSON
#   hapi-fork-codex-debt.sh --close-cold-review-corpses
#       Close open PRs whose title starts with [cold-review] OR body says
#       "Not for merge" (fork-stage only). Leaves a closing comment.
#   hapi-fork-codex-debt.sh --min-threads 1 # only rows with >= N unresolved Codex
#
# Exit: 0 always unless gh/API hard-fails. Non-zero unpaid count is data, not rc.
set -euo pipefail

REPO="${HAPI_FORK_REPO:-heavygee/hapi}"
JSON=0
CLOSE_CORPSES=0
MIN_THREADS=1
DRY=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --json) JSON=1; shift ;;
        --close-cold-review-corpses) CLOSE_CORPSES=1; shift ;;
        --min-threads) MIN_THREADS="${2:?}"; shift 2 ;;
        --dry-run) DRY=1; shift ;;
        -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

command -v gh >/dev/null || { echo "gh required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

gh pr list -R "$REPO" --state open --limit 100 \
    --json number,title,author,updatedAt,isDraft,body,url >"$tmp"

# Enrich with unresolved non-outdated Codex thread counts.
report=$(python3 - "$tmp" "$REPO" <<'PY'
import json, subprocess, sys
path, repo = sys.argv[1], sys.argv[2]
prs = json.load(open(path))
owner, name = repo.split("/", 1)
rows = []
q = """
query($o:String!,$n:String!,$num:Int!){
  repository(owner:$o,name:$n){
    pullRequest(number:$num){
      reviewThreads(first:100){
        nodes{ isResolved isOutdated comments(first:1){ nodes{ author{ login } } } }
      }
    }
  }
}
"""
for p in prs:
    num = p["number"]
    out = subprocess.check_output(
        ["gh","api","graphql",
         "-f", f"query={q}",
         "-F", f"o={owner}", "-F", f"n={name}", "-F", f"num={num}"],
        text=True,
    )
    nodes = json.loads(out)["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"]
    unres = [t for t in nodes if not t["isResolved"] and not t.get("isOutdated")]
    codex = []
    for t in unres:
        login = ((t.get("comments") or {}).get("nodes") or [{}])[0].get("author") or {}
        login = login.get("login") or ""
        if login.startswith("chatgpt-codex"):
            codex.append(t)
    body = p.get("body") or ""
    title = p.get("title") or ""
    cold = title.strip().startswith("[cold-review]") or ("Not for merge" in body)
    rows.append({
        "number": num,
        "title": title,
        "url": p.get("url"),
        "isDraft": bool(p.get("isDraft")),
        "updatedAt": p.get("updatedAt"),
        "codexUnresolved": len(codex),
        "unresolved": len(unres),
        "coldReviewStage": cold,
        "author": (p.get("author") or {}).get("login"),
    })
rows.sort(key=lambda r: (-r["codexUnresolved"], -r["unresolved"], r["number"]))
print(json.dumps({"repo": repo, "prs": rows, "totals": {
    "open": len(rows),
    "withCodexDebt": sum(1 for r in rows if r["codexUnresolved"] > 0),
    "codexThreads": sum(r["codexUnresolved"] for r in rows),
    "coldReviewCorpses": sum(1 for r in rows if r["coldReviewStage"]),
}}))
PY
)

if [[ "$JSON" == "1" ]]; then
    printf '%s\n' "$report" | jq --argjson min "$MIN_THREADS" '
      .prs |= map(select(.codexUnresolved >= $min or .coldReviewStage))
    '
else
    printf '%s\n' "$report" | jq -r --argjson min "$MIN_THREADS" '
      "Repo: \(.repo)",
      "Open PRs: \(.totals.open)  with Codex debt: \(.totals.withCodexDebt)  unresolved Codex threads: \(.totals.codexThreads)  cold-review corpses: \(.totals.coldReviewCorpses)",
      "",
      (["PR","codex","draft","cold","updated","title"] | @tsv),
      (.prs[] | select(.codexUnresolved >= $min or .coldReviewStage)
        | [.number, .codexUnresolved, .isDraft, .coldReviewStage, (.updatedAt[0:10]//""), .title[0:64]]
        | @tsv)
    ' | column -t -s $'\t'
fi

if [[ "$CLOSE_CORPSES" != "1" ]]; then
    exit 0
fi

corpses=$(printf '%s\n' "$report" | jq -r '.prs[] | select(.coldReviewStage) | .number')
if [[ -z "$corpses" ]]; then
    echo "No cold-review corpses to close." >&2
    exit 0
fi

close_body=$(cat <<'EOF'
Closing as a **fork cold-review stage corpse**.

This PR was a pre-upstream Codex pass (often titled `[cold-review]` / "Not for merge").
Leaving it open re-burns `chatgpt-codex-connector` on every touch without an owning
HAPI babysit chip. Upstream work (if any) lives on `tiann/hapi`; reopen a fresh
fork PR if you need another cold-review pass.

Canon: `docs/tooling/pr-review-loop.md` § Fork Codex debt + `hapi-fork-codex-debt.sh`.
EOF
)

for n in $corpses; do
    if [[ "$DRY" == "1" ]]; then
        echo "[dry-run] would close $REPO#$n"
        continue
    fi
    echo "Closing $REPO#$n (cold-review corpse)..."
    gh pr comment "$n" -R "$REPO" --body "$close_body"
    gh pr close "$n" -R "$REPO" --comment "cold-review stage closed — stop unpaid Codex burn"
done
