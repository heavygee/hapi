# Storage usage pie chart Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an interactive React pie/donut under Settings → Storage so operators see relative DB/WAL/SHM share alongside absolute sizes ([tiann/hapi#1382](https://github.com/tiann/hapi/issues/1382)).

**Architecture:** Keep existing `SettingsStoragePage` rows and API. Extract a presentational `StorageUsagePie` React component that owns `activeKey` state, computes polar arcs from byte counts, and syncs legend + center readout. No new chart library (three fixed slices).

**Tech Stack:** React 19, Vitest + Testing Library, existing `--app-*` theme tokens, `formatFileSize`.

**Issue:** https://github.com/tiann/hapi/issues/1382  
**PR:** https://github.com/tiann/hapi/pull/1383  
**Worktree:** `~/coding/hapi/worktrees/storage-pie` @ `feat/storage-usage-pie-chart`

**Status (2026-08-05):** Implemented + peer-stack dogfood green. Soup promote blocked by remat-hold (`feat/agent-session-import-picker`).

---

### Task 1: Worktree

- [x] `hapi-worktree-create storage-pie --branch feat/storage-usage-pie-chart`

---

### Task 2: Pure geometry + slice helpers (TDD)

- [x] `web/src/components/settings/storageUsagePie.ts` + tests

---

### Task 3: Interactive React component

- [x] `StorageUsagePie.tsx` + interaction test

---

### Task 4: Wire into Settings Storage page + i18n

- [x] `storage.tsx` + en/zh-CN strings

---

### Task 5: Verify + dogfood + PR

- [x] typecheck + unit tests
- [x] Peer stack Playwright (`e2e/peer/1382-storage-usage-pie.spec.ts`) + PNG/webm
- [x] Upstream PR #1383
- [ ] Soup promote when remat-hold clears

---

## Friction mode

- **Assumption challenged:** Pulling Recharts for 3 slices - rejected; custom component keeps PWA lean and avoids Recharts 3 `activeIndex` API churn.
- **Steelman:** Recharts is battle-tested a11y/tooltip - kill criterion if custom a11y fails keyboard + screen-reader smoke.
- **Falsify cheaply:** unit test interaction + one Playwright hover/tap before soup.
