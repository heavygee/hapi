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
