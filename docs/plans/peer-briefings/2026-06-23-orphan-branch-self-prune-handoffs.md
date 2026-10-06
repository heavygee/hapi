# Orphan branch self-prune handoffs (2026-06-23)

Orchestrator mirror tidy pinged live peers to assess orphan git refs. **Peers own prune decisions** — orchestrator does not delete unique-commit branches without sign-off.

## Falsification (PR #61 merged)

Fresh clone of `origin/main` @ `aa741d38`:

- `scripts/tooling/hapi-driver-build-web.sh` — present
- `scripts/tooling/lib/build-web-atomic.sh` — present
- `scripts/tooling/lib/driver-promotion.sh` — present
- `bash -n` on build scripts — PASS

## Handoffs delivered (HAPI)

| Orphan ref | Peer session | Status |
|---|---|---|
| `feat/claude-session-import` | `aad7763e` import picker | **pruned** by peer |
| `feat/scratchlist-attachments-v22` | `ccf9ed5d` Peer #921 | **keep** — upstream #921 lane @ `worktrees/scratchlist-attachments-v22` (orchestrator wrongly called this orphan) |
| `spike/scratchlist-attachments-921` + `worktrees/scratchlist-attachments` | same peer | **prune approved** — pending: session still bound to spike wt |
| `feat/mermaid-table-patch-loop` | parse-failure peer (`860cc065` / `mermaid-feedback` wt) | **pruned** — table repair on main via #902; patch loop dead (#900 flavor-gate rejection); unique work on `feat/mermaid-parse-failure-feedback` |
| `feat/tier-b-reattach-orphan-runner-children-v1-with-stale-base` | orchestrator | **pruned** |

## Peer instructions (common)

1. Run `git log main..<branch> --oneline` — if empty, safe delete ref.
2. If superseded by another branch/worktree, delete orphan ref only after confirming no unique commits.
3. Do not remove soup manifest layers without operator ack.
4. Reply in-session with keep/prune + rationale.

## Orchestrator answers to operator (2026-06-23)

- **Direct push to main:** bad hygiene; PR-only going forward (`mirror-main-layout.md` updated in #61).
- **Untracked tooling:** real estate, referenced in docs, used in soup rebuild; landed in #61.
- **"Merged" stale four:** mislabeled — 0 commits ahead of main; safe ref delete after worktree removal (confirm `upstream-main-test` separately).
- **Soup band-aids:** stay until upstream absorbs product or collision fixed upstream.

## Peer #921 scratchlist — incident + hygiene (2026-06-23)

**Incident:** Peer swapped `feat/scratchlist-attachments-v22/web/dist` into `driver/web/dist` — rolled back 120+ soup layers to a 15-commit feat bundle. Operator caught missing garden/overseer/mermaid on :3006.

**Recovery verified (orchestrator):** driver @ `04211a73`; bundle `index-vvLi2Rwn.js`; garden marker present in dist; full `driver/web` rebuild path restored.

**Peer RC (accepted):** feat-dist → driver/dist is never dogfood unless feat source == driver web tree. Enforce precache regression + soup marker grep before any dist serve.

**Branch verdicts:**

- **KEEP** `feat/scratchlist-attachments-v22` — upstream #921 PR lane, tip `c08f327d`, worktree `scratchlist-attachments-v22`
- **KEEP** `soup/scratchlist-attachments-v22-v12` — manifest layer; cherry `c08f327d` on driver (`04211a73`)
- **PRUNE** `spike/scratchlist-attachments-921` — 0 commits ahead of main (blocked: HAPI session `ccf9ed5d` still on spike worktree)
- **PRUNE** `worktrees/scratchlist-attachments` — after session repoints to v22 worktree

**Orchestrator correction:** `feat/scratchlist-attachments-v22` was never branch-only orphan — it always had worktree `scratchlist-attachments-v22`. Only the spike ref/wt was dead weight.

## Mermaid table-patch-loop — pruned (2026-06-23)

Parse-failure peer (`860cc065`, worktree `mermaid-feedback` @ `9f5874a5`):

- **PRUNED** `feat/mermaid-table-patch-loop` — verified gone on mirror
- GFM table repair superseded by upstream **#902** (on main)
- Silent mermaid patch loop abandoned — **#900** rejection (flavor-gated); no manifest dependency
- **KEEP** `feat/mermaid-parse-failure-feedback` — hub-side Approach B (#829 lineage); canonical mermaid work going forward
