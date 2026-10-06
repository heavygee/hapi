# Spec: Session Log (durable events chrome) + pins + summary filter

> **Status:** dogfooding on fork/soup; **not** an open PR yet. Spec for upstream packaging once dogfood closes.  
> **Date:** 2026-08-30  
> **Issues:** fork [heavygee/hapi#138](https://github.com/heavygee/hapi/issues/138) · upstream [tiann/hapi#1723](https://github.com/tiann/hapi/issues/1723)  
> **Tip SHA at filing:** `b9d2f4326`  
> **Branch tip (fork):** `feat/overseer-readonly-entity`  
> **Depends on:** durable `events` substrate + `AGENT_NOTIFY_SUMMARY` / hub-observed capture (events already landing upstream; Session Log is the first subtle product surface).

Related: [`2026-06-03-overseer-contracts.md`](./2026-06-03-overseer-contracts.md), [`2026-07-12-overseer-session-log-mandate.md`](./peer-briefings/2026-07-12-overseer-session-log-mandate.md), fork Step 2/2.5/3 issues.

---

## Problem

Long-lived agent sessions make **loaded-message TOC** (Outline) incomplete: older turns fall out of the client window. Operators need a **durable, session-scoped memory** of progress/completions/links/pins that:

1. Survives partial transcript load.
2. Jumps back into the chat when the turn is still fetchable.
3. Supports light summary search before full transcript search exists.

---

## Product surface (dogfood)

### Session chrome

- Header control **beside** Outline (not a second Outline; distinct “log” glyph).
- Panel: **Session Log** — lists hub `events` where `related_session_id = this session`.
- Deep link: `?log=true` (parallel to `?outline=true`).
- Settings → About: Events + Inbox **debug** controls (fork/soup; not Companion).

### Tabs

| Tab | Source | Notes |
|-----|--------|--------|
| **All** | Session events minus carveouts | Excludes `link_seen`, `stale`, `operator_pin` |
| **Links** | `event_type = link_seen` | Compact URL label; external open preserved |
| **Pinned** | `event_type = operator_pin` | Hub-durable pins (not localStorage) |

### Summary filter

- Single search box above the list.
- Case-insensitive substring over **event summary** (and link labels on Links).
- Filters the **active tab’s loaded rows** (client-side stopgap).
- Complements fleet `search_peers` (session discovery); this is **in-session summary filter**, not transcript FTS.

### Jump-to-message

- Parse `messageId` from `payloadJson`.
- Reuse Outline locate path (`locateOutlineTargetMessage` → load older if needed → `scrollIntoView`).
- DOM anchors: `hapi-message-${kind}:${id}` (e.g. `agent-text:<hubUuid>:0`).
- **Keep Session Log open** after jump (unlike Outline, which closes on select).
- Rows without `messageId` stay non-clickable.
- Links tab: URL stays external; row click still jumps when `messageId` present.

### Pin affordance

- Pin control next to **Copy** on message actions (assistant + user).
- Hub API: `POST/DELETE /api/sessions/:id/pins` → inserts/deletes `operator_pin` with idempotency key `session:{sid}:message:{messageId}:operator_pin`.
- Payload includes `messageId` (+ optional `targetMessageId`); summary = truncated message text.
- Unpin toggles the same control; Pinned tab lists pins for retrieval + jump.

### Substrate (already on tip; packages with Session Log for upstream)

- `events` / `event_links` / `deleted_sessions` / inbox tables (ensure-on-boot, not FCM schema ladder).
- Recorder: notify → typed events; hub URL scoop → `link_seen`; **no persist** of hub-inferred `stale`.
- Read-only Overseer entity + tools + `convo_turn` writeback (Step 3).
- REST: `/api/system-events`, `/api/inbox-items`, `/api/overseer/*`, pins routes above.

---

## Outline vs Session Log — keep both?

### Outline (today)

- Client TOC of **loaded** user turns (`user-text` blocks).
- Fast, zero hub round-trip, good for “jump within what’s already on screen / recently loaded.”
- Incomplete for long sessions; no durable links/completions/pins; no summary taxonomy.

### Session Log (this work)

- Hub **durable** projection of memory/progress/links/pins for the session.
- Complete even when transcript window is truncated; jump loads older as needed.
- Depends on event emission quality (`AGENT_NOTIFY_SUMMARY`, scoop, pins).

### Pros of keeping **both** (dogfood / v1 upstream)

| Pro | Why it matters |
|-----|----------------|
| Different jobs | Outline = local TOC; Log = durable memory + artifacts |
| Lower risk | Don’t rip out Outline while dogfooding Log jump/pins/filter |
| Matches mandate | “Log alongside Outline” day one; converge later |
| Outline stays cheap | No hub dependency for simple in-window navigation |

### Cons of keeping **both**

| Con | Why it hurts |
|-----|----------------|
| Two chrome controls | Cognitive load; “which panel?” |
| Overlapping jump UX | Both scroll the thread; rules differ (close vs stay open) |
| Maintenance | Two panels, two deep-links, duplicate locate wiring |
| Incomplete convergence story | Operators may never discover Log if Outline “feels enough” |

### Recommendation

1. **Dogfood + first upstream PR:** keep **both**. Ship Session Log beside Outline; document the split.
2. **Post-dogfood product call:** prefer **events-primary single panel** — Outline becomes a **Turns** (or TOC) mode/tab inside Session Log, or Outline retires once Log jump + user-turn capture is good enough.
3. Do **not** merge panels in the first upstream PR without dogfood evidence.

---

## Non-goals (this package)

- Full transcript search / FTS over `messages`.
- Fleet inbox in the session header slot.
- Replacing Outline in v1.
- Companion/FCM surfaces.
- localStorage pins (rejected; hub SoT only).

---

## Upstream packaging notes

- Prefer **one** upstreamable PR (or tightly stacked PRs) that includes substrate + Session Log chrome — not Log-only on bare `main`.
- Tip must stay **thin** on `upstream/main` (no soup merge history, no FCM-owned paths).
- Dogfood on `:3006` via soup rematerialize; **issue first, PR after dogfood**.

## Acceptance (for eventual PR)

- [ ] Session Log openable from header + `?log=true`
- [ ] All / Links / Pinned tabs behave as above
- [ ] Jump-to-message works for notify/`completed` and pins with `messageId`
- [ ] Pin/unpin persists across reload and devices (same hub)
- [ ] Summary filter narrows visible rows; empty states clear
- [ ] Outline still works unchanged
- [ ] `bun typecheck` + targeted hub/web tests green
- [ ] No FCM/Companion paths in the PR diff

## Open product questions (dogfood)

1. After dogfood: retire Outline, nest TOC in Log, or keep dual chrome?
2. Should user turns also emit durable events for All-tab TOC parity?
3. Promote summary filter to hub `q=` / FTS later, or jump straight to transcript search?
