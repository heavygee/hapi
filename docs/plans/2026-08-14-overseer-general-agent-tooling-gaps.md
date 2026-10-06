# Spec: tooling gaps for a general-capability agent standing in as the Overseer

> **Status:** SPEC / draft 2026-08-14 (operator dogfood session, not yet blessed).
> **Scope:** fork-only. This entire document, and everything it proposes, stays on
> `heavygee/hapi`. The Overseer is not an upstream concept and nothing here goes near an
> upstream PR branch (see root `CLAUDE.md` hard rules — `docs/plans/` is never in an upstream diff).
> **Companions:** `2026-06-03-overseer-contracts.md`, `2026-06-03-overseer-prioritization.md`,
> `2026-07-31-overseer-action-architecture-standing-orders.md` (the disposition/standing-order
> design), `2026-07-30-overseer-inbox-pr-notif-title-and-scoring.md`.
> **Origin:** operator asked Claude Code to stand in as the Overseer for a conversation (query the
> live inbox, decide what needs pinging). That exercise surfaced a set of tooling gaps. This doc
> specs the gaps that are real, and explicitly retracts the ones that turned out to already exist.
> **Update (same day, later):** operator blessed building the tooling. Pinged 🔁overseer prep
> (`a492a270-514f-4cd9-88c1-d6c07744a245`) for a sanity check before building anything — they
> correctly flagged that "Gap 1" below was mis-scoped: the JWT auth wasn't missing, it just wasn't
> being exchanged correctly. Falsified live (see Gap 1 rewrite): **Gap 1 needed zero new code.**
> Separately found `overseer-relay-ping` already mid-flight on a write-intent gate
> (`c6da6c1d5`, `converse.ts`) for exactly the write-authorization problem — so the write half of
> the original "Gap C" also needs no new hub code from this lane; the correct move is to *use*
> `/overseer/converse` as designed, not build a bypass around another lane's in-flight safety work.
> Net effect: the only things actually left to build are agent-side (a thin call wrapper, and the
> Gap 2 watch-loop) — nothing touches `driver/hub/src/overseer/` from this doc.

## Correction before the spec: most of this is already built

The first pass of this exercise (this session, read-only `sqlite3` against
`/var/lib/hapi/hapi.db`) concluded there was "nothing" for acting on the inbox. That was wrong —
it was a gap in *this session's* visibility, not in the product. The live driver
(`driver/hub/src/overseer/`) already has:

- A full tool surface (`runOverseerTool.ts`, `OVERSEER_TOOL_NAMES` in `@hapi/protocol`):
  `query_events`, `query_inbox`, `get_session_state`, `get_session_recent_output`,
  `get_worker_health`, `explain_priority`, `list_active_workers`, `query_open_loops`,
  `query_dispositions` (read), plus `record_disposition` and `ping_session` (write, gated behind
  `allowWrites` — only the conversational path sets it; raw HTTP tool-dispatch gets a 403).
- A real disposition audit trail: `inbox_operator_actions` has 112 real rows today, with the R8
  feature-snapshot columns from the standing-orders spec already populated
  (`source_kind`, `event_type`, `category`, `project`, `artifact_kind`, `repo`,
  `context_snapshot_json`). The "write real rows, not a side-channel memory watermark" ask (§E
  below) is **already satisfiable** — the table and the write path exist.
- A converse loop (`POST /overseer/converse`) that runs a small local brain LLM (referred to
  elsewhere as "the 27B") against this same tool set, with graceful degradation when the brain is
  offline (GPU pulled for VR).
- GitHub-state enrichment already running: `scripts/tooling/hapi-meta-daily.sh` classifies PRs,
  reads GitHub notifications, and folds live PR state into events (`github_state`, `artifact_kind:
  github_pr` visible directly in the `context_snapshot_json` sampled from the live DB). §F below is
  mostly "already exists," not "needs building."

