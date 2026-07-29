# Session header machine + last-active Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show the session's machine name and relative last-active age in the session detail header meta row (alongside flavor/model), so multi-machine estates keep that signal after leaving the list filter chips.

**Architecture:** Extend `SessionHeader` only. Resolve machine label via existing `useMachines` + `useMachineLabels` (same as session list), with `metadata.host` / short `machineId` fallback. Age uses existing `formatRelativeTime` on `activeAt ?? updatedAt`. Do **not** duplicate context-window usage (already in composer `StatusBar`).

**Tech Stack:** React web PWA, Vitest, existing i18n keys pattern, TanStack Query machines cache.

**Issue:** [tiann/hapi#1241](https://github.com/tiann/hapi/issues/1241)

---

### Task 1: Failing tests for machine + age

**Files:**
- Modify: `web/src/components/SessionHeader.test.tsx`

**Step 1:** Add cases that expect machine label and relative age in the header when session metadata has `machineId`/`host` and timestamps.

**Step 2:** Run `cd web && bun run test src/components/SessionHeader.test.tsx` - expect FAIL before implementation.

### Task 2: Implement header meta

**Files:**
- Modify: `web/src/components/SessionHeader.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

**Step 1:** Resolve machine label; render `session.item.machine` + label; render relative age with absolute tooltip.

**Step 2:** Re-run tests until green. Typecheck web package.

### Task 3: Soup dogfood (fork) — SKUNKED 2026-07-29

**Files:**
- Modify: `config/driver-manifest.yaml` (mirror)
- Push feature branch to `origin`

**Step 1:** Add manifest layer for `feat/session-header-machine-meta`. ✅

**Step 2:** Full `hapi-driver-rebuild --build-web --verify` **blocked** on
`driver/github-pr-awareness` (14-file add/add vs post-`hapi-sync-fork-main`
base).

**Step 3 (FAILED tip merge):** Reset driver to prior soup tip `34956f6f8`,
**merge entire** `feat/session-header-machine-meta` (newer `upstream/main`
ancestry) into driver. That dragged unrelated upstream `SessionList` edits into
a conflict with soup-local row helpers. Resolution residue left
`getTodoProgress(s)` call site with the **function definition deleted** → Hub
error boundary `getTodoProgress is not defined`. Same failure class as the
earlier rich-composer remat.

- Tip merge: `abb1e4229` (skunk)
- Locale heal tip: `d7e1dace4` (verify green, runtime broken)
- **Do not rebuild soup** until tooling/meta lands a fail-closed rebuild guard.
- **Meta owns restore** of driver soup.

**Feature-branch truth (still good):** `feat/session-header-machine-meta` @
`e3eff74a3` only touches SessionHeader + locales + tests. Worktree
`SessionList.tsx` still defines `getTodoProgress`. Keep that invariant.

### Hard rules for next soup apply (after guard + restore)

1. **Never merge the whole feature tip into driver** when ancestry is ahead of
   soup base. That is how SessionList helpers die.
2. **Apply SessionHeader (+ locale keys + header tests) only** — checkout those
   paths from the feature branch, or cherry-pick a commit that touches nothing
   else.
3. **Never "resolve" SessionList merges by dropping local row helpers**
   (`getTodoProgress`, attention/PR chips, LinkPrDialog wiring, etc.). If
   SessionList conflicts, abort and re-apply without touching that file.
4. No `hapi-driver-rebuild` / `hapi-driver-build-web` from this session until
   meta's fail-closed guard exists and restore is done.

### Task 4: Upstream PR (after clean dogfood)

Open PR to `tiann/hapi` with `Fixes #1241`. Not before soup dogfood sign-off on
a **non-skunked** tip.
