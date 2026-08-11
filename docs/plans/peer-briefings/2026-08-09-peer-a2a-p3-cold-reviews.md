# Full court press — A2A P3 (#1465) cold reviews (Cursor agents)

> **Pattern name:** *full court press* — canon in [`docs/tooling/pr-review-loop.md`](../../tooling/pr-review-loop.md#full-court-press-escalate-when-bot-thrash-must-die).  
> **Gate:** before orchestrator posts the #1462 techotaku note, tip must pass **two sequential** cold reads by **separate Cursor agent peers**.  
> Feature peer (`e4d152f3`) implements; **orchestrator spawns** cold peers (do not reuse the implementer session).

## Order (strict)

| Pass | Model (spawn) | Session title |
|------|---------------|---------------|
| **1** | `claude-opus-5-thinking-high` (high-effort Claude) | `Cold #1465 pass1: Claude high` |
| — | Feature peer fixes all **Blocker/Major** from pass 1 | |
| **2** | `gpt-5.6-sol-high` (GPT Sol high) | `Cold #1465 pass2: GPT Sol` |
| — | Feature peer fixes Blocker/Major from pass 2 (if any) | |

Do **not** start pass 2 until pass 1 has pinged back with a verdict and Majors are addressed (or explicitly deferred with operator OK).

## Spawn (orchestrator)

Worktree: `/home/heavygee/coding/hapi/worktrees/a2a-p3-notify-ingest`  
Ping-back: feature peer `e4d152f3` **and** meta watcher `9f5f7e1d`.

```bash
HUB=http://127.0.0.1:3006
SETTINGS=/home/heavygee/.hapi/settings.json
MACHINE=$(jq -r .machineId "$SETTINGS")
JWT=$(curl -fsS -X POST "$HUB/api/auth" -H 'Content-Type: application/json' \
  -d "{\"accessToken\":\"$(jq -r .cliApiToken "$SETTINGS")\"}" | jq -r .token)
AUTH=(-H "Authorization: Bearer $JWT" -H 'Content-Type: application/json')
WT=/home/heavygee/coding/hapi/worktrees/a2a-p3-notify-ingest

# Pass 1 — Claude high effort
SPAWN=$(curl -fsS -X POST "$HUB/api/machines/$MACHINE/spawn" "${AUTH[@]}" \
  -d "$(jq -n --arg dir "$WT" \
    '{directory:$dir, agent:"cursor", model:"claude-opus-5-thinking-high", yolo:true, sessionType:"worktree"}')")
# rename + hapi-ping-peer with Pass 1 brief below

# Pass 2 — only after pass 1 closed + fixes
SPAWN=$(curl -fsS -X POST "$HUB/api/machines/$MACHINE/spawn" "${AUTH[@]}" \
  -d "$(jq -n --arg dir "$WT" \
    '{directory:$dir, agent:"cursor", model:"gpt-5.6-sol-high", yolo:true, sessionType:"worktree"}')")
```

If base+effort form is required by runner: `model:"claude-opus-5"` + `modelReasoningEffort:"high"` / `model:"gpt-5.6-sol"` + `modelReasoningEffort:"high"`. Prefer full slug when runner accepts it (matches `agent models`).

## Shared review instructions (both passes)

```bash
cd /home/heavygee/coding/hapi/worktrees/a2a-p3-notify-ingest
git fetch upstream
git log --oneline upstream/main..HEAD
git diff upstream/main...HEAD
bun typecheck && bun run test   # at least hub/shared packages touched
```

- Rubric: `docs/tooling/cold-pr-review-rubric.md` + `.github/prompts/codex-pr-review.md`
- Issue: https://github.com/tiann/hapi/issues/1465
- Plan: `docs/plans/2026-08-09-notify-summary-upstream-recovery.md` Workstream A
- RFC: `docs/plans/2026-08-03-a2a-control-plane-rfc.md` § AGENT_NOTIFY_SUMMARY elevation
- Coordinate schema with #1374 — **one** events substrate
- **Public voice:** A2A only — do not mention estate product codenames in any GitHub text
- Severity: Blocker / Major / Minor / Nit. Evidence `path:line`. No praise. Confidence ≥80% to report.
- Run tests before verdict (rubric) — never verdict on diff-read alone

### Product focus (both)

1. Notify footer → ledger row on assistant ingest; idempotent  
2. Display-off does not gate capture  
3. Namespace/principal isolation per #1374 / RFC  
4. No rival `events` table; no P2 handoff scope creep  
5. No emit-default flip in this PR  

### Deliverable

1. Findings ordered by severity  
2. Ready for next gate: yes/no (pass 1 → fixes then pass 2; pass 2 → PR tip / #1462 note)  
3. Ping `e4d152f3` + `9f5f7e1d` with verdict  
4. `AGENT_NOTIFY_SUMMARY`

## Pass 2 delta note

Pass 2 is **not** a rubber stamp. Re-read full `upstream/main...HEAD` after pass-1 fixes. Call out residual Majors and any new issues introduced by fixes.
