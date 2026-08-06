# Peer briefing: session header missing project/path

**Spawned:** 2026-08-06  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/session-header-project-path`  
**Branch:** `feat/session-header-project-path` (from `upstream/main`)

## Operator repro (Quest / mobile screenshot)

Session header subtitle shows e.g. `cursor` · `machine: homelab` · `just now` · (optionally) `worktree: <branch>` — but **not** the project/directory category.

Sidebar already groups by project (`getGroupDisplayName(worktree.basePath ?? metadata.path)` → e.g. `coding/hapi`, `ygee/coding`). Open the session and that identity disappears from the header. On VR / full-bleed chat that is worse: you lose the sidebar context and cannot tell which project you are in from title + agent + machine alone.

Proof blob: `/tmp/hapi-blobs/6ce7f124-6240-4479-8dad-f2e27eb880a1-kYklrK/1786014886465-com.oculus.vrshell-20260806-121410.jpg`

## Authorship (already merged — do not piggyback)

| Artifact | Notes |
|----------|--------|
| [PR #1267](https://github.com/tiann/hapi/pull/1267) | **Merged** 2026-08-01 — @techotaku39 — `feat(web): make session header metadata configurable` |
| Commit | [`0537ddf84`](https://github.com/tiann/hapi/commit/0537ddf84a8ecfb3def7935ce67d803a1cb9d0c2) |

That PR added toggleable header fields: agent, machine, lastActive, model, reasoning, fastMode, createdAt, updatedAt, **worktree (branch only)**. It did **not** add project/path/`cwd`.

Related open PR [#1158](https://github.com/tiann/hapi/pull/1158) (same author) only unifies agent/model *display labels* — **out of scope**; do not dump path work there.

No unmerged heavygee session owns this gap → **new issue + fix on this branch**.

## Desired fix

1. Add a session-header metadata key for **project / path** (name it clearly — `path` or `project`; show the same human label the sidebar uses via `getGroupDisplayName` / shared helper, not raw absolute path unless that is the sidebar convention).
2. Wire it in `SessionHeader.tsx` (desktop + mobile secondary line). Prefer showing **project path** even when a worktree branch is also shown — they answer different questions (where vs which git worktree branch).
3. Default **on** (like worktree) in `DEFAULT_SESSION_HEADER_METADATA`; add Settings → Display toggle + i18n.
4. For worktree sessions: project = `metadata.worktree.basePath` (repo root category), not `worktreePath` (that is the worktree checkout — operator said they do **not** want worktree path confused with project).
5. For simple sessions: `metadata.path`.
6. Hide when empty (same pattern as other header fields).

## Your job

1. File upstream issue on `tiann/hapi` citing #1267 / `0537ddf84` and the missing project identity.
2. Implement on this worktree.
3. PNG proof (header with project visible) + `display_image` into this peer chat.
4. Soup dogfood when ready; **no upstream PR until operator OK**.

## Intake ownership

| Step | Status |
|------|--------|
| Archaeology (#1267 merged, #1158 unrelated) | DONE |
| Upstream issue | **YOU** |
| Implement | **YOU** |
| Proof + dogfood | **YOU** |
| Upstream PR | **YOU** only after operator OK |

Hard rules: product edits only in this worktree; no operator docs in upstream PR; never merge `tiann/hapi`.
