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

---

## 2026-08-26 — Fleet briefing: two at-risk findings, and a structural cause for "silent" agents

**Trigger:** Operator asked for a status briefing. Ground-truthed 6 decision-shaped inbox items
against their sessions rather than relaying inbox summaries (per the 2026-08-15 rule).

**Verified independently by this stand-in (not just relayed):**

1. **#1593's work is finished and unpushed.** `worktrees/voice-mobile-parity-1593` holds three
   commits ahead of `upstream/main` — `78aa66ee0` (#1593 gate stays), `97a163e68` (**the #1639
   browser-cloud provider — the feature it was re-briefed to build**), `17210c6e2` (post-review
   fixes). `git ls-remote origin fix/voice-mobile-parity-1593` returns nothing: **local-only for 7
   days, single worktree, no backup.** Working tree clean, so the commits are the whole asset.
2. **`quest-audio-relay` still has an unrepaired dirty tree.** On `feat/24-hapi-inline`: 7 deleted
   files uncommitted since Aug 22, including `scripts/gitleaks-staged.sh`, `scripts/owasp-gate.sh`,
   `.github/workflows/ci-cloud.yml` — i.e. security/CI tooling another agent had pushed. Cause was
   an `rsync --delete` from a nested worktree into the parent repo which also destroyed the
   uncommitted hapi-inline WIP (no commits, no remote branch, no PR #24). Anyone who commits that
   tree re-deletes the other agent's work.

**Structural finding that reframes earlier audits:** #1593 could not close the loop because
`ping_peer`/`SendMessage` fail with **"Invalid session capability"** from that worktree-spawned
session — inbound pings to it succeed (this stand-in delivered two), outbound does not. So its
silence was **infrastructure, not negligence**. This casts doubt on the 2026-08-15 entry, which
attributed a stalled session's failure to close the loop to process non-adherence: some share of
the "agent went idle without reporting" pattern this stand-in has been auditing may be agents that
were structurally unable to report. Worth its own issue and a re-read of that judgement before it
hardens into received wisdom.

**Stale, no action (confirms the standing pattern):** "Kitchen status session list UI" was blocked
only on an unrelated remat-hold that cleared 11 days ago; the APPROVAL item "Discord event banner
spike" had no pending prompt (**every APPROVAL item audited to date has been stale** — the category
looks structurally unreliable); "jessica oos brain" self-resolved Aug 22 ("She's back").

**Genuinely parked on the operator:** Peer #1686 (5-step dogfood on `:3006`, no PR until green) and
Peer #1594 (real click-and-speak test) — two agents idle awaiting the same human.

**Remediation dispatched (2026-08-26, operator-authorised):**
- **Peer #1593** — told to `git push -u origin fix/voice-mobile-parity-1593` (3 commits, 7 days
  local-only, includes the whole #1639 feature). No PR — operator holds that. Because its outbound
  pings fail, it was given a **file-based** report channel (`localdocs/1593-status.md`) instead of
  being told to ping, and told explicitly that its silence was infrastructure, not its fault.
- **qar hapi-inline** — told to restore exactly the 7 deleted files (leaving the 4 modified files
  alone for review, since those may be intentional), NOT to start rebuilding, and to return
  costed recommendations on rebuild-vs-abandon and the gitleaks licence rather than deciding.
- **"Tracking work to be done on a board"** (`516537b4`, agentSessionId `0a9aad27`) — briefed on
  the PAT thread: separate the **poll** surface (`GET /orgs/{org}/personal-access-token-requests`,
  which does exist) from the **webhook/push** surface (the actual suspected gap), verify which
  holds on GHES specifically, and alert via a scoped ntfy publisher. Plus the operator's decided
  interim: enable fine-grained PAT auto-approval, with the tradeoff stated once and the
  compensating control named (alerting + periodic token review).
- Filed **tiann/hapi#1698** for the "Invalid session capability" outbound-peer-messaging bug.