So the honest gap is much narrower than the first-pass conversation suggested. It is essentially
one thing: **a general-capability agent (Claude Code, not the narrow local brain) has no
credentialed way into this already-built surface.** Confirmed empirically this session: this
session's own `CLI_API_TOKEN` does not satisfy `/api/overseer/*`'s JWT auth (`{uid, ns}` payload
signed with the hub's JWT secret) — got back `{"error":"Invalid token"}`. Today the only path in is
raw `sqlite3` against the production DB file, which bypasses every safeguard the write-path spec
(§ `2026-07-31-overseer-action-architecture-standing-orders.md`) exists to provide (no snapshot
columns populated, no tombstone, no undo semantics, risk of touching a DB a live process has open).

## Gap 1: credentialed access for a general agent — CLOSED, no new code

**Original claim:** a general-capability agent has no credentialed way to call `/api/overseer/*`.
**Correction:** it does, today, with zero new code. The failure was calling the route with the raw
`CLI_API_TOKEN` as the Bearer token. The hub already exchanges that token for a real `{uid, ns}` JWT
— `ping_peer` already relies on this same exchange. The working recipe:

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:3006/api/auth \
  -H "Content-Type: application/json" \
  -d "{\"accessToken\":\"$CLI_API_TOKEN\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

curl -s -X POST http://127.0.0.1:3006/api/overseer/tools/query_inbox \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":["new","surfaced"],"limit":10}'
```

Verified live this session — returns real, typed `query_inbox` results (priority, agingFactor,
reasonForPriority, etc.), a strictly better read surface than raw `sqlite3`. The JWT is short-lived
(4h, see `auth.ts` `.setExpirationTime('4h')`) — re-exchange per session/as needed, cheap.

**What's still gated, correctly:** `POST /overseer/tools/record_disposition` (raw HTTP dispatch)
still 403s regardless of token — by design (`allowWrites` hardcoded false on that route). That's
not a bug to route around; it's the R2 safety invariant from the standing-orders spec (writes only
through the operator-directed conversational surface). See Gap "C" below for how a general agent
gets legitimate write access without weakening that invariant.

No MCP wrapper tool needed for reads — a thin fork-local shell wrapper around the two curl calls
above (so nobody re-derives this) is the only remaining artifact, and it's a script, not hub code.

## Write access (formerly "Gap C") — CLOSED, use `/overseer/converse` as designed

**Original claim:** a general agent has no sanctioned write path (`record_disposition` /
`ping_session`), only unsafe raw SQL. **Correction:** the write path exists and is actively being
hardened by another lane — `overseer-relay-ping` (`c6da6c1d5`, "write-intent gate, conflicting ping
targets, dispatched audit") adds server-side authorization checking that a write tool call is
backed by real operator intent in the latest utterance, rejects sessionId/itemId mismatches, and
records an idempotent `dispatched` audit event on successful relay. `converse.ts` already calls
`runOverseerTool(overseer, name, args, true)` — writes are allowed on that surface by design; the
raw HTTP dispatch route 403s them on purpose (Gap 1, above).

**The correct move for this lane: don't build a second write path.** `POST /overseer/converse`
already IS the sanctioned entry point for "an agent, in live conversation with the operator, acting
on an explicit imperative" — which is exactly this use case (Radar/secretary framing from the
standing-orders doc, R1(b): "the brain calls `record_disposition` only on an explicit operator
imperative... the voice/hands-free path"). The "brain" in that description doesn't have to be the
small local model specifically — a Claude Code session relaying the operator's explicit words
through `/overseer/converse` is the same pattern, reusing the write-intent gate `overseer-relay-ping`
is already building rather than duplicating or bypassing it.

Practical caveat: the local brain is documented elsewhere as "flaky on tool_choice, narrates from
memory" — so a converse call may not reliably trigger the right tool call from natural language.
That's a quality issue for the brain/converse lane to improve (not this doc's problem to solve by
adding a parallel raw-write endpoint, which would undercut the write-intent gate's whole point).

**Need:** don't wait to be asked — surface something the moment it crosses a threshold (new
ERROR, new BLOCKED, a PR that needs a decision), the way `2026-07-31-overseer-action-architecture-
standing-orders.md`'s "poll-on-turn" section describes for the converse loop, but for an
out-of-band watching agent rather than mid-conversation.

**Have:** `PushNotification` (real interrupt channel — desktop + phone) and `ScheduleWakeup` /
cron / `/loop` (self-paced polling) on the Claude Code side. Nothing wires them to the inbox today.

**Spec:** a fork-only watch loop — poll `query_inbox` (Gap 1's curl recipe, already working) on an
interval, diff against a persisted watermark (see Gap 3), and `PushNotification` on new items above a
severity/category threshold (start narrow: ERROR and BLOCKED only, tune from there). This is new,
small, fork-only work — no existing piece covers it. Respect the causal-gating idea from the
standing-orders doc (§ "poll-on-turn"): a routine ambient event should rise to the stack tip, not
interrupt; only a genuine threshold-crosser should page.

## Gap 3: continuity / watermark

**Need:** don't re-walk the same items every conversation.

**Resolved by Gap 1, not a separate build:** once an agent can call `query_dispositions` /
`record_disposition` for real, "have I already surfaced this" is answerable from the actual
`inbox_operator_actions` table — no side-channel memory file needed, per the operator's explicit
preference ("nobody cares about inbox as a concept right now except us... I'd prefer it to write
real rows"). The only remaining question is where the watch-loop (Gap 2) persists *its own*
last-polled watermark (a timestamp/id, not a decision) — a small local state file is fine for that,
distinct from the disposition table which stays the decision record.

## Gap 4: GitHub-issue tooling beyond `gh` (§F)

**Mostly already covered.** `hapi-meta-daily.sh` already does discovery, classification, and
GitHub-notification folding on a timer (`hapi-meta-daily.timer`). What it does NOT give an agent
mid-conversation is an on-demand "what's the live state of *this one* inbox item's PR right now" —
today that's a fresh `gh pr view` call per item, disconnected from the enrichment the daily batch
already computed and stored in `context_snapshot_json`.

**Spec (small, optional):** a thin read tool — `query_inbox` already returns
`context_snapshot_json.artifactRefs[].github_state` when the daily batch has run; if that's stale
(batch runs once a day), the gap is *freshness*, not *absence of tooling*. Proposal: expose an
explicit on-demand refresh for a single item's PR/issue state via `gh`, written back into the same
snapshot shape the daily batch uses, so there's one enrichment format, not two. Low priority — only
worth it if the 24h staleness actually causes bad triage calls in practice; revisit after a couple
weeks of using Gap 1.

## Item raised for an upstream-bound issue (list only — do not build yet)

**§B — `inspect_peer` has no first-class session/worker-health state.** The fork's overseer tool
set already has this solved *for the overseer feature* (`get_session_state`, `get_worker_health`,
`get_session_recent_output` in `runOverseerTool.ts`) — but that's fork-only, gated behind the
overseer surface, and not what ships upstream. The generally useful primitive — "is this session
actively streaming / idle / blocked-on-human / errored, as a first-class field, not inferred from
timestamps" — is a reasonable ask for upstream's own peer/session-inspection tooling
(`inspect_peer` or whatever upstream's equivalent is), independent of the Overseer concept
entirely. **Action:** raise as a normal upstream-bound issue on `tiann/hapi` (via the usual lane-A/B
discipline — prepare only, `docs/operator/AGENTS.md` § Upstream relationship), generalized so it
reads as "session state should be a first-class queryable field" with no mention of the overseer
fork feature that motivated it. Not specced further here — just tracked.

## Summary table

| Gap | Status | Scope |
|---|---|---|
| 1. Credentialed agent access (read) | **CLOSED — no new code**, just the auth-exchange recipe above | fork-only (wrapper script only) |
| Write access (was "Gap C") | **CLOSED — no new code**, use `/overseer/converse` write-intent gate (`overseer-relay-ping`, in flight) | fork-only, owned by 🔁overseer prep lane |
| 2. Proactive watch-loop + push threshold | **SHIPPED** — systemd timer, ntfy channel, zero agentic tokens per tick | fork-only, bare script + systemd |
| 3. Continuity/watermark | **Resolved by #1**, decision state already lives in `inbox_operator_actions` | fork-only |
| 4. On-demand per-item GitHub refresh | **Minor gap, low priority** — daily batch already covers most of it | fork-only |
| B. First-class session/worker state | **Not a fork build** — raise as generalized upstream issue | upstream-bound, list only |

**What this lane is actually building, post-correction:** a thin curl-wrapper script (Gap 1
convenience) and the Gap 2 watch-loop (scheduled agent + watermark file + `PushNotification`).
Nothing in `driver/hub/src/overseer/` gets touched by this doc's author.

## Implementation (2026-08-14, same day)

Operator blessing given to build. Both remaining items shipped same-day, agent-side only:

- **`scripts/tooling/hapi-overseer-call.sh`** — the Gap 1 wrapper. `identity` / `tool <name>
  [json-args]` / `converse <message> [relatedSessionId]` subcommands; does the `/api/auth` exchange
  internally so nothing calling it needs to know the recipe. Smoke-tested live this session:
  `identity` and `tool query_inbox` return real data; `tool <bogus>` returns the expected 404-style
  error; `converse` returns the expected `brainOnline:false` degrade path (brain was offline —
  GPU on VR duty at time of test — this is the designed behavior, not a bug).
- **Gap 2 watch-loop** — `CronCreate`, cron `8,38 * * * *` (job `6c4fc92e`, replacing an earlier
  `8a879830`), running inside this session. Each tick: `query_inbox` filtered to
  `category: [ERROR, BLOCKED]`, diffs against a watermark file
  (`${XDG_STATE_HOME:-~/.local/state}/hapi/overseer-watch-watermark.json`, `{lastMaxId}`, seeded at
  428 — the max id at seed time, so it doesn't fire on the existing backlog), alerts only on
  genuinely new items past the watermark, then advances the watermark to `max(current, new)` —
  never regresses, since an item can drop out of the filtered view after being dispositioned
  without that meaning it's safe to re-notify on a lower id later. **Known limitation, disclosed to
  the operator:** `CronCreate` jobs are session-only (die if this session ends) and auto-expire
  after 7 days — this is a working prototype of the watch-loop policy, not yet a durable/systemd-
  level installation. If it proves useful past a week, promote it to a real `systemd` timer (same
  pattern as `hapi-meta-daily.timer`).

### Correction (same day, later): `PushNotification` doesn't reach the operator — switched to ntfy

First live tick found a real BLOCKED item and called `PushNotification`, which returned "Mobile
push not sent (Remote Control inactive)". Investigated with the operator: **`PushNotification`'s
phone delivery rides on Claude Code's own "Remote Control" account-pairing feature** (an Anthropic
account feature — pairs a phone/web/VSCode client live to *this terminal session*), which the
operator has never set up. It is unrelated to HAPI's own notification system (the `fcm_devices` /
`push_subscriptions` tables + `NotificationHub` in `driver/hub/src/notifications/`) that the
operator's actual HAPI web/wear apps use — and there is no generic "send a push" HTTP endpoint on
the hub for that system either (it's purely event-driven off session activity, not
endpoint-callable). So neither existing channel gave a script a direct way to alert the operator.

**Resolution: use the operator's existing homelab `ntfy` instance** (`ntfy.introvrtlounge.com`,
already running, already has 25+ registered topics for arr-stack/backup/monitoring alerts — see
`server-setup/.cursor/rules/ntfy-topic-registry.mdc`). Set up the same way as the existing
`mapsnatch-publisher` / `hello-dalle-publisher` topics (scoped, non-admin, write-only — never the
shared admin password):

```bash
# on the homelab docker host (ssh homelab), one-time setup already done:
docker compose -f compose/monitoring/docker-compose.yml exec -e NTFY_PASSWORD=<random, discarded> \
  ntfy ntfy user add hapi-overseer-publisher
docker compose -f compose/monitoring/docker-compose.yml exec ntfy \
  ntfy access hapi-overseer-publisher hapi-overseer write-only
docker compose -f compose/monitoring/docker-compose.yml exec ntfy \
  ntfy token add --label "HAPI overseer watch-loop" hapi-overseer-publisher
```

Token stored locally (not in git) at `~/.config/hapi/ntfy-overseer-token`, mode 600. Topic
`hapi-overseer` registered in the server-setup ntfy registry. `hapi-overseer-call.sh` gained an
`ntfy <message> [priority] [title]` subcommand that publishes directly (no HAPI hub JWT needed for
this path) — verified live, `HTTP 200`, message delivered to the topic. The watch-loop cron job was
recreated to call `hapi-overseer-call.sh ntfy` instead of `PushNotification`.

**Operator action required to actually receive alerts:** subscribe to topic `hapi-overseer` on
`https://ntfy.introvrtlounge.com` (or tailnet `https://ntfy.tail9944ee.ts.net`) in whichever ntfy
app/client is on their phone or watch — this doc's author cannot do that half, it's a
client-side subscription action on the operator's own device.

### Correction #2 (same day, later still): stop burning agent turns on a mechanical check

Operator flagged, correctly: every 30-min `CronCreate` tick was a full LLM agent turn (prompt
read + reasoning + tool calls) to run logic that is 100% deterministic — query, diff two integers,
maybe one curl. That was a real cost, not a perception issue, and it existed only because the
*original* design (`PushNotification`) required an agent turn to call. Once the channel became
`ntfy` (a plain HTTP POST), that constraint no longer applied and the whole tick should never have
touched an LLM.

**Fixed:** extracted the tick logic into `scripts/tooling/hapi-overseer-watch-tick.sh` — pure
bash/jq, no agent involved — and installed it as a real systemd timer
(`scripts/tooling/systemd/hapi-overseer-watch.{timer,service}`, installer
`scripts/tooling/install-hapi-overseer-watch-timer.sh --run-now`, same shape as
`hapi-meta-daily.timer`). Verified via `journalctl -u hapi-overseer-watch`: one real tick ran,
found nothing new, held the watermark — zero agentic tokens spent. The `CronCreate` job (`6c4fc92e`)
was deleted; the watch-loop is now durable (survives this session ending — unlike the prototype's
7-day/session-scoped limitation, which is also now resolved as a side effect) and free to run.
`CLI_API_TOKEN` for the systemd service resolves from `${HAPI_HOME}/settings.json`'s `cliApiToken`
field (same fallback pattern as `hapi-runner-watchdog.sh`), so no token lives in the unit file.
