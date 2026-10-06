# Remat block (2026-07-30) — CLEARED

**Status:** green. Live tip `0a497f569` · asset `index-Cpc5HVzO.js` · `/sessions` Playwright OK.

| Layer | Tip used at remat | Now on origin |
|-------|-------------------|---------------|
| 27 awareness | `d946021a9` | same |
| 28 rich-composer | `091b1b651` | same |
| 29 session-header | `ba35a52c0` (remat-only ancestry) | **`4f3de28e1`** thin on `upstream/main` for [PR #1244](https://github.com/tiann/hapi/pull/1244) (+172/−46, 6 files) |

Next remat will pick up thin header tip `4f3de28e1` (no SessionList/helpers). Probe `merge-tree` vs remat pre-layer before promote; live soup already has header behavior from `ba35a52c0` absorb — no urgency to remat solely for this force-push.