**Operational note:** ids rotated *between* `resolve` and `ping_peer` twice in this pass (#1593 went
`0fac9738` -> `e3db09bc` mid-attempt). The reliable pattern is to resolve and send **in a single
shell command** (`ID=$(… resolve …); hapi ping-peer "$ID" …`) rather than two tool calls. Adopted.

---

## 2026-08-26 — Stand-in fabricated a citation; peer caught it and correctly refused an org security change

**What happened:** briefing the PAT thread, this stand-in told the peer it had filed
`lockhouse/is-vm-working#104`, "allowlist-sync: fine-grained PAT org-approval flow isn't
documented…". The peer disputed it. Verified against GHES:

- **#104** = "SSH sessions never get /etc/environment proxy vars — pam_env.so missing readenv=1",
  author `dl`, closed. Unrelated to PATs.
- **#107** = the actual PAT-approval issue, author `dl` — **not the peer**, which had only
  referenced it in passing.

Wrong on the issue number *and* the attribution.

**Mechanism (the part worth remembering):** two separate greps over the peer's transcript — one for
the issue title, one for `is-vm-working/issues/[0-9]*` URLs — returned the title and, separately,
`104/105/106`. The stand-in stitched the title onto the lowest number and asserted authorship.
**The evidence never contained that linkage; it was inferred from adjacency and then stated as
fact.** This is the same fabricated-corroboration failure this log exists to catch in others, and
it was committed while performing an audit.

**Rule adopted:** when citing an artefact (issue, PR, commit) sourced from grepped output, the
identifier and its content must come from the *same* match, or be confirmed against the artefact
itself (`gh issue view`) before assertion. Never join a title from one grep to an id from another.

**The peer's refusal was correct and was explicitly endorsed.** It declined to disable the org's
fine-grained PAT approval requirement on a relayed instruction whose one independently-checkable
detail proved false, on the grounds that an org-wide security control is not reversible-in-spirit.
It escalated directly to the operator instead. That is the behaviour this role should be
reinforcing, not overriding — the stand-in confirmed the operator's instruction was genuine while
agreeing the peer should take it from him directly, and explicitly told it not to treat the
follow-up as authorisation either.

**Substantive finding from the peer, more valuable than the brief that prompted it:** the GHES org
audit log carries real `personal_access_token.request_created` / `access_granted` action types, and
`dl` currently has a `request_created` with **no matching `access_granted`** — a teammate is
blocked waiting on approval *today*. Also: `orgs/lockhouse/hooks` is empty, so no push-side
listener exists yet; the peer correctly declined to create a probe webhook before scope was agreed.

**2026-08-26 — Operator decisions (a)+(b) dispatched; a second relayed figure caught before use.**

Operator approved both: rebuild hapi-inline, and the gitleaks OSS CLI swap. On (a) he explicitly
overrode this stand-in's suggestion to defer the rebuild behind the STT work — "quest usage is
still the bulk of our HAPI time, so yes, first class citizen there." Relayed as front-of-queue,
and framed as new intake (file an issue first) rather than a resume, since the WIP has no history.

**Scope figure corrected before acting on it.** The peer reported "18 migrated repos using
gitleaks-action@v3". Checked rather than relayed: `HeavyGee-Projects` contains 18 repos, but
enumerating every repo's `.github/workflows` via the API shows only **6** actually reference
`gitleaks-action` — quest-audio-relay, tvtropes-discord-bot, tvtropes-dev, system-voice, putout,
discord-draytek. The 18 was the org size, not the affected count; roughly a third of the assumed
work. Also noted: `gh search code` returns **0** for this org despite a locally-verified usage, so
code search is unreliable here and workflow enumeration is the trustworthy method.

