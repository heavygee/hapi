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
| #2002 Active + Working lenses | [Peer #2002: Active Working lenses](/sessions/ea9e52cc-cf3d-4f5d-95d8-9944bf08b0d6) |
| #1996 blocked filter lens | [Peer #1996: blocked filter lens](/sessions/eddfb230-ebc4-4196-b2b7-c33a2f5f71f8) |
| Cursor emit #2354 babysit (pre-existing) | [Cursor status-summary emit](/sessions/ab6f3c6c-3a29-49df-82fa-bceda7e46318) |

Still later (orchestrator will spawn when blockers clear): list persistence of last status summary; settings default-on; blocked FUE; hub-authored blockers.

## Daily check

`attention-daily-sweep` via `scripts/tooling/hapi-attention-daily-sweep.sh`:
- **Progress:** `done/total` hourly sweeps (24), unit `sweeps` — each tick queries Discussion #2355, Issue #2356, and open dogfooded PRs.
- **Detail:** quiet vs N new signals; findings accumulate in `/tmp/hapi-attention-daily-sweep.log.findings`.
- Wake-on-terminal re-arms triage after the day. Not a bare `sleep 86400`.

Merge remains operator/Meta after elapsed windows — prepare only.

## Filter-chain hold (2026-11-10 decision)

`#2002` / `#1996` **HOLD** upstream lodging until `tiann/hapi#1772` is mergeable.

- techotaku39 pushed 2026-11-09 — author live; no competing reconciled #1772 PR.
- No Draft-stacked #2002 against `main` (cold-review noise).
- Soup thin layers stay warm; peers idled `blocked`.
- Unblock path: help #1772 clear conflicts (rebase-assist / operator-mediated offer), then re-wake filter peers.

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

## Mirror hygiene

Rebased+pushed 4 local docs/tooling commits onto `origin/main` @ `9591e34ac` (2026-11-10) after tooling/meta blocked remat on ahead-of-origin main.

## Dirty-dogfood triage (2026-11-10 ~09:00Z)

First hourly sweep flagged #1725/#1733/#1772/#987 as CONFLICTING/DIRTY after sync.

| PR | Remediations |
|---|---|
| #1725 | **Rebased** — MERGEABLE @ `10c5ba127c`; CI running; dogfood ~40h left; [peer](/sessions/1e75a008-dda1-4549-af61-1f69150e1795) |
| #1733 | **Ready-YES / CLEAN** @ `7e86f4f93b`; dogfood ~40h left; peer idling |
| #987 | Thin re-cut approved — [Peer #987](/sessions/290c588b-5f7c-4391-80ad-6078f695d4be); drop cold-review-clean only; keep dogfooded; note pre-tip `2c28a1365` |
| #1772 | Rebase-assist offer posted on PR; assist branch `rebase-assist/1772-onto-upstream-main` |

