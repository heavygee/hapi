# Attention umbrella orchestration

**Orchestrator session:** [Attention umbrella: orchestrate dogfood + PRs](/sessions/c89dc806-274d-4194-b61a-d64c0a69f12d)

## Posted

| Artifact | URL |
|---|---|
| Three-way Discussion | https://github.com/tiann/hapi/discussions/2355 |
| Umbrella issue (submission) | https://github.com/tiann/hapi/issues/2356 |
| Proof assets | https://github.com/heavygee/hapi/releases/tag/attention-umbrella-assets |

## Dogfooded (countdown running from 2026-11-10T01:38Z-ish)

#1725 · #1733 · #1772 · #2339 · #987 · #2354

## Peers lodging missing PRs

| Remit | Session |
|---|---|
| Flagship #1717 blocked PR (submission text in body) | [Peer #1717: flagship blocked PR](/sessions/83d28e01-5852-4926-b163-99a95f46c931) |
| Residency fade | [Peer #2356: residency fade PR](/sessions/205260d9-527a-4f7b-beeb-968ecf567fe0) |
| #2002 Active + Working lenses → **PR #2376** | [Peer #2002: Active Working lenses](/sessions/ea9e52cc-cf3d-4f5d-95d8-9944bf08b0d6) |
| #1996 blocked filter lens | [Peer #1996: blocked filter lens](/sessions/eddfb230-ebc4-4196-b2b7-c33a2f5f71f8) |
| Cursor emit #2354 babysit (pre-existing) | [Cursor status-summary emit](/sessions/ab6f3c6c-3a29-49df-82fa-bceda7e46318) |

Still later (orchestrator will spawn when blockers clear): list persistence of last status summary; settings default-on; blocked FUE; hub-authored blockers.

## Daily check

`attention-daily-sweep` via `scripts/tooling/hapi-attention-daily-sweep.sh`:
- **Progress:** `done/total` hourly sweeps (24), unit `sweeps` — each tick queries Discussion #2355, Issue #2356, and open dogfooded PRs.
- **Detail:** quiet vs N new signals; findings accumulate in `/tmp/hapi-attention-daily-sweep.log.findings`.
- Wake-on-terminal re-arms triage after the day. Not a bare `sleep 86400`.

Merge remains operator/Meta after elapsed windows — prepare only.

## Filter-chain hold (LIFTED 2026-11-11)

`#1772` is now **MERGEABLE/CLEAN** (author techotaku39 merged `main` @ tip `61d72d98c`, `codex-review:pass`). HOLD on `#2002` / `#1996` lodging is **lifted**.

- Re-wake peers to lodge **stacked** PRs on `#1772` tip (not a competing #1772, not bare `main`).
- Prefer Draft if still unsure of CI; body must say depends-on #1772.
- Soup layers stay warm until upstream PR exists + linked.

## #1772 rebase-assist (ready — awaiting operator post)

- Branch: `heavygee/hapi` `rebase-assist/1772-onto-upstream-main` @ `8b254399c`
- Author kept as techotaku39; committer heavygee
- Shape: merge commit of current `upstream/main` + techotaku tip (not a linear squash — 28 commits in ancestry count; tip is one merge resolving conflicts)
- `maintainerCanModify: true` on #1772 — do **not** push until author (or operator) says yes; no force-push
- Compare: https://github.com/tiann/hapi/compare/main...heavygee:rebase-assist/1772-onto-upstream-main
- Prep peer: [/sessions/3c5af7c8-540d-4d7c-b7a1-5df17abe5b37](/sessions/3c5af7c8-540d-4d7c-b7a1-5df17abe5b37)

## Landed on upstream `main` (via fork sync 2026-11-10)

| PR | Notes |
|---|---|
| #2354 Cursor emit | Merged upstream (`39da0be55`) — dogfood window moot; Ready-YES was correct |
| #2339 FUE unlabelled callouts | Merged upstream (`7498d8c8f`) — check whether `driver/fue-unlabelled-controls` soup layer is now redundant |
| #1424 session-attached jobs | Already counted; reconfirmed in sync |
| #2296 presence badges (Ian) | Landed — residency-fade sibling narrative may need a light refresh vs power-mark/badge taxonomy |
| #2362 residency fade | Merged by tiann 2026-11-11 (`a29fe7b32`); badge identity + fade scale coexistence |

## Mirror hygiene

Rebased+pushed 4 local docs/tooling commits onto `origin/main` @ `9591e34ac` (2026-11-10) after tooling/meta blocked remat on ahead-of-origin main.

## Dirty-dogfood triage (2026-11-10 ~09:00Z)

First hourly sweep flagged #1725/#1733/#1772/#987 as CONFLICTING/DIRTY after sync.

| PR | Remediations |
|---|---|
| #1725 | **Ready-YES / CLEAN** @ `cfa9b93e5` (one-shot Continue fix); dogfood ~40h left; peer idling |
| #1733 | **Ready-YES / CLEAN** @ `7e86f4f93b`; dogfood ~40h left; peer idling |
| #987 | **Re-cut MERGEABLE** @ `7a2cd6232` (1 commit); CRC dropped for fresh bot; dogfooded kept; archive `archive/pr987-pre-recut`; [peer](/sessions/290c588b-5f7c-4391-80ad-6078f695d4be) babysitting CI |
| #1772 | Rebase-assist offer posted on PR; assist branch `rebase-assist/1772-onto-upstream-main` |

## Residency fade lodged

| PR | Notes |
|---|---|
| #2362 | **MERGED** by @tiann 2026-11-11T00:58:25Z (`a29fe7b32`). Peer Gate A / exit reflection owed. [peer](/sessions/205260d9-527a-4f7b-beeb-968ecf567fe0) |
| Tooling | **Fork [heavygee/hapi#326](https://github.com/heavygee/hapi/pull/326)** open — `codex-review-state:v1` parse + offline probe that fails on unpatched script. Awaiting fork merge. |

## Daily sweep complete (2026-11-11T08:00Z — 24/24)

Job `attention-daily-sweep` completed. Findings: `/tmp/hapi-attention-daily-sweep.log.findings`.
No third-party pushback on Discussion #2355 or Issue #2356 (only our own comments).

| PR | Status after day |
|---|---|
| #1725 | Ready-YES / CLEAN; dogfood ~17h left |
| #1733 | Ready-YES / CLEAN; dogfood ~17h left |
| #1772 | Author self-merged `main` overnight → **CLEAN** three-dim; dogfood clock running; HOLD lift |
| #987 | Still NOT clean: Android `build` fail (`MissingTranslation` ru for `channel_model_errors` + sibling), 6 unresolved threads, bot Needs changes. Tip `8f5fc0672`. Peer wake with fix prescription. |
| #2362 | **Landed** (tiann merge) — remove from open attention set |

Re-arm next 24h sweep watching the same open PRs (drop #2362; it was never in the script list).

## #1996 re-HOLD (2026-11-11) — waiting on #1717 open PR

Peer correctly flagged: blocked-only lens has no predicate home on `main` or any open PR; it lives only in [Peer #1717](/sessions/83d28e01-5852-4926-b163-99a95f46c931) WIP (`feat/blocked-session-affordance-1717`).

**Call: option 1** — keep #1996 held until #1717 opens upstream. No invented minimal predicate. No informal base on moving tip `d1c19413a`.

**Stack order (updated):** `#1772 → #2002 → #1996`. [#2002](/sessions/ea9e52cc-cf3d-4f5d-95d8-9944bf08b0d6) already lodged fork cold-review [heavygee/hapi#328](https://github.com/heavygee/hapi/pull/328) off #1772 tip; when #1996 resumes it builds on `feat/2002-active-working-lenses`, not the reverse.

## #2362 Gate A clean (2026-11-11)

Peer exit reflection: `docs/plans/retros/2026-11-11-session-row-residency-fade-exit.md`. Idle for Meta archive.

**Follow-up authorized:** live stacking-context defect from #2362 Minor → tracker [tiann/hapi#2373](https://github.com/tiann/hapi/issues/2373); fix branch `fix/session-row-fade-tooltip-stacking` (`0cd8475d3`). Peer to open upstream PR.

Promotes applied: fork-stage non-draft guidance (`pr-review-loop.md` + `hapi-pr-create`); tip-check gap filed [heavygee/hapi#327](https://github.com/heavygee/hapi/issues/327).

## MCP `link_pr` regression (2026-11-11)

Live soup: awareness ON, CLI `hapi link-pr` OK, MCP catalog missing `link_pr` (only `link_issue`). Loss predates current absorb (inherits; both merge parents have 0). Originating restore that rebuilt `link_issue` and omitted `link_pr`: `e08eb8b69`. Symbol still on `driver/github-pr-awareness` @ `8ff958321`.

**Owner:** [tooling/meta bot](/sessions/cbd1073e-4fd3-4f4a-bff8-cf9ba97bca6d) — finish current absorb first, then thin tip re-union + `sentinel: link_pr` (fail-closed remat). Confirm MCP catalog with awareness ON. [#1163 session](/sessions/b30cf5c0-633b-420f-bc10-26229e07f598) not required for remat (upstream #1163 CONFLICTING is independent). Workaround: CLI `hapi link-pr`.

## #2002 lodged as tiann/hapi#2376 (2026-11-11)

[Peer](/sessions/ea9e52cc-cf3d-4f5d-95d8-9944bf08b0d6) opened [PR #2376](https://github.com/tiann/hapi/pull/2376) off #1772 tip `61d72d98c` (head `0aaed119f`). Chip linked. Fork #328 cold-review-clean (P2s pre-existing in #1772 base). CI pending. Dogfood stamp authorized once CI green (soup-proven). Stack: `#1772 → #2376/#2002 → #1996` (#1996 still held on #1717 open).
