# Cursor ↔ HAPI MCP wiring (post hub-on-oos)

**Do not point Cursor MCP at the hub.** Hub (`:3006`, MagicDNS / LAN) is REST + Socket.IO. HAPI MCP is a **per-session HappyServer sidecar** on loopback.

## Intended system

```text
HAPI Cursor ACP session (CLI wrap)
  ├─ starts HappyServer → metadata.hapiMcpUrl = http://127.0.0.1:<ephemeral>/
  ├─ installs stdio bridge into **project** Cursor MCP config:
  │     <cwd>/.cursor/mcp.json  →  key `hapi` (one mailbox)
  │     command: hapi mcp --url <hapiMcpUrl> --tools …
  │     strips PID-stamped hapi* keys from ~/.cursor/mcp.json (no union load)
  ├─ runs `agent mcp enable hapi` (cwd = session path)
  └─ on session end: removes only that key (PID-stamped crash recovery on next install)

Hub URL (HAPI_API_URL / :3006)  ≠  MCP --url
Runner                         ≠  MCP --url
```

| Surface | Role |
|---------|------|
| Hub `:3006` | Session sync, web UI, runner RPC |
| `metadata.hapiMcpUrl` | Loopback HappyServer for **this** CLI process |
| `hapi mcp --url …` | Stdio MCP bridge Cursor loads from `mcp.json` |
| `hapi-display-image.mjs` | Out-of-band POST to a session's `hapiMcpUrl` (no Cursor mcp.json needed) |

Upstream context: Cursor ACP historically ignored `mcpServers` on `session/new`. Overlay remains because Cursor **merges** user + project mcp.json. Isolation is project-local `hapi` plus stripping user-level `hapi-*` keys. Gitignore ephemeral `.cursor/mcp.json` so the mailbox is not committed.

## What agents must not do

1. **Rewrite `--url` to the hub** (`http://192.168.86.79:3006`, MagicDNS, etc.). That is a different protocol; it will not restore MCP tools.
2. **Commit** project `.cursor/mcp.json` hapi blocks (gitignored here; still noise if copied into other repos).
3. **Treat a dead `127.0.0.1:<port>` as "hub moved".** Ports die with the session/CLI process. Fix = live session overlay or strip the stale entry.

## Standalone Cursor (IDE / agent not wrapped by HAPI CLI)

**Strip** any `hapi` / `hapi-*` entries from that workspace's `.cursor/mcp.json`.

Standalone Cursor does not get a HappyServer sidecar. Keeping a pinned loopback port only produces ENOENT / connection refused noise. Inline media into a HAPI chat uses `hapi-display-image.mjs` against a **live** HAPI session id that already has `hapiMcpUrl` - not a project mcp.json entry.

