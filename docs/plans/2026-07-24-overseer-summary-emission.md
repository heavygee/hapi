# Overseer summary emission (Half B) — 2026-07-24

Status: Piece 1 live; Piece 2 hub text-synth **removed**; Piece 3 in flight
(Claude remote + Codex app-server only; Grok/OpenCode deferred to #89).
Option A LLM fallback implemented (default OFF, #90).
Owner: feat/overseer-summary-emit (peer of 🔁overseer prep)
Scope: FORK-ONLY. Never upstream. The whole overseer feature is fork-private.

- Piece 1 — `feat/overseer-summary-emit` (fork PR #86): CLI Cursor rule overlay.
- Piece 2 — `feat/overseer-summary-fallback` (PR #87): hub text-synth **removed**
  (operator: Session Log is AGENT_NOTIFY_SUMMARY only). LLM fallback is #90.
- Piece 3 — `feat/overseer-summary-flavors-and-dates`: Claude remote + Codex
  app-server get the contract via system/developer instructions
  (`HAPI_SESSION_SUMMARY_CONTRACT=0` to opt out). Local native TUI
  (Claude/Codex/OpenCode) stays human-facing. Grok/OpenCode first-turn user
  prepend is not wrapped (#1095/#1096); those flavors wait on #89. Generic
  prompts omit `<agent-id>`/`<project>`; hub ignores those tokens. Debug
  events/inbox timestamps use standard "x ago" + absolute tooltip.


## Why this exists (the real WHY — keep it here, not in product code)

The overseer/inbox/session-log is fed by `AGENT_NOTIFY_SUMMARY` lines that agents
emit as the last line of every turn. PR #81 (`feat/overseer-contract-invisible`)
**Half A strip is now optional in the web UI.** Settings → About → "Show
AGENT_NOTIFY line" (`hapi-show-agent-contract` localStorage) leaves the trailing
line visible in session chat so the operator can verify emission without
digging in SQLite. Default remains strip-on. Raw store is never mutated.

**No hub first-line text synth.** Piece 2's `hub-synthesized from assistant text`
path is removed. ACP mid-turn text flushes are not Session Log events. Primary
signal is agent `AGENT_NOTIFY_SUMMARY` only; opt-in LLM fallback (#90) remains
a separate layer (default off). Tool-call timelines belong in session-flow
experiments, not overseer Session Log.




**Half A is useless for Cursor because nothing emits the line.** The hub
deliberately does not inject the contract for Cursor
(`shouldInjectNotifyContract('cursor') === false`, now orphaned — see below), and
no compensating Cursor-side rule was ever created. Cursor is ~95% of the fleet,
so the overseer is effectively blind: it sees turns but gets no self-reported
status/action/summary for almost every session.

This plan closes that gap: **Half B — summary emission for Cursor**, plus a
hub-side deterministic backstop so the overseer never has a fully blind turn even
when rule compliance slips.

## Constraints learned the hard way (do not re-litigate)

- **No user-turn prepend.** Non-Cursor ACP flavors used to PREPEND the contract
  onto the user's outbound message. That tripped a prompt-injection false
  positive and was removed (upstream #1095 / fork #1096,
  `fix/skill-lookup-no-user-prepend`). `shouldInjectNotifyContract` is now
  orphaned (referenced only by its own test). Do NOT reintroduce a user-turn
  prepend for any flavor.
- **cursor-agent has no HAPI system-prompt channel.** Unlike claude/codex/grok/
  opencode (each has `cli/src/<flavor>/utils/systemPrompt.ts`), cursor-agent
  ignores ACP `session/new` `mcpServers` for prompt purposes and has no
  developer-instructions hook we control. It discovers rules only from:
  (a) workspace `.cursor/rules/*.mdc` (MUST be `.mdc` with frontmatter; plain
  `.md` is ignored) + `AGENTS.md`, and (b) `~/.cursor` global user rules.
- **No global `~/.cursor` edits.** That would pollute the operator's entire
  non-HAPI Cursor experience. Rejected.
- **`--add-dir` is not documented to contribute rules.** Do not rely on it.

## Decision: per-session transient repo-local `.cursor/rules/*.mdc` overlay

Write a per-session, workspace-local, **transient** rule file at
`<cwd>/.cursor/rules/hapi-session.mdc` on spawn and remove/restore it at
teardown. This is the only channel cursor-agent reliably reads that we can scope
to a single HAPI session's workspace.

Discipline (mandatory, same shape a config overlay would use):

- **Merge-safe / non-clobbering.** If the user already has a file at that exact
  path, back up its contents and restore them verbatim on cleanup.
- **Own-file sentinel.** Our file carries a hidden sentinel comment. A file that
  already carries the sentinel is one of ours (a prior or concurrent HAPI
  session in the same cwd), never a user's — so we never back it up as if it
  were user content and never leave a stale copy behind.
- **Created-dir tracking.** We remember whether we created `.cursor` and/or
  `.cursor/rules`; on cleanup we prune only the dirs we created, and only if
  they are empty.
- **Fail-open, never throw.** Every fs op is wrapped; a failure logs at debug and
  is swallowed. A missing rule must never crash a session — it just degrades to
  the hub backstop below.

## Two pieces

### Piece 1 — CLI Cursor notify-rule overlay (this branch: `feat/overseer-summary-emit`)

- `cli/src/cursor/utils/cursorNotifyRuleOverlay.ts` — `installCursorNotifyRuleOverlay({ cwd, project, agentId })`
  returns `{ cleanup }`. Writes the `.mdc` with `alwaysApply: true` frontmatter;
  body mandates ending every response with the canonical machine line.
- Wired into `cli/src/cursor/cursorAcpRemoteLauncher.ts`: install near the top of
  `runMainLoop` (before the backend spawns cursor-agent so the file is on disk
  first); `cleanup()` in the launcher's `cleanup()`.
- Canonical line shape mirrors `AGENT_NOTIFY_CONTRACT_INLINE_PREFIX`
  (`shared/src/overseerEvents.ts`):
  `AGENT_NOTIFY_SUMMARY {"version":1,"agent":"<agent-id>","project":"<project>","status":"done|blocked|needs_review|needs_decision|failed|stalled","action":"<=12 words","summary":"one-line triage"}`

### Piece 2 — Hub deterministic backstop — REMOVED

Operator rejected hub first-line text synth. `onAgentMessage` does **not**
synthesize events from assistant text. Session Log is agent
`AGENT_NOTIFY_SUMMARY` (+ rare session-end completed) only. Opt-in LLM fallback
is #90 / `feat/overseer-llm-fallback`, default off. Do not reintroduce Piece 2
heuristics.

## Stealth requirements (operator-critical — "don't freak users out")

Cursor rules are visible to the user in their workspace. The overlay must read as
ordinary, useful project config, never as surveillance:

- **Filename:** `.cursor/rules/hapi-session.mdc` — innocuous, not
  `hapi-overseer-surveillance.mdc`.
- **Rule copy:** "end each response with a one-line machine-readable status
  summary for session tracking." True and useful-sounding. Never "so the overseer
  can watch you."
- **Prompt teardown:** remove the file at session end (restore any pre-existing
  user file).
- **Code comments / labels:** benign ("session summaries", not "overseer
  monitoring"). The real WHY lives in this doc, which is fork-only and excluded
  from upstream diffs.

## Scope / non-goals

- Cursor: transient `.mdc` overlay (Piece 1).
- Claude remote + Codex app-server: system / developer instructions (Piece 3).
  Opt-out via `HAPI_SESSION_SUMMARY_CONTRACT=0`.
- Local native Claude / Codex / OpenCode TUI: **no** notify contract (stdio).
- Grok / OpenCode first-turn prepend: title + skill-lookup only. Session-summary
  for those flavors is [#89](https://github.com/heavygee/hapi/issues/89).
- kimi + generic ACP / pi: also #89.
- Better LLM / oneshot-agent fallback: Option A implemented behind
  `HAPI_OVERSEER_LLM_FALLBACK` (default off); see § Better fallback / #90.
  Option B oneshot agent remains out of scope.

## Better fallback (opt-in — tracked #90)

v1 fallback is first-non-empty-line heuristics. A *better* fallback needs an LLM
and is a real cost tax - so it must be **opt-in**, clearly labeled, and rare
(only when the primary agent omitted the contract).

**Issue:** [#90](https://github.com/heavygee/hapi/issues/90) — implement Option A (default off).
**Remaining flavor coverage (separate):** [#89](https://github.com/heavygee/hapi/issues/89).

### Gate: rarity first, quality never second

Do **not** enable a better fallback until primary emission is good enough that
fallback is a thin residue - target **well under 5% of turns** (5% is already
generous). Measure emit vs missing-line ratio fleet-wide after Piece 3 is
live; only then enable LLM fallback.

When it *does* run, it must be **at least as useful as a primary self-report**:
feed the **full last-turn assistant content** (no input-char truncation that
would make the summary worse than the agent would have written). Rarity is the
cost control; accuracy is non-negotiable on the rare path.

### Option A — raw OpenAI-compatible completions call (implemented)

Hub POSTs the full last assistant turn text to an operator-configured base URL
(`/v1/chat/completions` or `/v1/responses`) with a fixed prompt: "emit exactly
one AGENT_NOTIFY_SUMMARY JSON line." Local (Ollama / vLLM / gateway) or remote
(OpenAI) - same wire format.

**Enable (default OFF — never surprise usage):**

```bash
export HAPI_OVERSEER_LLM_FALLBACK=1
export HAPI_OVERSEER_LLM_BASE_URL=http://127.0.0.1:11434/v1   # include /v1
export HAPI_OVERSEER_LLM_MODEL=llama3.3
# optional:
export HAPI_OVERSEER_LLM_API_KEY=ollama                       # Bearer token; empty OK for local
export HAPI_OVERSEER_LLM_API=chat-completions                # or: responses
export HAPI_OVERSEER_LLM_TIMEOUT_MS=30000
```

Prefer `chat-completions` for local-gateway compatibility; use `responses` for
OpenAI-native. Failures / non-compliant model output fall through to the
heuristic first-line fallback. Events are marked
`provenance: hub-llm-fallback ...` with `payload.synthesis = "llm-fallback"`,
`attentionCandidate = 0` (Session Log only — not inbox / voice).

**Cost warning:** every missed primary emit becomes a full-turn prompt. Enable
only after the rarity gate, or accept the bill deliberately.

### Option B — out-of-band oneshot agent

Spawn a short-lived non-HAPI (or disposable HAPI) agent with a fixed prompt:
retrieve last turn text for session X and emit a compliant summary line. Mark
the resulting event `provenance: oneshot-agent-fallback` and surface that label
in Session Log / inbox so the operator never wonders "wtf usage is this."

- Pros: can use whatever model/provider the operator already trusts; can do
  multi-step retrieval if needed.
- Cons: heavier; looks like a phantom session if not carefully labeled; higher
  cost variance; more moving parts.
  **Out of scope for #90** — revisit only if Option A proves insufficient.

### Shared requirements (either option)

- **Default off.** Explicit settings toggle + config (URL/key for A; spawn
  recipe for B). Unlock only after rarity gate is met (or operator accepts the
  measured miss rate).
- **Full turn content.** No max-input-char chop that degrades quality below a
  primary emit. Empty turns still skip.
- **Transparency:** event payload must say this was synthesized *because* the
  primary turn lacked a contract - never pretend the primary agent said it.
- **Kill-criterion:** if opt-in users report surprise usage, the toggle and
  provenance labels failed - fix UX before expanding defaults. If fallback
  summaries are worse than the heuristic first-line, do not ship.

Prefer **Option A** as the first better-fallback ship: smaller blast radius,
easier to reason about cost, no phantom sessions.


## Known edge cases / follow-ups

- **Concurrent HAPI sessions sharing one cwd:** the sentinel prevents user-data
  loss; worst case is one session removing the shared rule mid-run of another
  (rule stops applying). Acceptable for v1.
- **Cursor native `--worktree`:** the backend spawn cwd is `session.path`; if a
  future cursor-native worktree changes the effective workspace root, revisit
  where the rule is written. Noted, not handled in v1.
- **Rule compliance ceiling:** even with `alwaysApply` / remote systemPrompt, the
  model may drop the line. No hub text-synth; missing lines stay missing until
  #90 LLM fallback (opt-in).
- **Grok / OpenCode remote:** first-turn prepend is title + skill-lookup only.
  Session-summary for those flavors is #89 (durable instruction channel).

## Soup / coordination

- Fork-only; layers go AFTER `feat/overseer-contract-invisible` in
  `config/driver-manifest.yaml`. Coordinate exact placement + stacking + any
  rebuild with the "cursor - tooling/meta bot" session.
- CLI change requires an operator `hapi-restart-hub` to take effect. Agents must
  not restart / stack-switch.
