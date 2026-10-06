# Spec: ContributionState → SystemEvent ingest (first external / channel producer)

> **Status:** **slices A+B SHIPPED INTO SOUP 2026-07-25.** First chatty inbox corpus emitted and steady-state idempotence verified.
> **Date:** 2026-07-25
> **Audience:** Meta PR watcher, Overseer peers, whoever picks up the ingest slice.
> **Ancestor session:** [State indicators based on PR state](/sessions/fc561649-e783-4a56-be5e-3ca7511c1663) (2026-06-16) — operator framed "babysit upstream PRs whose control ≠ ours"; peer recommended project `pr_targets` + artifact_refs + external GitHub→events, and a contracts addendum that was **never written**. This doc is that addendum, updated for what exists now.
> **Companions:**
> - [`2026-07-25-contribution-state-as-overseer-sensor.md`](./2026-07-25-contribution-state-as-overseer-sensor.md) — principle / observe-vs-actuate
> - [`2026-07-25-github-pr-awareness-optin-and-attachment.md`](./2026-07-25-github-pr-awareness-optin-and-attachment.md) — opt-in gate + how a session gets bound to a PR (replaces title scraping as the source of `related_session_id`)
> - [`2026-06-03-overseer-contracts.md`](./2026-06-03-overseer-contracts.md) §1 events, §2 worker state, §10 channels
> - `scripts/tooling/hapi-meta-daily.sh` + `lib/pr-emoji-core.sh` — live classifier + ping policy
> - Soup (live on `:3006`): `hub/src/store/events.ts` (`insertSystemEvent`, `sourceKind: 'channel'` already in the type union), `hub/src/web/routes/systemEvents.ts` (GET + **POST as of slice A**)

---

## Slice A: landed in soup (2026-07-25)

Branch `feat/contrib-state-channel-ingest` @ `c11e049ec` (worktree `worktrees/contrib-state-ingest`), soup layer added to `config/driver-manifest.yaml` after the overseer block. Driver rematerialized to **`5e1800923`** (`--build-web --verify`, 232 tests, dist + verify stamp both at HEAD), hub restarted patiently.

Verified on the live `:3006` hub, not just in unit tests:

| Probe | Result |
|---|---|
| `POST` valid channel event | `201`, event id assigned |
| Replay same `idempotencyKey` | `200 deduped:true`, **same id** |
| `sourceKind: "worker"` | `400 sourceKind must be channel` |
| `relatedSessionId` unknown | `404` |
| `relatedSessionId` omitted | `201` |
| `GET ?sourceKind=channel` | returns only channel rows |
| **ADR-001 leak probe** | **PASS** |

ADR-001 was tested at worst case: `attentionCandidate:1, operatorActionRequired:1, riskDetected:1, severity:5` bound to a live worker session. A unique nonce that had never appeared in that session was absent from its transcript afterwards (with a non-zero before-count as the sanity guard — an earlier probe using `limit=1000` returned an empty list because the endpoint silently caps `limit`, which would have made the test vacuous).

Two findings that shape slice B:

1. **Channel events do not promote to the operator inbox.** `/api/inbox-items` held 30 items and zero probes. Correct for ADR-001 (workers never see channel provenance) but means the operator surface is still **PR chips** + meta-daily stdout (title-emoji interim retired — ADR D8).
2. **`dedupeKey` still needs the reminder suffix** (`:reminder:YYYY-MM-DD`) so the 24h re-ping of a stuck `⚠️`/`🔧` is not swallowed by the UNIQUE index.

## Slice B: landed and dogfooded (2026-07-25)

Final branch tip **`2e318cfec`** plus test-harness cleanup `3933d87b7`; soup rematerialized to driver **`f8f24ce81`** (`--build-web --verify`: 232 pass, 0 fail; dist + verify stamp match). Hub restarted patiently.

Live receipt from `driver/scripts/tooling/hapi-meta-daily.sh --emit-events --no-ping`:

- First run emitted **18** Meta contribution-state events across **18 session bindings**: 17 `progress`, 1 `needs_decision`.
- Inbox projection grew from 129 to 135 active/history rows; transitions coalesce into the existing per-session work item via `sourceEventIds`, so chatty corpus does not mean one row per event.
- Duplicate PR #947 correctly emitted two events with distinct `:sess:<relatedSessionId>` keys for its two sessions.
- Immediate second run exited 0 and left the Meta event count at **18** (steady-state silence).
- Peer pings were disabled during corpus fill; no workers were interrupted.
- Direct execution from `driver/` resolves the canonical mirror's batch/ping dependencies (`explicit env > same dir > $HAPI_PRIMARY/scripts/tooling`).