**CursorRemote** (and similar legacy trees): strip the hapi MCP block. Do not regenerate toward the hub. If that workspace is later opened as a HAPI Cursor session, the CLI overlay recreates the bridge in **project** `<cwd>/.cursor/mcp.json` (soup / [#1613](https://github.com/tiann/hapi/pull/1613); stock upstream without that PR still uses user-level `hapi-<uuid>`).

## Estate notes (oos-linux)

- Cursor state lives under `/var/lib/hapi/cursor` with `~/.cursor` → that path (disk hygiene; see janus-oos phase-q). Overlay must **follow** that symlink (fix branch `fix/cursor-mcp-overlay-follow-home-symlink`); a hard refuse of symlinked config dirs breaks install on this host.
- Optional explicit dir: `HAPI_CURSOR_MCP_CONFIG_DIR=/var/lib/hapi/cursor`.
- Pre-user-level overlay left **project** `*/.cursor/mcp.json` piles of stale `127.0.0.1:<port>` entries across `~/coding`. Prune with `hapi-prune-stale-cursor-mcp` (below). Live PID-stamped `hapi-*` keys are kept until the owning process exits.
- **Second Cursor into same cwd (oos 2026-10-02 / [#195](https://github.com/heavygee/hapi/issues/195)):** exclusivity is correct; dock/machine `sessionType=simple` spawn used to die on the lock then hub-timeout (~30s). Runner now auto-escalates to `sessionType=worktree` when a live project mailbox is held — new session gets `<repo>-worktrees/…` + its own `hapi` mailbox. Kill-criterion: spawn cursor into an occupied project path succeeds in seconds (not timeout).
- **Live multiplex (fixed on provenance branch):** unique `hapi-<uuid>` keys in user-level `mcp.json` union-load every sidecar into every Cursor agent. Overlay now writes one `hapi` mailbox to **project** `<cwd>/.cursor/mcp.json` and strips PID-stamped `hapi*` keys from the user file. Same-cwd second live session fails closed. Kill-criterion: `agent mcp list-tools` in a Cursor session shows one HAPI server, and outbound `sourceSessionId` equals that session.
- **Agent PWD ≠ session path (oos 2026-10-02 / [#1951](https://github.com/tiann/hapi/pull/1951)):** `createCursorAcpBackend({ cwd: session.path })` used to omit spawn `cwd`, so the ACP child inherited the HAPI CLI package dir (`…/driver/cli`). Cursor loads MCP from **process PWD** (walking parents), so every Cursor HAPI agent latched `driver/.cursor/mcp.json` bare `hapi` → a dead loopback URL. Symptom: `GetDynamicTools` / namespace `hapi` looks ready, `CallDynamicTool` `inspect_peer`/`ping_peer` fails with `Unable to connect`, while `hapi inspect-peer` CLI still works.
- **Launcher serverId skew (same incident):** isolation wants project key `hapi` (`CURSOR_HAPI_MCP_SERVER_ID`). A tip/hot-copy of upstream launcher that still passes `cursorHapiMcpServerId(sessionId)` writes `hapi-<uuid>` into the **project** file. Discovery can still say ready while invoke fails or routes weirdly; stale sibling ports look like "wrong server for namespace `hapi`". Fix: keep launcher on bare `hapi` whenever project isolation is rematted; prune leftover `hapi-*` project keys.
- **Kill-criterion (PASSED on Quest Audio Relay 2026-10-02):** after spawn-cwd + bare `hapi` overlay + session restart — `readlink /proc/<agent>/cwd` == `session.path`, project mcp.json has a single `hapi` → live `hapiMcpUrl`, MCP child `--url` matches that URL, and bare `CallDynamicTool hapi.inspect_peer` succeeds (not only CLI).

## Binary skew

Prefer soup `hapi` / `hapi-from-active`, or the stable `~/.hapi/bin/hapi` symlink - never a missing versioned path like `hapi-0.23.3`. Fixing the binary without a live sidecar URL still does nothing useful.

## Ops commands

```bash
# Live session sidecar (from hub)
hapi doctor inline-media   # when available on soup tip
# or: GET /api/sessions/<id> → metadata.hapiMcpUrl

# Prune dead project sidecars + dead PID overlays (oos / estate)
hapi-prune-stale-cursor-mcp --dry-run
hapi-prune-stale-cursor-mcp
```

## Friction / kill-criteria

- **`hapi doctor inline-media` must fail closed** on Cursor invoke-path breakage (agent cwd, project mailbox, listen, stdio child) — not green on HappyServer alone ([#194](https://github.com/heavygee/hapi/issues/194) / [tiann#1953](https://github.com/tiann/hapi/pull/1953)).

- If Cursor native MCP tools work after overlay install **and** `hapiMcpUrl` answers on loopback → wiring is correct.
- If someone "fixes" MCP by setting `--url` to `:3006` → reject; that is the wrong layer.
- If project mcp.json is the only place live `hapi-*` appears on oos → user-level overlay is still broken (symlink refuse / missing follow); do not normalize on project files.
- If a session's outbound ping shows a nametag chip but `meta.peer.sourceSessionId` is another live HAPI uuid → MCP multiplex (user `hapi-*` keys), not hub scramble. Do not "fix" by adding session-proof HMAC on the victim PR — see [#1613](https://github.com/tiann/hapi/pull/1613).
