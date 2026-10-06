# Cold review pass 2: session-attached jobs (#1404)

**Role:** Independent Claude Opus cold reviewer. Defect-first. No praise theater. This is a **delta pass** after Majors from pass 1 were fixed + music dogfood + A2A alignment ACK.

**Worktree:** `/home/heavygee/coding/hapi/worktrees/session-attached-jobs`  
**Branch:** `feat/session-attached-jobs` @ `954279b8a` (track `origin/feat/session-attached-jobs`)  
**Base:** `upstream/main` (prefer `git fetch upstream && git diff upstream/main...HEAD`)  
**Issue:** https://github.com/tiann/hapi/issues/1404  
**Plan:** `~/coding/hapi/docs/plans/2026-08-07-session-attached-jobs.md`  
**Guide:** `docs/guide/session-jobs.md`  
**Pass 1 peer (context only):** `/sessions/eb1746db-fbb2-401c-adae-e168cb6fd917` — verdict was **ship with fixes / Ready-for-PR: NO**

**Parent / orchestrator:** `/sessions/6e70f97b-24c6-49bd-907f-98ce9bfc8b8f` (Cursor feature peer). Do **not** open upstream PR. Do **not** remat/soup/stack-switch.

---

## Settled — do NOT re-litigate

### A2A / work_ad boundary (RFC v2 + Overseer ACK 2026-08-07)

`session_jobs` / `SessionSummary.attachedJob` = **Layer 0 process meters** for outliving batch work.  
**Not** Layer 1 `work_ad`, handoffs, or Google A2A Tasks.  
Do **not** auto-ingest heartbeats into the work-graph ledger.  
`AGENT_NOTIFY_SUMMARY` stays the optional turn self-report path for future work ads (P3).  
Ship Layer 0 jobs **without waiting on A2A P1** (#1374).

Canon: `docs/plans/2026-08-03-a2a-control-plane-rfc.md`, [#1332](https://github.com/tiann/hapi/discussions/1332), guide § "Relation to A2A". If you find a *new* conflict with RFC v2, say so with evidence; do not reopen the Layer 0 vs Layer 1 placement itself.

### Pass 1 Majors claimed fixed (verify, don't rubber-stamp)

1. `hapi job run` supervisor (auto heartbeat + exit status)
2. Post-merge / superseded session job redirects
3. CLI unit tests (`parseJobArgs`, resolve, exit codes, runSessionJob)
4. Steer scoped to Claude/Codex/OpenCode/Grok (honest; not "every flavor")
5. Since pass 1: PUT honors **explicit** `startedAt`; CLI `--started-at`; late-attach clear+set docs (beets dogfood)

---

## Focus of this pass

1. **Are pass-1 Majors actually fixed** in tip `954279b8a`? Spot-check code + tests; note residual risk.
2. **Discoverability / agent-viability now** — update % attach and % sustained after `job run`. Cursor/ACP still has no MCP `hapi_job` — is that Ready-for-PR: NO, or acceptable as scoped follow-up?
3. **startedAt / elapsed contract** — PATCH rejects it; PUT omit preserves; PUT explicit corrects. Any remaining footguns?
4. **Anything new on the full diff** since pass 1 that would block upstream (schema, merge transfer, SSE, web chrome)?
5. **A2A boundary** — only if tip *violates* the settled contract (e.g. writes to work-graph, conflates status vocab).

Kill criteria from pass 1 still apply if still true:
- Majority of real runs `set` then go amber without `job run`
- Fake totals / forgotten clear dominate
- Cursor/random ACP attach rate remains ~0 without MCP and PR claims "agents will discover this"

---

## How to review

```bash
cd /home/heavygee/coding/hapi/worktrees/session-attached-jobs
git fetch upstream 2>/dev/null || git fetch origin
git log --oneline upstream/main..HEAD   # or origin/main..HEAD
git diff upstream/main...HEAD
bun typecheck
bun test hub/src/store/migration-v22.test.ts hub/src/web/routes/sessions-jobs.test.ts \
  cli/src/commands/job.test.ts cli/src/modules/sessionJob/ cli/src/modules/common/sessionJobInstruction.test.ts
# Full suite if time: bun run test
```

Rubric: `~/coding/hapi/docs/tooling/cold-pr-review-rubric.md` + `.github/prompts/codex-pr-review.md` if present.

Severity: Blocker / Major / Minor / Nit. Evidence `path:line`. No finding under ~80% confidence. Concrete fixes for Blocker/Major. **No praise.**

---

## Deliverable

Reply in this HAPI session with:

1. **Findings** (ordered by severity) — `[Code]` / `[Product]` — focus on deltas + residual Majors
2. **Viability verdict** — ship upstream / ship with fixes / do not ship yet — with kill criteria
3. **Discoverability score** — % attach / % sustained (update pass-1 ~40/~20)
4. **Ready for upstream PR:** yes / no — if no, smallest remaining gate; if yes, whether MCP must be same PR or explicit follow-up is OK
5. **A2A note** — one line: boundary still clean / or conflict found

## Close the loop (mandatory when done or blocked)

1. `hapi ping-peer 6e70f97b` (or MCP `ping_peer`) the orchestrator with: verdict, Ready-for-PR yes/no, pointer to this session, note full findings are in this chat.
2. Then emit `AGENT_NOTIFY_SUMMARY` on your final turn.

`AGENT_NOTIFY_SUMMARY` alone is not loop-closure.
