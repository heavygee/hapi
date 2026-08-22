# Overseer stand-in activity log

Fork-only. Running log of process-audit / diagnostic / triage activity performed by a
general-capability agent (Claude Code) standing in for the not-yet-built Overseer role, per
`docs/plans/2026-08-14-overseer-general-agent-tooling-gaps.md`. This is a log of *what the
stand-in did and found*, not a spec — append entries, don't edit history.

Format per entry: date, trigger, what was checked, finding, outcome/action taken (or explicitly
"no action — flagged only").

---

## 2026-08-15 — Stalled intake session, no issue/PR ever filed (session-search-longpress-dismiss)

**Trigger:** Operator noticed upstream PR #1544/#1545 (external contributor, OpenAI Codex) had
already shipped a search-clear "X" button — a feature that also existed, unfinished, in a local
worktree (`worktrees/session-search-longpress-dismiss`). Asked the stand-in to find the session
responsible and diagnose why the standard intake workflow (spawn → issue → dogfood → PR → babysit)
hadn't completed.

**What was checked:** git worktree creation timestamp, `sessions` table for a session created in
the matching window, `inspect_peer` on the candidate, `gh issue list`/`gh pr list` on both repos
for any trace of a filed issue or PR, worktree `git log`/`git status` for actual commit state.

**Finding:** Session `4ace594e-4901-4a96-9411-7c4d2e8b881a` (Cursor flavor, generically titled
"Hapi Web Session" — never renamed to reflect the task, itself a process-adherence signal) did the
real implementation work correctly (fixed a Rules-of-Hooks bug, a flaky test, tap-vs-long-press
handling) but:
- Never created a GitHub issue at any point (verified: no matching issue/PR exists on either repo).
- Ended its last turn asking the operator "Want me to commit + open an upstream PR?" and then went
  idle. No commit, no push, no PR followed. Worktree still sits at its original base commit with
  the changes unstaged, over a day later.
- No evidence in its own transcript of a hub/server restart killing it mid-turn; it looks like a
  direct yes/no question that simply never got answered or resurfaced.

**Outcome:** No action taken on the session or worktree — the feature is superseded by upstream
PR #1544/#1545, so finishing it is unnecessary. Diagnosis-only. Flagged to the operator that a
correctly-paused-for-permission session silently going unanswered for 24h+ is exactly the failure
mode the Overseer's proactive/interrupt function (Gap 2,
`docs/plans/2026-08-14-overseer-general-agent-tooling-gaps.md`) is meant to catch — worth checking
whether "session asked a direct question and has been idle N hours" should be its own watch-loop
category alongside ERROR/BLOCKED.

---

## 2026-08-15 — Follow-up: correctly-intaked spawns for the repurposed feature

**Trigger:** Operator's next request (long-press-to-talk voice search) directly followed from the
incident above — they wanted the abandoned worktree's intent repurposed, and explicitly wanted the
correct intake procedure followed this time given what the audit just found.

**What was done (as orchestrator, per `docs/tooling/new-feature-intake.md` §0-3):**
- Code search: found native browser STT ("Browser on-device") already fully shipped
  (`web/src/hooks/browserLocalSpeech.ts`, `realtimeTranscription.ts`, etc.) — the operator's initial
  "assess viability" framing was reshaped after this to a real open question (is the existing
  mobile fail-closed restriction still justified?), not a redundant re-assessment.
- Upstream search: no precedent on either sub-task.
- Playback sent to operator in-chat, corrected/clarified twice (provider-agnostic wiring, real
  parity question vs. redundant assessment), operator confirmed before any spawn.