Defects caught before real emit:

1. `dedupeKey` initially omitted fingerprint and collided with the DB UNIQUE index on same-type transitions.
2. Failed POSTs initially advanced emit/notif cursors and could permanently lose retries.
3. GitHub `notif_cursor` initially advanced past failed notification emits.
4. Session-bound keys initially omitted `relatedSessionId`, so two sessions tracking one PR deduped each other.
5. The souped entrypoint initially assumed low-level tools existed beside it rather than falling back to the canonical mirror.

All five have regression coverage. Final focused evidence: core **86/86**, meta-daily **42/42**, route **12/12**, hub typecheck clean, defect-first re-review **No findings**.

### Operator decision 2026-07-25: chatty inbox first (training corpus)

**Do not** ship the timid "promote only when ping policy fires" gate. Operator framing:

> It's a question of who does the work and who's getting interrupted. A chatty inbox is initially a great inbox, because it becomes a trainable signal — "ok overseer, you can handle all of those kind of inbox items yourself from now on, don't bug me unless there is a problem." So give me more inbox items to start with.

This is progressive delegation (human-on-the-loop → exception escalation), not notification hygiene. Volume early = labeled corpus later. Silence early = nothing to teach against.

**Slice B promotion policy (locked):**

| Emit / promote? | Class | Why |
|---|---|---|
| Yes → inbox (`attentionCandidate:1` + `promoteAttentionEvent`) | Every session-bound ContributionState **transition** (emoji change), sticky ⚠️/🔧 fingerprint change, reminder, new actionable GitHub notif bound to a session | Operator sees the shape of external work |
| Yes → inbox | ✅ "waiting on upstream" **transitions** (first time we enter waiting) | Trainable: "Overseer, auto-ack these / don't interrupt" |
| Events only / stdout queue | Steady-state no-change, pure digests, unbound/orphan warnings without a session | Inbox projection requires `relatedSessionId`; orphan work remains in the Meta action queue |

