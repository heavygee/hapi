#!/usr/bin/env bash
# Cursor beforeShellExecution: pre-PR create + open-PR push cold-review gates
# PLUS hard blocks on:
#   - `gh pr comment` / `gh issue comment` against a PR with unresolved
#     review threads (forces reply+resolve via hapi-pr-reply instead of
#     a new top-level comment).
#   - `git push origin <branch>` when that branch has an open PR with
#     unresolved review threads (forces reply+resolve before iterating).
#
# Bypass for both blockers: set HAPI_ALLOW_TOPLEVEL_COMMENT=1 / HAPI_ALLOW_PUSH_WITH_UNRESOLVED=1
# in the shell environment. Deliberately ugly env-var names so they
# do not become muscle memory.
#
# Postmortem context: PR #814 #issuecomment-4639449666 (2026-06-06).

set -euo pipefail

# shellcheck source=/dev/null
source "$HOME/.local/bin/pr-open-push-lib.sh"

PRE_CREATE_CHECKLIST='STOP — MANDATORY PRE-PR CHECKLIST: Before creating this PR you MUST have run /verification-before-completion (all checks passing with evidence) AND /requesting-code-review (cold diff read, all findings addressed). If you have not done BOTH, do not proceed — stop and run the skills first.'

input=$(cat)
command=$(echo "$input" | jq -r '.command // empty')

# -- 1. gh pr create gate (unchanged) --
if [[ "$command" =~ (^|[;&|[:space:]])(gh(-[a-z]+)?)[[:space:]]+pr[[:space:]]+create ]]; then
    jq -n \
        --arg msg "$PRE_CREATE_CHECKLIST" \
        '{
            permission: "allow",
            user_message: "Pre-PR checklist — confirm verification + cold code review ran before filing.",
            agent_message: $msg
        }'
    exit 0
fi

