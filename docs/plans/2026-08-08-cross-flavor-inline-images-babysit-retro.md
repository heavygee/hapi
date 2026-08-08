# Retro: `#958` cross-flavor inline media → absorbed by `#1405` (2026-08-08)

Fork babysit session `d2c47d15` / worktree `cross-flavor-inline-images`. Product code shipped on upstream via **[tiann/hapi#1405](https://github.com/tiann/hapi/pull/1405)** (`feat(media)`). Fork **[#958](https://github.com/tiann/hapi/pull/958)** closed empty-vs-main (superseded). Soup layer `feat/cross-flavor-inline-images` DROPPED.

This note is **ops / review / Meta lessons** — not a product design doc. Media invariants now live on `upstream/main`.

---

## What actually happened

1. Long-lived lane-A PR (`#958`) tracked cross-flavor `display_image` / `display_video`, Cursor `~/.cursor/mcp.json` overlay, bounded reads, ACP queue fixes, etc.
2. Daily Meta ⚠️ pings were mostly **merge-dirty vs `upstream/main`**, not new product scope.
3. Upstream **#1405** landed a **superset** (image + video + `display_media` audio/file). After merging main into `#958`, the tree matched `main` → close as superseded, retarget chip to `#1405` → 🔧 cleanup.

---

## Insights worth keeping

### 1. Detect “absorbed by upstream” early

When a dirty merge floods the same files your PR owns (`startHappyServer`, `generatedImages`, `ToolMessage`, display prompts), **diff the merge result tree against `upstream/main` before more conflict artistry**.

- Identical tree → **close superseded**, do not keep resolving forever.
- Retarget the session chip to the **absorbing merged PR** (`#1405`), not leave `#958` as “closed WITHOUT merge” ⚠️ (Meta will sticky-ping that forever).

### 2. Hot conflict zones for media/MCP PRs

Expect repeated conflicts in:

- `cli/src/claude|codex|opencode/utils/systemPrompt.ts` (citation steer, session-summary wrap, display prompts)
- `startHappyServer*` / `happyMcpStdioBridge*` / `buildHapiMcpBridge*`
- `generatedImages*` / web `ToolMessage*` / `generatedInlineMedia*`

Keep **union** of features (e.g. `display_video` + `list_peers` + later `display_media`) rather than “ours vs theirs” binary when both are intentional.

### 3. Cursor MCP overlay: project path is a footgun

Writing ephemeral `hapi-<sessionId>` into `<cwd>/.cursor/mcp.json` invites:

- untracked / accidentally committed loopback URLs
- bot Majors about git pollution

**Prefer user-level `~/.cursor/mcp.json`** (+ `agent mcp enable` with session cwd). Keep `mcpConfigDir` injectable for tests. Refuse symlinked config dirs/files (don’t write through attacker-controlled links).

### 4. Review Majors that aged well (keep as invariants)

| Finding | Fix pattern |
|---------|-------------|
| TOCTOU `lstat` then `readFile` | `readBoundedRegularFile` (open → fstat → sized buffer → re-stat) |
| Ambiguous session prefix in display helper | `filter` + require unique match |
| Claude auto-allows `display_video` | keep in `CLAUDE_MANUAL_APPROVAL_HAPI_TOOLS` (same for `display_media`) |
| Eager video fetch | lazy “Load video” / audio / download |
| Overlay cleanup after failed enable / disconnect | install rollback + `finally` cleanup; PID stamp + prune dead PIDs; fail closed on stale locks with clear `rm` hint |

### 5. Meta 🔧 sticky pings after Gate A is clean

After layer DROPPED + worktree/branch gone, chip stays **🔧** until Meta archives from outside. Generic `statusAction` text still says “drop soup layer…” even when `mw_wave_member_clean` is already `clean` — peers re-verify, **ack, idle**, do not rematerialize or self-archive mid-turn.

Wave clear + `thinking=false` is what unblocks archive. Extra tool calls to “prove” cleanup keep the session hot and delay 🧹.

### 6. Soup drop discipline (worked)

Manifest pattern used:

```yaml
# DROPPED 2026-08-08: feat/cross-flavor-inline-images absorbed by upstream
# #1405 (...). Fork #958 closed empty-vs-main.
# - branch: feat/cross-flavor-inline-images
```

Remove worktree/branch from **mirror**, not from inside the doomed worktree. One remat per wave (Meta), not peer rebuilds.

---

## Suggested Meta / tooling follow-ups (optional)

Status 2026-08-08 (Meta skim — not a Promote? checkbox retro; applied where already shipped):

1. Classifier: if PR `closed` && tree empty vs base && another merged PR owns same paths → suggest **superseded close + chip retarget**, not endless rebase. — **partial:** `ahead_by == 0` superseded action text in classifier; full path-overlap heuristic still open.
2. Soften 🔧 `statusAction` when Gate A predicates are already clean → “ack + idle; archive pending”. — **done** (`hapi-meta-daily.sh` Gate A clean action + exit reflection).
3. Document closed-without-merge → retarget-to-absorber as a first-class babysit exit. — **done** (lifecycle § Absorbed / empty-vs-main).

---

## Session / estate end state (at write time)

- Chip: 🔧 `#1405` (await Meta archive → 🧹)
- Soup: layer DROPPED; tip already carried `#1405` at wave clear
- Worktree/branch: gone
- `#958`: closed superseded
