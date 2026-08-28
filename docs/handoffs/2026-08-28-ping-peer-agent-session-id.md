# Handoff: Peer #1203 — agentSessionId ping-peer resolution

**Parent:** remat orchestrator [cursor - tooling/meta bot](/sessions/05d9f0f2-9273-4137-933c-07459a1146a2)  
**Spawned:** 2026-08-28  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/ping-peer-1203`  
**Branch:** `feat/ping-peer-agent-session-id` (from `upstream/main`)  
**Upstream issue:** [tiann/hapi#1203](https://github.com/tiann/hapi/issues/1203) — reply-addressable `ping_peer` handoffs  
**Lane:** B (fork PR on `heavygee/hapi`, prepare only for upstream)

## Scope (this peer owns)

Implement **durable `metadata.agentSessionId` as a find-key** for `hapi ping-peer` / MCP `ping_peer`:

- Resolve target by `agentSessionId` prefix (same semantics as `hapi-overseer-call.sh resolve`)
- Still POST to the **current hub session id** after resolve (ids rotate; agentSessionId is durable)
- Ambiguous / not-found errors with actionable hints (name, hub id sample)
- Unit tests in `cli/src/modules/pingPeer/`
- **Do not** reintroduce #1473 fortress (`peerCapability.ts`, `verifyPeerSessionCapability`)

## Explicitly NOT this peer

- **#1618 nametag UI** — orchestrator lands `feat/a2a-nametag-attribution` as soup layer separately
- Fortress / capability HMAC stack (rejected; see `docs/plans/2026-08-17-a2a-nametag-only-thesis.md`)
- Automatic reply loops, durable mailbox, or new session-management tools

## DONE (orchestrator)

- Driver remat promoted to `5f14e73a9`; hold cleared
- Worktree created on `upstream/main`
- This handoff file on disk

## Proof / ship

1. `bun typecheck && bun run test` from repo root (cli package at minimum)
2. Open fork PR `heavygee/hapi` → prepare upstream PR text for `tiann/hapi#1203`
3. Dogfood: `hapi ping-peer <agentSessionId-prefix> "test"` against a known session

## Close the loop (mandatory when done or blocked)

1. `hapi ping-peer 05d9f0f2` — message opens with `From: /sessions/<your-id>` then verdict
2. Emit `AGENT_NOTIFY_SUMMARY` on final turn
