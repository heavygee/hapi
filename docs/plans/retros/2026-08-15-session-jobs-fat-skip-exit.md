# Exit reflection: session-jobs fat SKIP (#1424 dogfood)

> Meta applied Promote? from peer `6e70f97b` via soup-stabilize `05d9f0f2`. Not Gate A close — PR still open.

## Shipped as

- PR(s): tiann/hapi#1424 (open) — rescue soup `driver/session-jobs-delta`
- Absorber: n/a
- Session: `6e70f97b`

## Non-code residue

- Tip-forward SKIP of fat `driver/session-attached-jobs` is silent success unless someone pings the owner
- Rebase of fat `driver/*` ≠ re-tip onto live soup HEAD
- Rescue delta layers must drop with the fat parent at Gate A
- Kitchen: live `0053806dc`; manifest tip `882082b7d` not absorbed this pass — Meta did not remat (lease/STALE on peer)

## Promote?

- [x] `High-signal index` — SKIP fat layer → re-thin 1–3 onto current tip; ping owner
- [x] `lifecycle / tooling doc` — `driver-soup.md` § Fat SKIP; Gate A dual-drop; dogfood close SHA check
- [ ] `tooling issue` — optional: manifest lint if commit-count vs tip > fat-gate (deferred; remat skip already exists)

## Open questions / landmines

- Wire SKIP WARN → automatic `hapi-ping-peer` from `hapi-driver-rebuild` (not this patch)
- Do not steal remat lease from `6e70f97b` while they finish `882082b7d`

## Skip

- n/a
