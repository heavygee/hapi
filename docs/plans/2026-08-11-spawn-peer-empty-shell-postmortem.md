# Postmortem: empty peer after "successful" spawn (2026-08-11)

> Incident: orchestrator spawned `Peer #1508: work_ad cause inbound` (`b74405b7-…`). Hub returned `sessionId`. Sidebar showed a named session. **Zero messages. Agent idle.** Operator saw an empty peer. Not a runner outage.

## What happened

Spawn HTTP succeeded. The **handoff never entered the session**. Cursor got a chat id, went inactive, and had nothing to do.

```text
POST /api/machines/:id/spawn  { directory, agent, yolo, sessionType, message: "<§0 brief>" }
        │
        ▼
SpawnSessionRequestSchema  (Zod object, extra keys STRIPPED)
        │
        ▼
200 { sessionId }     ← looks done
        │
        ✗  `message` discarded — field does not exist on the schema
        ✗  no user turn queued
        ✗  session active=0, messages=[]
```

Fix after the fact: `hapi-ping-peer b74405b7 --message-file -` (resume + POST messages). Agent started immediately.

## Why this is not "the peer was lazy"

Machine spawn is **create process + session row**, not **assign work**. A Cursor session with no user message is an empty composer. The agent is not broken; it was never prompted.

## Swiss cheese (all slices required)

1. **API cannot take a first message.** `SpawnSessionRequestSchema` (`shared/src/apiTypes.ts`) has directory/agent/yolo/sessionType/… — no `message`. `hub/src/web/routes/machines.ts` never forwards one. Product plan `docs/plans/2026-05-30-peer-agent-offering.md` still says `POST /api/sessions/:parentId/spawn-peer` is future. **It never shipped.**

2. **Silent drop, not 400.** Zod default is strip-unknown. Putting `message` in the JSON is not an error. You get a healthy-looking session id. Fail-open.

3. **Skill is a two-act play; agents perform act one.** `spawn-peer-agents` § "Spawn a peer" is a curl that stops at `sessionId`. Mandatory `hapi-ping-peer` is ~100 lines later under "Deliver handoff". Under time pressure, orchestrators copy the first block and stuff the brief into spawn JSON (this session, 2026-08-11). The skill *does* say ping is mandatory. The first copy-pasteable snippet does not.

4. **No atomic utensil.** There is `hapi-ping-peer` (deliver to an existing id) and machine spawn (create id). There was no `hapi-spawn-peer` that does spawn → rename → ping → **verify message count > 0** or exit non-zero. `peer-feature-handoff.sh` is cited in the skill "when present" — **it is not present**.

5. **Verification skipped.** Skill table: "Handoff | POST …/messages queued; peer active: true". Orchestrator stopped at rename `{"ok":true}`.

## This was not the first time (same session)

| Peer | Spawn body included `message`? | First stored user turn |
|------|-------------------------------|-------------------------|
| #1374 `e1ee1785` | yes (stripped) | **Sibling ping** about #1375 — not the §0 intake brief |
| #1375 / #1464 | yes (stripped) | Cursor ACP binary / later turns — spawn brief never landed as JSON user text |
| #1508 `b74405b7` | yes (stripped) | **none** until emergency ping |

#1374 "worked" because a later `hapi-ping-peer` happened to be their first inbound. They never received the orchestrator's spawn JSON brief. Luck, not a pipeline.

## Kill criteria (estate)

- Spawn that returns `sessionId` with **0 user messages** after the orchestrator intended a brief → **failed spawn**, not "peer idle."
- Skill / script that documents stuffing `message` into `/spawn` → **bug** (API will never see it).
- Claiming "peer spawned" without `hapi-ping-peer` (or wrapper) + verify → **incomplete.**

## Remediation (ordered)

1. **Now:** `hapi-spawn-peer` — spawn + PATCH name + `hapi-ping-peer` + fail if no user message. Skill leads with that; first curl block is not spawn-only.
2. **Skill:** state explicitly: extra JSON keys on `/spawn` are **silently ignored**; `message` is not a spawn field.
3. **Product (later, tiann or fork):** either `spawn-peer` route that accepts `message`, or `.strict()` / explicit 400 `"unknown key message; use POST /sessions/:id/messages"`. Silent strip is the footgun.
4. **Do not** wait on the May 2026 spawn-peer offering to make today's orchestrators reliable.

## Not this incident

- Runner/hub down (spawn 200, cursorSessionId present)
- Worktree path wrong (session path was correct)
- Peer #1508 scope or the #1508 bug itself
