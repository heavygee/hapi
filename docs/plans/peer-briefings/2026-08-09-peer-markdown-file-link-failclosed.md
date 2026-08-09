# Peer briefing: fail-closed markdown file links (#1452)

**Spawned:** 2026-08-09  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/markdown-file-link-failclosed`  
**Branch:** `fix/markdown-file-link-failclosed`  
**Upstream issue:** https://github.com/tiann/hapi/issues/1452  

## Operator (not peer) report

Thought #1142 fixed this. Still routinely sees in-session blue links that go to the wrong place. Product rule: **never paint a clickable link that navigates incorrectly** — open HAPI file preview, or don’t look like a link.

## Truth

#1120/#1142 landed and rewrites allowlisted relative `[label](docs/foo.md)`. Incomplete. `<A>` still **fail-opens** any other no-scheme href as SPA nav → `/sessions/<id>/…` or `/home/…` dead ends. Absolute `/home/…`, `~/…`, no-ext paths, `#fragment` on files, unknown exts: still blue and broken.

## Fix direction (locked)

1. **Defense in depth in `<A>`** (not only remark): no-scheme file-like → `FilePathAnchor` / resolve; real app routes (`/settings`, `#`, `?`) stay SPA; everything else no-scheme that looks path-like → **non-navigable** (plain/muted), never fake `<a href>`.
2. Expand what can open preview where safe (esp. abs/`~/` if session workspace resolve exists — check CLI file API).
3. Tests for: allowlisted relative still works; `/home/…` and `~/…` either preview or non-link (never SPA 404); `/settings` still works; regression for #1142 cases.

## Job

Implement → proof PNG/video → soup dogfood → **PR only after operator OK**. Cite #1452; relate #1120/#1142 as partial.

Hard rules: edits only in this worktree; never merge `tiann/hapi`.
