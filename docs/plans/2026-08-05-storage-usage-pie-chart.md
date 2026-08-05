# Storage usage pie chart Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an interactive React pie/donut under Settings → Storage so operators see relative DB/WAL/SHM share alongside absolute sizes ([tiann/hapi#1382](https://github.com/tiann/hapi/issues/1382)).

**Architecture:** Keep existing `SettingsStoragePage` rows and API. Extract a presentational `StorageUsagePie` React component that owns `activeKey` state, computes polar arcs from byte counts, and syncs legend + center readout. No new chart library (three fixed slices).

**Tech Stack:** React 19, Vitest + Testing Library, existing `--app-*` theme tokens, `formatFileSize`.

**Issue:** https://github.com/tiann/hapi/issues/1382

**Worktree:** `~/coding/hapi/worktrees/storage-pie` @ `feat/storage-usage-pie-chart` from `upstream/main`

---

### Task 1: Worktree

**Step 1:** `hapi-worktree-create storage-pie --branch feat/storage-usage-pie-chart` (base `upstream/main`)

**Step 2:** Confirm `git merge-base HEAD upstream/main` equals `upstream/main`

---

### Task 2: Pure geometry + slice helpers (TDD)

**Files:**
- Create: `web/src/components/settings/storageUsagePie.ts`
- Create: `web/src/components/settings/storageUsagePie.test.ts`

**Step 1:** Write failing tests for:
- building slices from `{databaseBytes, walBytes, shmBytes}` (drop zeros)
- percent of total (round sensibly; 0 total → empty)
- arc path / angles for known inputs (e.g. equal thirds)

**Step 2:** Implement helpers until green

---

### Task 3: Interactive React component

**Files:**
- Create: `web/src/components/settings/StorageUsagePie.tsx`
- Create: `web/src/components/settings/StorageUsagePie.test.tsx`

**Behavior:**
- Donut with center label (active slice name, size, %)
- Pointer enter / click / keyboard (legend buttons or radiogroup) sets active slice
- Active wedge slightly expanded (`outerRadius + 6`)
- Colors from CSS vars / muted theme palette (not purple-on-white dashboard defaults)
- `role="img"` + accessible name; legend as buttons with `aria-pressed`

**Step 1:** Failing interaction test (click legend → center text updates)

**Step 2:** Implement component

---

### Task 4: Wire into Settings Storage page + i18n

**Files:**
- Modify: `web/src/routes/settings/storage.tsx`
- Modify: `web/src/routes/settings/storage.test.tsx`
- Modify: `web/src/lib/locales/en.ts`, `zh-CN.ts`

**Step 1:** Render pie below the existing `SettingsSection` when `query.data` present

**Step 2:** Add strings: chart title, empty state, percent suffix if needed

**Step 3:** Extend page test to assert pie landmark / chart title present after load

---

### Task 5: Verify + dogfood + PR

**Step 1:** In worktree: `bun install` then `bun typecheck` and `cd web && bun run test`

**Step 2:** Peer stack Playwright smoke (existence PNG + interaction clip for slice select) OR soup promote for `:3006` dogfood per lifecycle

**Step 3:** After operator dogfood OK: push branch, open upstream PR with `Fixes #1382`

---

## Friction mode

- **Assumption challenged:** Pulling Recharts for 3 slices - rejected; custom component keeps PWA lean and avoids Recharts 3 `activeIndex` API churn.
- **Steelman:** Recharts is battle-tested a11y/tooltip - kill criterion if custom a11y fails keyboard + screen-reader smoke.
- **Falsify cheaply:** unit test interaction + one Playwright hover/tap before soup.
