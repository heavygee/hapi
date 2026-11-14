# Exit reflection: stale permission required badge (PR #2415)

## Shipped as

- PR(s): [#2415](https://github.com/tiann/hapi/pull/2415) — squash `cca38a4ac` (tiann merge, Lane A)
- Absorber (if superseded): n/a
- Session: Peer #2414 / PR #2415: stale permission required badge

## Non-code residue

- Sticky **permission required** was orphaned `agentState.requests` after CLI pending was gone; #1735 made 409 visible but left the badge.
- Live dogfood evidence: Peer #1717 still held `toolu_01HTLNZ3…` in hub `agent_state` with empty `completedRequests`.
- Ready YES ≠ lane B: no `dogfooded`, no laneb grant — saying "lane-B eligible" in a handoff was wrong even though conduct stayed prepare-only (#1842 conflation).
- Reporting the red tip (TS2322 + two follow-up findings) immediately mattered more than waiting for green.
- Fixes were placement/responsibility: restore generic `registerHandler` (not widen types); drop hub cancel-on-409 because CLI orphan finalize owns the clear; in-flight set for overlapping answers.
- Always reply **in-thread and resolve** — PR comments alone leave threads open and hide from merge APIs.
- No soup tip was ever promoted for this PR (clean Gate A step 1).

## Promote?

- [x] `none` — lessons already in Meta brief / known babysit canon; no new High-signal row needed
- [ ] `High-signal index`
- [ ] `lifecycle / tooling doc`
- [ ] `tooling issue`

## Open questions / landmines

- Proactive clear when a peer/user message supersedes AskUserQuestion (without requiring a 409 click) is still unproven; falsify with soup dogfood if it recurs.
- `updateAgentState` while session `closed` silently drops finalizes — reconnect/`reset` is the heal path; still a footgun for hard kills.

## Skip

- n/a
