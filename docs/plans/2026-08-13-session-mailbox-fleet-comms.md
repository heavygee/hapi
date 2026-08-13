# Plan: Session mailbox (session-scoped attention inbox)

> **Status:** intake — feature peer spawned 2026-08-13  
> **Date:** 2026-08-13  
> **Audience:** feature peer, operator, upstream A2A discussion  
> **Parent session:** [meta - PR watcher](/sessions/9f5f7e1d-d1d8-4d17-a668-0a0fdf4af685)  
> **Upstream framing:** A2A operator-awareness (Layer 0→1 bridge) — **not** fleet-manager UI  
> **Explicit non-goals:** do not mention or design for "Overseer" in upstream-facing copy; estate may dogfood richer tooling behind the same affordance.

---

## 0. Operator playback (locked)

We already emit a lot. The problem is **attention**, not volume. The global inbox is a first-class **attention filter** on the event firehose. This plan adds a **session scope** to that filter and surfaces it where operators already look when a PR-attached session is in play.

**Anchor UI:** **Session Log** — the panel in the session header (mobile/tablet icon row in soup today). Upgrade it from "durable system-event tail" to **session mailbox**: inbox rows + system events, with unread count and emoji salience.

| Surface | Behavior |
|---------|----------|
| Session list row | Badge: unread count for that session's mailbox (0 = hidden) |
| Session Log affordance (header icon) | Same badge on the icon; opens Session Log → mailbox tab |
| Session Log panel | Tabs evolve: **All** (events, today) + **Attention** (inbox items for this session) + **Links** (unchanged) |

