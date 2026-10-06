# inspect_peer MCP + CLI Implementation Plan

> **For Claude:** Implement task-by-task with TDD. Upstream issue: tiann/hapi#1246.

**Goal:** Read twin of `ping_peer` so cited `/sessions/<id>` UUIDs feed straight into tooling that returns peer metadata + recent messages (overseer + agent).

**Architecture:** Reuse `pingPeer` hub JWT / list / `resolveSessionByPrefix`. New `inspectPeer()` is **read-only** (no resume). Register MCP + `hapi inspect-peer`. System prompts teach `[title](/sessions/<id>)` → inspect / ping.

**Tech Stack:** Bun, Vitest, axios, existing HAPI MCP bridge (`startHappyServer`, `happyMcpStdioBridge`).

---

### Task 1: `inspectPeer` core module (TDD)

**Files:**
- Create/Modify: `cli/src/modules/pingPeer/pingPeer.ts` (or `inspectPeer.ts` importing shared resolve)
- Test: `cli/src/modules/pingPeer/inspectPeer.test.ts`

**Behavior:**
- Input: `sessionIdPrefix`, optional `messageLimit` (default 30, max 100)
- Resolve via existing prefix logic
- `GET /api/sessions/:id` + `GET /api/sessions/:id/messages?limit=`
- **Never** call resume
- Return structured result + `formatInspectPeerReport()` text for MCP/CLI

### Task 2: CLI `hapi inspect-peer`

**Files:**
- Create: `cli/src/commands/inspectPeer.ts`
- Modify: `cli/src/commands/registry.ts`
- Test: arg parse tests

### Task 3: MCP registration all flavors

**Files:**
- `cli/src/claude/utils/startHappyServer.ts` (+ tests)
- `cli/src/codex/happyMcpStdioBridge.ts` (+ tests)
- `cli/src/codex/utils/buildHapiMcpBridge.ts` / tests
- Agent runners that join toolNames

**Permissions:**
- Do **not** add to Claude `--allowedTools` auto list (namespace transcript is sensitive) — same as ping_peer manual gate
- Do **not** put in write/sensitive write hints (read-only in read-only mode should auto-approve)
- Optionally add to always-approve hints for overseer DX — prefer: auto-approve in `read-only` / default when not write; keep Claude MCP allowlist exclusive of inspect like ping for first ship, OR allow inspect on Claude allowlist since read-only. **Decision:** include `inspect_peer` on Claude `--allowedTools` (read-only, same-namespace) but keep `ping_peer` off. Codex bridge: `approval_mode: auto` for inspect, `prompt` for ping.

### Task 4: System prompt glue

**Files:**
- `cli/src/claude/utils/systemPrompt.ts`
- `cli/src/codex/utils/systemPrompt.ts`
- `cli/src/opencode/utils/systemPrompt.ts`
- `cli/src/agent/hapiSessionEnv.ts` / mcp bridge prompt if any
- Cursor ACP bridge prompt if present

Text: When the user cites `[title](/sessions/<uuid>)` (or a bare `/sessions/<uuid>`), extract the id and call `inspect_peer` to read that session / `ping_peer` to message it. Prefer these over JWT+curl.

### Task 5: Verify

- `bun typecheck` + targeted vitest
- Dogfood: `hapi inspect-peer <uuid>` against live hub

---
