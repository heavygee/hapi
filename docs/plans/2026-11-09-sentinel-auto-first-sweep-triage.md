# `hapi-sentinel-check --auto` — first full sweep, triaged (2026-11-09)

**Run:** `--auto` against soup tip `5a281d30b`, 90 absorbed layers of 91, **2.5 seconds**.
**Result: 7 layers flagged — 4 real silent losses, 3 false positives, all three renames.**

This is the answer to *"is it much good then?"*, stated as numbers rather than as a
promise. Four features that were provably composed into the soup are not in it, and
nobody knew about any of them. Clearing the three false positives took a few minutes
each, and every one was the same shape: a symbol renamed by a later refactor while the
behaviour survived, often stronger than before.

> **Correcting the record.** `119900386`'s commit message says the first run *"flagged
> 7 absorbed layers with missing content"*. That number came from a pre-release build,
> before SKIPPED layers were excluded; the coincidence with today's 7 is accidental and
> the sets are different. Cite this file, not that message.

---

## The four real losses

### 1. `feat/overseer-summary-emit` — the Cursor notify-rule overlay is never installed

| | |
|---|---|
| Lost | `notifyRuleOverlay`, `preExistingContent` |
| Survives | `installCursorNotifyRuleOverlay`, `CursorNotifyRuleOverlay`, the whole `cursorNotifyRuleOverlay.ts` module, and its test file |

**The function is declared, exported, and tested. Nothing calls it.** The only
non-test references in the tip are its own definition, a plan doc, and two parked
soup-heal patches. The layer had wired it into `cli/src/cursor/cursorAcpRemoteLauncher.ts`:

```ts
this.notifyRuleOverlay = installCursorNotifyRuleOverlay({ … })
```

The tip's launcher installs `cursorMcpOverlay` and no longer installs this one. Heal
patch `91-modelerror-outcome-contract-and-stderr.patch` still carries the import as a
*context* line, which dates the loss: the wiring was present when that patch was
authored and disappeared in a later rewrite of the launcher.

This is precisely the trap the tool's own header warns about — *"a declaration can
survive while its only caller is deleted"* — and it is why a sentinel should name a
symbol on the call path, not a definition. Typecheck is green, the unit tests pass, and
the overlay is simply never installed.

### 2. `feat/overseer-summary-fallback` — the no-LLM backstop is gone

| | |
|---|---|
| Lost | `TURN_FALLBACK_SUMMARY_MAX`, `firstNonEmptyLine`, `synthesizeTurnFallback`, `longLine` |

The layer added a **deterministic** backstop: if an agent produced visible text but no
`AGENT_NOTIFY_SUMMARY`, synthesize a session-log-only capture from the first non-empty
line, capped at 200 chars. Its own comment says why — *"rule compliance can never be
100%"*, and *"No LLM; attention stays 0 so the inbox is untouched."*

In the tip, `hub/src/sync/overseerEventRecorder.ts:293` reads:

```ts
if (!primary && plainText && this.llmFallback) {
```

The name survived — `turn_fallback` is still the idempotency key — but the branch is
now gated on `this.llmFallback`, which is `options?.llmFallback ?? null` (`:190`) and
documented at `:42` as **opt-in**. With the LLM fallback unconfigured, a turn with text
and no summary line is blind again: exactly the hole this layer closed.

If the LLM path was meant to supersede the deterministic one, the deterministic branch
belongs *under* it as the `else`, not deleted.

**These two compound.** #1 means a Cursor agent may never receive the rule overlay that
tells it to emit `AGENT_NOTIFY_SUMMARY`; #2 removed the backstop that covered agents
which don't emit one. Together they are a plausible explanation for overseer turns that
capture nothing — and neither would ever show up as a failing test.

### 3. `feat/fue-app-shell-onboarding` — 4 of 5 FUE affordances gone

| | |
|---|---|
| Lost | `PerSessionSettingsButton`, `ScheduleButton`, `SwitchToRemoteButton`, `isVoiceStartState`, `voiceFue`, `showPicker`, `setShowPicker` |

