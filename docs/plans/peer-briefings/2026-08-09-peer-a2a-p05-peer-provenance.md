# Peer brief: A2A P0.5 / #1203 peer delivery provenance

## Parent
- Orchestrator HAPI session: `9f5f7e1d-d1d8-4d17-a668-0a0fdf4af685` (meta - PR watcher / this Cursor lane)
- Operator request (verbatim gist): make a peer and file it - align with A2A contract so it can ship independently (intrinsically useful), not a work-contract ask, but related - align in code (PR) and docs (RFC revision)

## Intake status (orchestrator completed)
- [x] 1 Code search - DONE: `cli/src/modules/pingPeer/pingPeer.ts` posts `{ text }` only; `hub/src/web/routes/messages.ts` hardcodes `sentFrom: 'webapp'`; `syncEngine.sendMessage` typed `sentFrom?: 'telegram-bot' | 'webapp'`
- [x] 2 Upstream search - DONE: [#1203](https://github.com/tiann/hapi/issues/1203) open; bot + techotaku confirm ghost-user bug; no impl PR yet. Related A2A: [Discussion #1332](https://github.com/tiann/hapi/discussions/1332), P1 #1374, P3 #1465
- [x] 3 Playback - DONE: operator 2026-08-09 (identity / From: habit → demand real provenance + A2A alignment)
- [x] 4 Issue - [#1203](https://github.com/tiann/hapi/issues/1203) + scope-lock comment https://github.com/tiann/hapi/issues/1203#issuecomment-5233188159 + #1332 revision https://github.com/tiann/hapi/discussions/1332#discussioncomment-17954883
- [x] 5 Proof path - **peer stack** + soup promote when UI badge lands; hub/cli unit tests mandatory even before dogfood

## Your assignment (feature peer)
- Own steps: **implementation + gates + upstream PR (Fixes #1203) + cold-review-ready tip**
- Do NOT redo: intake 1-5, RFC revision (orchestrator already revised fork RFC)
- Worktree: `~/coding/hapi/worktrees/a2a-p05-peer-provenance` @ `feat/a2a-p05-peer-provenance` (off `upstream/main`)
- Do NOT edit `~/coding/hapi/driver` by hand
- Do NOT merge on `tiann/hapi`
- Do NOT include `docs/operator/`, `docs/plans/`, or fork `CLAUDE.md` in the upstream PR diff
- Read: `docs/tooling/feature-work-lifecycle.md` + this brief + fork RFC section "Revision 2026-08-09" at `~/coding/hapi/docs/plans/2026-08-03-a2a-control-plane-rfc.md` (mirror path; not in your worktree tip)

### Product contract (must match RFC P0.5)

1. Inside a wrapped session: derive sender from `HAPI_SESSION_ID` (optional name from session metadata / `HAPI_SESSION_NAME` if already exported). **Never** accept `sourceSessionId` as an MCP/CLI free-form arg that becomes authoritative.
2. Persist peer deliveries as roughly:
   ```json
   { "meta": { "sentFrom": "peer", "peer": { "sourceSessionId": "<uuid>", "sourceName": "<optional>" } } }
   ```
3. Outside a session: still `sentFrom: "peer"` (or peer-unknown) - **never** `webapp`.
4. Hub must ignore/reject forged body fields that claim a different source.
5. Web: badge "From peer session" + link to `/sessions/<id>` when `sourceSessionId` present.
6. Out of scope: ledger/events, handoff receipts, auto-reply, AGENTS.md prose stamps (estate habit stays separate).

### Suggested touch points
- `cli/src/modules/pingPeer/pingPeer.ts` - stamp headers / dedicated peer-send path
- `shared` send-message schema - additive peer meta (hub-validated)
- `hub/src/web/routes/messages.ts` + `messageService` / `syncEngine.sendMessage` - `sentFrom: 'peer'`
- `web` message chrome - badge
- Tests: forge attempt fails; with env set, stored meta matches; without env, not webapp

### PR body requirements
- Fixes #1203
- Explicit "A2A P0.5 / Layer 0.1 - not a P2 work-contract" paragraph linking Discussion #1332
- Kill criteria listed
- Do **not** open/undraft PR until Claude cold → fix → Sol cold → fix (full court press) if that policy is still active on this estate - or at least local cold-review-clean before undraft. Prefer **draft** until colds green.

### Session title
`Peer #1203: peer delivery provenance` (workstream only; no status emoji; `hapi link-pr` after PR exists)

### Close the loop
1. `hapi ping-peer 9f5f7e1d` with message opening:
   ```
   From: /sessions/<your-id>
   Name: <metadata.name>
   ```
   then: PR URL, one-paragraph verdict, pointer to this session
2. Emit `AGENT_NOTIFY_SUMMARY` on final turn

## Links
- Issue: https://github.com/tiann/hapi/issues/1203
- A2A discussion: https://github.com/tiann/hapi/discussions/1332
- Scope comment: https://github.com/tiann/hapi/issues/1203#issuecomment-5233188159
- RFC (fork): `docs/plans/2026-08-03-a2a-control-plane-rfc.md` § Revision 2026-08-09 + phase P0.5
