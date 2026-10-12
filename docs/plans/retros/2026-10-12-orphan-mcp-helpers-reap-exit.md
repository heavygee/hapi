# Exit reflection: orphan-mcp-helpers-reap (PR #2004)

> Canon: [`feature-work-lifecycle.md` § Exit reflection](../../tooling/feature-work-lifecycle.md#exit-reflection-gate-a--knowledge-cleanup)

## Shipped as

- PR(s): tiann/hapi#2004 (squash `c3e33835c`); issue #2003
- Absorber: n/a
- Session: babysit peer on `fix-2003-orphan-mcp-reap` (chip after parent handoff)

## Non-code residue

- Partial vs #2003: stamps + stop/archive reap only; no PPID=1 / parent-dead janitor (intentional known limit).
- Unstamped legacy MCP leftovers need session restart before argv match.
- Lane B authorise from HAPI Terminal failed: PTY inherited `HAPI_AGENT_CONTEXT=1` → filed #2013 / PR #2014 (separate tip).
- `hapi-pr-merge-gate.sh` consumes `.auth` on any PASS including standalone dry-run — burned one operator grant; merge succeeded on second grant via `gh pr merge` only.
- Codex `pr-review` 503 / `OPENAI_MODEL=gpt-6.1-sol` blocked Ready YES for ~1 day estate-wide; rerun after Sol recovered.

## Promote?

- [x] `tooling issue` — lane-B gate should not consume grant on dry-run / standalone `hapi-pr-merge-gate.sh` (only when `gh pr merge` via wrapper). Title: "hapi-pr-merge-gate consumes Lane B auth on preflight PASS".
- [ ] `none`
- [ ] `High-signal index`
- [ ] `lifecycle / tooling doc`

## Open questions / landmines

- After #2014 lands + soup: dogfood `printenv HAPI_AGENT_CONTEXT` empty in session Terminal before relying on it for Lane B.
- Homelab may still hold unstamped MCP zombies until those sessions restart.

## Skip

n/a
