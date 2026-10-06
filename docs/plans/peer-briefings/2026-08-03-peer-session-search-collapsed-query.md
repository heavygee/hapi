# Peer briefing: collapsed session search must show the query (ellipsis)

**Spawned:** 2026-08-03  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/session-search-collapsed-query`  
**Branch:** `feat/session-search-collapsed-query` (from `upstream/main`; contains collapse commit)  
**Orchestrator:** thesis / A2A session  
**Operator dogfood / soup coordination:** HAPI session [`cursor - tooling/meta bot`](/sessions/05d9f0f2-9273-4137-933c-07459a1146a2) (`05d9f0f2-9273-4137-933c-07459a1146a2`)

## Bug (operator repro, live)

1. Expand session search, type e.g. `jellybot` → list filters correctly; query visible in the input.
2. Blur / collapse search → **only** a search icon with a purple **indicator dot** remains. The word `jellybot` disappears.
3. Operator: "dumb. there is some space to show the search terms, at least show as much as fits with an ellipsis so can not just see THAT there is an active search but FOR WHAT."

**Proof screenshots (orchestrator captured):**

| State | File |
|-------|------|
| Collapsed + active filter (dot only - bad) | `docs/plans/peer-briefings/assets/2026-08-03-session-search-collapsed-dot.png` |
| Expanded with `jellybot` (good while open) | `docs/plans/peer-briefings/assets/2026-08-03-session-search-expanded-jellybot.png` |

Also under `/tmp/hapi-blobs/6ce7f124-6240-4479-8dad-f2e27eb880a1-kYklrK/`.

## Root cause (known)

Commit (author **@weishu** / tiann):

- https://github.com/tiann/hapi/commit/3f73a5f6ef04157166f9875ecbc264d1b625068d  
- `feat(web): collapse session search into the sidebar toolbar row`

Collapsed branch in `web/src/components/SessionList.tsx` (`SessionListSearch`):

```tsx
if (!props.expanded) {
  return (
    <button ...>
      <SearchIcon />
      {hasActiveFilters ? <span className="... rounded-full bg-[var(--app-link)]" /> : null}
    </button>
  )
}
```

Dot-only when `value.length > 0 || date range`. Query string never rendered while collapsed.

## Desired UX

When **collapsed** and there is an active **text** query:

- Show a compact chip / truncated label next to (or instead of pure icon+dot): search icon + **query text truncated with ellipsis** (`truncate` / `text-overflow: ellipsis`), max-width constrained so toolbar icons still fit (download / folder / eye / gear / +).
- Click still expands to full input (current behavior).
- Keep a clear "active filter" affordance; ellipsis text can replace or complement the purple dot (prefer readable query over redundant dot if space is tight - your call, but **query text is mandatory**).
- Date-only filter (no text): current calendar/dot behavior is OK; optional short date hint if easy.

Do **not** force always-expanded. Collapse is fine; **hiding the terms** is the bug.

## Mandatory path

1. **File upstream issue** on `tiann/hapi`:
   - Title idea: `Session search: show truncated query when collapsed (not just indicator dot)`
   - Body: repro + screenshots (upload via GitHub UI / `gh` attach if available) + link commit `3f73a5f6e` + proposed fix
   - Labels if available: `bug` / `web`
2. **Implement** on this worktree / branch; keep diff small (mostly `SessionListSearch` collapsed UI + i18n if needed).
3. **Proof:** PNG of collapsed toolbar with e.g. `jellybot` (or long query truncated) visible; `display_image` into **this** peer HAPI chat.
4. **Dogfood on driver soup (`:3006`)** via Meta bot:
   - Peer stack proof first (`hapi-use-worktree` on this worktree - **operator/TTY**; agents do not stack-switch from tool shells).
   - Then ask Meta session `05d9f0f2-9273-4137-933c-07459a1146a2` (`cursor - tooling/meta bot`) to coordinate soup: add branch layer + `hapi-driver-rebuild --build-web --verify` when operator/dogfood path requires it.
   - Use `hapi-ping-peer` / `@` Meta bot with a clear ask (rebuild + confirm collapsed query visible on live sidebar).
5. **Do NOT open upstream PR until operator says dogfood is good.** After OK: upstream PR from this branch → `tiann/hapi`, cite issue + commit, attach PNGs. Never merge upstream.

## Intake ownership

| Step | Status |
|------|--------|
| Issue filed | **YOU** |
| Implementation | **YOU** |
| Peer-stack + PNG proof | **YOU** |
| Soup dogfood via Meta `05d9f0f2…` | **YOU** (coordinate; do not stack-switch from agent shell) |
| Upstream PR | **YOU** only after operator OK |

## Hard rules

- Product edits only under this worktree.
- No `docs/operator/`, `docs/plans/`, `CLAUDE.md` in upstream PR diff (briefing stays fork-local).
- Session title = workstream only (no status emoji). After PR: `hapi-link-pr`.
- Agents must not run `hapi-use-worktree` / activate from tool shells.

Canonical: `docs/tooling/feature-work-lifecycle.md`, `docs/tooling/new-feature-intake.md` §0.
