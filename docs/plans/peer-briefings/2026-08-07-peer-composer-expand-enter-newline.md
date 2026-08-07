# Peer briefing: Enter = newline when composer expanded

**Spawned:** 2026-08-07  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/composer-expand-enter-newline`  
**Branch:** `feat/composer-expand-enter-newline` (from `upstream/main`)  
**Upstream issue:** https://github.com/tiann/hapi/issues/1403  

## Context

Expandable composer: [#1319](https://github.com/tiann/hapi/pull/1319) (@techotaku39). Collapse-after-send: [#1368](https://github.com/tiann/hapi/pull/1368).

Bug/UX: with default Enter=send, expanded composer still submits on plain Enter. Operator + orchestrator agree expand implies long-form → Enter should newline.

## Spec (locked)

| Mode | Plain Enter | Send |
|------|-------------|------|
| Collapsed | Honor `composerEnterBehavior` | as today |
| Expanded | **Newline** (do not preventDefault / do not send) | Send button or **Ctrl/Cmd+Enter** |

- No new Settings knob.
- Keep Escape → collapse, Shift+Enter in collapsed send-mode, Alt+Enter Pi queue, suggestion Enter-select.
- Rich + plain text paths both covered.
- Tests for expanded Enter → newline + Ctrl/Cmd+Enter → send while expanded.

## Your job

1. Implement in worktree (`HappyComposer.tsx` `handleKeyDown` + tests).
2. Peer-stack proof + `display_image` (expand, type, Enter adds line, Ctrl/Cmd+Enter or button sends).
3. Soup dogfood on `:3006` (manifest layer + rebuild; no agent stack-switch).
4. **Do NOT open upstream PR until operator OK after dogfood.** Then PR closes #1403.

## Intake ownership

| Step | Status |
|------|--------|
| Issue #1403 | DONE (orchestrator) |
| Implement | **YOU** |
| Proof + soup dogfood | **YOU** |
| Upstream PR | **YOU** only after operator OK |

Hard rules: product edits only in this worktree; no operator docs in upstream PR; never merge `tiann/hapi`.