- Filed two GitHub issues before spawning (tiann/hapi#1593 mobile parity investigation,
  tiann/hapi#1594 long-press-to-talk implementation) — the exact step the prior session skipped.
- Spawned two peers with fully-completed §0 handoff blocks (steps 1-4 marked done, issue links
  included, explicit "close the loop" instruction naming this session as orchestrator target).
  Verified both spawns delivered (non-zero message count) via `inspect_peer`, not assumed.

**Outcome:** Peer #1593 (`9b23ed0b-...`, worktree `voice-mobile-parity-1593`) and peer #1594
(`19c5c074-...`, worktree `session-search-longpress-dismiss`, reusing the prior session's
uncommitted `useLongPress` wiring) both spawned and running. This entry exists so a future overseer
pass can check whether *these* two actually close the loop, rather than repeating the incident above.

**Update (same day, both peers closed the loop correctly — contrast with the original incident):**

- **Peer #1593** reported back (did not go idle): verdict is keep the mobile fail-closed
  restriction as-is — real reasoning (Chromium hasn't shipped bundled on-device models for Android
  at all, so relaxing the gate would unlock zero capability while risking reopening a renderer-
  crash regression, #1348), verified via `git stash` that pre-existing typecheck errors aren't its
  own. Landed a docs/comment-only clarification, correctly held off on committing/PR without
  authorization. Operator is now discussing directly with that peer whether to broaden scope to a
  genuinely new backend (native Google/Apple platform STT) rather than the browser API — handled
  operator-to-peer directly, not via this orchestrator.
- **Peer #1594** reported back: implementation done, gates green (typecheck, 98/98 relevant tests,
  cold review, Playwright evidence — pulled the PNG/webm into the operator's chat via
  `display_image`/`display_video` for direct review rather than making them dig through the peer's
  own session). Correctly did **not** silently soup-promote (hit the production-mutation guard,
  flagged for a go-ahead rather than working around it) and did **not** claim its own Playwright
  run as a real dogfood. **Caught on inspection:** the peer's own report said "mocked transcription-
  provider + getUserMedia/MediaRecorder" — no real audio ever went through a mic or a real STT
  backend. Operator's standing rule for this case: mocked evidence → soup-promote and the operator
  tests it live themselves; only a genuine real-audio self-dogfood would have authorized the peer
  to open the PR itself. Relayed: commit + soup-promote (driver-status confirmed idle first), hold
  the PR until operator's own real click-and-speak test passes.

**Process note for future stand-in passes:** verify "dogfooded" claims by checking whether the
test actually exercised real hardware/audio/a real backend, not just that assertions passed —
mocked-everything tests can report "passing" while proving nothing about real-world behavior.

---

## 2026-08-15 — Peer #1594 hit a fleet-wide remat hold; handled it correctly

**Trigger:** Peer #1594's soup-promotion attempt (per the operator's "commit + soup" decision
above) hit a real merge conflict during `hapi-driver-rebuild`'s tip-forward merge — its branch
predated upstream PR #1545, which had already reworked the same collapsed-search-chip code. The
rebuild auto-set a **remat escalation hold** that blocks rebuild/promote fleet-wide, not just for
this peer — another peer (`feat/kitchen-status-session-list`) was already queued behind it.

**What the peer did (good, worth logging as a positive example):**
- Confirmed via `hapi-remat-hold-guard.sh` that it does not hold `HAPI_REMAT_OWNER_TOKEN` and
  correctly did **not** attempt to bypass or force-clear the hold itself.
- Fixed the actual root cause in its own worktree instead: rebased onto current `upstream/main`,
  manually re-resolved the conflict (preserving PR #1545's structure, layering long-press-dictation
  on top), reran the full test suite (33/33 passing, regaining the #1545 test it would otherwise
  have dropped), force-pushed, updated the manifest tip comment.
- Escalated to the actual hold owner (session `05d9f0f2`, "cursor - tooling/meta bot") directly
  with exact recovery steps, rather than asking the orchestrator to intervene on a system it
  doesn't own.

