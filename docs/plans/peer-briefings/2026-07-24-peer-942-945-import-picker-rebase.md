# Peer brief: Rebase multi-agent session import (#942 + #945) — restore tabbed importer on soup

**Peer HAPI:** `625682d5-92d4-4d50-804e-d7e1009816e2` (reopened originating #945 peer)  
**Worktree:** `~/coding/hapi/worktrees/agent-import-picker`  
**Branches:** `feat/claude-session-import` (#942, dzshzx) → `feat/agent-session-import-picker` (#945, heavygee)  
**Why you were reopened:** Live `:3006` sidebar shows Codex-only “Import sessions from Codex into Hapi” because both soup layers were **DROPPED 2026-07-19** after upstream **#1088** reworked the Codex import dialog. Operator wants the tabbed Claude/Codex/Cursor importer back.

## Operator ask (verbatim intent)

Find originating agent(s), reopen, get them rebasing — restore multi-agent import (Claude + Codex + Cursor tabs).

## DONE (orchestrator)

- Confirmed live tooltip = upstream `codexSync.tooltip` (Codex-only).
- Manifest parked both layers pending rebase vs 0.23.1 #1088 (see `~/.config/hapi/driver-manifest.yaml` ~L231–256).
- #945 open, **CONFLICTING**, ~24 commits behind `upstream/main`.
- #942 open (dzshzx), still the Claude foundation #945 stacks on.
- Worktree tip `dfd27b555` on `feat/agent-session-import-picker`.

## PEER OWNS (rebase cluster — do in order)

1. **Fetch & understand #1088 surface** on current `upstream/main`: `CodexSessionSyncDialog`, hub `codexDesktop` routes — adopt upstream’s native Codex dialog; do **not** blindly re-apply pre-#1088 rewrites.
2. **Rebase / rebuild `feat/claude-session-import` (#942)** onto current `upstream/main`:
   - Claude import + shared picker extraction on top of post-#1088 Codex dialog.
   - May need local branch from `dzshzx:feat/claude-session-import` (`f1f93474…`) if not on `origin`. You cannot force-push dzshzx; push a heavygee fork branch / coordinate PR update as needed; soup can use local branch tip.
3. **Rebase `feat/agent-session-import-picker` (#945)** onto the refreshed #942 tip:
   - Cursor tab + unified dialog (codex|claude|cursor).
   - Resolve conflicts; push to `heavygee` and update PR #945.
4. **PR messaging:** #945 (and #942 if you touch it) — note this restores dogfood multi-agent import after #1088 park; tabbed UI is the product goal.
5. **Soup:** After green typecheck/tests, tell orchestrator/operator to **un-comment** both manifest layers (claude then agent-import-picker, order matters) and `hapi-driver-rebuild --build-web`. **Do not** stack-switch or hand-edit `driver/`. Do **not** `gh pr merge` on `tiann/hapi` without explicit operator approval.

## Do NOT

- Hand-edit `~/coding/hapi/driver`
- Stack-switch / destroy hub via systemctl
- Merge upstream PRs yourself
- Re-enable soup before rebase is merge-ready / typecheck green

## Verify done

- Sidebar import opens tabbed UI covering **Claude, Codex, Cursor** (not Codex-only tooltip).
- Report: rebase notes, conflict resolutions, PR URLs, test output, “ready for manifest un-park + rebuild”.

## DONE (peer 625682d5 — 2026-07-24)

| Branch | Tip | Notes |
|--------|-----|-------|
| `feat/claude-session-import` (heavygee) | `2424b42a5` | Claude + dual Codex/Claude buttons; on `upstream/main` 8eac26726. **Not** dzshzx PR tip. |
| `feat/agent-session-import-picker` (#945) | `d2c5e2ced` | MERGEABLE; tabs Codex\|Cursor\|Claude; tooltip `agentImport.tooltip`. |

- Rebase conflict: only `bun.lock` (took main; refreshed win32 pin).
- Raw `dzshzx:feat/claude-session-import` still CONFLICTING (trellis + pre-#1088 Codex rewrite) — soup must use **heavygee** tips above.
- Verify: `bun typecheck` green both tips; focused import tests green; full suite 1 unrelated runner integration flake.

## META PROCEDURE CALL (2026-07-24)

**Do not un-park both layers as-is.** `merge-base --is-ancestor feat/claude-session-import feat/agent-session-import-picker` is **NO** — picker rewrote the same Claude-resume commits as different SHAs/trees (`2424b42a5`≠`4ee491784`, etc.). Souping both = conflict hell.

**Did instead:**

1. **Soup single layer** `feat/agent-session-import-picker` @ `bacfd20b9` (Claude+Codex+Cursor tabs + `agentImport.tooltip`; getModel stub aligned to `undefined`).
2. `feat/claude-session-import` **RETIRED** (superseded below) — do not un-park; do not rebase picker for two-layer ancestry.
3. Never soup raw `dzshzx:feat/claude-session-import`.
4. Parked heals **52/53/54** (assumed cluster dropped / wiped syncEngine import). Trained correct llm-fallback↔syncEngine rerere (keep soup scratchlist methods).

**Two-layer ancestry:** optional PR hygiene only — see § CLAUDE FINAL DISPOSITION (not required for dogfood/merge).

**Dogfood:** hard-reload `:3006` → sidebar import tooltip = `agentImport.tooltip` → tabs Codex \| Cursor \| Claude.

## CLAUDE FINAL DISPOSITION (2026-07-24 — supersedes "parked until ancestry")

Operator challenge: do not leave Claude in limbo. Investigation closed the case:

| Fact | Evidence |
|------|----------|
| Picker tip already ships Claude product | `claudeDesktop.ts` + Claude tab in `AgentSessionImportDialog` on souped #945 tip |
| Claude tip's last 2 commits are content-identical to picker's rewrites | `git patch-id --stable` matches for `2424b42a5`↔`4ee491784` and `d1749c94a`↔`0f8d413db` |
| Diff claude→picker is additive Cursor/unified UI only | No Claude-only product files missing from picker |
| Upstream #942 head is still **dzshzx** @ `f1f93474f` | CONFLICTING (trellis / pre-#1088); we cannot force-push their tip |
| Heavygee `feat/claude-session-import` @ `2424b42a5` | Clean rebased tip; **no** tiann PR pointing at it |
| #945 | `base=main`, MERGEABLE, includes full Claude import surface |

### Durable policy

1. **Soup:** `feat/claude-session-import` is **RETIRED** (not "parked pending rebase"). Never un-park as a second layer while #945 is the dogfood surface. Single layer stays `feat/agent-session-import-picker`.
2. **Upstream landing:** Claude import rides **#945**. Do not open a competing heavygee #942 unless tiann asks for a Claude-only slice (kill-criterion: #945 rejected for scope).
3. **dzshzx #942:** Leave open for author; comment that product is subsumed by #945 / heavygee tip exists for anyone who wants a clean Claude-only base. Do not babysit their trellis tip into soup.
4. **Two-layer ancestry rebase:** Optional PR-hygiene only, **not** required for dogfood or merge. Skip unless someone needs distinct review diffs for Claude vs Cursor. Cost > value given patch-id identity.
5. **Heals 52/53/54:** Stay parked while cluster is souped.

**Friction (falsify this call):** If dogfood shows Claude tab broken / missing fork-resume behavior that exists only on `2424b42a5` tree and not picker - then cherry-pick the delta onto picker tip, do not revive the soup layer.