FUE keys the layer registered, versus `web/src` today:

| Key | In tip? |
|---|---|
| `composer-per-session-settings` | **gone** |
| `composer-schedule-send` | **gone** |
| `composer-switch-remote` | **gone** |
| `composer-voice-start` | **gone** |
| `session-outline-toggle` | present |

`ComposerButtons.tsx` still exists and was rewritten on Nov 4; four of five callouts did
not survive that rewrite.

**The irony worth recording:** this surfaced on the same day a peer shipped
`driver/fue-unlabelled-controls`, a *new* layer adding FUE to unlabelled controls. Its
keys are different ones, so it is not a literal rebuild — but it is the same work, in
the same component, done again beside a composed layer that had silently stopped
existing. The cost of this bug class is not only a missing feature; it is duplicated
effort.

### 4. `driver/overseer-brain-active` — the post-restart fleet-upgrade sweep is gone

| | |
|---|---|
| Lost | `FLEET_UPGRADE_STARTUP_SWEEP_DELAY_MS`, `scheduleFleetUpgradeStartupSweep`, `runFleetUpgradeStartupSweep`, `fleetUpgradeStartupSweepTimer` |

The most operationally relevant of the four, because it is about **this seat's own
routine**. Its doc comment:

> *After hub startup (post-remat / patient restart), sweep once for runners that trail
> the hub offer. Heartbeat auto-upgrade alone can miss the window when a successful
> upgrade lands on the pre-restart generation and the 15m cooldown blocks chasing the
> new hub fingerprint.*

The heartbeat path survives — `maybeFleetUpgradeMachine`, `handleMachineAlive` and two
live `machineTrailsUpgradeOffer` call sites are all present. What is gone is the
**one-shot 15-second sweep after hub start**, which existed precisely because the
heartbeat path has a blind window across a restart. So after a `hapi-restart-hub`, a
runner that trails the new offer can sit on the old CLI until a cooldown expires and a
heartbeat happens to land.

*Attribution caveat:* this branch's diff against its own first parent is 3780
insertions across 5 files, so it is not a thin layer and the sweep may have arrived
from a neighbour in that range. The loss is real; the branch name is an approximate
pointer. The tool now says so in its output when a diff is that fat.

---

## The three false positives — every one a rename