# -- 2. gh pr comment / gh issue comment HARD BLOCK on PR with unresolved threads --
# Pattern: any `gh ... pr comment <pr-or-url> ...` or `gh ... issue comment <pr-or-url> ...`
if [[ "$command" =~ (^|[;&|[:space:]])(gh(-[a-z]+)?)[[:space:]]+(pr|issue)[[:space:]]+comment[[:space:]]+(.+)$ ]]; then
    rest="${BASH_REMATCH[5]}"
    pr_num=$(pr_extract_pr_number_from_args "$rest" || true)
    if [ -n "$pr_num" ]; then
        repo_pair=$(pr_repo_for_number "$rest" || pr_repo_for_number "" || true)
        owner=$(echo "$repo_pair" | awk '{print $1}')
        repo=$(echo "$repo_pair" | awk '{print $2}')
        if [ -n "$owner" ] && [ -n "$repo" ]; then
            unresolved=$(pr_unresolved_thread_count "$owner" "$repo" "$pr_num")
            if [ "$unresolved" -gt 0 ] 2>/dev/null && [ "${HAPI_ALLOW_TOPLEVEL_COMMENT:-0}" != "1" ]; then
                summary=$(pr_unresolved_thread_summary "$owner" "$repo" "$pr_num")
                msg=$(cat <<EOF
STOP — \`gh ${BASH_REMATCH[4]} comment\` against ${owner}/${repo}#${pr_num} is BLOCKED.

This PR has ${unresolved} unresolved review thread(s). This project's protocol
(\`~/coding/AGENTS.local.md\` §"Responding to PR review comments") requires that
addressed bot/reviewer findings be answered via REPLIES TO THE THREAD plus
\`resolveReviewThread\` - not via top-level comments.

Top-level comments on a PR with unresolved threads silently bypass the bot's
review loop. They do not mark findings as addressed and they obscure the
real conversation surface for the next reviewer.

Unresolved threads on ${owner}/${repo}#${pr_num}:
${summary}

DO ONE OF:
  1. Reply + resolve each thread via the project helper:
       hapi-pr-reply <comment_id> <fix_sha> "<one-line explanation>"
     (or, lower-level: \`gh api -X POST repos/${owner}/${repo}/pulls/${pr_num}/comments/<comment_id>/replies -f body="..."\`
      followed by the \`resolveReviewThread\` graphql mutation)
  2. If you genuinely need a standalone PR comment (release note, scope-change
     summary, NOT a review response), bypass this guard explicitly:
       HAPI_ALLOW_TOPLEVEL_COMMENT=1 $command

Postmortem: PR #814 #issuecomment-4639449666 (2026-06-06) - this guard exists
because the orchestrator created a top-level comment instead of replying.
EOF
                )
                jq -n \
                    --arg msg "$msg" \
                    --arg um "Blocked: gh ${BASH_REMATCH[4]} comment on PR with $unresolved unresolved thread(s). Use hapi-pr-reply or set HAPI_ALLOW_TOPLEVEL_COMMENT=1." \
                    '{
                        permission: "deny",
                        user_message: $um,
                        agent_message: $msg
                    }'
                exit 0
            fi
        fi
    fi
fi

# -- 3. git push origin <branch>: cold-review gate + HARD BLOCK on unresolved threads --
branch=$(pr_extract_push_branch "$command" || true)
if [ -n "$branch" ]; then
    lookup=$(pr_open_push_lookup "$branch" || true)
    if [ -n "$lookup" ]; then
        pr=$(echo "$lookup" | awk '{print $1}')
        base=$(echo "$lookup" | awk '{print $2}')

        # Look up the repo for this PR (assume current repo / upstream remote).
        repo_pair=$(pr_repo_for_number "" || true)
        owner=$(echo "$repo_pair" | awk '{print $1}')
        repo=$(echo "$repo_pair" | awk '{print $2}')

        # If we can resolve the repo and the PR has unresolved threads, BLOCK.
        if [ -n "$owner" ] && [ -n "$repo" ]; then
            unresolved=$(pr_unresolved_thread_count "$owner" "$repo" "$pr")
            if [ "$unresolved" -gt 0 ] 2>/dev/null && [ "${HAPI_ALLOW_PUSH_WITH_UNRESOLVED:-0}" != "1" ]; then
                summary=$(pr_unresolved_thread_summary "$owner" "$repo" "$pr")
                msg=$(cat <<EOF
STOP — \`git push origin ${branch}\` is BLOCKED. PR #${pr} has ${unresolved} unresolved review thread(s).

\`~/coding/AGENTS.local.md\` §"Responding to PR review comments": a finding is
not "done" until it is replied to AND resolved. Pushing with unresolved
threads buries them under the new commits, creates confusion about PR
readiness, and accumulates noise that hides real problems.

Unresolved threads on ${owner}/${repo}#${pr}:
${summary}

DO ONE OF:
  1. For each unresolved thread, reply via:
       hapi-pr-reply <comment_id> <fix_sha> "<one-line explanation>"
     (the helper posts the reply AND calls \`resolveReviewThread\` atomically.)
  2. If a thread genuinely cannot be resolved before this push (mid-iteration,
     work-in-progress), reply with an explicit "WIP: will address in next
     push" note - then bypass:
       HAPI_ALLOW_PUSH_WITH_UNRESOLVED=1 $command
EOF
                )
                jq -n \
                    --arg msg "$msg" \
                    --arg um "Blocked: push to $branch (PR #$pr) has $unresolved unresolved thread(s). Reply+resolve via hapi-pr-reply or set HAPI_ALLOW_PUSH_WITH_UNRESOLVED=1." \
                    '{
                        permission: "deny",
                        user_message: $um,
                        agent_message: $msg
                    }'
                exit 0
            fi
        fi

        # No unresolved blocker -> standard cold-review reminder (allow + context).
        cr_msg=$(pr_open_push_cold_review_message "$branch" "$pr" "$base")
        jq -n \
            --arg msg "$cr_msg" \
            '{
                permission: "allow",
                user_message: "Open PR push — run cold review on full PR diff before push.",
                agent_message: $msg
            }'
        exit 0
    fi
fi

echo '{"permission":"allow"}'
exit 0
