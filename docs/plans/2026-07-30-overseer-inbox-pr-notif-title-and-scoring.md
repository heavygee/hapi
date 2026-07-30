# Plan: Overseer inbox — de-flood upstream PR notifications (title + scoring)

> **Status:** implementing 2026-07-30
> **Owner:** feature peer (spawned by 🔁overseer prep)
> **Scope:** INGEST + SCORING layer only. NOT the converse layer (`feat/overseer-text-converse`, owned by 🔁overseer prep).
> **Companion spec:** [`2026-07-25-contrib-state-event-ingest-spec.md`](./2026-07-25-contrib-state-event-ingest-spec.md)

## Problem (live evidence, `:3006`, 2026-07-30)

`POST /api/overseer/tools/query_inbox {limit:200}` → 174 active items.

| Priority | Count | Category | What |
|---|---|---|---|
| 20 | 9 | BLOCKED | channel PR babysit (⚠️) + some worker |
| 30 | 12 | QUESTION | channel `needs_decision` (notifs/orphans) |
| 40 | 6 | REVIEW | worker `needs_review` |
| 50 | 128 | FINALE | worker `completed` + channel merged-PR (🔧) |
| 60 | 6 | STALE | — |
| 70 | 13 | QUESTION | channel `progress` (📝 pre-PR / 🔁 CI) — falls to `default` |

- **25 items** have a **bare GitHub PR URL as their whole title** (e.g. `https://github.com/tiann/hapi/pull/987`). All are `github_pr` artifactRefs with **no `title` field**.
- The Overseer (27B brain, online) when asked "what needs my attention?" replies that the top-of-queue items (priority 20–30, which sort first) are "mostly GitHub PRs for `tiann/hapi`." Routine upstream PR babysit notifications literally occupy the **highest-priority tier**, drowning genuine operator items.

## Root causes (traced)

**RC1 — bare-URL titles.** `shared/src/overseerInbox.ts` → `pickPrimaryArtifactTitle()` returns `match.url` when a `github_pr` artifactRef has no `title`. The producer (`scripts/tooling/lib/pr-emoji-core.sh` → `pec_build_channel_event_body`) never emits `artifactRefs[].title`. Result: title = raw PR URL.

**RC2 — channel PR notifications share the worker/system priority scale.** `computeCoarseBasePriority(eventType)` keys only off `eventType`, ignoring `sourceKind`. So a channel `blocked` (babysit PR, control:theirs) == worker `blocked` (real operator blocker) == 20. And channel `progress` (📝/🔁) uses eventType `progress`, which is **unhandled** → `default` (70) + category `QUESTION` (misleading). Every channel event is emitted `attentionCandidate:1` (producer hardcodes it — the "chatty inbox first" operator decision), so all of them promote.

## Fixes

All in the `feat/contrib-state-channel-ingest` layer (contains both files).

### F1 — consumer title synthesis (`shared/src/overseerInbox.ts`) — guaranteed
`ArtifactRef` gains optional `repo`/`number`. `pickPrimaryArtifactTitle` for `github_pr`/`github_issue`:
1. `title` present + repo/number → `"{repo}#{number}: {title}"`
2. `title` present only → `title`
3. repo/number → `"{repo}#{number}"` (e.g. `tiann/hapi#987`)
4. url parseable → `"{owner}/{repo}#{number}"` from the URL
5. never return a bare `https://…` as the title.

### F2 — sourceKind-aware priority band (`shared/src/overseerInbox.ts`) — core
`computeCoarseBasePriority(eventType, sourceKind?)`:
- add explicit `progress` rank (routine forward motion, below `stale`);
- `sourceKind === 'channel'` → add `CHANNEL_PRIORITY_OFFSET` (100) so the entire external-PR-notification band sits **below** every worker/system attention item.

Result: worker blocked/needs_decision/failed/review/completed/stale = 20/30/35/40/50/60; channel PR band = 120/130/.../165. Genuine operator items always rank above routine PR notifications. Ordering within the channel band preserved. `promoteAttentionEvent` passes `event.sourceKind`.

### F3 — one-time idempotent backfill (`hub/src/store/inboxItems.ts`)
`ensureOverseerInboxSchema` re-derives `title` + `base_priority`/`priority` for existing `inbox_items` from their latest source event (deterministic, no status/delete changes) so the live wall is fixed immediately on next hub start, not only on the next PR transition. Safe to run every boot.

### F4 — producer title (`pr-emoji-core.sh` + `hapi-meta-daily.sh`) — best-effort
`pec_build_channel_event_body` gains `--title`; emits `artifactRefs[].title` only when set. Wired at the notification site (`_emit_notif_event`) where the GitHub subject title is in hand ("if the notification payload carries it"). Transition sites keep relying on F1's `repo#number`.

## Out of scope
- The converse layer's priority-direction interpretation (the 27B currently calls priority-50 "highest"). Owned by 🔁overseer prep.
- A dedicated de-emphasis inbox category (would expand the `INBOX_CATEGORIES` enum + web/converse consumers). The priority band achieves the ranking goal without that risk; noted as a future option.

## Delivery
- Branch `feat/contrib-state-inbox-title-priority` off `feat/contrib-state-channel-ingest` (fork-only overseer stack; NOT upstream).
- Fork PR against `heavygee/hapi`.
- Soup: repoint the `feat/contrib-state-channel-ingest` layer (or stack after it) to the new branch; hand rebuild to the meta bot session (do not self-activate).
- Evidence: before/after `query_inbox` + Overseer converse "what needs my attention?".