| Layer | Flagged | Reality |
|---|---|---|
| `feat/tier-b-reattach-orphan-runner-children` | `adoptedSession`, `Adopting`, `Likely` | `const adoptedSession` → `const adopted` (`cli/src/runner/run.ts:543`), inside a *stronger* version of the behaviour (`decideUntrackedRunnerWebhook`, shared-Codex sibling protection, start markers, #1910/#1911). `Adopting`/`Likely` are English words from a changed log string. |
| `fix/runner-agent-context` | `sessionStartCommand` | A parameter name. The tip's `buildHookSettings(command, hooksEnabled, trackPermissionMode, includePreToolUse)` reverted the name; `resolveHapiToolingRoot.ts`, `workingDirectory` and the preToolUse guard wiring are all present. |
| `driver/doctor-provenance` | `reenrollGrant`, `bindReenrollGrantDb`, `restart_unsupported` | `reenrollGrant` → `cli/src/runner/reenrollGrantStore.ts` with `issueMachineReenrollGrant`/`ackMachineReenrollGrant` intact; `restart_unsupported` → `restart_unavailable` (`hub/src/sync/syncEngine.ts:1726`). |

**A rename is textually identical to a deletion**, and no cheap check can tell them
apart. That is the honest, irreducible limit of this tool, and the reason its output
must be read as *"go look at this"* and never as *"this is broken"*. The good news is
that triaging one takes a single `git grep` for the neighbouring behaviour.

---

## What the sweep changed about the tool

### Comment lines are excluded

Two of the original false positives were identifiers that only ever appeared in
**prose** — `driver/a2a-2251-strict-delta` named `pingPeerOptions` in a comment
explaining a test it was *deleting* (the layer is `+2 / −61`), and
`driver/247-deliberate-fleet-push` used the word `Unattended` in a doc comment later
reworded, while all four of its exported functions are present. Neither was ever
behaviour, so neither could be lost. Both layers now clear silently.

### Hex-looking tokens are excluded

`driver/job-complete-wake` was flagged for `c88c8925` and `eb72fcacc7c8` — the two
halves of a UUID in a test fixture.

### What is deliberately **not** excluded

English words inside string literals (`Adopting`, `Likely`) survive the filters and
show up as noise. Stripping string literals would also blind the tool to quoted
identifiers like `'search_content'` — and a tool name silently dropped from an
advertised list is exactly the loss this exists to catch. A few readable false
positives beat a silent hole.

### Sampling is gone, and that is the biggest change

The first implementation sampled `sort -u | head -40` per layer "to bound remat cost".
That was not a sample, it was an **alphabetical prefix**: it over-weighted
`SCREAMING_CASE` constants, never reached the tail of the alphabet, and reported `ok`
on layers it had only partly read.

The proof was accidental and conclusive. Adding the comment filter should only have
*removed* flags. It removed the two prose ones — and surfaced
`FLEET_UPGRADE_STARTUP_SWEEP_DELAY_MS`, a real loss the identical tool had never looked
at over the identical tip, because dropping comment identifiers moved where the cut
line fell. A later de-biasing change moved it again and **hid two real losses that the
previous run had found**. Three sweeps, three different answers, one unchanged tip.

So the fix was to stop sampling. One `git grep -o` pass extracts every identifier in
the composed tree (43k names in ~1.6s); each layer is then a `comm` against that set,
which costs nothing. **Full coverage turned out to be ~300× faster than the sample
was** — 2.5s for the whole soup versus 13 minutes — because the old design paid one
`git grep` per identifier.

> **The transferable lesson, and it is bigger than this tool:** a cap that is also an
> *ordering* silently decides what you never look at. Every sweep had been blind to the
> same slice of every fat layer, and the blindness was invisible because the output
> said `ok`. Whenever you bound work by taking the first N of a sorted list, you have
> not sampled — you have chosen, and hidden the choice.

### Honest reporting of partial work

A truncated run would now print `[sampled N of M — not full coverage]`, and a fat layer
prints a note that attribution to that branch is approximate. Neither can quietly imply
coverage it does not have.

---

## Tests

21 assertions, and the ones that matter are asserted **both ways**:

- Removing the comment filter makes the suite report
  `FAIL: comment-only identifier reached the report` — the guard is not vacuous.
- A positive control (`vanishedCodeSymbol`) proves `--auto` still goes red on deleted
  code, so the filter test cannot pass merely by the tool going quiet.
- A **coverage** guard: `zzzTailSymbol` sorts past any `head -N` cut, so a return to
  prefix-sampling fails the suite.
- An unabsorbed (fat-tip SKIP) layer must not be flagged — legitimately-absent layers
  would drown the real findings.

The harness's `out="$(run)"; rc=$?` pattern was also replaced. Under `set -e` a failing
run aborted the whole suite mid-way instead of recording a FAIL, so the pass count had
silently stopped being a count of everything — the same class of defect as the sampling
cap, in the test harness meant to catch it.

---

## How to read a flag (for whoever holds this seat next)

1. **Is the layer deletion-shaped?** (`--stat` net-negative.) Then absence is the point.
2. **Was it renamed?** Look for the layer's *behaviour* — the surrounding function, the
   call site, the error-code union — not its symbol. A rename usually arrives with the
   feature visibly stronger. This is 3 of 3 false positives so far.
3. **Is the symbol declared but uncalled?** `git grep <sym> | grep -v '\.test\.'`. A
   module that survives with only its tests referencing it is a loss, not a pass — see
   finding #1.
4. **Only then** is it a loss. Report it to the layer's owner; do not fix someone
   else's feature from this seat.

Expected steady-state cost: a flag or two per sweep, a few minutes each, on a 2.5s run
that can sit inside every remat. The four losses here had been invisible for months.
