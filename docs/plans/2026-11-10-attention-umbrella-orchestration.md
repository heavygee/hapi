# Attention umbrella orchestration

**Orchestrator session:** Attention umbrella (HAPI id `c89dc806-274d-4194-b61a-d64c0a69f12d`)

## Posted

| Artifact | URL |
|---|---|
| Three-way Discussion | https://github.com/tiann/hapi/discussions/2355 |
| Umbrella issue (submission) | https://github.com/tiann/hapi/issues/2356 |
| Proof assets | https://github.com/heavygee/hapi/releases/tag/attention-umbrella-assets |

## Dogfooded (countdown running)

#1725 · #1733 · #1772 · #2339 · #987 · #2354

## Missing PRs to lodge (peers)

1. **#1717 blocked chrome** — flagship / uber PR (submission text + images in body)
2. Residency fade restore
3. #2002 Active + Working lenses
4. #1996 blocked lens (after / stacked on #1772)
5. Persist last status summary onto session-list fields
6. Settings: flag blocked from status summaries (default on)
7. FUE for blocked affordance
8. Hub-authored blocker sources (after #1717)

## Daily check

Session job `attention-daily-sweep` wakes this orchestrator every ~24h to:
- Read new comments on #2355 / #2356
- Read reviews/comments on dogfooded + child PRs
- Triage pushback; respond or escalate; re-arm the job

Merge remains operator/Meta after elapsed windows — prepare only.
