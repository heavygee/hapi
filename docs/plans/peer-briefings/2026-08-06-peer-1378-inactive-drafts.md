# Peer handoff: tiann/hapi#1378 → green CI → soup on :3006

**Peer owns this end-to-end.** Orchestrator (upstream watcher) spawned you; do not wait for more prompts.

## Operator ask (verbatim)

> by all means give me the draft paste ready comment. give me a peer for 1378 so we can get it into the soup

## Target

- **PR:** https://github.com/tiann/hapi/pull/1378
- **Title:** fix(web): preserve drafts across inactive session resume
- **Author:** @techotaku39 (Ananovo)
- **Head:** `techotaku39/hapi:fix/inactive-session-attachments` (`maintainerCanModify: true` — push fixes there)
- **Base:** `tiann/hapi:main` / `upstream/main`
- **Worktree:** `/home/heavygee/coding/hapi/worktrees/inactive-drafts-1378`
- **Local branch:** `fix/inactive-session-drafts-1378` (currently at PR tip `76e7fa6df`)

## Current blockers (as of spawn)

- **CI `test` FAILURE:** `web/src/components/SessionChat.tsx` has **committed merge conflict markers** (`<<<<<<<` / `=======` / `>>>>>>>` around lines 79–84). Typecheck dies with `TS1185`.
- `mergeable=MERGEABLE` on GitHub UI is misleading — merge queue still hits those markers.
- `pr-review` was SUCCESS; re-run after fix.
- **Not** operator-authorized to merge yet — get green + soup dogfood first; report back for merge decision.

## Steps (do in order)

### 1. Fix conflict markers + rebase onto upstream/main

```bash
cd /home/heavygee/coding/hapi/worktrees/inactive-drafts-1378
git fetch upstream main
git fetch https://github.com/techotaku39/hapi.git fix/inactive-session-attachments
# resolve SessionChat.tsx markers preserving BOTH intents:
#   - #1378 inactive draft / attachment resume handoff
#   - any newer upstream SessionChat changes (composer collapse #1368 already on main)
git rebase upstream/main   # if not already rebased cleanly
bun install
bun typecheck
```

Push to **their** head:

```bash
git push https://github.com/techotaku39/hapi.git HEAD:fix/inactive-session-attachments
```

### 2. Mechanical verify

```bash
cd /home/heavygee/coding/hapi/worktrees/inactive-drafts-1378
bun typecheck && bun run test
# focused if needed:
cd web && bun run test -- inactive-composer-draft-lifecycle attachmentAdapter composer-draft-transfer
```

### 3. Wait for CI green + bot clean (babysit, do not merge)

```bash
hapi-pr-status 1378
# Poll until test + pr-review SUCCESS; resolve outdated threads if any
```

### 4. Soup promote (mandatory — operator wants :3006 dogfood)

```bash
# Edit ~/.config/hapi/driver-manifest.yaml — add layer for this branch tip
# Also commit config/driver-manifest.yaml on fork mirror same turn (mess-maker rule)
hapi-driver-status --quiet   # must be idle (0); if 75 wait
hapi-driver-rebuild --build-web --verify
hapi-verify-web-dist
# web-only → hard-reload :3006; hub restart only if hub/cli changed (unlikely)
```

Read: `docs/tooling/feature-work-lifecycle.md` + `docs/tooling/driver-soup.md`. **Do not** hand-edit `~/coding/hapi/driver`. **Do not** rematerialize for others mid-wave.

### 5. Report back

Ping orchestrator / operator with:

- CI status + tip SHA
- Soup layer branch name + verify-web-dist OK
- Dogfood notes (inactive session: compose text+attachment → archive/switch/reopen still has draft)
- Whether merge-ready (needs explicit operator OK to merge community PR)

## Session hygiene

- Title: workstream only after chip — e.g. `inactive session drafts`
- Attach chip: `hapi link-pr https://github.com/tiann/hapi/pull/1378` (or MCP `link_pr`)
- **No** status emoji / `PR #N:` in title
- Do **not** self-archive mid-turn; after merge+cleanup Meta archives when idle

## Do NOT

- Merge on `tiann/hapi` without fresh operator authorization
- Title-scrape / Meta-direct non-HAPI sessions
- Stack-switch / `hapi-use-worktree` from agent shell
- `sudo systemctl restart hapi-hub`

## Peer progress (2026-08-06 ~20:21 UTC)

- Conflict markers fixed; pushed to techotaku39 head `629db29e8` (also empty CI retrigger + close/reopen).
- All 17 review threads replied+resolved via `hapi-pr-reply`.
- Local: `bun typecheck` green; focused web draft tests 28/28 green.
- GitHub Actions: **major outage** (status.github.com) — CI has not started on tip; cannot claim green CI yet.
- Soup: layer in manifest as `driver/inactive-session-drafts` union tip `b762c90b7` (thin PR tip conflicted with soup share-retarget/cursor gates).
- Remat nearly succeeded (web verify OK) then rolled back: session-open-smoke failed because Playwright chromium 1228 missing. Browsers installed; smoke now OK.
- **Blocked on Meta remat-hold clear** (owner `05d9f0f2`) before re-running `hapi-driver-rebuild --build-web --verify`.
- Do **not** merge on tiann/hapi without fresh operator OK.

## Meta confirm (2026-08-06 ~20:23 UTC)

- Remat hold cleared; tip carries soup union `b762c90b7` (#1378 @ `629db29e8`).
- verify-web-dist + session-open-smoke OK; web-only (no hub restart).
- Dogfood URL: https://hapi-gc-oos.forest-adder.ts.net/ (hard-reload).
- Still waiting: GitHub Actions recovery → CI + fresh Codex review before merge authorization.
