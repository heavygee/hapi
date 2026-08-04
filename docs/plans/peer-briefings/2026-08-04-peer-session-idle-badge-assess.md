# Peer briefing: assess (then likely remove) "Idle" session-list badge text

**Spawned:** 2026-08-04  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/session-idle-badge-assess`  
**Branch:** `feat/session-idle-badge-noise` (from `upstream/main`)  
**Orchestrator ask:** assess whether the "Idle" text in the left session list makes sense; if not, propose/remove with an appreciative-but-clear rationale.

## Origin (appreciate this first)

Landed in [PR #1315](https://github.com/tiann/hapi/pull/1315) by **@wu736139669**, squash [`0725fabe8`](https://github.com/tiann/hapi/commit/0725fabe84e7a047e44bd98c10ed10da95826c27):

> feat(web): pin running sessions in an in-progress section with state badges

That PR did real useful work: pin live sessions, working/pending signals, project/machine labels on pinned rows, collapsible section. **Lead with gratitude for that.** The question is narrowly about the **Idle** residual label, not the whole PR.

Related follow-up already in flight elsewhere: optional In progress section (default off) - [#1350](https://github.com/tiann/hapi/pull/1350) / local peer work. Do not collide; your scope is Idle labeling.

## Where "Idle" actually renders (verify in tree)

`web/src/components/SessionRowSummary.tsx` - for `s.active` sessions that are not "running" (bg tasks) and not pending:

```tsx
) : s.active ? (
  <span title={t('session.item.idle')}>
    <span className="... rounded-full ..." />  // grey dot
    {!inRunningSection ? (
      <span ...>{t('session.item.idle')}</span>  // "Idle" text
    ) : null}
  </span>
)
```

So:

- **Outside** the pinned In progress section (which is now often off / collapsed): every quiet **active** session gets a grey dot + the word **"Idle"**.
- **Inside** the running section: subgroup header still uses `session.item.idle` (`SessionList.tsx` `RUNNING_BUCKETS`), but row text is suppressed - still an "Idle" bucket of "nothing special happening."

Operator shorthand "every non-archived session" is slightly loose - it is every **active-at-rest** session. Same gut punch when you have dozens of live-but-quiet rows: the list screams "Idle" everywhere nothing interesting is going on.

## Operator thesis (steelman this; do not water it down)

1. **Idle is a default / lack-of-state.** Labeling it reports "nothing to report" once per quiet active row. That is anti-signal.
2. **We already have positive indicators for things that matter:**
   - Spinners / pulse for working / thinking / bg work
   - Pending badge when attention is needed
   - Faded rows for archived / inactive
3. Therefore the Idle **text** (and arguably the always-on grey idle dot next to every quiet active row) is **visual noise**. Prefer silence for the default.

Tone for any public GitHub writing:

- Appreciate #1315 and @wu736139669 (grouping + working/pending are valuable).
- Be clear and specific why Idle-as-label is the wrong information design: defaults should be unmarked; exceptions should be marked.
- Do **not** dunk on the author. Do **not** sound like a drive-by "remove feature" rant. Make it a design refinement of their work.

## Your job

1. **Assess** in the worktree / on live soup if useful: count how often Idle appears; screenshot before; confirm interaction with In progress optional toggle / archived fade / spinners.
2. **Write the rationale** (issue body or #1315 comment draft). Appreciative + clear. Prefer a **new upstream issue** on `tiann/hapi` that cites #1315 / `0725fabe8`, unless a short comment on #1315 is enough and then link from a focused issue for the fix.
3. **If assessment agrees** (expected): implement removal/simplification:
   - Drop the **"Idle" text** on rows (and likely the idle-only grey dot if it adds nothing beyond "active").
   - Keep **working** and **pending** signals.
   - Revisit the In progress **Idle subgroup**: either fold quiet actives without an "Idle" heading, or drop idle bucket entirely so the section only surfaces working/pending (operator preference lean: do not advertise a lack of state).
   - Update tests / i18n keys as needed.
4. Peer-stack PNG proof (before/after) + `display_image` into this peer chat.
5. Soup dogfood when ready (coordinate Meta `05d9f0f2` if you need `:3006` rebuild; do not stack-switch from agent shell).
6. **Do NOT open upstream PR until operator OK.**

## Intake ownership

| Step | Status |
|------|--------|
| Assess Idle UX vs existing signals | **YOU** |
| Upstream issue/comment (appreciative + clear) | **YOU** |
| Implement if assessment agrees | **YOU** |
| Proof + dogfood | **YOU** |
| Upstream PR | **YOU** only after operator OK |

## Hard rules

- Product edits only in this worktree.
- No `docs/operator/`, `docs/plans/`, `CLAUDE.md` in upstream PR diff.
- Session title = workstream only; after PR: `hapi-link-pr`.
- Never merge on `tiann/hapi`.

Canonical: `docs/tooling/feature-work-lifecycle.md`.
