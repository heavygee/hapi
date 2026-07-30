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

**Feature-branch tip (re-thinned):** `feat/session-header-machine-meta` @
`3f4667c3f` on `upstream/main` — SessionHeader meta + `sessionRowHelpers`
import (no inline SessionList helper defs).

### Hard rules for next soup apply

1. Prefer remat (`upstream/main` + thin tip). **Do not tip-merge** onto an old
   soup SHA when ancestry diverged (three-way SessionList rewrite).
2. Tip must bind hot calls via `@/lib/sessionRowHelpers` (or equivalent import).
3. **Never "resolve" SessionList merges by dropping row helpers.**
4. Rebuild fails closed via `verify-sessionlist-bindings.mjs` (meta).

### Task 3b: Re-thin after P0 restore (2026-07-29)

Kitchen restored at driver `6dfd82aba` + shared helpers + bindings gate.

### Soup remat gate (Meta 2026-07-30) — P0 re-thin done

Remat failed at layer 29/29 on SessionList + sessionRowHelpers add/add.

Re-thinned onto exact remat intermediate:
`7ef4226a3` (Merge feat/session-mention-rich-composer into driver/integration-wip)

Tip: **`ba35a52c0`** (force-pushed)

- `77f2e8f09` — SessionHeader machine + last-active (union with soup LinkPr header)
- `ba35a52c0` — activeAt detail keep-alive + 60s age tick

No SessionList / sessionRowHelpers edits on tip (helpers already on base).
`merge-tree` vs `7ef4226a3`: clean. Bindings verify OK.

**Do not** hand-merge onto live soup. Meta remats on this ack.
Force-pushed 2026-07-30: origin tip = `ba35a52c0c5c744d621cebb5048124965e9dfb7b`
(garden pre-push override: `HAPI_SKIP_COMMIT_HOOKS=1` — remat base carries garden ancestry).

After remat: re-thin back onto `upstream/main` for PR #1244 reviewable ancestry.

### Task 4: Upstream PR

- Opened: https://github.com/tiann/hapi/pull/1244 (`Fixes #1241`)
- Fork stage: https://github.com/heavygee/hapi/pull/96 (`cold-review-clean`)
- Remat tip (temporary): `ba35a52c0` on soup intermediate — **not** the reviewable PR tip
- After remat succeeds: re-thin onto `upstream/main` and force-push product-only tip again