**Stand-in follow-up:** checked whether the hold owner had acted — `inspect_peer` showed it
`active: true` but with no visible message content about the hold; most recent visible message was
an unrelated conversation. Sent a light, non-redundant nudge (not a full re-explanation, the
original peer's ping already had the steps) noting it's blocking 2+ peers, not just one, in case it
got buried under other activity. No token-holder action taken directly — correctly left the actual
fix to whoever holds the token, same discipline the reporting peer itself observed.

**Outcome:** still pending confirmation the hold actually clears and the rebuild completes. Not
yet closed — next entry should record whether the nudge helped or the hold needed further escalation.

**Closed:** hold cleared, promotion completed. Meta (`05d9f0f2`) cleared the remat hold and promoted
both queued layers (#1594 + `kitchen-status-session-list`) to `:3006` at `3515b4a7d`, hub+runner
restarted, hub suite (1542 tests) passed on the promoted tip (the known fleet-wide vitest
globalSetup hub-spawn timeout is unrelated host flakiness, correctly not blocking on it). Post-
restart, verified this stand-in's own tooling (JWT auth via `hapi-overseer-call.sh identity`,
`hapi-overseer-watch.timer`) survived the hub/runner restart intact before handing off to the
operator's real click-and-speak test.

**Correction:** Meta confirmed directly the nudge was stale — the hold had already cleared ~10
minutes *before* the nudge landed; the "REMAT HOLD" pings queued against it were leftover failed-
verify-retry noise from mid-recovery, already superseded. So: not "can't attribute causation," it's
now confirmed the nudge contributed nothing. Correctly hedged at the time rather than claiming
credit, and it's good this got explicitly confirmed rather than left ambiguous.

---

## 2026-08-18 — Self-audit: the stand-in's own tooling was silently dropping every argument

**Trigger:** Operator asked for a status check-in, then to resume the #1593 scope discussion.
Attempting `get_session_state` surfaced a bug in this stand-in's own wrapper.

**Finding (own-goal, worth logging as such):** `scripts/tooling/hapi-overseer-call.sh` used
`ARGS_JSON="${3:-{}}"`. Bash parses that as `${3:-{}` **plus a literal `}`**, so every supplied
argument got a stray trailing brace. The hub route does `try { body = await c.req.json() } catch {
body = {} }` — malformed JSON is silently swallowed into an empty body rather than erroring. Net
effect: **every argument passed through this wrapper since it was written was discarded**, and the
call still returned a plausible-looking 200. The no-arg default case worked by accident (`{`+`}`).

Second bug exposed by fixing the first: `query_inbox`'s `category` arg takes a **single string**,
not an array — `["ERROR","BLOCKED"]` is rejected outright. So the watch-loop's intended category
filter could never have worked even without the brace bug.

**Blast radius:**
- The watch-loop has been querying the inbox **unfiltered** (all categories, default limit 50)
  since it went live, not ERROR/BLOCKED-only as designed.
- Worse, its watermark tracked the **unfiltered** max id, which advances much faster (QUESTION
  items vastly outnumber ERROR/BLOCKED). Watermark had raced to 462 while the true ERROR/BLOCKED
  max was 455. The failure mode is therefore **silently missing alerts**, not false ones — the
  dangerous direction.
- Any briefing figures previously reported from this wrapper with filter args should be treated as
  unfiltered defaults, not the filters stated.

**Fix:** replaced the brace-default with an explicit `if [ $# -ge 3 ]` conditional (+ a comment
explaining the trap); moved category filtering client-side into `jq` in
`hapi-overseer-watch-tick.sh`; scoped `CURRENT_MAX` to the watched categories so the watermark
tracks the right id space; raised `limit` to 200 since the old default was also truncating.
Re-aligned the watermark 462 -> 455 (verified no new/surfaced ERROR/BLOCKED item exists in
456-462, so no alert flood). Ran a real tick end-to-end: correct behaviour confirmed.

**Process note:** a 200 response is not evidence the request did what you asked. This wrapper
"worked" for days while ignoring every filter. Where an API silently coerces bad input to a
default, verify a *negative* case (does an intentionally-invalid arg get rejected?) — if garbage
args produce a happy result, the args aren't reaching anything.

---

## 2026-08-18 — #1593 scope resolved; peer session lost to the disk incident

**Finding on scope (the operator's "browser API vs native Google/Apple STT" question):** these are
not alternatives. The classic Web Speech API **is** how a web app reaches Google STT (Chrome) /
Apple STT (Safari). Verified by code search: `webkitSpeechRecognition` has **zero** occurrences
across `web/src`, `hub/src`, `shared/src`. The existing `browser-local` provider is exclusively the
*on-device* variant — it hard-sets `recognition.processLocally = true`
(`realtimeTranscription.ts:477`) and requires `'processLocally' in constructor.prototype`
(`browserLocalSpeech.ts:100`). So the operator's instinct was right: a genuine option is missing,
and unlike the on-device route (which #1593 correctly closed as unreachable on mobile) the classic
API works on Chrome Android and Safari iOS with no API key — i.e. it actually delivers the mobile
parity that motivated #1593.

Filed https://github.com/tiann/hapi/issues/1639 with that scope, flagging privacy labelling as a
hard requirement (this ships audio to Google/Apple; the platform deliberately distinguishes
on-device today), honest feature detection (Firefox does not implement it), and validation of the
classic API's quirks. Explicitly excluded: the settled #1593 on-device gate, and Google Cloud STT
as a server-side API-key provider (separate optional paid path).

**CORRECTION (same day):** the "session deleted" call below was **wrong**, caught by the operator
asking to search *by name* rather than by id. The session was never deleted — **its id rotates on
restart while its name stays stable**. Observed three ids for one session inside a single hour:
`9b23ed0b` -> `044295ca` -> `0fac9738`. Each prior id returns `state: null` / "Session not found",
which looks exactly like deletion if you only ever query by id.

**Why this matters beyond one peer:** `inbox_items.related_session_id` stores an id. If ids rotate
on restart, those references silently rot — which is a plausible mechanical cause for some of the
"stale inbox item" behaviour logged on 2026-08-15, where items pointed at sessions that appeared
not to exist. Worth investigating as a real defect rather than treating each instance as noise.
**Operational rule adopted:** resolve peers by **name** (`list_peers` / `hapi ping-peer --list`)
immediately before acting, and never conclude a session is gone from an id lookup alone.

**Also corrected:** issue #1639 was filed before this stand-in had read the peer's *existing*
operator conversation, and over-weighted a Google/Apple privacy angle. The operator had already
settled the opposite framing — the four server-backed providers already send audio off-device, so
nothing is uniquely sensitive about Google/Apple; the axis that matters is on-device vs cloud
staying legible, both independently selectable. The peer had also established the sharper technical
point that plain `webkitSpeechRecognition` never calls `available({processLocally:true})`, so
#1348's crash is sidestepped by construction. Issue body rewritten to match, and the peer asked to
confirm nothing of theirs was mis-stated. **Process note: check whether the operator has already
had the conversation with the peer before writing up "the" scope — I re-derived a conclusion they
had already reached, and framed it worse than they had.**

**Scope condition already met:** the operator's approval was conditional on an upstream prior-art
search; the peer had run it (nothing found either way) before ENOSPC killed it. Peer resumed at its
live id with that recap, the #1639 pointer, a rebase warning (137 commits behind), and instruction
to resolve its dangling uncommitted #1593 diff deliberately.

**Superseded text (kept for history):** peer #1593's session (`9b23ed0b-...`) **no longer exists** — `get_session_state`
returns `null` and `ping_peer` fails with "Session not found". Almost certainly deleted during the
disk-full cleanup. Its worktree `voice-mobile-parity-1593` and its uncommitted docs-only #1593 diff
still exist on disk. So the discussion could not be resumed with that peer; #1639 needs a fresh
peer. Not spawned yet — flagged to the operator first, since the peer's loss materially changed
what "continue the discussion" meant.

---

## 2026-08-19 — Session ids rotate; name resolution built into the tooling

**Trigger:** Operator: "Sessions will change their IDs — you need to have the tooling to identify
them by name if needs be. As an overseer."

**The defect, confirmed live:** HAPI session ids rotate on restart while `metadata.name` stays
stable. Every stale id returns `state: null` / "Session not found" — indistinguishable from
deletion. Observed in one sitting:
- Peer #1593: `9b23ed0b` -> `044295ca` -> `0fac9738`
- Peer #1594: `19c5c074` -> `f0086bea` — this one rotated **between resolving it and sending the
  ping**, i.e. the race is tight enough that resolve-then-act must be a single step.
- **This stand-in itself: `09d01a99` -> `70b25f03`.**

**The own-goal that exposed the real blast radius:** every §0 peer handoff and ping this stand-in
sent carried `From: /sessions/09d01a99-…` and told the peer to close the loop to that id. It was
read once from `$HAPI_SESSION_ID` early in the conversation and cached thereafter. **That address
was dead.** Both in-flight peers would have had their loop-closure pings fail silently with
"Session not found" — precisely the failure this stand-in exists to catch, committed by the
stand-in, against itself. Corrected: both peers re-pinged at freshly-resolved ids, told to resolve
by name rather than trust any cached id including the one in the correcting message's own header.

**Tooling fix:** added `hapi-overseer-call.sh resolve '<name fragment>'` — queries `GET
/api/sessions`, matches case-insensitively on `metadata.name`, sorts active-before-idle then
most-recently-updated, prints TSV `id<TAB>active|idle<TAB>name`. Take the first line. Header
comment documents the rotation trap so the next reader does not re-derive it.

**Standing rules adopted:**
1. Never cache a session id across turns. Re-resolve by name immediately before acting.
2. Never conclude a session is gone from an id lookup alone — check by name first.
3. Give peers a **name-based** return address, not an id.
4. `$HAPI_SESSION_ID` is live and does change — read it fresh, never transcribe it into a template.

**Wider implication, still uninvestigated:** `inbox_items.related_session_id` stores an id. If ids
rotate, those references rot silently, which is a plausible mechanical cause for the "stale inbox
items pointing at non-existent sessions" logged on 2026-08-15 and written off as generic staleness.
Flagged to the operator as a possible real defect; not yet chased.

---

## 2026-08-19 — Root cause of id churn; durable id found; inbox-rot suspicion RETRACTED

**Trigger:** Operator: "We cannot rely on sessions remaining active. Machines reboot, stuff
happens. If there is a non-ephemeral id that persists, find that, otherwise it's best effort from
name." Also directed to chase the suspected `inbox_items.related_session_id` rot.

### Why ids churn (mechanism, not guesswork)

`hub/src/store/sessions.ts::getOrCreateSession(db, tag, …)` keys sessions on a client-supplied
**tag**, reusing the row when the tag matches and minting `randomUUID()` only when it does not.
`cli/src/agent/sessionFactory.ts:213,282` does `options.tag ?? randomUUID()` — so a relaunch that
does not carry its tag forward presents a new tag and gets a new hub id.

The churn is then completed by a deliberate **merge-and-replace** in
`hub/src/sync/sessionCache.ts:~1520-1560`: agentState and teamState are merged onto the new
session, references are repointed, and the old row is **deleted** (`deleteOldSession`), emitting
`session-removed`. So old ids are genuinely gone, not merely inactive — confirmed against
`/api/sessions` (618 rows; `9b23ed0b`, `044295ca`, `19c5c074`, `09d01a99` all absent).

### RETRACTION: the inbox is not being corrupted

The 2026-08-19 entry above speculated that id rotation was silently rotting
`inbox_items.related_session_id` and might explain the 2026-08-15 stale-inbox findings. **That was
wrong, and it is worth being explicit about.** The hub explicitly maintains these references:

- `store/inboxItems.ts::repointSessionInboxItems` / `detachSessionInboxItems`
- `store/events.ts` equivalents for `overseer_events`
- called from `sessionCache.ts:1548-1549` on the merge path, before the old row is deleted.

Measured on the live DB via the API: of 193 open inbox items, 124 carry a `relatedSessionId`; **124
of 124 resolve to a live session, 0 dangling.** Same check across `obsoleted`/`resolved` items:
**0 dangling.** The substrate is correct. The 2026-08-15 staleness has some other cause (most
likely simply that items are not re-evaluated when a session moves on) and should not be attributed
to id rotation.

### What actually breaks — and it is narrower than feared

The hub migrates its **own** references. It cannot migrate an id an agent wrote **outside** the
DB — a §0 handoff brief, a ping body, a doc, this log. Those rot silently. That is precisely the
failure that bit this stand-in (dead `From:` address in every peer handoff), and it is the whole
justification for name/durable-id resolution.

### The non-ephemeral id: `metadata.agentSessionId`

Because merge copies metadata onto the surviving row, `metadata.agentSessionId` (== `claudeSessionId`
for claude flavor) survives the churn. Verified: peer #1593 held `8e1f4fd4-…` across all three hub
ids, matching its pre-ENOSPC transcript filename. Coverage 502/611 sessions, better than `name`
(476/611); `path` is 611/611 but not unique per session.

**Durability ranking adopted:** `metadata.agentSessionId` (durable across hub-id merge and resume;
changes only if the agent is relaunched from scratch) > `name` (stable but human-editable) >
`path` (stable, non-unique) > hub `id` (ephemeral — never store it).

`hapi-overseer-call.sh resolve <needle>` now matches case-insensitively across name,
agentSessionId, hub id, and path, and emits TSV `hubId<TAB>active|idle<TAB>agentSessionId<TAB>name`
— act on the hubId now, store the agentSessionId to find it again later. Verified both by-name and
by-agentSessionId lookups return the correct current hub id.

**Follow-through (operator: "Then don't write it outside the DB? … Or at least refer to the SoT
identifiers that are correct in the database"):** the right correction, and it goes further than
the resolver. Traced the rot to its source: the **§0 handoff template itself institutionalised it**
— `docs/tooling/new-feature-intake.md` line 29 told every orchestrator to write
`<cursor-session-id or HAPI session URL>` into a brief that outlives it, and the close-the-loop line
told the peer to reply to that id. The dead `From:` address in this stand-in's handoffs was not a
personal slip; it was the documented procedure.

Amended that file so briefs carry **durable in-DB identity** (`Name:` + `agentSessionId:`), with any
hub id explicitly labelled ephemeral and barred as a return address, and the close-the-loop step now
requires resolving to the current id immediately before pinging.

Also reconciled with existing canon rather than contradicting it: `docs/operator/AGENTS.md`
§ Peer message identity establishes **soft nametag** provenance (`meta.peer.sourceSessionId` under
shared `CLI_API_TOKEN` trust — not verified, not capability HMAC; #1473 closed, #1618 path). Client
`From:` text is a reply hint only. So the template amendment is explicitly framed as an
**addressing hint for resolution, not an identity assertion**. Taken together the rule is: resolve
peers by durable id/name; hub nametag + agent `From:` are routing hints that may be stale or
spoofed within the namespace token.
