# Peer briefing: lightweight session-list "needs attention" filter

**Spawned:** 2026-08-06  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/session-attention-filter`  
**Branch:** `feat/session-attention-filter` (from `upstream/main` @ `828e98450`)  
**Orchestrator:** session-search-collapsed-query peer / A2A (`cd23b9db-6ed6-4905-bafd-b784960055a3`)  
**Dogfood / soup coordination:** Meta bot `05d9f0f2-9273-4137-933c-07459a1146a2`

## Operator ask (verbatim gist)

> add with a peer agent our own filtering to the list of sessions … in the past we have had people who have come in and said i only want to see active and [that] fuck[ed] things up … required us to make that to be an option rather than the default … what actually is pertinent is which agent needs review that has actually had something to say … without going too much into overseer territory … simple way to filter the list of sessions to denote which items have things i haven't seen … very very lightweight inbox type metaphor not anything like the inbox that we're creating for overseer … much simpler … More like a ux just application

## Intent (playback)

**Want:** Opt-in sidebar filter (default **off**, like "Active sessions only") that narrows the session list to rows that need human eyes: unseen activity / attention — a lightweight "inbox" for the session list.

**Not want:** Overseer inbox, contribution-state sensors, Meta daily machinery, or changing default list behavior.

**Why:** "Active only" hid too much / broke workflows when forced as default. Operators care about *what needs review*, not merely *what is running*.

## Existing building blocks (do not reinvent)

| Piece | Where |
|-------|--------|
| Attention classification | `web/src/lib/sessionAttention.ts` — `permission` / `input` / `background` / `unread` (`updatedAt > lastSeenAt`) |
| Unread dots / tooltips | `SessionAttentionIndicator`, `SessionRowSummary`, last-seen in localStorage |
| Active-only filter pattern | `web/src/hooks/useShowActiveSessionsOnly.ts` + Settings → Display + `SessionList` filter (PR #903 / #901) — **default off** |
| Pin in-progress | separate Settings toggle; do not conflate |

Upstream history: #270 / #477 unread indicators; #470 freshness+unread; #903 active-only as opt-in.

## Proposed scope (peer owns design within this fence)

1. **File upstream issue** on `tiann/hapi` (bug/enhancement + `area:web`). Cite active-only lesson (#901/#903) and attention primitives.
2. **Filter semantics (start here, adjust only with evidence):**
   - Include rows where `classifySessionAttention(...)` is `permission`, `input`, or `unread`.
   - **Exclude** `background` alone unless dogfood proves otherwise (busy ≠ needs review).
   - Keep currently selected session visible even if it would filter out (same as active-only).
   - Default **off**. Persist via localStorage hook mirroring `useShowActiveSessionsOnly`.
3. **UX:** Small sidebar affordance (toolbar chip / filter control near search) and/or Settings → Display row. Prefer discoverable but not always-on chrome; FUE optional if non-essential.
4. **Do not** build Overseer inbox, hub schema for read receipts, or cross-device sync in v1 (local last-seen already powers unread).
5. **Proof:** peer-stack Playwright PNG of filter on/off; `display_image` into peer HAPI chat; soup via Meta (no agent stack-switch).
6. **Upstream PR** only after operator dogfood OK.

## Hard rules

- Product edits only in this worktree.
- No `docs/operator/`, `docs/plans/`, `CLAUDE.md` in upstream PR diff.
- Session title = workstream only (no status emoji). After PR: `hapi link-pr`.
- Agents must not run `hapi-use-worktree` / activate from tool shells.

Canonical: `docs/tooling/feature-work-lifecycle.md`, `docs/tooling/new-feature-intake.md` §0.