**Unread model (operator answer #1):** per-session cursor — "if I opened Session Log for this session, I looked." Opening the panel or the Attention tab advances `lastSeenAt` for that session. No global "mark all read."

**Badge placement (operator answer #2):** both session list and Session Log icon.

**Config (operator answer #4):** per-login YAML beside `config/pr-chip-states.yaml` — classes of human external signal (FYI vs hold vs agent ping) and default salience emoji. Same estate pattern: checked into repo, overridable under `$HAPI_HOME`.

**Salience (operator answer #5 / #8):** inbox rows today are mostly text. Prefer **emoji prefixes** (and later A2A envelope `kind` when [#1509](https://github.com/tiann/hapi/issues/1509) lands) for at-a-glance scanning — not another wall of prose.

---

## 1. What exists today (inventory)

### 1.1 Session Log (fork soup — not upstream)

| Piece | Location |
|-------|----------|
| UI panel | `driver/web/src/components/AssistantChat/SessionLogPanel.tsx` |
| Hook | `driver/web/src/hooks/queries/useSessionSystemEvents.ts` |
| Header affordance | `driver/web/src/components/SessionHeader.tsx` (`session.log.*` i18n) |
| Deep link | `router.tsx` `?log=1` → `initialSessionLogOpen` |
| Provenance | Driver commit `4cb90c23f` — `feat(overseer): thin tip — read-only entity, events/inbox, Session Log` |

`upstream/main` **does not** contain `SessionLogPanel`. Upstream path options for the peer:

1. **Preferred:** land Session Log (read-only system events) as a small upstream PR first, then session-mailbox as a follow-on; or
2. **Combined:** one PR titled "session activity + attention inbox" if review size stays reasonable.

Fork soup keeps the full estate stack (Meta emit, PR chips, YAML classes) as optional layers.

### 1.2 Inbox store + API (soup / fork-local promotion)

| Piece | Location |
|-------|----------|
| Schema + promotion | `hub/src/store/inboxItems.ts` |
| List filter | `GET /api/inbox-items?sessionId=<uuid>` (already shipped) |
| Client | `web/src/api/client.ts` `fetchInboxItems` |
| Debug UI only | `web/src/components/settings/InboxDebugControls.tsx` |

Channel/system events with `attentionCandidate:1` and `relatedSessionId` promote into inbox (`syncEngine.insertChannelSystemEvent`).

### 1.3 Three pipes (do not conflate)

| Pipe | What it is | Operator glance today |
|------|------------|------------------------|
| **PR chip** | `externalRefs.status` ✅🔁⚠️📝🔧🧹🛑 | Machine babysit — CI, threads, merge cleanup |
| **GitHub human comms** | `hapi-meta-daily.sh` → `gh_notifications()` → `--emit-events` | Inbox when emitted; hourly default `EMIT_EVENTS=0` |
| **Agent session events** | `AGENT_NOTIFY_SUMMARY`, channel ingest, peer pings | Session Log **All** tab (system events) |

**Vocabulary:** **human collaborators** = co-devs on GitHub (comments, reviews). **Agent sessions** = fleet workers. Reserve **peer** for agent-to-agent mechanics ([A2A RFC](./2026-08-03-a2a-control-plane-rfc.md)).

### 1.4 Gates and estate tooling

| Gate | Doc / path |
|------|------------|
| `githubPrAwareness` toggle | [`2026-07-25-github-pr-awareness-optin-and-attachment.md`](./2026-07-25-github-pr-awareness-optin-and-attachment.md) |
| Chip states YAML | `config/pr-chip-states.yaml` |
| Meta classifier + emit | `scripts/tooling/hapi-meta-daily.sh`, `lib/pr-emoji-core.sh` |
| Operator hold (future) | [`2026-08-11-operator-hold-chip.md`](./2026-08-11-operator-hold-chip.md) — 🛑 `needs_operator` |
| Contrib-state ingest | [`2026-07-25-contrib-state-event-ingest-spec.md`](./2026-07-25-contrib-state-event-ingest-spec.md) |

**Rule:** When `githubPrAwareness` is off, session mailbox UI for PR-bound items should not render (or shows empty with hint). Estate showcase turns the toggle **on** and wires Meta emit.

---

## 2. Product shape

### 2.1 Session mailbox ≠ duplicate inbox

Session mailbox is a **filtered view** of the same `inbox_items` rows plus the existing system-event stream — not a second database. Unread is a **client-side (or hub-persisted per login) cursor** over item `updatedAt` / event `ts`.

### 2.2 Attention tab (inbox items)

- Query: `fetchInboxItems({ sessionId, activeOnly: true, limit: N })`
- Row layout: `[emoji] [title/summary] [relative time]` — emoji from YAML class map or event `eventType` / future A2A envelope kind
- Actions (reuse existing): done / dismiss / snooze via `POST /api/inbox-items/:id/actions` where appropriate
- Empty: "No attention items for this session" (distinct from All tab empty)

### 2.3 Unread badge

```
unreadCount = count(items where updatedAt > lastSeenAt[sessionId])
            + optional: count(events where ts > lastSeenAt and attentionCandidate)
```

Peer may persist `lastSeenAt` in hub settings (per login) or `localStorage` keyed by `loginId:sessionId`. Prefer hub settings if we already store display prefs server-side.

### 2.4 Session list badge

Reuse the same unread query or a lightweight `GET /api/sessions/:id/mailbox-summary` if list N+1 becomes painful. Start simple: batch or piggyback on session list payload only if needed.

---

## 3. Event sources to wire (estate)

| Source | Emit today? | Mailbox class | Emoji (proposal) |
|--------|-------------|---------------|------------------|
| PR chip transition | `--emit-events` | `contrib.state` | chip emoji from YAML |
| GitHub human notif (comment, review, mention) | `--emit-events` (45m refresh timer) | `github.human` | 💬 / 👀 / 📝 |
| Operator hold latch | future Track A | `babysit.hold` | 🛑 |
| Agent `needs_decision` summary | channel ingest | `agent.decision` | ❓ |
| Peer ping (future #1473 provenance) | not inbox today | `a2a.ping` | 📨 |
| Steady-state ✅ waiting | emit but trainable dismiss | `contrib.waiting` | ✅ |

**Hourly digest (orchestrator Q3 — deferred):** Meta stdout queue (`Q_NOTIF`) is the **digest-shaped** printout; inbox emit is the **interrupt-shaped** surface. Peer should **not** duplicate digest into mailbox — optional future "Digest" sub-tab is out of scope unless operator asks. Default: Attention tab = actionable + FYI rows only.

**Agent routing (orchestrator Q5 — deferred):** A2A envelope work ([#1509](https://github.com/tiann/hapi/issues/1509)) will supply typed `kind` for rows. This plan only reserves emoji column + `payload.kind` hook — no duplicate capability plumbing.

### 3.1 Meta emit policy (estate fork)

- Ensure hourly `hapi-meta-daily` refresh path keeps `--emit-events` for GitHub human notifs bound to `relatedSessionId` (session chip present).
- Document in peer PR: operator can ratchet classes via YAML without code change.
- Do **not** block upstream PR on Meta script changes — estate layer can land in fork `scripts/tooling/` parallel to product PR.

---

## 4. Upstream path (clean PR discipline)

### 4.1 What can go upstream (tiann pace)

| Slice | Upstream-eligible? | Notes |
|-------|-------------------|-------|
| `GET /api/inbox-items?sessionId=` | Already exists in soup — confirm upstream parity |
| Session Log (system events panel) | **Yes** — general session awareness |
| Attention tab + unread cursor | **Yes** — framed as "session-scoped attention inbox" under A2A RFC motivation |
| `githubPrAwareness` gate | **Yes** — [#1162](https://github.com/tiann/hapi/issues/1162) / [#1163](https://github.com/tiann/hapi/pull/1163) |
| YAML class map | **Maybe** — start fork-local; propose upstream as `config/attention-classes.yaml` if small |
| Meta `hapi-meta-daily` emit | **Fork-only** — reference implementation, not upstream blocker |

### 4.2 PR strategy

1. Branch from `upstream/main` → `feat/session-mailbox-fleet-comms` (worktree `worktrees/session-mailbox-fleet-comms`).
2. Open **draft** upstream issue discussion link in PR body → [A2A RFC](./2026-08-03-a2a-control-plane-rfc.md) + "operator awareness without fleet UI."
3. Keep PR diff free of `docs/operator/`, `docs/plans/`, `CLAUDE.md`.
4. Estate dogfood: soup layer after operator gates (`hapi-driver-rebuild --build-web --verify`) — **feature peer owns**, not Meta PR watcher.

### 4.3 Relationship to A2A RFC

RFC Layer 0 today: cite / inspect / ping. Layer 1 adds durable work ledger. **Session mailbox** is the **human-facing read model** for "what does this session need from me?" — compatible with Layer 1 consumers later, but shippable without `work_ad` objects.

---

## 5. Implementation checklist (feature peer)

### Phase A — discover + upstream gap

- [ ] Diff `driver` Session Log stack vs `upstream/main`; list files to port or reimplement
- [ ] Confirm inbox API on upstream; port if missing
- [ ] File upstream issue if none exists (link from PR)

### Phase B — core UI (upstream PR)

- [ ] Port or reimplement `SessionLogPanel` + header affordance on worktree branch
- [ ] Add **Attention** tab wired to `fetchInboxItems({ sessionId })`
- [ ] Per-session `lastSeenAt` + unread badge (header + session list)
- [ ] Emoji salience map (fork YAML first; document upstream proposal)
- [ ] Respect `githubPrAwareness` off → hide PR-class rows / empty state
- [ ] i18n keys under `session.log.*` / new `session.mailbox.*`
- [ ] Tests: panel render, unread math, gate off

### Phase C — estate wiring (fork scripts / soup)

- [ ] Document Meta `--emit-events` binding for human notifs → inbox
- [ ] Optional: `config/session-mailbox-classes.yaml` (name TBD) parallel to `pr-chip-states.yaml`
- [ ] Dogfood on `:3006` with PR awareness on + linked PR session
- [ ] Playwright proof: badge + Attention tab + mark-seen clears badge

### Phase D — handoff

- [ ] `hapi ping-peer` orchestrator with proof inline
- [ ] Draft upstream PR + operator dogfood note

**Out of scope for this peer:** #1473 trusted peer provenance, #1511 capability plumbing duplicate, Overseer chat, operator-hold 🛑 detector (separate plan), global inbox redesign.

---

## 6. Open questions (peer proposes defaults)

| # | Question | Proposed default |
|---|----------|------------------|
| Q3 | Hourly digest vs inbox | Digest stays Meta stdout; mailbox = session-scoped inbox rows only |
| Q5 | A2A envelope routing | Emoji + `payload.kind` column; no new transport |
| — | `lastSeenAt` storage | Hub per-login settings key `sessionMailboxSeen:<sessionId>` |
| — | Session list N+1 | v1: fetch on list mount with session ids batch endpoint only if slow |

---

## 7. Success criteria

1. Operator with PR-linked session sees unread badge without opening email or Meta stdout.
2. Opening Session Log → Attention clears badge for that session.
3. Row emoji distinguishes GitHub human vs chip transition vs agent decision at a glance.
4. Upstream PR is reviewable without fork docs; estate soup demonstrates full stack.
5. Toggle off → zero GitHub-class mailbox noise for generic HAPI users.

---

## 8. References

- [A2A control plane RFC](./2026-08-03-a2a-control-plane-rfc.md)
- [Contrib-state → inbox ingest](./2026-07-25-contrib-state-event-ingest-spec.md)
- [GitHub PR awareness opt-in](./2026-07-25-github-pr-awareness-optin-and-attachment.md)
- [Operator hold chip](./2026-08-11-operator-hold-chip.md)
- `config/pr-chip-states.yaml`
- `scripts/tooling/hapi-meta-daily.sh`
