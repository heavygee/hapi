# Full court press — A2A P0.5 / #1203 peer delivery provenance

> **Pattern:** [`docs/tooling/pr-review-loop.md`](../../tooling/pr-review-loop.md#full-court-press-escalate-when-bot-thrash-must-die)  
> Feature peer: `6212dae5` — implements / fixes **and owns cold spawns after pass 1** (quieter Meta 2026-08-09).  
> Meta `9f5f7e1d`: dispatch only; **not** CC on every cold. Ping Meta once at Ready YES or hard block.  
> Cold peers ping **implementer only**. **Do not** open/undraft upstream PR until Ready YES.

## Tip under review (freeze)

| Field | Value |
|-------|-------|
| Tip (upstream draft) | `b8c4c0ed45e93216dd35cea7fb9e2d3e21178abf` (Ready YES tip rebased onto upstream/main) |
| Upstream draft | https://github.com/tiann/hapi/pull/1473 |
| Pass 2j | DONE — `7c2f86e5` → `2026-08-09-cold-pass2j-1203.md` — **Ready YES** |
| Pass 2i | DONE — `6a2159d9` → `2026-08-09-cold-pass2i-1203.md` — Ready NO (Vitest bun:test) |
| Pass 2h | DONE — `cb9b144b` → `2026-08-09-cold-pass2h-1203.md` — Ready NO (first-connector TOCTOU) |
| Pass 2g | DONE — `a3cb7e56` → `2026-08-09-cold-pass2g-1203.md` — Ready NO (pidfd_getfd) |
| Pass 2f | DONE — `eb551767` → `2026-08-09-cold-pass2f-1203.md` — Ready NO (/proc/fd race) |
| Pass 1 | DONE — `75a86204` → `2026-08-09-cold-pass1-1203.md` |
| Orchestrator B1 decision | **Exit 1** — bind to authenticated source channel; kill criterion stands |
| Pass 2–2d | DONE — Ready NO each time (forge ladder → broker) |
| Pass 2e | DEAD — `f61a4617` OpenAI cyber-flag mid-review (provider policy, not a code finding) |
| Pass 2e-alt | DONE — `e104b6ec` → `2026-08-09-cold-pass2e-alt-1203.md` — **Ready NO** (B1 /proc environ tag; M1 macOS; M2 terminal resume; M3 sock rebind; M4 spawn RPC) |
| Next cold after fixes | Prefer **`cursor-grok-4.5-high`** if OpenAI still radioactive; see `pr-review-loop.md` § Provider cyber-flag recovery |
| **Standing recovery** | Cyber-flag → archive → **`cursor-grok-4.5-high`**. No Sol retry. Claude not default alt. |
| Branch | `feat/a2a-p05-peer-provenance` |
| Worktree | `/home/heavygee/coding/hapi/worktrees/a2a-p05-peer-provenance` |
| Fork cold draft | https://github.com/heavygee/hapi/pull/118 (not merge; not upstream) |
| Issue | https://github.com/tiann/hapi/issues/1203 |
| A2A | Discussion #1332 + fork RFC § Revision 2026-08-09 / phase **P0.5** |

## Order (strict)

| Pass | Model | Session title |
|------|-------|---------------|
| **1** | `claude-opus-5-thinking-high` | `Cold #1203 pass1: Claude high` |
| — | Feature peer fixes all Blocker/Major | |
| **2** | `gpt-5.6-sol-high` | `Cold #1203 pass2: GPT Sol` |
| — | Feature peer fixes residual Blocker/Major | |
| **5** | Feature peer / orchestrator | `hapi-pr-create --draft` upstream Fixes #1203 |

**Forbidden:** upstream `gh pr create` / undraft before Sol fixes land. Fork #118 is OK as private tip handle.

## Shared review instructions

```bash
cd /home/heavygee/coding/hapi/worktrees/a2a-p05-peer-provenance
git fetch upstream
git rev-parse HEAD   # must be 02e754f4d… unless orchestrator retargets after a freeze
git log --oneline upstream/main..HEAD
git diff upstream/main...HEAD
bun typecheck
# focused + at least packages touched:
bun run test   # or package-scoped if full suite env-flakes; note any unrelated fails
```

- Rubric: `docs/tooling/cold-pr-review-rubric.md` + `.github/prompts/codex-pr-review.md`
- Contract: `~/coding/hapi/docs/plans/2026-08-03-a2a-control-plane-rfc.md` § Revision 2026-08-09 (mirror path)
- Issue scope-lock: https://github.com/tiann/hapi/issues/1203#issuecomment-5233188159
- Severity: Blocker / Major / Minor / Nit. Evidence `path:line`. No praise. Confidence ≥80%.
- **Public voice:** A2A / Layer 0 only — no estate product codenames in findings that might be pasted to GitHub

### Product focus (both passes)

1. `sourceSessionId` derived from trusted env / hub — **never** free-form MCP arg as authoritative
2. Peer deliveries never stored as `sentFrom: "webapp"`; unknown-source still peer-marked
3. Hub rejects/ignores forged body `peer` without trusted delivery signal
4. Out-of-namespace source ids dropped / not attributed
5. Web badge + link when source known
6. **No** ledger/events/handoff/P2 scope creep
7. Additive wire only; old clients still parse messages

### Deliverable

1. Write full findings to:
   `~/coding/hapi/docs/plans/peer-briefings/2026-08-09-cold-pass1-1203.md` (pass 1)
   or `...-cold-pass2-1203.md` (pass 2)
2. Ping feature peer `6212dae5` **and** Meta `9f5f7e1d` with: verdict counts, Ready-for-next-gate yes/no, tip SHA reviewed, pointer to findings file + this session
3. Message **must** open with `From: /sessions/<your-id>` (+ optional Name)
4. `AGENT_NOTIFY_SUMMARY` on final turn
5. When idle after ping: ready for orchestrator to archive+delete spent cold peer

## Pass 1 brief (paste after spawn)

You are **Cold #1203 pass1: Claude high**. Full court press pass 1 only.

Read `docs/plans/peer-briefings/2026-08-09-peer-a2a-p05-cold-reviews.md` (mirror) and run the shared instructions above on tip `02e754f4d`.

Do **not** implement fixes. Do **not** open upstream PR. Do **not** start Sol pass.

Close the loop to `6212dae5` + `9f5f7e1d` when done.

## Pass 2 brief (only after pass-1 Majors fixed + tip freeze)

You are **Cold #1203 pass2: GPT Sol**. Re-read full `upstream/main...HEAD` on the **post-fix frozen tip** (orchestrator will name the SHA in the ping). Not a rubber stamp. Residual Majors + regressions from fixes. Same deliverable path with `cold-pass2-1203.md`.
