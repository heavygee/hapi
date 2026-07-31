# Plan: Overseer inbox — de-flood upstream PR notifications (title + scoring)

> **Status:** IMPLEMENTED 2026-07-30 — fork PR [heavygee/hapi#99](https://github.com/heavygee/hapi/pull/99),
> branch `feat/contrib-state-inbox-title-priority` (stacked on `feat/contrib-state-channel-ingest`).
> Tests green (shared 10, hub inbox 10, route 2, recorder 8, pr-emoji-core 88); `bun run typecheck:hub` clean.
> Simulated after over real 174-item inbox: bare-URL titles 25→0; PR items in top-12 triage 8/12→0/12.
> Awaiting meta bot soup rematerialize for live converse before/after.
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

### F5 — auto-dispose terminal items (`hub/src/store/inboxItems.ts`) — operator-greenlit 2026-07-31
Second de-flood lever. Live inbox was **73% FINALE** (128/174) that never gets disposed. Operator: a completed item is *"nothing more to do — the only relevance is that it happened"* (context, not attention).

`sweepDecayedTerminalItems(db, now, windowMs)`:
- **FINALE** (completed) → `status='resolved'` once past `FINALE_DECAY_WINDOW_MS` (14d).
- **STALE** → `status='obsoleted'` immediately, any age. Idle-silence detection is retired (`checkStaleSessions` returns `[]`; **0 stale events live** on :3006), so STALE rows are orphaned legacy. This also answers the operator's "what is still emitting these?" — nothing is.
- Rows **retained as history** (status leaves the active set, never deleted). Idempotent.
- Runs on Store init (immediate) + the 5s sync tick (`syncEngine.expireInactive`, alongside `checkStaleSessions`) for live decay.
- Tests: `hub/src/store/inboxItems.test.ts` (decayed vs fresh vs non-terminal FINALE; STALE obsolete). 12 pass; `typecheck:hub` clean.

**Archiving reframe (operator, 2026-07-31):** active-vs-archived is meaningless noise (restart artifacts); only **exists vs deleted** matters. So there is **no mass-archiving bucket** — the levers are (a) auto-resolve completed [F5], (b) close open loops (converse open-loops lens), (c) deletion (operator-only, destructive). Consequence for the converse layer: the open-loops / forgotten lens must consider **all non-deleted sessions**, not active-only — flagged to 🔁overseer prep.

## Handoff to 🔁overseer prep (converse/entity layer — NOT this layer)

These are owned by the overseer entity/converse layers (`toolProjection.ts`, tool-arg
schemas in `shared/src/overseerEntity.ts`, converse system prompt) which stack **above**
this ingest layer. Recorded here so they survive the conversation; do not edit from the
ingest worktree.

### H1 — pull session context when discussing an item (operator-approved 2026-07-31)
When the operator converses about a specific inbox item, the brain should first pull that
item's session backlog (`query_events { sessionId }`, and optionally `query_inbox { sessionId }`)
so it has the history of *other* recorded activity in that session as salience. One-line
system-prompt instruction; the capability already exists (`query_events` accepts `sessionId`).

### H2 — context-size-sensitive output option on ALL context tools (recurring operator requirement)
The brain-facing projection (`projectToolResultForBrain`) must be **budget-aware and
caller-controllable**, uniformly:
- **Gap A (coverage):** it currently thins only `query_events`, `query_inbox`,
  `list_active_workers`, `query_open_loops`. `get_session_state`, `get_session_recent_output`
  (raw terminal chunks — token bomb), and `get_worker_health` fall through **raw**. Extend
  projection to cover them (and any future `query_session_actions`).
- **Gap B (no knob):** thinning is path-binary (lean on brain path / full on HTTP), not a
  caller option. Add `detail: 'lean' | 'full'` (default `'lean'`) to every context tool's
  arg schema, threaded into `projectToolResultForBrain(tool, result, detail)`. Lean = the
  current token-cheap shape; full = richer fields, still bounded by `limit`. Goal: max signal
  for min tokens by default, escalate deliberately per-call.

### H3 — operator-disposition-history tool (deferred, per operator)
`inbox_operator_actions` (snooze/dismiss/resolve/done + feedback + ts) is recorded but has
**no read tool**. Deferred until operator disposition volume justifies it (currently ~0).
~30-line add: store query + `query_session_actions` tool schema + entity method + (H2) projection.

### H4 — open-loops lens spans all non-deleted sessions
Per the archiving reframe (F5): active-vs-archived is noise; the lens must not post-filter to
active-only or it misses open loops in archived-but-existing sessions that still matter.

## Out of scope
- The converse layer's priority-direction interpretation (the 27B currently calls priority-50 "highest"). Owned by 🔁overseer prep.
- A dedicated de-emphasis inbox category (would expand the `INBOX_CATEGORIES` enum + web/converse consumers). The priority band achieves the ranking goal without that risk; noted as a future option.

## Delivery
- Branch `feat/contrib-state-inbox-title-priority` off `feat/contrib-state-channel-ingest` (fork-only overseer stack; NOT upstream).
- Fork PR against `heavygee/hapi` → [#99](https://github.com/heavygee/hapi/pull/99).
- Soup: repoint the `feat/contrib-state-channel-ingest` layer to `feat/contrib-state-inbox-title-priority`
  (my branch already contains the base layer's tip 2e318cfec as ancestor), OR add a new layer immediately
  after it. Then `hapi-driver-rebuild --build-web --verify` + `hapi-restart-hub`. Owner: meta bot session
  (`05d9f0f2-9273-4137-933c-07459a1146a2`). This session does NOT stack-switch/activate.
- Evidence: before/after `query_inbox` + Overseer converse "what needs my attention?".

## Soup handoff note for the meta bot
- `feat/contrib-state-channel-ingest` was published to origin (unchanged tip `2e318cfec`) so PR #99 could
  stack cleanly; this did not alter the branch.
- The backfill runs at hub store init (idempotent, title+priority only), so the existing 174-item wall is
  repaired the moment the rebuilt hub restarts — no separate migration needed.
- Pre-existing (not this PR) `web/HappyThread.tsx` `outlineTitle` typecheck error lives on the base layer;
  it does not block the hub build but note it if `--verify` runs full web tsc.
