# Peer briefing — #956 cross-flavor inline image display

**Branch:** `feat/cross-flavor-inline-images`
**Worktree:** `~/coding/hapi/worktrees/cross-flavor-inline-images/`
**Base:** `upstream/main`
**Demo topology:** **soup** — manifest layer after gates; web+cli changes may need `hapi-driver-rebuild --verify` + operator `hapi-use-driver`
**Tracker:** [tiann/hapi#956](https://github.com/tiann/hapi/issues/956)

---

## Parent

- Orchestrator HAPI: `4afb9884-8262-4eff-a519-635d23741f5e`
- Orchestrator Cursor: `d1ceebab-27db-4601-9b9d-00a5c5bc7c3f`
- Operator request: "image display for ALL agents in HAPI chats" + assess why #700 omitted flavors

## Why #700 left gaps (orchestrator assessment — do not redo)

PR #700 (NightWatcher314, merged 2026-05-27) was **intentionally narrow**, not incomplete by accident alone:

1. **Explicit PR scope:** body lists only "Codex, Claude, and OpenCode prompt hints" — not all bridge consumers.
2. **At merge time:** Gemini (#543 Apr) and Kimi (#659 May) already used `buildHapiMcpBridge` but were **not included** — clear oversight in contributor PR scope.
3. **Cursor:** still on legacy stream-json launcher at #700; `buildHapiMcpBridge` wired in Cursor ACP **June 6** (#799) — 10 days later, nobody backfilled prompts/tool config.
4. **Architecture trap:** `display_image` added to shared `startHappyServer`, but **prompt hints are per-flavor files** with no shared injector; `buildHapiMcpBridge` lives under `codex/utils/` and docs say "Codex needs" — easy to miss Gemini/Kimi/Cursor/OpenCode when adding tools.
5. **Separate path:** ACP `{ type: 'image' }` blocks in `AcpMessageHandler` were never in #700 scope (MCP-only feature); handler still drops images at line ~326.
6. **#508 tool results:** still open — optional v1.1 unless cheap.

Follow-ups #927/#934/#944 hardened generated-image transport/security; still no cross-flavor prompt parity.

## Intake status (orchestrator completed)

- [x] **1 Code search:** `display_image` in startHappyServer; bridge in buildHapiMcpBridge; web GeneratedImageCard works; AcpMessageHandler drops images; #508 tool results text-only.
- [x] **2 Upstream search:** #697 open, #700 merged partial, #508 open, #511 composer thumbs, #956 filed today.
- [x] **3 Playback:** Operator confirmed spawn peer + wants all-agent parity.
- [x] **4 Issue:** [#956](https://github.com/tiann/hapi/issues/956)
- [x] **5 Worktree:** `~/coding/hapi/worktrees/cross-flavor-inline-images`

## Your assignment (feature peer)

**Own:** implementation → tests → cold review → handoff for soup + dogfood → upstream PR after operator approval.

### v1 implementation (priority order)

1. **Shared prompt snippet** — extract `display_image` hint from Claude/Codex/OpenCode system prompts into one module (e.g. `cli/src/modules/common/displayImagePrompt.ts`); inject into **Cursor, Gemini, Kimi, Pi** launchers that use `buildHapiMcpBridge`. Dedupe existing copies in Claude/Codex/OpenCode to use shared snippet.

2. **`buildHapiMcpBridge`** — add `display_image: { approval_mode: 'approve' }` alongside `change_title` in tools config (match auto-approve pattern from deb05bb7 for title). Update module comment: "all MCP-bridge flavors", not Codex-only.

3. **`AcpMessageHandler`** — handle ACP inner `{ type: 'image', ... }` blocks: register via `registerGeneratedImage` / path helper, emit `generated-image` agent message. Add tests mirroring existing ACP block tests. **Security:** content sniff via `detectImageMimeType`, size caps, no symlink tricks (learn from #700 review comments on startHappyServer).

4. **Optional if small:** #508 base64 image blocks in `ToolCard/views/_results.tsx` — defer if > ~80 LOC.

### Do NOT

- Run `hapi-use-worktree` / `hapi-use-driver` / `hapi-driver-rebuild --activate`
- Edit `~/coding/hapi/driver` by hand
- Open upstream PR before operator dogfood
- Include fork docs in upstream PR
- **`nohup bun run src/index.ts` (or any manual hub) on production `:3006`** — hijacks the live stack; systemd hub crash-loops; operator loses soup layers in the UI. Pre-soup hub testing: isolated peer stack on `:3100+` only (see `docs/plans/2026-06-20-hapi-peer-stack-default.md`). Soup dogfood: manifest layer + `hapi-driver-rebuild --verify` + operator watch-activate.

### Dogfood scenarios (report back)

- **Cursor:** agent writes PNG, calls `display_image` MCP → inline in web chat
- **Gemini or Kimi:** same
- **Codex/Claude:** regression — still works via existing paths

## Gates (intake §6)

1. `bun typecheck` + `bun run test`
2. Cold review vs `upstream/main`
3. Playwright or focused test for generated-image render if feasible

## Ping back

```bash
hapi-ping-peer 4afb9884 "Peer #956: gates pass, ready for manifest + dogfood"
```

## References

- `cli/src/claude/utils/startHappyServer.ts` — display_image impl
- `cli/src/codex/utils/buildHapiMcpBridge.ts`
- `cli/src/agent/backends/acp/AcpMessageHandler.ts`
- `web/src/components/AssistantChat/messages/ToolMessage.tsx`
