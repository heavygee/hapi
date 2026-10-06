# Plan: Cursor MCP overlay isolation (separate from #1473)

**Status:** ready for Meta review / draft upstream PR  
**Worktree:** `~/coding/hapi/worktrees/cursor-mcp-isolation`  
**Branch:** `fix/cursor-mcp-overlay-isolation` (off `upstream/main`)  
**Not part of:** [#1473](https://github.com/tiann/hapi/pull/1473) peer provenance (Lane A; Meta: do not fold)

## Problem

Cursor merges global `~/.cursor/mcp.json` with project `<cwd>/.cursor/mcp.json` ([docs](https://cursor.com/help/customization/mcp)). HAPI historically wrote unique `hapi-<sessionUuid>` servers into the **user** file so ACP could find the session mailbox.

Dogfood result: every live Cursor session's HAPI MCP tools union-load into every agent in that cwd - wrong sender capability + **N copies of tool schemas** eating context (the usual MCP "tools cost tokens even unused" tax).

## Fix (this tip)

1. Write one stable project key `hapi` into `<cwd>/.cursor/mcp.json`
2. Strip dead PID-stamped `hapi` / `hapi-*` entries from the user file (alive stamps left alone)
3. Same-cwd second live mailbox fails closed (no multiplex)
4. Refuse symlinked project `.cursor` (repo could point at `~/.cursor`)
5. Overlay install failure → status message + warn (not silent)

## Scope / non-goals

- **In:** `cli/src/cursor/utils/cursorMcpOverlay.ts` (+ test), launcher wiring for install failure surfacing
- **Out:** #1473 provenance, machineTag/runnerProof, peercred, soup remat activation
- **Lane:** soup-stabilize / CLI tooling - ship independently

## Kill criteria

1. Two concurrent Cursor sessions in different cwds do not see each other's `ping_peer` mailbox
2. Two concurrent sessions in the **same** cwd: second fails closed (no dual `hapi` owners)
3. Stale `hapi-<uuid>` user entries for dead PIDs are pruned; live ones not nuked mid-flight
4. Symlinked project `.cursor` → refuse install (no escape to user dir)
5. Estate `~/coding → /work/coding`: realpath cwd + symlink-prefix `mcpConfigDir` must still install (fixed `1794f48cf`)

## Dogfood log

- 2026-08-16 remat `ebe4658f8`: FAIL — overlay refused (`escapes session cwd`) on first ACP in `cursor-mcp-isolation` because `.cursor` did not exist yet under symlink prefix. Tip `1794f48cf` fixes; awaiting remat.
- 2026-08-16 remat `fcf6f6329` (= `1794f48cf`): **PASS**
  - Project keys `['hapi']` owner `1a1cec28` (Dogfood4)
  - Same-cwd second live mailbox fail-closed (Dogfood3 while Dogfood2 held)
  - Attributed ping: `sentFrom=peer`, `sourceSessionId=1a1cec28-…` === speaker
  - #1613 marked ready-for-review (not merged)

## Test

- [x] `cursorMcpOverlay.test.ts` + `cursorAcpRemoteLauncher.test.ts` → 64/64
- [ ] Manual: two sessions different cwds → one `hapi` each in project mcp.json; user file not accumulating uuid keys
- [ ] Manual: cold review already green on dirty tip (787225fe)

## Upstream

Draft PR from `fix/cursor-mcp-overlay-isolation` → `tiann/hapi:main`. Do not merge onto #1473.
