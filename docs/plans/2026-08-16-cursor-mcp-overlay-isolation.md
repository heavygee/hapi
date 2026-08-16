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

## Test

- [x] `cursorMcpOverlay.test.ts` + `cursorAcpRemoteLauncher.test.ts` → 64/64
- [ ] Manual: two sessions different cwds → one `hapi` each in project mcp.json; user file not accumulating uuid keys
- [ ] Manual: cold review already green on dirty tip (787225fe)

## Upstream

Draft PR from `fix/cursor-mcp-overlay-isolation` → `tiann/hapi:main`. Do not merge onto #1473.
