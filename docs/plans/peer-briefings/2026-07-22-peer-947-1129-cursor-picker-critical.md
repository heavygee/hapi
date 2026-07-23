# Peer brief: Cursor model picker — critical bare-ID fix + #947 nested UX

**Peer HAPI:** `3c141438-5702-4ef6-a754-64a726052038`  
**Worktree:** `~/coding/hapi/worktrees/cursor-picker-ios-nested`  
**Branch:** `feat/cursor-picker-ios-nested` → upstream PR [tiann/hapi#947](https://github.com/tiann/hapi/pull/947)  
**Issues:** [tiann/hapi#1129](https://github.com/tiann/hapi/issues/1129) (CRITICAL — cannot pick models), heavygee/hapi#48 (nested UX), optionally heavygee/hapi#46 / Default highlight

## Operator ask

Fix the live bug where Cursor model picker shows **only Default** (cannot pick a model). Fold that fix into the open #947 PR. Make reviewers see this is a **critical bug fix**, not only a UX feature.

## DONE (orchestrator)

- Root-caused on `:3006`: ACP returns 31 **bare** ids; `cliModelSkus` empty; `isCursorAcpWireModelId` filters all → catalog empty.
- CLI `enrichCursorModelsWithCliSkus` early-returns on same predicate.
- Filed #1129; cross-linked on #947 / #1129 / fork #49.
- Cherry-pick probe: #947 vs current `upstream/main` — 8/9 files auto-merge; **1 conflict** in `HappyComposer.tsx` (#969 extracted `ModelEffortSettingsSection`).
- #47 Default highlight still applies cleanly (optional fold-in).

## PEER OWNS — DONE (2026-07-22)

1. [x] Rebased onto `upstream/main`; HappyComposer keeps nested drill-down **and** #969 `ModelEffortSettingsSection` (extended with back/title props).
2. [x] **CRITICAL #1129:** `isCursorAcpCatalogModelId` + wired through web picker / CLI enrichment / ACP probe; CLI `--list-models` still not promoted as ACP catalog. Live-shaped regression tests green.
3. [x] Default-highlight: `SessionChat` already ungated; folded flat-mode + bare-id highlight tests.
4. [x] PR #947 title/body critical-first; test plan boxes checked after verify.
5. [x] Pushed `90dc261b9` to heavygee; **not merged** (await operator).

**PR:** https://github.com/tiann/hapi/pull/947  
**HEAD:** `90dc261b9` on `feat/cursor-picker-ios-nested`  
**Verify:** `bun typecheck` OK; shared 17 + cli cursorModels/probe 18 + web picker suite 57 pass.  
**Diffstat vs upstream/main:** 18 files, +701 / -79

## Do NOT

- Hand-edit `~/coding/hapi/driver` or soup-promote without operator
- Stack-switch / `sudo systemctl` destroy hub
- Merge upstream PR yourself
