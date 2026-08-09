# Exit reflection: project-pin-intra-group-only (PR #1458)

> Gate A' after tiann/hapi#1458 squash-merge. Cap: bullets only.

## Shipped as

- PR(s): tiann/hapi#1458 (Fixes #1457)
- Absorber: n/a
- Session: bf56c5a8 (Peer #1457)

## Non-code residue

- #1432 was a product mistake (#1431 hierarchy); Pin in project = intra-group only, never above In progress
- Soup Settings had evolved past upstream tip (jobs-mode / `pinInProgressMode`) - naive locale revert conflicts; keep soup keys, strip folder-lift claim
- Meta re-landed pinned-first intra-group sort (`d6f634f30`) after tip-forward merge dropped it - watch auto-merge of SessionList sort helpers on soup remat
- Peer PNG + unit RED→GREEN enough; lane B after :3006 dogfood OK
- Do not parallel-rebuild while Meta remat-hold owns tip-forward

## Promote?

- [x] `none` — no durable follow-up (one-off product revert + remat conflict shape already handled)

## Open questions / landmines

- Tip-forward of thin web locale/order PRs into soup can drop adjacent sort helpers if merge takes soup side - Meta caught it this time
- Obsolete peer e2e `e2e/peer/1431-*.spec.ts` skipped on fork main; delete on next peer-e2e sweep if desired

## Skip

- n/a (filled)
