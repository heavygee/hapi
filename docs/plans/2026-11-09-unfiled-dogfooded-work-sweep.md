# Sweep: dogfooded soup work with no upstream PR

**Date:** 2026-11-09 — operator-requested, after three separate instances turned up in one day.

## Method

1. Parsed all **91 active layers** in `config/driver-manifest.yaml` with their comment blocks.
2. Extracted upstream refs written **strictly** as `tiann/hapi#N` (bare `#N` is ambiguous — the
   fork's own PR numbers are in the same range and would produce false positives).
3. Batch-resolved all **68 distinct refs** via one GraphQL call → issue vs PR, open vs closed.
4. For every layer pointing at an **open upstream issue**, queried that issue's
   `CROSS_REFERENCED_EVENT` timeline for PRs that reference it.

**Known limitation, stated rather than hidden:** cross-reference events include PRs from *this
fork* as well as upstream. Fork PR numbers (low hundreds) overlap upstream's older range, so a
small number of rows below are classified by judgement, not purely mechanically.

## Genuinely unfiled — no upstream PR of any kind

| Layer | Upstream issue | Notes |
|---|---|---|
| `feat/fue-app-shell-onboarding` | **#1272** app-shell first-user onboarding (guided tour) | Zero cross-references. 13 files / ~915 insertions, authored directly against upstream/main. |
| `driver/2002-session-filter-active-working` | **#2002** Active + Working lenses | Zero cross-references. |
| `driver/1996-consolidate-blocked-filter` | **#1996** fold blocked lens into combined filter | Only a fork-side PR references it. |
| `driver/2038-machine-tag-reregister` | **#2038** | Only a fork-side PR references it. |
| `driver/blocked-list-ux` | **#1717** blocked affordance | The cross-referenced upstream PR (#1725) is a *different* change that merely mentions the issue. The affordance itself has never been filed. **Now in flight** — this sweep's trigger. |

## Filed and in flight (no action)

`#1404`/`#1489` → **#1424** (Ready YES) · `#1403` → #1729 · `#881` → #1607 · `#1160` → #1163 ·
`#1710` → #2010 · `#1724` → #1725 · `#1756` → #1762 · `#1792` → #1793 · `#2015` → #2018 ·
`#2020` → #2021 · `#2062` → #2066 (merged).

## What this says

Roughly **5 of 91 layers** are finished, dogfooded work aimed at an open upstream issue that was
never submitted. That is a small fraction — the filing discipline is mostly working — but the
items that slipped are not trivial ones, and two of them (`#1996`, `#2002`) are *filter* layers
that the attention submission depends on being coherent upstream.

The failure mode is consistent and worth naming: **work gets dogfooded into the soup, the soup
becomes the reward, and the upstream submission never happens** because nothing in the loop
demands it. The `dogfooded` label exists precisely to close that gap and is not being applied.

## Recommendation

1. `#1717` is already moving.
2. `#1996` and `#2002` should follow it — they are part of the same filter story and the
   attention submission is weaker without them.
3. `#1272` (FUE tour) is self-contained and sizeable; it is a candidate on its own merits, and
   item 6 of the attention submission should **not** depend on it.
4. `#2038` to be triaged by whoever owns it.
5. Worth considering: a check that flags a manifest layer which has been in soup beyond some age
   with no upstream PR cited. That is the mechanism that would have caught all five.
