# Peer brief: Share-target session titles must match sidebar (`name` before `summary`)

**Worktree:** `~/coding/hapi/worktrees/share-session-title-parity`  
**Branch:** `fix/share-session-title-parity` (off `upstream/main`)  
**Topology:** **peer stack** (default) for Playwright proof → soup dogfood on `:3006` before upstream PR

## Operator ask (verbatim intent)

> this is our own feature. spawn a peer to take its OWN snapshots as proof, submit an issue upstream (again, we made this feature) referencing the PR that was merged and the og issue that created it, and note that it should retain search ability but match visuals with expected session sidebar names. get all the proof needed from playwright on a peer spin up (as per policy) then submit issue, fix in a local PR, dogfood, and then when we have confirmed it works - issue a PR upstream.

## Lifecycle confirmation (orchestrator)

Matches [`feature-work-lifecycle.md`](../../tooling/feature-work-lifecycle.md):

`impl → §6 gates + Playwright → §6.4 inline proof → §7 operator dogfood → §8 upstream PR`

**Do not open the upstream PR until operator confirms dogfood.** Peer stack first; then promote to soup for `:3006` dogfood; then `gh pr create` vs `tiann/hapi`.

## Root cause (already diagnosed)

Live session `7d55ed21` (`hub-runner-version-skew`):

- `metadata.name` = `hub runner version governance` ← **sidebar** (`@/lib/sessionTitle`)
- `metadata.summary.text` = `HAPI Skill Lookup` ← **`/share` picker** (local helper)

`web/src/routes/share/index.tsx` defines its own `getSessionTitle` with **summary before name**. Sidebar uses `web/src/lib/sessionTitle.ts` (**name before summary**). Bug is on **current `upstream/main`** (landed with share target #933); searchable picker soup/#986 inherits it.

## Links to cite in the new upstream issue

| Ref | Role |
|-----|------|
| [tiann/hapi#933](https://github.com/tiann/hapi/pull/933) | **Merged** — Web Share Target base (introduced `/share` + local title helper) |
| [tiann/hapi#980](https://github.com/tiann/hapi/issues/980) | OG issue — searchable session picker on Android share target |
| [tiann/hapi#986](https://github.com/tiann/hapi/pull/986) | Our open PR — searchable picker (retain search; fix titles) |
| Operator product shot | `/tmp/hapi-blobs/…/Screenshot_20260728-174808.png` (sidebar only — **you must capture share picker yourself**) |

## PEER OWNS (in order)

1. **Peer stack up** for this worktree (`hapi-peer-stack` from mirror; see `docs/tooling/peer-stack.md`). Seed a session with **both** `metadata.name` and a **different** `metadata.summary.text` (mirror live mismatch).
2. **Playwright before-fix proof** (your own captures — do not rely on operator blob alone):
   - Sidebar / session list row showing `name`
   - `/share` picker row for **same session id** showing `summary` (the bug)
   - Inline both into this HAPI chat via `display_image` / `hapi-display-image.mjs`
3. **File upstream issue** on `tiann/hapi` (new bug, not a rewrite of #980):
   - Title e.g. `fix(web): share-target session picker titles use summary instead of sidebar name`
   - Reference #933 (merged), #980, #986
   - State: retain search (#980/#986); titles must match sidebar (`getSessionTitle` parity)
   - Attach/upload your Playwright PNGs in the GitHub issue body
4. **Implement fix** in this worktree: delete local helper; `import { getSessionTitle } from '@/lib/sessionTitle'` (or match its priority exactly). Unit test for name-vs-summary precedence on share list labels.
5. **Playwright after-fix proof** — same two surfaces, titles match. Inline in chat.
6. **§6 gates:** `bun typecheck`, relevant tests, cold review.
7. **Dogfood path:**
   - Peer-stack demo URLs + what to click
   - Apply same one-liner onto soup layer `feat/share-target-session-search` (worktree `~/coding/hapi/worktrees/share-target-session-search`) **or** ask orchestrator to unpark/rebuild after your commit is on that branch — so `:3006` Android share sheet can be verified
   - **STOP for operator dogfood confirmation** before upstream PR
8. **Only after operator says yes:** `gh pr create` vs `tiann/hapi` from this branch; `Closes #<new-issue>`; link_pr on this session. Do **not** `gh pr merge`.

## Do NOT

- Open upstream PR before dogfood confirmation
- Hand-edit `~/coding/hapi/driver`
- Stack-switch / systemctl destroy hub
- Drop searchable picker behavior
- Commit binary PNGs into git (upload to GitHub issue/PR UI)

## Session title

Workstream only while incubating, e.g. `Peer: share picker title parity`. After upstream issue exists: `Peer #<issue>: share picker title parity`. No status emoji; after upstream PR, attach via `link_pr` (chip owns identity).
