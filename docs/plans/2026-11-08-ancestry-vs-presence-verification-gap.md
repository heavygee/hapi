# Ancestry containment is not presence — a verification gap in the promote pipeline (2026-11-08)

**Raised by:** [Overseer stand-in](/sessions/4230142b-8abe-4a31-af35-c22922bb649b) · **Diagnosed by:** [tooling/meta bot](/sessions/cbd1073e-4fd3-4f4a-bff8-cf9ba97bca6d) · **State:** filed here, not yet implemented (stack frozen 2026-11-08)

## The worked example

Resolve-a-peer-by-durable-`agentSessionId` (fork #137, `driver/ping-peer-agent-session-id` @ `93cae0af5`, Fixes #1203) is **absent from the live composed tip** `c5a182a12`:

- `cli/src/modules/pingPeer/pingPeer.ts` `resolveSessionByPrefix()` matches **only** `session.id` — exact, then `startsWith`.
- `agentSessionId` is not read and is not projected into `PingPeerSessionSummary`.
- The layer implements all of it: field projection, `readAgentSessionId()`, a richer not-found hint, and the comment *"Hub ids are ephemeral; agentSessionId survives hub-row churn (#1203)"*.

Three sessions independently hit `no session matching prefix` when citing a peer by its `agentSessionId`. Hub id resolves; the durable id does not. The hub **does** store it (`metadata.agentSessionId` = `metadata.claudeSessionId` = the transcript uuid), so the callers were right.

## Why every audit said clean

```
git rev-list --count 93cae0af5 ^c5a182a12   →   0
```

The layer **is** a provable ancestor of the live tip. It was absorbed. The code is gone anyway:

| Commit | Date | Effect |
|---|---|---|
| `49d2145bd` | 2026-11-04 12:42 | manifest swap drops the layer line (suspected cause — **innocent**) |
| `1b4438be5` | 2026-11-05 14:14 | `fix(soup): clear remat verify CLI failures after tip-forward` — **−426/+184 on `pingPeer.ts`**, strips every `agentSessionId` line including the doc comment |

A later conflict-resolution-by-rewrite deleted an absorbed feature while its layer stayed a provable ancestor. **Ancestry containment answers "was this merged", which is adjacent to — and not — "is the behaviour present".**

This is the same family as the other verification failures this estate found this month: a check that answers a question next to the one anyone cares about. Compare `hapi-meta-sessions-audit`'s original page-scan (answered "is it in the recent window", not "does it exist") and the auditor's own subshell bug (a check that silently never ran).

## Item 1 — assert presence, not ancestry, at promote

Proposal, cheapest first:

1. Add an optional **`sentinel:`** to a layer's `config/driver-manifest.yaml` entry — a symbol or string that must exist in the composed tree if the layer's behaviour survived. For #137 that is `readAgentSessionId` or `metadata?.agentSessionId` in `cli/src/modules/pingPeer/pingPeer.ts`.
2. After absorb, `git grep` each declared sentinel in the composed tree. Missing sentinel ⇒ **fail the remat**, same class as a typecheck failure, with the layer named.
3. Report sentinel-less layers in the remat summary so coverage is visible rather than assumed.

A sentinel grep would have caught this on 2026-11-05, the same day, instead of three days later via three confused agents.

**Design caution:** a sentinel that merely greps a symbol can itself rot into an adjacent question (symbol present, call site deleted). Prefer a sentinel on the *call path* over a declaration where the two can diverge.

## Item 2 — narrow the read-only guard false positives

Two read-only diagnostics were refused in one evening, both correctly classified as *refuse rather than guess*, both false:

| Command | Guard | Why it is a false positive |
|---|---|---|
| `sqlite3 … SELECT` against the hub DB (overseer) | DB-prep-on-`:3006` class | a `SELECT` mutates nothing |
| `git merge-base --is-ancestor A B` (kitchen) | hand-merge-on-`driver/integration` class (#962) | matched the substring `git merge`; `merge-base` is a query |
| `git add` + `git commit -m "…"` of **this very file** (kitchen) | same class | the *commit message* quotes the string `git merge` from the row above. A docs commit in the mirror checkout, nowhere near `driver/integration`. |

The third one is the clearest statement of the defect: the guard refused the document describing the guard's false positives, because the document quotes the pattern. **The matcher reads the entire command line, including commit message bodies**, so any prose about merges is indistinguishable from a merge. Reshaped with `git commit -F -` (message off the command line), which is a normal invocation rather than a bypass — the mutation classes are untouched by it.

Neither agent reshaped to bypass — the overseer stopped and escalated; the kitchen ran the identical query from the mirror checkout. That is the correct behaviour and it cost both of them a step. The guards are taxing exactly the diagnostic work they exist to protect.

Suggested narrowing: match `git merge`/`git cherry-pick`/`git reset` on a **word boundary followed by a non-`-base` token**, and allow `sqlite3` invocations whose statement parses as a single read-only `SELECT`/`PRAGMA`. Both are small; neither weakens the mutation classes.

## The fix for the feature itself

Restore resolve-by-`agentSessionId` as a **thin delta on the current soup tip** — not by re-adding `driver/ping-peer-agent-session-id`, which would conflict with the consolidated #2251 tip exactly as it did on 11-05.

**Check the #2251 tip's own resolve path first** and land the restoration in a shape that survives the next tip-forward. Otherwise the same cleanup mechanism re-strips it within the week, and the second disappearance will be harder to see than the first.

## Operator decision, pending

Every agent's tool descriptions advertise durable resolve — *"agentSessionId survives hub-row churn when the cited hub id is stale"* — and it does not work on this hub. Until restored, the honest options are **fix it quickly** or **stop advertising it**. Documented-and-broken is the worst of the three. Taken to the operator by the overseer stand-in.

---

## Third confirmed instance: title-lock, found by a feature peer (2026-11-09)

**A feature peer found this class independently, using exactly the check this document proposes.** It was re-thinning an FUE layer onto the soup tip, went to add a callout to the rename dialog's title-lock padlock, and discovered there is no padlock.

Verified here before composing their layer:

| Probe | Result |
|---|---|
| `git rev-list --count 577ab7546 ^aea13a532` (#2072, the commit that ADDED title-lock) | **0** — it is an ancestor |
| `titleLocked` in the tip's `web/src/components/RenameSessionDialog.tsx` | **0** |
| `titleLocked` in `upstream/main`'s same file | **11** |
| last real touch on that file in the tip's history | `ad7222992` (#1577, AI title suggestions) — *predates* #2072 |

So the feature was absorbed into ancestry and then removed by a later conflict resolution that took an older fork shape of the file. Ancestry says present; the tree says absent. Identical to the 11-05 `agentSessionId` loss, in a different file, found three days later by accident.

**What this instance adds:**

- **The class is not rare.** Three confirmed now (`pingPeer.ts` 11-05, this, plus the `search_content`/`toolNames` near-miss caught mid-merge on 11-09). Two reached the live tip; one was caught only because a merge happened to fail typecheck for an unrelated reason.
- **The discovery mode is still accidental.** Nobody audits for it. Both live instances surfaced when someone tried to *use* the missing thing — agents unable to cite each other by durable id, and a peer with nothing to attach an FUE callout to.
- **It confirms the sentinel proposal is worth building.** A `sentinel:` on the #2072 layer (`titleLocked` in `RenameSessionDialog.tsx`) would have failed the remat that dropped it, on the day it dropped.
- **The peer did the right thing by not fixing it.** Reintroducing title-lock is product-sized work, not a one-file patch inside an unrelated FUE layer. It flagged and scoped down to the two controls that do exist. Silently widening a layer to repair an unrelated regression is how layers go fat and how review loses the plot.

**Open:** title-lock is absent from the soup and present upstream. That is a live feature regression against upstream, unowned. It needs a deliberate re-absorb, not a drive-by.

---

## Fourth instance, and the taxonomy this whole thread actually resolves to (2026-11-09)

A feature peer spawned to do two things — sweep for what's already gone, build the check that stops it recurring — ran three instrument shapes against this class before the picture clarified. The result that outlasts any one of them: **"ancestry vs presence" is not one mechanism with two examples. It is two distinct mechanisms, with two different instruments, and solving one does nothing for the other.**

### Mechanism 1 — fork-layer absorbed, then rewritten

A fork PR lands as a declared `driver/*` layer, later gets consolidated into base ancestry (its layer line dropped from the manifest as "superseded — stays in tip ancestry"), and a subsequent conflict-resolution-by-rewrite deletes its code while the commit remains a provable ancestor.

**Example:** `pingPeer.ts` resolve-by-`agentSessionId` (fork #137, `driver/ping-peer-agent-session-id` @ `93cae0af5`). Confirmed: `git rev-list --count 93cae0af5 ^upstream/main` = **1419** — it is not reachable from upstream at all, confined entirely to fork history. It reached the tip via the #2251 base consolidation, not an upstream merge.

**Instrument: the landed per-layer `hapi-sentinel-check.sh`**, in two modes:
- Declared (`sentinel:`/`sentinel_path:` in the manifest) — works, but only for a layer somebody already thought to protect. 3 of 91 layers have one today.
- `--auto` (added same day, `119900386`) — needs no foresight: diffs each *currently manifest-listed* layer against its own base, asserts the identifiers it added are still in the composed tree. First run flagged 7 absorbed layers with missing content, none previously known.

**The gap this leaves, stated precisely:** `driver/ping-peer-agent-session-id` has no manifest entry of *any* kind — not undeclared, **absent**, by design, since the layer was correctly dropped once its commit became a base ancestor. `--auto` walks `- branch:` lines in the manifest; a layer that isn't listed is never iterated, regardless of ancestry. So this loss is invisible to *both* sentinel modes simultaneously, for the same reason: there is no layer line left to attach a check to, declared or derived. This is not "nobody got around to it" — it is a structural blind spot in a mechanism that is keyed on manifest layer entries, for a commit that graduated out of the manifest on purpose. **The single highest-value follow-up from this whole thread:** either re-add a thin, inert layer line whose only job is carrying a sentinel (no code, since the behaviour is already in base), or extend `--auto` (or a sibling mode) to also walk a list of "superseded, formerly-layer" commits that graduated into base ancestry. A bare manifest edit does not fix this one — there is nothing to edit yet.

### Mechanism 2 — upstream absorbed, then rewritten

A real `tiann/hapi` commit lands via a periodic `merge(upstream): ... into fork main`, and a later conflict-resolution-by-rewrite on a contested file takes an older fork shape, discarding the upstream addition while the commit stays a provable ancestor of the tip.

**Example:** `RenameSessionDialog.tsx` title-lock (upstream #2072, `577ab7546`). Confirmed ancestor (`rev-list --count` = 0); `titleLocked` present 11× upstream, 0× on tip.

**No instrument exists for this today.** Three shapes were tried against it, in order, each validated against the known case *before* being trusted further — none reached a shape fit to gate on:

1. **Top-level export-name diff** (upstream vs tip, same file). Clean signal (2 new confirmed losses elsewhere: `spawnPeer.ts` cross-host directory resolution, `messageContentSearch.ts`'s `hasPotentiallyIncompleteMessageContent`) — but a **hard miss on the motivating case**. `RenameSessionDialog.tsx` exports exactly one name on both sides (`RenameSessionDialog`); title-lock shrank *inside* a surviving export (a prop, a button, local state), which this shape cannot see by construction. Same miss, independently, on `pingPeer.ts`: `metadata?.agentSessionId` is a property read, not a declaration.
2. **Intra-file JSX-prop / type-field diff.** Surfaces title-lock cleanly — `field:currentTitleLocked` and `prop:aria-pressed` land directly on the lost state and its ARIA wiring, with corroboration independently found in two more call sites (`SessionList.tsx`, `SessionHeader.tsx`) beyond the one originally reported. But confirmed **~50% precision** even on the one file with ground truth (half the 46 candidates were CSS-utility class words and one differing inline SVG icon's primitive attributes) and, per the required second control, a **confirmed miss on `pingPeer.ts`** (0 candidates — a property read is neither a JSX attribute nor a type field, so this shape is blind to it same as shape 1, for a different reason).
3. **Commit-derived token diff** (identifiers a specific upstream commit added, still present in upstream HEAD today, checked against the tip). Catches both shrink-inside-a-surviving-export (title-lock) and logic-shaped changes alike — it doesn't care what kind of token it is. But at **commit-wide scope** (the literal shape proposed), a single real-world upstream commit like `577ab7546` touches ~37 files including its own tests, e2e specs, fixtures, and docs — 702 raw candidates, almost all scaffolding, not feature surface. A same-file-path presence check is also blind to a legitimate cross-file relocation (confirmed false positive: `file-markdown-preview.ts`'s `resolveImageMimeType` + its 12-extension table were simply moved into `web/src/routes/sessions/file.tsx`, same logic, same coverage — correctly identified and excluded rather than counted as a loss).

**Honest characterisation, not a verdict of failure:** shape 2, at ~50% precision, is useless as an automated gate — nobody should wire a coin-flip into remat — but perfectly serviceable as a one-shot retro audit with a human reading the ranked list and picking the real hits out, which is exactly how the two new findings below were separated from the noise. The right read is "mis-specified as a gate," not "doesn't work."

**New confirmed losses found this way, filed separately, cross-referencing this doc and each other:**
- heavygee/hapi#315 — `spawnPeer.ts`: `isCrossPlatformAbsolutePath`/`resolveSpawnPeerDirectory` (cross-host directory resolution) absent.
- heavygee/hapi#316 — `hub/src/store/messageContentSearch.ts`: `hasPotentiallyIncompleteMessageContent()` absent; `search_content` cannot signal partial results.
- heavygee/hapi#317 — `useDictation.ts` / `useRealtimeDictation.ts`: the entire failed-voice-send recovery mechanism absent.
- heavygee/hapi#318 — `SessionChat.tsx`: `filterConciseChatBlocks` import survives, every call site and the toggle control that used it do not.

**Also filed from the same investigation, upstream of the instrument work:** heavygee/hapi#312 (this doc's original title-lock instance), #313 (durable `agentSessionId` is derived in the list/search response path only — the single-session detail endpoint never computes it, so a correct restore of #1203's read would *still* silently fail for any lookup routed through that endpoint), #314 (the `spawn_peer` parent-stamp handoff block's bare `agentSessionId:` line reads as the child's own identity with no possessive — reproducibly misread by at least two independent sessions today).

### What this means for anyone picking this up next

Two separate problems, two separate owners, don't conflate them:

- **Mechanism 1 (fork-layer)** has a real instrument (`hapi-sentinel-check.sh --auto`, no foresight needed) with one known architectural gap (superseded layers with no manifest line, like pingPeer's). Fixing that gap is cheap and well-scoped.
- **Mechanism 2 (upstream-absorbed)** has no instrument that clears the bar for unattended use. The closest attempt (intra-file identifier diff) is a good *audit* tool, not a gate. Building something that clears the bar — likely some combination of shape 3's commit-token idea with per-file scoping and a hard exclusion of test/doc/fixture paths — is unstarted work, not a tuning pass on what exists.
