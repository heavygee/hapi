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

Session job `attention-daily-sweep` on the orchestrator — wakes ~every 24h to triage Discussion #2355, Issue #2356, and all dogfooded / child PRs for pushback. Re-arm after each sweep.

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

