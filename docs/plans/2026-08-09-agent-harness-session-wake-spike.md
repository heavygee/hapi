# Spike: agent-harness wake → HAPI session wake

**Date:** 2026-08-09  
**Upstream issue:** https://github.com/tiann/hapi/issues/1470  
**Worktree:** `~/coding/hapi/worktrees/agent-harness-session-wake` @ `feat/agent-harness-session-wake`  
**Peer:** spawned from #1464 continuum (`7fd700b2`); Meta `9f5f7e1d`  
**Status:** Path A shipped in upstream PR #1487. **Peer dogfood 2026-08-10 FAIL** (kill-test): Cursor ACP `2026.08.04` printed `HAPI_WAKE_SENTINEL` after turn-end but emitted **no** post-idle `session/update` / no new NAL request - Path A had nothing to bridge. Path B now required for real harness wakes. Details: worktree `localdocs/dogfood-harness-wake-RESULT.md`.

## Verdict

Thinnest durable bridge is **not a new wake API**. Reuse CLI `session-alive` / `thinking` already on the wire.

1. **Path A (preferred):** ACP post-idle agent activity → `session.onThinkingChange(true)` → existing keepalive → hub SSE.
2. **Path B (escape hatch):** harness hook / script → local CLI hook server (Claude `hook-forwarder` pattern) requesting the same thinking bump.
3. **Hub REST wake endpoint:** last resort only if A+B cannot reach a live CLI socket.

Out of scope: `#1462`/`#1464` notify-summary display, `hapi job` progress bars, Cursor's flaky long-interval shell teardown.

## Code map (upstream/main tip)

| Layer | Path | Role today |
|-------|------|------------|
| Socket | `shared/src/socket.ts` `session-alive` | `{ sid, time, thinking }` |
| CLI keepalive | `cli/src/agent/sessionBase.ts` `onThinkingChange` | 2s interval `keepAlive(thinking)` |
| Cursor ACP thinking | `cli/src/cursor/cursorAcpRemoteLauncher.ts` | `onThinkingChange(true)` only around HAPI-owned `backend.prompt()` |
| ACP updates | `cli/src/agent/backends/acp/AcpSdkBackend.ts` `handleSessionUpdate` | Forwards updates; no thinking side-effect when idle |
| Hub | `hub/src/sync/sessionCache.ts` `handleSessionAlive` / `markMessageQueued` | Thinking + SSE; message accept already wakes |
| Hooks | `cli/src/modules/common/hooks/generateHookSettings.ts` + `hook-forwarder` | Claude SessionStart etc.; **Cursor ACP does not install hooks.json today** (MCP overlay only) |

## Why hub looks idle

Harness resume (Cursor `notify_on_output` / `/loop`, Claude resume hooks) can restart agent work **without** a new hub user message. Hub optimistic thinking only runs on message accept. Cursor launcher clears thinking in `prompt()` `finally`, then ignores later ACP activity until the next HAPI-driven prompt.

ACP v2 note: `state_update: running` is the protocol signal for "foreground work started or resumed"; background updates may continue while `idle` without changing state. Gate thinking bumps on real activity / running, not usage/title noise.

## Cursor harness reality (external)

Long-interval `notify_on_output` / `/loop` shells are often killed by Cursor idle / extension-host recycle before the sentinel fires ([forum](https://forum.cursor.com/t/agent-background-shell-for-monitored-loops-dies-before-first-sleep-interval-fires-loop-never-ticks/162544)). HAPI cannot fix that. This spike only covers **truthfulness when resume does happen**.

## Implementation sketch (after operator OK)

### A1. Thinking bump gate (shared pure fn + tests)

```ts
// e.g. cli/src/agent/backends/acp/shouldBumpThinkingFromSessionUpdate.ts
export function shouldBumpThinkingFromSessionUpdate(sessionUpdate: string | null): boolean {
    switch (sessionUpdate) {
        case 'agent_message_chunk':
        case 'agent_thought_chunk':
        case 'tool_call':
        case 'tool_call_update':
        // ACP v2 when Cursor ships it:
        // case 'state_update' with state===running handled by caller
            return true
        default:
            return false // usage_update, sessionInfoUpdate, …
    }
}
```

### A2. Wire AcpSdkBackend → launcher

- Optional `onAgentActivity?: () => void` (or reuse existing listeners).
- In `handleSessionUpdate`, if gate passes and `!isProcessingMessage` (or always if thinking currently false - launcher owns debounce), invoke callback.
- `cursorAcpRemoteLauncher` (and siblings as needed): callback → `session.onThinkingChange(true)`.
- Do **not** set false from noise; rely on existing turn-end / abort / prompt finally.

Kill-test for A: instrument a Cursor ACP session, arm short notify wake after turn ends; if no ACP updates arrive without a new `session/prompt`, stop and do B.

### B1. Hook route `/hook/agent-wake`

- Extend CLI hook server + `hook-forwarder` event name.
- Handler: `onThinkingChange(true)` for the owning session.
- Document Cursor `hooks.json` one-liner for estate overlays (optional product install later).

### Docs

- Short guide paragraph: harness wake vs `hapi job` vs scheduled composer.
- Link #1470.

## Acceptance criteria

Copied from #1470:

- [ ] HAPI-wrapped Cursor ACP resume without new hub user message → `thinking: true` via SSE within ~2s — **blocked on Cursor ACP wake** (2026-08-10 peer FAIL)
- [ ] List/attention match normal in-turn thinking chrome
- [x] Turn end clears thinking (no stuck spinner) — unit + Codex babysit fixes
- [x] usage/title-only updates do not wake — unit tests
- [x] Docs distinguish wake vs jobs
- [x] Unit tests on bump gate

## Friction mode

- **Steelmanning "just document a curl wake":** cheap, but operators will not wire it; hub stays lying by default. Prefer A in-process.
- **Steelmanning "new REST /wake":** duplicates `session-alive`, auth surface, and encourages scripts that fight CLI keepalive. Kill unless A+B fail.
- **Falsification (done 2026-08-10):** peer-stack Cursor ACP, 20s sentinel after turn-end. Shell succeeded; **no ACP traffic on wake → B required.** Path A not buggy for missing events.

## Next

Path B design (hook / terminal watch → `onThinkingChange(true)`). Keep Path A in #1487 as opportunistic bridge for future ACP v2 agent-initiated `state_update: running`. Soup layer already queued for remat; `:3006` dogfood cannot pass harness wake until B or Cursor fixes ACP notify resume.
