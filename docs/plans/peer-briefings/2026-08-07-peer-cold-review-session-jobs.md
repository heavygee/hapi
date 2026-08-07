# Cold review brief: session-attached long-running jobs (#1404)

**Role:** Independent Claude Opus cold reviewer. Defect-first. No praise theater. Operator wants a hard read **before any upstream PR**.

**Worktree:** `/home/heavygee/coding/hapi/worktrees/session-attached-jobs`  
**Branch:** `feat/session-attached-jobs` @ `266965f8a` (track `origin/feat/session-attached-jobs`)  
**Base:** `upstream/main` (or `origin/main` if upstream remote missing — prefer `git fetch upstream && git diff upstream/main...HEAD`)  
**Issue:** https://github.com/tiann/hapi/issues/1404  
**Plan:** `~/coding/hapi/docs/plans/2026-08-07-session-attached-jobs.md`  
**Agent contract guide:** `docs/guide/session-jobs.md`  
**Estate skill (not in upstream diff):** `~/coding/skills/hapi-session-jobs/SKILL.md`

**Parent / orchestrator:** Cursor session on this feature (HAPI worktree `session-attached-jobs`). Do **not** open upstream PR. Do **not** remat/soup/stack-switch.

---

## What this feature is

Hub-persisted `session_jobs` so agents/scripts can attach work that **outlives the agent** (nohup/batch/daemons). Session list shows primary running job (`attachedJob`) with honest remaining / done+total / indeterminate + **wall-clock elapsed from `startedAt`**. Not thinking progress / todos / `backgroundTaskCount`.

CLI: `hapi job set|update|clear|list`. Auth like ping-peer. Heartbeat freshness (~15m amber).

---

## Review axes (both mandatory)

### A. Product / agent-viability (the undertaking)

Steelman and attack:

1. Will agents **discover** and correctly use this without a human peer-ping? (system-prompt steer on Claude/Codex/OpenCode/Grok; Cursor ACP has **no** system-prompt seam — skill-only on estate; AGENTS.md only helps agents working **on** hapi.)
2. Is guidance-vs-enforcement the right bet? Kill criteria for failure modes (fake totals, forgotten clear, never-attach).
3. Is the contract honest enough (no percent field, elapsed ≠ ETA)?
4. What is missing for upstream viability (MCP tools? Cursor injection? FUE? docs only?)?
5. Likelihood estimate: in a random non-hapi workspace session that starts a days-long batch, does the agent attach? Why/why not?

### B. Code cold read (full diff)

Use rubric: `~/coding/hapi/docs/tooling/cold-pr-review-rubric.md` + `.github/prompts/codex-pr-review.md` if present.

```bash
cd /home/heavygee/coding/hapi/worktrees/session-attached-jobs
git fetch upstream 2>/dev/null || git fetch origin
git diff upstream/main...HEAD   # or origin/main...HEAD
bun typecheck
bun run test   # or package-scoped if full suite too heavy — note what you ran
```

Cover: shared schemas, hub store/migration/REST/SSE enrichment, CLI, web list chrome, tests, agent instruction injection, docs. Trace lifecycle: set → heartbeat → list enrichment → SSE patch → clear/complete → session transfer/merge if any.

Severity: Blocker / Major / Minor / Nit. Evidence `path:line`. No finding under ~80% confidence. Concrete fixes for Blocker/Major. **No praise.**

---

## Deliverable

Reply in this HAPI session with:

1. **Findings** (ordered by severity) — code + product/discoverability mixed, labeled `[Code]` or `[Product]`
2. **Viability verdict** — ship upstream / ship with fixes / do not ship yet — with kill criteria
3. **Discoverability score** — rough % that a typical HAPI-wrapped agent starting a long batch will correctly attach without operator coaching (and what would move that needle most)
4. **Ready for upstream PR:** yes/no

## Close the loop (mandatory when done or blocked)

1. `hapi ping-peer` / MCP `ping_peer` the **orchestrator** (Parent above — Cursor feature peer on `session-attached-jobs`) with: verdict, Ready-for-PR yes/no, pointer to this session, note that full findings are in this chat.
2. Then emit `AGENT_NOTIFY_SUMMARY` on your final turn.

`AGENT_NOTIFY_SUMMARY` alone is not loop-closure. "Ping only if blocked" applies to mid-task escalation, not to signaling done.

---

## Process note (2026-08-07 operator feedback)

This brief originally said "ping orchestrator only if blocked" + "end with AGENT_NOTIFY_SUMMARY." That caused a passive close. Standing rule for all future peer briefs: proactive originator ping on completion. Canon: `spawn-peer-agents` skill § Close the loop; `new-feature-intake.md` §0.