This is the second relayed detail in two turns that did not survive checking (after the fabricated
#104 citation, which was this stand-in's own error). Both directions confirm the same rule: verify
identifiers and counts against the artefact before they become the basis of dispatched work.

Scope split to protect the first-class priority: the qar peer takes its own repo's swap only; the
other five need an owner. The prior estate CI/runner-audit session is **archived** ("moved to
oos-linux peer") and no successor resolves by name — flagged to the operator rather than inventing
one or silently loading the rebuild peer with five extra repos.

---

## 2026-08-26 — Duplicate spawn prevented; unmerged branch found masquerading as canon

**Trigger:** Jellybot marketing session (`1572630b`) asked for (1) provenance of the Quest debug
ntfy install, and (2) a peer spawned for Pixel 10a parity.

**Request 2 — declined the spawn, correctly.** `Peer: Pixel 10a ntfy debug parity`
(`ee15c399`, cwd `server-setup`) already existed and was `active: true, thinking: true`. Spawning
as asked would have put two agents in one repo on one task. Routed the research to the existing
peer instead and told the requester plainly why. **This is the clearest instance so far of the
overseer role paying for itself: the requester had no way to see the peer already existed.**

**Request 1 — the more useful finding is that the "canon" is not on main.**
`scripts/ntfy/quest-ntfy-subscribe.sh`, cited as canon by the requester and by the
`ntfy-integrations` skill, **does not exist on `server-setup` main.** It lives only on unmerged
branch `origin/feat/18-quest-ntfy-subscribe`, commit `d527735` (2026-08-15). Issues
`heavygee/server-setup#18` and `#20` are both **OPEN**, and **no PR was ever opened**. So a
documented-as-canonical helper is invisible to anyone who checks out the repo — the same
push-without-PR failure pattern already logged twice in this file (#1594's original session, and
#1593's unpushed commits).

Attribution honestly left unresolved: no session demonstrably performed the headset install; the
best documentary source is session "PR reviews" (`507be0ab`, durable `992cf83a`) which authored the
skill text. Declined to name an installer on circumstantial grounds — explicitly because of the
fabricated #104 citation earlier the same day.

**Contract captured for reuse** (package `io.heckel.ntfy.debug`, server
`https://ntfy.introvrtlounge.com`, wireless ADB `source_ip:5555` / `QUEST_ADB_SERIAL`, token
`~/.config/quest-ntfy/access-token` or `QUEST_NTFY_TOKEN`, flags `--no-smoke` / `--serial`), plus a
pointer that `scripts/ntfy/adb-phone-reload.sh` is already on main and likely closer to the Pixel
path than the Quest script.

**Pattern now worth naming for the operator:** three separate work items in this log were lost or
made invisible by branches pushed without a PR. That is not three accidents; it is a missing gate.

**2026-08-26 — Verified the Pixel peer's report; caught a 12-commit scope bleed in PR #30.**

Confirmed independently: `jellybot-dmca-publisher` is write-only on `jellybot-dmca` (correct
mapsnatch pattern); `~/docker/jellybot/.env` carries `NTFY_SERVER`+`NTFY_TOKEN` with **zero**
`NTFY_USER`/`NTFY_PASSWORD` (admin creds genuinely removed); PR #30 open on the right branch.
Its judgement to supersede unmerged `feat/18` rather than depend on it was right.

**False alarm avoided:** `heavygee/server-setup` and `Heavygee-Projects/server-setup` are the same
repo (id `924469024`) — the former is a post-migration redirect, and #18 is one issue (id
`5159618279`), not two. Checked before raising it, unlike the #104 citation earlier today.

**Two real defects found in PR #30:**
1. No `Closes #18` linkage, so the merge would not close it — the exact invisible-work pattern the
   peer was deliberately trying to avoid would have recurred.
2. **13 commits, only 1 of which is the peer's work.** The other 12 were verified *not* already on
   `origin/main` (`git merge-base --is-ancestor`), i.e. genuinely introduced: kinrupt endpoints,
   Borg/backup behaviour changes, a **transmission-vpn Privado→PIA switch**, NetBird installers,
   Home Assistant kitchen-lights, Brainstorm library remuxes. Merging would have landed a VPN
   provider change and backup-behaviour changes into main under a "Pixel ntfy subscribe" banner.
   Told the peer to rebase to its single commit and to justify any of the 12 it actually needs.

**Fourth signal on the headset bottleneck:** Quest could not be subscribed to `jellybot-dmca`
because its ADB is offline. Deployment-to-headset is now blocking a fourth distinct workstream.

**2026-08-26 — CORRECTION: "no PR was ever opened" for #18 was false; the pattern is misdiagnosed.**

PR #30 cleanup verified: 1 commit, 9 files, all ntfy, `Closes #18` present; the 12 displaced
commits are safely reachable from remote branch `origin/feat/kinrupt-presence-endpoint` and have
their own PR #7 — nothing orphaned by the force-push.

**But the stand-in's own claim was wrong.** `PR #19` is **OPEN** on `feat/18-quest-ntfy-subscribe`,
created 2026-08-15, not a draft. The claim "no PR was ever opened" was reached by running
`gh pr list --search "quest ntfy"`, getting an empty result, and treating an empty search as proof
of absence — **the exact false-negative trap this stand-in had warned the qar peer about an hour
earlier regarding `gh search code`.** Stated as fact to two peers and to the operator, and used to
build a "missing gate" narrative.

**Consequences corrected:** the Pixel peer was told (its supersede decision still stands on merit,
but PR #19 now overlaps PR #30 and should be closed as superseded, with salvage first).

**The pattern was misdiagnosed and is now restated.** It is *not* "work never gets a PR". It is
**PRs get opened and then sit unmerged**. `server-setup` currently has six open PRs — #19 (11 days
old), #21, #23, #27, #29, #30 — several of which are the very capabilities other sessions are
blocked on. That is a review/merge backlog, not a missing gate, and the remedy is different:
nothing upstream of the PR needs fixing; someone needs to land them.

**High-value find in that backlog:** **PR #29** (`fix/quest-adb-sidequest-serial`, OPEN, 2026-08-25)
is a written fix for the Quest ADB bottleneck flagged four times in this log — "SideQuest uses an
ephemeral high port, not 5555; `quest-3-adb-wireless.sh live`/`ensure` now pick a live
`eureka`/`Quest_3` serial". **Its test-plan checkbox is unticked.** The blocker costing four
workstreams may already be solved and merely awaiting a test run on a SideQuest-connected host.

**Rule reinforced (second violation in one day):** an empty result from a *search* API is not
evidence of absence. Enumerate the underlying resource (`gh pr list --head <branch>`,
workflow listings, `git ls-remote`) before asserting that something does not exist.

**2026-08-26/27 — ADB "bottleneck" root-caused: the headset is simply off.**

Peer closed PR #19 with a supersession comment (verified: `state=CLOSED`), corrected the
provenance framing in LOGBOOK/runbook/PR body, and kept #30 clean (verified: 1 commit, 9 files).
It also attempted PR #29's test plan and could not — no Quest in `adb devices -l`.

**Root cause established, and it is not code.** `tailscale status` shows `gc-quest-3` **offline,
last seen 1h ago**, and the quest-audio-relay heartbeat is **71 minutes stale with `worn: false`**.
The headset is powered down / not worn / not on the tailnet. Four workstreams
(QAR builds, hapi-inline rebuild, "Android phone Debug", `jellybot-dmca` subscribe) have been
described in this log as blocked on "ADB flakiness"; they are actually blocked on **the device
being switched on**, which is an operator action of a few minutes, not an engineering thread.
This corrects the framing used in four previous entries.

**Merge-readiness of the stalled `server-setup` PRs (the real pattern — PRs opened then left):**
| PR | state | checks | age |
|----|-------|--------|-----|
| #30 Pixel ntfy + jellybot-dmca | **MERGEABLE / CLEAN** | SUCCESS | today |
| #27 Quest 2D panel + Transmission→HAPI | mergeable unknown | SUCCESS | Aug 24 |
| #29 SideQuest live serial (the ADB fix) | **CONFLICTING / DIRTY** | none | Aug 25 |
| #21 ntfy topic registry + provenance (#20) | unknown | **FAILURE** | Aug 15 |
| #23 android-dev-emulator CLI | unknown | **FAILURE** | Aug 16 |

So the backlog is not uniform and does not need one blanket action: #30 can land now; #29 needs a
rebase *before* it can even be tested; #21 and #23 have been red for ~12 days. Notably #29 — the
fix for the bottleneck — is conflicted, so even a live headset would not be enough today.

---

## 2026-08-27 — POST-MORTEM: I sent unattributed peer messages, and broke the #1203 guarantee

**Operator report:** the top message in `Peer: Pixel 10a ntfy debug parity` is unattributed,
defeating the purpose of the A2A nametag attribution work.

### Root cause (verified in code, not inferred)

Verified peer provenance is minted **only** by the capability route
`POST /sessions/:id/peer-messages` (`hub/src/web/routes/cli.ts:~502`), which requires the
`HAPI_SESSION_CAPABILITY_HEADER` and checks it with
`verifyPeerSessionCapability(source.sessionId, capability, jwtSecret)` — an HMAC over the hub JWT
secret. The route's own comment is explicit: *"Shared CLI token + path claim alone is rejected."*
Separately, `hub/src/socket/handlers/cli/sessionHandlers.ts:194` refuses any generic CLI `message`
that tries to carry `meta.sentFrom === 'peer'` — deliberate anti-forgery from #1473.

The capability is **deliberately unavailable to me**: `cli/src/api/apiSession.ts:248` —
*"Session-scoped peer capability from hub create/load; **never exported to agent env**."* It is
held by the live CLI process that owns the session, not by shell commands that process's agent runs.

So:
- **MCP `ping_peer`** goes through this session's own MCP bridge, inside the process holding the
  capability → hub stamps `meta.sentFrom: 'peer'` + `meta.peer.sourceSessionId` → **attributed**.
- **`hapi ping-peer` invoked from my Bash tool** is a separate process with `CLI_API_TOKEN` but no
  session capability → cannot mint peer provenance → lands as a plain message → **unattributed**.

### Why I did it

To beat the session-id rotation race. Ids were rotating *between* my `resolve` call and my
`ping_peer` call (`0fac9738` → `e3db09bc` mid-attempt), so I moved to a single shell command that
resolved and sent atomically. **I traded verified provenance for id freshness and did not notice
the trade.** `hapi ping-peer` printed `OK - delivered` every time; the degradation was silent.

**The aggravating factor:** I had already read and *quoted* the governing canon earlier in this
same session — `docs/operator/AGENTS.md` § Peer message identity, including "client `From:` text is
display-only (⚠ unverified)" and "bare CLI / systemd with no capability is unknown peer". I used it
to reconcile my intake-template edit, then violated it an hour later. This was not missing
knowledge; it was failure to apply knowledge I had just handled.

### Blast radius

Unattributed (sent via Bash CLI): the #1593 push instruction; three messages to `qar hapi-inline`;
two to the PAT session; three to the Pixel peer; the reply to the Jellybot session.
Attributed (sent via MCP, earlier): overseer prep, meta PR watcher, the early #1593/#1594 briefs,
and the tooling meta-bot nudge.

**Consequence that matters:** peers were asked to do consequential things — push branches, rebase
and force-push a PR, change an org-wide PAT policy — by a sender the hub could not identify. The
PAT peer's refusal to flip that policy now reads as *more* correct than I credited at the time: it
said it could not verify me, and the system was in fact telling it I was unverified. My own
`From:` lines were display-only text that any process could have written.

### Fix

Return to **MCP `ping_peer`** as the only send path. Handle rotation by retrying rather than by
changing transport: resolve → send → on "Session not found", re-resolve once and resend. The race
window is small and a retry costs nothing; losing attribution costs the whole #1203 guarantee.
**Never substitute a shell transport for a capability-bearing one to solve an unrelated problem.**

### Post-mortem addendum — the diagnosis above was itself incomplete

Attempting to demonstrate the fix by re-sending via MCP `ping_peer`, **that failed too**:
`Invalid session capability`. So "use MCP instead of the CLI" was not the whole answer, and the
real cause is deeper — and it is the same fault that silenced peer #1593.

**Actual root cause.** `hub/src/web/peerCapability.ts` binds the capability to the session id:
`HMAC(jwtSecret, "hapi-peer-cap-v1:" + sessionId)`; `verifyPeerSessionCapability` recomputes it
over the **current** id. `sync/sessionCache.ts` rotates ids by merging state onto a new id and
**deleting the old row** — without re-issuing a capability to the still-running client. The client
keeps a capability minted for a dead id, so every attributed send 403s from then on.

Re-mint needs either a socket connect presenting the **create-time session tag**, or a runner
**resume peer-mint nonce**. A long-lived session that rotated mid-life re-presents neither, and by
design cannot mint its own (correct #1473 anti-forgery). **So a rotated session is structurally
unable to send attributed messages, permanently, with no recovery path from its side.**

**This estate rotates ids constantly** — this stand-in observed three rotations of one peer within
an hour, and its own id rotate mid-conversation. So the #1203/#1473 attribution guarantee is
probably broken for a large share of long-lived sessions right now. That is a far more serious
finding than my messaging lapse, and it re-frames it: my fallback to the CLI was the *symptom* of
a hub defect, though I reached for it for the wrong reason and failed to notice what I had traded.

It also vindicates two earlier judgements: peer #1593's silence was genuinely structural, and the
PAT peer's refusal to act on my unverified instruction was correct — the hub really could not
identify me.

**Issue #1698 corrected** (comment `5441053544`): re-scoped from "worktree-spawned sessions" to
rotation-induced capability invalidation, with the suggested fix — re-issue the capability inside
the `sessionCache` merge, at the same point `events`/`inbox` refs are repointed, where both ids and
`jwtSecret` are already in hand; or at minimum surface a loud error on first 403 instead of
failing silently.

**Correction to my own earlier claim:** I told the operator #1698 was about worktree spawning. It
is not. Same class of error as the #104 citation and the "no PR" claim — a plausible cause asserted
before it was isolated.

### Post-mortem correction #2 — the framing above was built on rejected canon

The #1618 owner reviewed the post-mortem and was right to flag it: the entry above accurately
describes **soup reality** but calls it "verified provenance" and "the #1203/#1473 guarantee"
without contrasting it against the product bet that actually holds. Correcting that here rather
than editing history.

**#1473 was rejected, not broken by me.** `docs/plans/2026-08-17-a2a-nametag-only-thesis.md` closed
it as overweight — *"we are not shipping fortress provenance as the A2A answer."* Operator canon
was updated 2026-08-22 (`f09bfb225`): peer nametags are **UX routing hints** under namespace-token
trust, **spoof-within-token accepted**, and agents must **not** describe them as verified, trusted,
or capability-bound. So the "guarantee" I spent the post-mortem mourning is a thing this estate
deliberately walked away from. I read a pre-sync mirror early in the session, never re-read after
Meta's `hapi-sync-fork-main` landed the correction, and reasoned from stale canon for hours.

**Verified independently (all four confirmed):**
- `upstream/main` has **no** `peerCapability.ts` — #1473 never merged.
- **#1618** (open, Lane A wait on @tiann) is the replacement: no capability header; peer delivery
  under the same namespace-token trust as other `/cli/sessions/:id/*` routes.
- `driver/doctor-provenance` **and** `driver/fleet-runner-upgrade` both carry `peerCapability.ts`.
- The manifest shows `feat/a2a-p05-peer-provenance` **commented out** (dropped 2026-08-17) while
  both fat branches remain **active**.

**The reusable lesson, and the sharpest finding of the day:** dropping a manifest layer does not
remove code that *other* layers happen to re-carry. The p05 drop was defeated by two unrelated fat
soup tips, so every rebuild silently reinstated the rejected stack. Docs walked back; runtime did
not; and the drop that was supposed to align them accomplished nothing. That is a soup-hygiene
failure mode worth a standing check, not a one-off.

**My proposed fix was also wrong** and has been retracted on #1698 (comment `5441190658`):
re-issuing the capability during the `sessionCache` merge would have entrenched a mechanism the
project has already decided to delete. Correct direction is removal via #1618; interim is manifest
hygiene. Upstream #1698 is probably a close-in-favour-of-#1618, not a fix.

**Stale docs still carrying rejected framing** (flagged by the #1618 owner, not yet corrected —
`machine-reenroll-resume-runbook.md` is a whole-doc rewrite and should not be butchered blind):
- `docs/tooling/machine-reenroll-resume-runbook.md` — assumes #1473 session-RPC auth + capability
  inject is live product
- `docs/plans/2026-08-13-session-mailbox-fleet-comms.md` — "future #1473 provenance"

**Tally for the day, stated plainly:** five assertions made before isolation — the #104 citation,
"no PR was ever opened", #1698's worktree framing, the "verified provenance" framing, and the
capability re-mint fix. Each was plausible, checkable, and wrong. The corrective that actually
works is the one this log keeps re-deriving: enumerate the artefact before asserting it.

**2026-08-28 — #1473 thread parked, cleanly.** Meta confirmed: #1618 queued behind current remat;
pre-restart ping agreed so this stand-in can go idle for the drain (it was the WORKING=1 blocker);
`allow:` entry for `feat/a2a-nametag-attribution` will be added when that layer lands, so the new
excision gate does not block the very fix it exists to protect. Durable-vs-ephemeral id distinction
accepted — `agentSessionId` as find-key, resolved hub id as ping target, resolve-and-send in one
step. Excision gate shipped in `ec3345778` and green against the live manifest. Fortress confirmed
still absent across a full rebuild/restart cycle (hub pid 1445444, 07:51:47) — first evidence the
excision persists rather than being silently reinstated.

**Estate state at parking — items awaiting the OPERATOR, not an agent:**
1. Peer #1594 long-press-to-talk — live on `:3006`, awaiting the real click-and-speak test. Oldest.
2. Peer #1686 local follow-up abort — 5-step dogfood ready on `:3006`; PR opens only on green.
3. PR #30 (server-setup) — MERGEABLE/CLEAN, checks green, closes #18. Ready to land.
4. PAT auto-approval — the peer correctly wants the org-policy change confirmed by the operator
   directly, not relayed. `dl` has a `request_created` with no `access_granted`: blocked today.
5. gitleaks OSS swap — qar owns its own repo; the other 5 repos have no owner assigned.
6. PR #29 (SideQuest ADB serial fix) — CONFLICTING, needs a rebase before its test plan can run;
   and the Quest is offline anyway (heartbeat stale, `worn: false`). Headset-on is the precondition
   for four workstreams.
7. Two docs still teaching the rejected #1473 model: `machine-reenroll-resume-runbook.md`,
   `2026-08-13-session-mailbox-fleet-comms.md`.
8. Unverified: whether peer #1593 pushed its three local-only commits (incl. the whole #1639
   feature) as instructed. Worth confirming — that work existed in one worktree with no remote.

**2026-08-29 — recurring pattern: branches cut from the wrong base.** Second instance today.
- qar PR #30 carried **12 unrelated commits** (VPN provider switch, backup behaviour, NetBird,
  Home Assistant) under a "Pixel ntfy subscribe" banner — cut from a dirty/older base.
- #1203 PR #137 failed `drift-gate` + `integration` because it was cut from **upstream/main rather
  than fork main**, producing lockfile drift and replaying upstream-only failures. Not a logic bug.
Both were invisible to their authors, who reported local green in good faith. Fix in both cases was
the same: reset to the correct base, cherry-pick only the feature commit, force-push. After the
reset, #137's `drift-gate` went FAILURE -> SUCCESS with the branch down to one commit.
Worth considering whether `hapi-worktree-create` should assert the intended base, or whether a
pre-PR check should flag "branch contains commits not authored for this change".

**Stand-in error tally, 2026-08-29:** grepped the wrong branch name (`feat/` vs soup `driver/`) AND
the wrong manifest (legacy `~/.config/hapi` vs canonical `config/`), and concluded #1618 was not
landed when it had been since Aug 28. That second mistake was also latent **inside the excision gate
shipped yesterday**, which defaulted to the legacy manifest — a guard that could report green while
the manifest actually used for rebuilds was contaminated. Fixed in `7ac66a563`. First error today
that shipped into tooling rather than just into a message.