Still **not** every GitHub webhook flap. Transitions + sticky-problem reminders, not heartbeat. The chatty part is "more classes reach the inbox than the ping policy would interrupt a peer for." Peer pings stay gated (don't yank workers for ✅). Inbox gets the wider set.

Later ratchet (not B): operator verbs on inbox items (accept / ignore / "handle this class") become the policy. Kill-criterion shifts from "too many items" to "items with no disposition after N days" — unread swamp, not chatty swamp.

Wire shape confirmed against the shipped Zod schema — required: `sourceKind:'channel'`, `sourceRef`, `eventType`, `attentionCandidate` (0|1), `summary` (≤280), `idempotencyKey`, `provenance`. The ancestor's naming survived intact: `artifactRefs[].control` is `ours|theirs`, `github_state` is PR lifecycle only, `source` is `'external'`.

---

## 0. Why this exists (and why that session matters)

June 16 operator ask, paraphrased:

> Sessions whose work has left the building and is waiting on someone else's hand still have a job. For HAPI there are two PRs in play — fork (`heavygee/hapi`, control:ours) and upstream (`tiann/hapi`, control:theirs). Upstream demands babysitting. Encoding that as `✅` in the session title is a manual hack because HAPI has nowhere else to put it.

*(Historical. As of ADR D8 / #1163 the glance is the PR chip (`externalRefs.status`); do not re-encode status into titles.)*

Peer synthesis that day (still correct on fork vs upstream babysit):

- Artifacts, not titles, are the long-term primitive (`artifact_refs.kind = github_pr`).
- External GitHub signals are a **channel**, not session metadata (contracts §10).
- Missing contract slice: dual-target project registry + control semantics + ongoing PR lifecycle sync.
- Interim bridge: thin session-list badge until Overseer inbox lands. **Don't fight the architecture.**

What happened between then and now:

| Layer | Status 2026-07-25 |
|-------|-------------------|
| Title-emoji bridge (`✅⚠️🔁📝🔧`) | **Retired as primary surface** — Meta caches status on the chip; `hapi-pr-session-emoji` deprecated. Title strip remains for leftover prefixes. |
| Events substrate + `sourceKind: 'channel'` | **Live in soup** — schema, idempotency dedupe, `related_session_id`, query tools, replay harness. |
| HTTP ingest for channel producers | **Missing** — `GET /api/system-events` only. |
| Dual-target project registry | **Missing** — never written. |
| Session-list badge UI (non-title) | **Missing** — still title prefixes. |
| Overseer inbox consumer stack | **Open / unmerged** — fork PRs #54–#57, #81, #86–#91. |

So: the sensor half of ContributionState is running as a morning CLI (chip status + pings). The architecture half (emit into events, attach to session, feed Overseer) is the gap this spec closes. Kill-criterion for emoji titles is **met** for chipped sessions; do not reintroduce title status.

---

## 1. Goal

Make `hapi-meta-daily` (and any future ContributionState producer) the estate's **first `source_kind: 'channel'` event producer**:

1. Classify contribution state (already done).
2. Actuate local fleet (rename + policy-ping — already done).
3. **NEW:** on disposition *transitions* (and actionable human GitHub comms), POST typed SystemEvents into the hub, bound to the owning session via `related_session_id`, with namespaced PR identity in `artifact_refs`.

Observing and actuating stay separate sinks of the same classification. Overseer (and contradiction detection) finally get an external ground truth that is not worker self-report.

**Non-goals for this slice:**

- Session-list badge UI (Layer C interim from June — separate thin PR once events exist to project).
- Full project-registry UI / multi-project generality beyond HAPI's two remotes.
- Webhooks (poll via meta-daily is enough; webhook later if rate limits bite — same call June 16 made).
- Actuation upgrades (no auto-merge, no soup edits, no archive).
- Replacing emoji titles — **done via PR chip** (ADR D8). Events should project into chips/inbox, never re-encode into titles.

---

## 2. Architecture (three layers, matching June 16)

```
 GitHub (tiann/hapi + heavygee/hapi)
              │
              ▼
   ┌──────────────────────────┐
   │  ContributionState       │  hapi-meta-daily + pr-emoji-core
   │  classify + fingerprint  │
   └────────────┬─────────────┘
        ┌───────┼────────┬────────────────┐
        ▼       ▼        ▼                ▼
   rename    ping    stdout queue    POST /api/system-events  ◄── NEW
   (hub)     (hub)   (operator)      source_kind=channel
                                          │
                                          ▼
                                   events table (live)
                                   related_session_id = owning peer
                                          │
                          ┌───────────────┴────────────────┐
                          ▼                                ▼
                   Overseer inbox                    Session badge UI
                   (when #57+ lands)                 (future thin PR)
```

---

## 3. Hub slice — `POST /api/system-events`

### 3.1 Route

Add write support next to the existing read route in `hub/src/web/routes/systemEvents.ts` (soup layer / fork worktree — **not** upstream PR until dogfooded).

```
POST /api/system-events
Authorization: Bearer <hub JWT>   # same auth as other operator routes
Content-Type: application/json
```

Body (Zod; mirrors `InsertSystemEventInput`, channel-restricted):

```ts
{
  ts?: number,                          // default Date.now()
  sourceKind: 'channel',                // ONLY this value on this route
  sourceRef: string,                    // e.g. "contrib-state:tiann/hapi" or "github-notif:tiann/hapi"
  eventType: string,                    // see §4
  attentionCandidate: 0 | 1,
  operatorActionRequired?: 0 | 1,
  riskDetected?: 0 | 1,
  summary: string,                      // ≤ 280 chars, human-readable
  relatedSessionId?: string | null,     // owning HAPI session when known
  artifactRefs: Array<{                 // JSON-stringified into DB column
    kind: 'github_pr' | 'github_issue' | 'github_notification',
    url: string,
    title?: string,
    repo: string,                       // canonical "owner/name" ONLY (not URL-host form) — used in idempotency keys
    number?: number,
    target_id?: string,                 // registry key; HAPI binding uses 'upstream'|'fork' for now
    control?: 'ours' | 'theirs',        // load-bearing for rollup; estate-ok in soup
    github_state?: 'open' | 'merged' | 'closed' | 'draft',  // PR lifecycle ONLY — NOT review disposition
    source: 'external'
  }>,
  payload?: object,                     // review disposition (CHANGES_REQUESTED|APPROVED|…) lives HERE / in fingerprint — not in github_state
  tags?: string[],
  dedupeKey?: string,
  idempotencyKey: string,               // REQUIRED on this route; form contrib:{owner/name}#{number}:{fingerprint}
  provenance: string,                   // e.g. "contrib-state@meta-daily"
  severity?: 1 | 2 | 3 | 4 | 5,
  expiresAt?: number | null
}
```

**Naming (ancestor concurrence):** `babysitting` is a **UI / rollup attention class**, never an `eventType`. Worker state `waiting_on_external` (contracts §2) is orthogonal. Event types stay `blocked` / `needs_decision` / `progress` / `completed`.

**Rollup (consumer rule, not emit):** prefer primary `pr_target`; if primary is open and `control:theirs` → attention class `babysitting` even when the fork PR is merged. Do not invent a second `eventType` for rollup.

**Badge projection rule:** session-list badges project from latest channel event and/or session `external_refs` — **never by parsing emoji titles.** Chip owns health now; parsing titles recreates the `#22` cross-wire class of bugs.
### 3.2 Server behavior

1. Auth + namespace as existing web routes.
2. Reject `sourceKind !== 'channel'` with 400 (workers/system keep using internal `insertSystemEvent`; this route is the external contract).
3. If `relatedSessionId` set: resolve session; 404 if missing; 403 if wrong namespace. Do **not** invent a session.
4. Call `insertSystemEvent` — existing idempotency_key dedupe returns the prior row (200 with `{event, deduped: true}`).
5. New insert → 201 `{event, deduped: false}`.
6. Never marks GitHub notifications read. Never mutates session title for status (actuation stays in meta-daily: chip status + strip leftover emoji + ping).

### 3.3 Why not write SQLite from bash

`driver/` is reset by every `hapi-driver-rebuild`. Lock contention with the live hub. Validation bypass. The ingest route is the whole point of "right now, properly."

### 3.4 Auth note

Reuse the existing CLI-token → JWT exchange (`POST /api/auth`). meta-daily already holds a JWT for renames/pings. No new credential type.

---

## 4. Event taxonomy (conservative; transitions only)

Emit **only when meta-daily's ping policy would fire** (emoji transition, sticky ⚠️/🔧 fingerprint change, reminder elapsed) **or** when a new actionable GitHub notification appears. Steady state → silence. Same function, different sink.

**Fingerprint must include review disposition**, not just emoji. Otherwise `CHANGES_REQUESTED` with sticky ⚠️ never re-emits and babysit goes dark — that is the June kill-criterion's real teeth. Practical rule: fold latest review decision / open-thread count / bot-major bit into `pec_action_fingerprint` inputs (already partially true via action string; lock it in tests before enabling `--emit-events`).

| Trigger | `eventType` | `attentionCandidate` | `severity` | `operatorActionRequired` |
|---------|-------------|----------------------|------------|--------------------------|
| → ⚠️ (owned session) | `blocked` | 1 | 3–4 | 1 |
| → ⚠️ (orphan PR, no session) | `needs_decision` | 1 | 2 | 1 |
| → 🔧 merged | `completed` | 1 | 2 | 1 (soup/worktree cleanup) |
| → closed-unmerged | `needs_decision` | 1 | 3 | 1 |
| Human comment / mention / review_requested on tracked PR | `needs_decision` | 1 | 3–4 | 1 |
| → ✅ (green, waiting on theirs) | `progress` | **0** | 1 | 0 |
| → 🔁 (CI in flight) | `progress` | 0 | 1 | 0 |
| → 📝 pre-PR | `progress` | 0 | 1 | 0 |
| `?` data unavailable | *(no emit)* | — | — | — |
| Steady ⚠️/🔧 same fingerprint, reminder not due | *(no emit)* | — | — | — |

**Contradiction support:** always `sourceKind: 'channel'`, `provenance: 'contrib-state@meta-daily'`. Never `'worker'`. Contracts §14 needs an independent ground truth; poisoning that defeats the purpose.

**Dedupe / idempotency:**

```
idempotencyKey = "contrib:{repo}#{number}:{fingerprint}"
dedupeKey      = "contrib:{repo}#{number}:{eventType}"
```

Reminder re-pings append `:reminder:{YYYY-MM-DD}` to the idempotency key so a legitimate nag can land once per day without colliding with the original transition.

**Namespaced identity (kill-criterion from overseer `#22` cross-wire):**
`repo` + `number` always — never bare `#803`. `target_id` + `control` carried on every `github_pr` artifact so dual-target rollup is possible without a second schema pass.

---

## 5. meta-daily slice — `--emit-events`

### 5.1 Flags

```
hapi-meta-daily.sh --emit-events          # POST transitions (default OFF until dogfood)
hapi-meta-daily.sh --emit-events --dry-run  # print the event bodies, no POST
```

Default remains off so today's morning dance does not surprise the inbox corpus while the consumer stack is unmerged.

### 5.2 Mapping from existing policy

Inside the per-session loop, where `pec_should_ping` / notification handling already decide:

```
if emit_events && decision == yes && emoji != "?":
    POST event per §4 table (relatedSessionId = sid when active or known)
if emit_events && new actionable notif:
    POST needs_decision (relatedSessionId = matched session or null)
```

Reuse `pec_action_fingerprint` for the idempotency key. No second policy brain.

### 5.3 Dual-target (minimal HAPI binding)

Until a real project registry lands, hardcode the June 16 shape for this repo only:

```yaml
# conceptual; can live as constants in meta-daily or a tiny YAML later
pr_targets:
  - id: upstream
    repo: tiann/hapi
    control: theirs
    primary: true
  - id: fork
    repo: heavygee/hapi
    control: ours
```

Open heavygee PRs on `tiann/hapi` → `target_id: upstream`, `control: theirs` (babysit).
Fork-only PRs on `heavygee/hapi` → `target_id: fork`, `control: ours`.

Rollup rule (for future badge / inbox, not for emit): if primary is open, session attention class = babysitting regardless of fork PR state. Emit still fires per-PR transitions; rollup is a consumer concern.

### 5.4 Failure modes

- Hub 5xx / timeout: log, continue actuation (rename/ping). Emitting must not block the morning dance.
- 404 on `relatedSessionId`: emit anyway with `relatedSessionId: null` (orphan path) — still valuable ("PR with no owner").
- Idempotent 200: count as success, no retry storm.

---

## 6. Sequencing (honest about the open stack)

| Order | Work | Depends on | Notes |
|-------|------|------------|-------|
| ~~**A**~~ | ~~Hub `POST /api/system-events` (channel-only)~~ | — | **DONE 2026-07-25.** `c11e049ec`, soup layer live on `:3006` @ driver `5e1800923`. See "Slice A: landed in soup" above. |
| ~~**B**~~ | ~~`hapi-meta-daily --emit-events` (default off)~~ | A ✅ | **DONE + dogfooded.** Final receipt in "Slice B" above. |
| **C** | Operator runs `--emit-events` for one week | A+B ✅; inbox readable in Settings debug | **STARTED 2026-07-25:** first 18-event corpus emitted. Kill-criterion: not "too many items" — **items with no disposition after N days** (unread swamp). Chatty + disposed = healthy training corpus. |
| **D** | Session-list badge projecting from events/`external_refs` | C proven | Kills title-emoji as the *only* surface (June 16 interim graduation). **Never parse titles for badge state.** |
| **E** | Real project registry (multi-repo) | Demand from a second forked project | Do not build until a second name exists (June 16 friction call — still holds). |
| **S (parallel)** | Stealth upstream: session `external_refs` + clickable PR chip | Independent of A–C | No events/Overseer brand. **Built 2026-07-25** — `0d0cd28ef`, issue [#1160](https://github.com/tiann/hapi/issues/1160), thin tip on `upstream/main`. **Deliberately NOT souped:** its +138/-66 `SessionList.tsx` restructure conflicts with six existing soup layers (`shared/src/index.ts`, `schemas.ts`, `sessionSummary{,.test}.ts`, `SessionList.tsx`). PR-only path; dogfood on the peer stack at `:3101`, not `:3006`. |

**Do not** land B's default-on while #87's fallback spam kill-criterion is still hot *and unread* — but inbox is already readable in Settings debug, so C is unblocked on the "unread void" objection. Still watch #87's event-spam criterion separately.

**ADR-001 kill-criterion (ancestor add):** if channel events leak into worker-facing transcripts / one-boss paths as system messages, stop. Workers never see Overseer/channel provenance.

Recommended peer ownership: **A** = overseer substrate peer (touches hub routes next to existing system-events). **B** = this Meta session / tooling. **C** = operator. **S** = optional thin upstream PR peer (product, not overseer-branded). **D/E** = later.

---

## 7. Acceptance tests

### Hub (A) — all green on live `:3006` @ driver `5e1800923`

1. `POST` with `sourceKind: 'worker'` → 400. **PASS**
2. `POST` valid channel event → 201, row visible on `GET /api/system-events?sourceKind=channel`. **PASS**
3. Replay same `idempotencyKey` → 200, `deduped: true`, single row in DB. **PASS** (same id returned)
4. `relatedSessionId` unknown → 404; omit field → 201 with null relation. **PASS**
5. Wrong-namespace session → 403. **PASS** (unit test; not re-probed live)
6. ADR-001: worst-case channel event invisible in worker transcript. **PASS**

When re-probing the messages endpoint, keep `limit` ≤ 200 — larger values silently return an empty list, which turns a leak test into a false pass. Always assert a non-zero before-count.

### meta-daily (B)

1. Mock hub: first run with transitions → N POSTs; second run same state → 0 POSTs.
2. Fingerprint change on sticky ⚠️ → 1 POST with new idempotency key.
3. `--dry-run --emit-events` prints bodies, zero HTTP.
4. Default (no flag) → zero POSTs even when pinging.
5. Namespaced artifact: every body has `artifactRefs[].repo` + `number`; never bare number-only identity.

### Live dogfood (C)

1. One morning with `--emit-events`: event count ≈ ping count (order of magnitude), not ≈ session count.
2. Overseer `query_events` (or `GET /system-events?attentionCandidate=1`) shows channel items bound to real sessions.
3. No ✅/🔁 attention candidates appear.
4. A known CI-fail on an owned PR produces a `blocked` channel event that a worker `progress`/`completed` claim can later contradict.

---

## 8. Friction / kill-criteria

- **If after a week of emit-on you still only look at chips/stdout and never at events/inbox** → the sensor is writing to a sink nobody reads; pause D and ask whether Overseer query UX is the blocker, not the producer.
- **Unread swamp, not chatty swamp (operator 2026-07-25):** kill-criterion is inbox items with **no disposition after N days**, not raw volume. Chatty + disposed = healthy training corpus for progressive delegation. Chatty + ignored forever = swamp.
- **If a second project needs dual-target and we hardcode HAPI forever** → then and only then extract project registry (E).
- **If someone proposes writing events by opening the hub SQLite from bash** → refuse; that is the failure mode this route exists to prevent.
- **June 16 kill-criterion still stands:** if after badge UI (D) you still rename sessions with ✅, the model is wrong (probably missing `changes_requested` detection or wrong primary target) — do not paper over with more title logic.
- **Still not heartbeat:** transitions + sticky reminders only. Every-poll emits of unchanged state remain forbidden.

---

## 9. Doc / backlog updates when this lands

- Tick the "HTTP ingest missing" row in [`2026-07-25-contribution-state-as-overseer-sensor.md`](./2026-07-25-contribution-state-as-overseer-sensor.md).
- AGENTS § Meta PR watcher: note `--emit-events` and the observe sink.
- Contracts §10: add ContributionState as the worked example of a channel producer (poll, not webhook).
- Close the loop on session `fc561649-…` — peer brief or reopen with "Layer B+C from your June design now has a concrete ingest path."

---

## 10. Open decisions for the operator (do not resolve in code)

1. ~~Land A as soup layer or fork PR?~~ **Done — soup layer @ `5e1800923`.**
2. ~~Turn `--emit-events` on before or after inbox is readable?~~ Inbox readable in Settings debug — C unblocked. Still: don't default-on while #87 spam kill-criterion is hot.
3. ~~Should ✅ ever become `attentionCandidate=1`?~~ **Operator override 2026-07-25: yes on transition** (first enter waiting) so the class is trainable. Steady ✅ stays quiet. Ancestor's "don't interrupt on waiting" still applies to **peer pings**, not to inbox promotion.
4. ~~Promote only on ping policy?~~ **No.** Chatty inbox first; progressive delegation later. See "Operator decision 2026-07-25" above.
5. ~~Reopen / brief session `fc561649-…`?~~ **Done 2026-07-25 — concurrence reply is the close-the-loop; leave archived for implementation.**

### Ancestor insights folded in (2026-07-25)

- Fingerprint must include review disposition (see §4).
- Orphan `relatedSessionId: null` stays attention=1 for ⚠️, but badge UI must deprioritize orphans vs owned sessions (don't recreate the 126-session swamp as an inbox swamp).
- Yes-man / contradiction argument is the strongest socialization line for A — lead with that to Overseer peers.
- Canonical docs stay `2026-07-25-*`; do not resurrect a `2026-06-17-…` filename.
