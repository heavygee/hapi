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

### Task 3: Soup dogfood (fork)

**Files:**
- Modify: `config/driver-manifest.yaml` (mirror)
- Push feature branch to `origin`

**Step 1:** Add manifest layer for `feat/session-header-machine-meta`. ✅

**Step 2:** Full `hapi-driver-rebuild --build-web --verify` **blocked** on
`driver/github-pr-awareness` (14-file add/add vs post-`hapi-sync-fork-main`
base). Rerere cleared earlier layers; awareness still needs a remat wave.

**Step 3 (dogfood tip):** Reset driver to prior complete soup tip
`34956f6f8`, merge `feat/session-header-machine-meta`, heal `sessions.count`
locale, `hapi-driver-build-web` → verify OK at `d7e1dace4`. Hard-reload `:3006`.

### Task 4: Upstream PR (after operator dogfood)

Open PR to `tiann/hapi` with `Fixes #1241`. Not before soup dogfood sign-off.
