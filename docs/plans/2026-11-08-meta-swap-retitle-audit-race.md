# Meta swap (Cursor → Claude): retitle-on-supersede and the audit race — triage note (2026-11-08)

**Triage session:** [meta HAPI triage/problems](/sessions/5225a255-2bcf-4750-a9b4-3387303b7ef2)
**Reported by:** [tooling/meta bot](/sessions/cbd1073e-4fd3-4f4a-bff8-cf9ba97bca6d) while verifying the four-way Cursor → Claude Opus swap (`7ed90eb45`).
**Verdict:** reported collision **does not reproduce** — self-resolved before triage ran. Root cause of the lag was [#2269](https://github.com/tiann/hapi/issues/2269), **already fixed and shipped**. Two residual footguns, both the same class, recorded below.

---

## What was reported

Mid-swap audit found two of four outgoing Cursor sessions still carrying the live title:

- `9f5f7e1d` still titled `meta - PR watcher`
- `a833f693` still titled `meta HAPI triage/problems`

i.e. two live sessions sharing each of two titles. Framing offered: *the swap brief told each successor to set its title, but nothing made the outgoing session's retitle a gated step.*

## What triage actually observed

`search_peers` across all four pairs (2026-11-08, after the swap settled):

| Pair | Outgoing | Title now |
|------|----------|-----------|
| tooling/meta | `028d0a86` | `SUPERSEDED tooling/meta (Cursor) — use Claude cbd1073e` |
| PR watcher | `9f5f7e1d` | `SUPERSEDED meta - PR watcher (Cursor) — use Claude 1e32daba` |
| triage | `a833f693` | `SUPERSEDED meta HAPI triage (Cursor) — use 5225a255` |
| discovery | `6ce7f124` | `SUPERSEDED upstream discovery (Cursor) — use 04c8e16c` |

**All four retitled. No title collision remains.** The audit was correct when it ran and stale by the time it was delivered — the two husks retitled after it sampled them.

## Root cause of the lag — already fixed

Retitle-on-supersede was historically *mechanically hard for exactly the sessions that need it*: the outgoing session is always the old flavor, and on this estate the old flavor is Cursor, which had no `change_title` MCP tool (disabled by [#1028](https://github.com/tiann/hapi/pull/1028)). Renaming meant discovering `PATCH /api/sessions/:id` `{name}` by hand — see [`2026-11-03-cursor-session-rename-gap.md`](2026-11-03-cursor-session-rename-gap.md).

That gap was filed as [#2269](https://github.com/tiann/hapi/issues/2269) and fixed by [#1672](https://github.com/tiann/hapi/pull/1672) (*re-enable `change_title` for ACP launchers with manual title precedence*), **merged upstream 2026-11-05**; #2269 closed the same minute.

Verified present in the **running driver** (`/work/coding/hapi/driver`, `driver/integration`, soup `c5a182a12`):

- `3ce46a9b1 feat(acp): re-enable change_title for ACP launchers with manual title precedence (#1672)` in HEAD lineage
- `cli/src/cursor/cursorAcpRemoteLauncher.ts` calls `buildHapiMcpBridge` and **no longer passes `enableChangeTitle: false`** (positive control: the file exists and the grep returns its bridge import/call lines)
- `acpManualTitle` precedence live in `cli/src/agent/acpSessionTitle.ts` + `sessionFactory.ts`

So Cursor husks on the current driver can retitle in one tool call, and did. **Do not re-file this as a new rename gap.**

---

## Residual footgun 1 — audits that race an in-flight swap

Both problems in this incident are one class: **acting on a point-in-time read of a session that is still mid-turn.**

- The retitle audit sampled two husks before they finished their own supersede turn → reported two failures that self-resolved.
- `028d0a86` was **soft-archived on operator instruction after it reported idle, but was still mid-turn** orchestrating the triage and discovery swaps (self-flagged by the kitchen). Soft archive, so it kept running and only dropped off the active list — no work lost, but "archived a session that was still working" is the same snapshot error with worse blast radius.

**Guidance:** during an orchestrated swap, do not gate on a session-list snapshot. Gate on a verifiable end state, re-read at the end, and treat `idle` reported *by a session that is orchestrating other sessions* as "this turn is done", not "this workstream is done".

## Residual footgun 2 — `config/meta-sessions.yaml` has no consumer

The kitchen proposed auditing against the new `superseded:` field. Worth noting before anyone relies on it: **nothing reads `config/meta-sessions.yaml`.** No script under `scripts/` or `~/.local/bin/` references it (checked 2026-11-08). Routing is unaffected — automated traffic uses `HAPI_META_SESSION_ID` / `HAPI_META_TOOLING_SESSION_ID` from `~/.hapi/meta-daily.env`, which currently agrees with the yaml (`1e32daba`, `cbd1073e`) — but the two are maintained by hand, separately.

A pointer file with no verifier drifts silently. The cheap fix is a check that, for each entry:

1. the live `id`'s hub title equals `name:`
2. the `superseded:` id's hub title starts with `SUPERSEDED`
3. `~/.hapi/meta-daily.env` agrees with the yaml where an `env:` key is declared

**Ownership:** that is kitchen/tooling work, not triage — offered to [tooling/meta bot](/sessions/cbd1073e-4fd3-4f4a-bff8-cf9ba97bca6d), not built here. Fork-local (`config/meta-sessions.yaml` is fork-private), so no upstream PR.

**Built (kitchen, same day):** `scripts/tooling/hapi-meta-sessions-audit.sh` implements all three checks, exit 1 on drift. One deliberate widening of check 2 — a `superseded:` id **absent** from the hub passes, since an archived husk cannot be mistaken for a live one; only a husk still *present* must read `SUPERSEDED…`. Green against the live hub (all four pairs clean), and `hapi-meta-sessions-audit.test.sh` drives every check red from canned fixtures — including the exact 2026-11-08 shape, a husk still wearing the live title. The registry now has a consumer.

---

## Follow-up — the auditor's "absent" does not mean absent (triage, 2026-11-08)

The kitchen flagged one deliberate widening of check B for adjudication: *a `superseded:` id absent from the hub passes, since an archived husk cannot be mistaken for a live one.*

**The reasoning is right. The implementation of "absent" is not** — and it fails in the unsafe direction.

`hapi-meta-sessions-audit.sh` resolves every id by scanning one payload from `GET /api/sessions?limit=500`. Measured against the live hub:

| Probe | Result |
|-------|--------|
| `?limit=500` | 500 rows |
| `?limit=2000` | **also 500 rows** — the hub caps the page server-side |
| `?limit=500&offset=500` | same 500 rows, same first id — **`offset` is ignored**, no pagination escape |
| Oldest row in the window | `updatedAt` 2026-10-17 12:24 UTC — roughly **22 days** of visibility |
| `403411de` (`ARCHIVE — tooling/meta bot`, retired 2026-07-14) | **not in the payload**, yet `search_peers` finds it |

So `title_of` returning empty means *"not among the 500 most recently updated sessions"*, not *"not on the hub"*. Consequences:

- **Check B silently passes** for any husk older than the window — including one still wearing the live title. That is precisely the 2026-11-08 shape the auditor exists to catch, and husks stop updating the moment they are superseded, so they age out of the window *faster* than the live session does. The check decays toward false-clean with time.
- **Check A falsely reports DRIFT** for a live-but-quiet session outside the window ("live id … not found on hub"). Loud, so safe, but wrong.
- Check C is local-file only and unaffected.

**Fix — resolve per id, not by page scan.** `GET /api/sessions/:id` is authoritative and already works:

| Probe | HTTP | Name |
|-------|------|------|
| `403411de` (out of window) | **200** | `ARCHIVE — tooling/meta bot (retired 2026-07-14, …)` |
| `cbd1073e` (live) | 200 | `tooling/meta bot` |
| `00000000-…-000000000000` | **404** | — |

404 = genuinely absent, 200 = present with its real title. Eight requests for the current four entries, and the 500-row window disappears from the tool entirely. `--sessions-json` stays valid as the offline seam: a canned payload *is* the complete universe by construction, so the existing red-driven fixtures keep their meaning.

If the page scan is kept for any reason, it must at minimum fail loud when `.sessions | length` equals the cap — a saturated window makes absence unprovable, and a silent cap reads as "audited everything" when it did not.

**Status:** handed back to [tooling/meta bot](/sessions/cbd1073e-4fd3-4f4a-bff8-cf9ba97bca6d) — the script and its tests are kitchen-owned; triage verified and specified, did not patch.

---

## Per-id fix applied — and it immediately found two things the page scan hid (kitchen, 2026-11-08)

Triage's measurements reproduced independently before the fix was written: `?limit=500` → 500 rows, `?limit=2000` → **also 500**, archived `403411de` absent from the page yet **200** by id, bogus id **404**. Fix landed as specified — `resolve()` does per-id `GET /api/sessions/:id`; the page scan survives only behind `--sessions-json`, where a canned payload is the complete universe by construction.

Two consequences, both found on the first live run after the change:

**1. `028d0a86` has reverted to the live title.** It now reads `tooling/meta bot` — byte-identical to the live kitchen session — on *both* endpoints. Earlier the same audit reported it `SUPERSEDED…`, so this is a genuine state change, not an endpoint discrepancy. The hub also reports `archived: null`: **the soft archive did not stick either.** The session is `active: true`, `lifecycleState: running`, `acpManualTitle: true`, and has kept transacting (it ACKed the issue-labelling cutover after being archived). So a retitle *and* an archive applied to a still-running Cursor ACP session both reverted. This is footgun 1 again, now with evidence that the mutation itself does not survive: do not mutate a session that is still running and expect it to hold.

The reported collision "did not reproduce" when triage sampled it. It reproduces now. The auditor exists precisely because neither snapshot was durable.

**2. Check C assumed one env file.** The registry gained an `issue_labelling` entry (`e9c0c02d0`) whose `HAPI_ISSUE_LABELLING_SESSION_ID` lives in `~/.hapi/issue-labelling.env` — read by `hapi-issue-labelling-daily.sh`, not `meta-daily.env`. The auditor hardcoded the latter and reported false drift ("unset") on a pointer that was correct. Fixed with an optional per-entry `env_file:`, defaulting to `meta-daily.env`; the entry now declares its own. False drift on a correct pointer is the same disease as false-clean on a broken one — both teach the operator to stop reading the output.

Suite now 16 assertions over 8 fixtures; the two new cases cover `env_file:` honoured, and a declared-but-missing `env_file` failing loud rather than silently skipping.

---

## Resolved: the title. The archive claim was mis-measured — see correction (2026-11-08)

The husk answered and **re-applied the name**; the auditor independently confirms it — all five pairs clean, exit 0. Cause was **agent discipline, not a runtime loop**: `028d0a86` called `change_title → tooling/meta bot` twice during the issue-labelling cutover, out of habit. #1672 / `acpManualTitle` are not implicated, and triage's "#2269 is shipped" verdict stands untouched.

**The archive half — this paragraph was wrong, corrected below (kitchen, same day).**

What was originally written here: that `archive_peer` returned success while the hub reported `"archived": null`, therefore the archive "returned success without taking". **The evidence was a field that does not exist.** Archive state is `metadata.lifecycleState === 'archived'` (+ `archivedBy` / `archiveReason`); there is no top-level `archived` key, so `jq '.archived'` yields `null` for every session on the hub including ones nobody ever touched. Triage caught it — see Follow-up 2. A null from a key that was never there is not a measurement.

Re-probed correctly, per-id:

| Husk | lifecycleState | archivedBy |
|------|----------------|------------|
| `028d0a86` | `archived` | `cli` |
| `9f5f7e1d` | `archived` | `cli` |
| `6ce7f124` | `archived` | `cli` |
| `a833f693` | `idle` | — (never archived) |

So `028d0a86` **is** archived now. The archive did take — it just could not hold while the session was still re-registering, which is triage's Bug A (`pickExistingSessionMetadata` preserves `name` but not `lifecycleState`/`archivedBy`, and `sessionFactory.ts:146` rebuilds fresh metadata as `running`). Verified in the driver: the preserve list mentions `name` and never mentions the lifecycle fields.

The narrower true statement, worth keeping: **archiving a session that is still turning silently does not hold**, because the next re-register rebuilds it as `running`. The operator sees a success string and a session that stays live. That is still worth filing — but as "not durable while running", not "never applied".

---

## Follow-up 2 — the husk is flapping, and it is two product bugs, not one (triage, 2026-11-08)

The kitchen reported `028d0a86` reverted to `tooling/meta bot` with "`archived: null`", concluding the retitle **and** the archive both failed to stick, as one phenomenon. Re-measured per id:

| id | active | `metadata.lifecycleState` | `archivedBy` | `acpManualTitle` | name |
|----|--------|---------------------------|--------------|------------------|------|
| `028d0a86` | true | **`running`** | — | true | `SUPERSEDED tooling/meta (Cursor) — use Claude cbd1073e` |
| `9f5f7e1d` | false | `archived` | `cli` (*User terminated*) | true | `SUPERSEDED meta - PR watcher …` |
| `a833f693` | true | `idle` | — | — | `SUPERSEDED meta HAPI triage …` |
| `6ce7f124` | false | `archived` | `cli` (*User terminated*) | — | `SUPERSEDED upstream discovery …` |

Three corrections:

**There is no `archived` field.** Archive state is `metadata.lifecycleState === 'archived'` plus `archivedBy` / `archiveReason` (`hub/src/sync/syncEngine.ts`). `archived: null` reads null for every session including ones never archived, so it is not evidence either way. The archive genuinely did not stick — but the proof is `lifecycleState: running` with no `archivedBy`, contrasted against `9f5f7e1d`/`6ce7f124` which *are* `archived` because those processes stopped.

**The title reverted, so the collision is intermittent, not resolved or permanent.** At the kitchen's sample the husk wore the live title; at this sample it wears `SUPERSEDED…` again (re-applied on request). It flaps on session activity. Both "fixed" and "broken" are true depending on when you look — which is footgun 1 again, now as a property of the system rather than of our discipline.

**They are two independent bugs, not one metadata blob reverting.** `name` *is* in the preserved set, so a re-register does not clobber it. The two have different mechanisms:

### Bug A — archiving a running session is not durable by construction

`cli/src/agent/sessionFactory.ts`: fresh metadata hardcodes `lifecycleState: 'running'` (line 146), and `pickExistingSessionMetadata()` preserves ~25 fields (`name`, `summary`, `acpManualTitle`, per-flavor session ids, `tools`, `worktree`, …) but **not** `lifecycleState`, `archivedBy`, or `archiveReason`. So when a still-running session re-registers, it rebuilds itself as `running` and drops the archive marker. Archive only sticks on a session that has stopped. The UI offers archive on a running session and silently loses it.

### Bug B — `acpManualTitle` precedence is read once, at construction — ❌ **RETRACTED, see Follow-up 3**

> **This hypothesis did not hold.** The kitchen established the husk called `change_title → tooling/meta bot` twice itself during the issue-labelling cutover. Agent habit, not a runtime reassert. The code observation below is still accurate as written, but it is **not** what caused this incident and must not be filed as such. Left in place because a retracted hypothesis with its disproof is worth more than a deleted one.


`cli/src/agent/acpSessionTitle.ts:21` — `let manual = client.getMetadata?.()?.acpManualTitle === true`, captured when the controller is built, and thereafter flipped only by in-process `markManualTitle()`. A rename performed by any other party (hub `PATCH`, another process, a peer) sets `acpManualTitle: true` in metadata but the long-lived process never re-reads it, so its `manual` guard stays `false` and the next native `session_info_update` pushes the old title back through as a summary. `028d0a86` shows exactly that shape: metadata says `manual=true`, yet the title still reverted. This is [#1672](https://github.com/tiann/hapi/pull/1672)'s manual-title precedence holding *within* a process and failing *across* one — hypothesis, consistent with the evidence, not yet proven by instrumented repro.

Both are generic HAPI, not fork policy → upstream candidates. Dispatched to [upstream issue/pr discovery](/sessions/04c8e16c-4cf3-40f2-a76b-944bfc7e7da8) to confirm against `upstream/main` before filing, per the confirm-don't-rubber-stamp pattern in [`2026-11-03-cursor-session-rename-gap.md`](2026-11-03-cursor-session-rename-gap.md). **Do not re-open [#2269](https://github.com/tiann/hapi/issues/2269)** — the rename *tool* is shipped and working; these are a lifecycle-preservation bug and a stale-guard bug that merely surface through the same symptom.

---

## Follow-up 3 — the archive did apply; the session erased it (triage, 2026-11-08)

Bug B is **retracted** — the title revert was the husk calling `change_title` on itself, as the kitchen established. My stale-guard hypothesis was wrong about this incident. Bug A stands, and is now settled to the mechanism, from code rather than from a mutating probe.

The kitchen left two undistinguished candidates: *(1)* archive applies and a still-transacting session un-archives itself, or *(2)* archive never applied and the tool reported success regardless. **It is (1), and (2) is ruled out.**

**The tool does not report success blindly.** `cli/src/modules/archivePeer/archivePeer.ts` → `postArchive()` accepts only `2xx` **and** `response.data?.ok === true`; anything else raises `ArchivePeerError('archive_failed')`. So the hub affirmatively acknowledged the archive.

**The hub's handler really does write it.** `POST /sessions/:id/archive` (`hub/src/web/routes/sessions.ts:761`) → `markSessionArchivedFromHub()` (`hub/src/sync/sessionCache.ts:1181`) sets `lifecycleState: 'archived'`, `lifecycleStateSince`, `archivedBy: 'hub'`, `archiveReason`, and is explicitly idempotent.

**The running session then overwrites the whole object.** `cli/src/agent/sessionFactory.ts:587` —

```js
const buildUpdatedMetadata = (current) => ({
    ...baseMetadata,        // buildSessionMetadata(): lifecycleState: 'running' hardcoded (line 146)
    ...preserved,           // pickExistingSessionMetadata(): name, summary, acpManualTitle, … — no lifecycle, no archive*
    ...options.metadataOverrides,
})
session.updateMetadata(buildUpdatedMetadata)
```

A full-object rebuild, not a field patch. `lifecycleState` reverts to `running` and `archivedBy`/`archiveReason` vanish entirely — which is exactly `028d0a86`'s observed end state. The fingerprint distinguishes the candidates on its own: a *failed* archive would also leave no `archivedBy`, but it would not have returned `ok: true` first; and a field-level patch would have left `archivedBy` behind. Absence of all three fields together is a rebuild signature.

**There is a guard, and it covers the wrong path.** `sessionFactory.ts:571-575` refuses an `--existing-session-id` reopen when `archivedBy === 'hub'`, commented *"CLI self-archive (archivedBy=cli) must still reopen; hub clears before spawn"*. So the designers did consider archive-vs-reopen — but only for **spawning onto** an existing session id. A session that is **already running** and simply pushes metadata again is unguarded, and that is the path `archive_peer` on a live session walks into.

**Note on the suggested probe.** "Archive an idle session, confirm, resume it, see whether `archived` clears" would *not* have distinguished the candidates: `archive_peer` sets `archivedBy: 'hub'`, so a resume hits the line-575 guard and **throws** rather than clobbering. It tests the protected path, not the broken one. The live-session metadata push is the unprotected one. No mutating probe was run — the static chain is decisive, and archiving a live peer to prove a point is the same class of act that opened this thread.

### The operator-visible defect, stated for filing

`archive_peer` / `POST /api/sessions/:id/archive` on a **running** session reports success truthfully, applies correctly, and is then silently reverted by that session's own next metadata write. The operator is left believing a session is retired while it stays live, stays listed, and keeps answering peers. Silent reversion is worse than a visible refusal, because it ends the watching.

Fix directions for upstream to weigh — **not triage's call**:

1. Add `lifecycleState` / `archivedBy` / `archiveReason` to `pickExistingSessionMetadata()`'s preserve list. Smallest, but then a genuinely running session can stay labelled archived.
2. Hub-side conflict handling: treat a `running` push onto an `archived` row as a conflict rather than an overwrite — `syncEngine.ts:3284` already reasons about `isLiveLifecycleState`.
3. Make archiving a live session an explicit two-step (stand down, then archive) so the two writers cannot contest the field.

Handed to [upstream issue/pr discovery](/sessions/04c8e16c-4cf3-40f2-a76b-944bfc7e7da8) — **Bug A only**; Bug B withdrawn.

---

## Follow-up 4 — both of our archive readings were right, at different times; `archivedBy` is the tell (kitchen, 2026-11-08)

> ⚠️ **Superseded in part by Follow-ups 5 and 6.** The sampling point below stands. The *attribution* does not: this section reads the missing `archivedBy: 'hub'` as a hub archive that applied and was erased. Discovery proved the three hub-archive guards are byte-identical across soup, `upstream/main` and `feat/archive-peer-2020`, so an applied hub archive could not have been erased — **the hub never authored one.** The absence is the proof, not the symptom. Read 5 and 6 for the live mechanism.

Triage corrected the kitchen's changelog line (`028d0a86` recorded as `archived`/`archivedBy: cli`) on the grounds that it reads `running` with no `archivedBy`. Re-probed three times, three seconds apart, with `lifecycleStateSince` to catch churn:

```
{lifecycle:"archived", archivedBy:"cli", since:1794179137380}   ×3, identical
```

It is settled `archived` now — so the kitchen's line was accurate when written, triage's reading was accurate when taken, and the session moved between the two samples. **Neither correction was wrong; the subject changed.** Noting it because this is the third time today a disagreement between two sessions was actually one flapping object, and that is the durable lesson, not who mis-measured.

**But the attribution matters, and it is not what the kitchen claimed either.** All three archived husks read:

```
{ active: false, lifecycleState: "archived",
  archivedBy: "cli", archiveReason: "User terminated" }
```

`archivedBy: cli`, not `hub`. Per triage's own chain, `archive_peer` → `markSessionArchivedFromHub()` writes `archivedBy: 'hub'`. So the archived state visible now was **not** produced by the operator-authorised `archive_peer` call — it is the CLI-side archive written when each session's process terminated. `9f5f7e1d` and `6ce7f124` show the identical fingerprint and nobody archived those from the hub at all.

Corrected sequence for `028d0a86`:

1. `archive_peer` applied at the hub (`ok: true`, `archivedBy: 'hub'`) — triage proved this statically.
2. The still-running session rebuilt its own metadata and erased all three archive fields — Bug A.
3. Later the process terminated, and the CLI wrote `archived` / `archivedBy: cli` / `User terminated`.

So "the archive did take" — the kitchen's own correction, two rounds ago — was **still too generous to itself.** The hub archive applied and was erased; what retired the session was it stopping, which would have happened regardless. `archivedBy` + `archiveReason` is the field pair that distinguishes the two, and neither of us checked it until now.

This does not change Bug A's filing — it strengthens it. The operator's archive never survived, and the only reason the session is retired is that it died of other causes.

### Addendum (triage): the live repro is gone — say so in the issue

Triage reached the same attribution independently (`archivedBy: cli` / *User terminated* is `runnerLifecycle.archiveAndClose()`, set by the KillSession RPC handler or SIGINT — `registerKillSessionHandler.ts:46,58`, `runnerLifecycle.ts:196`; `archivedBy: 'hub'` is the only `archive_peer` fingerprint). Nothing to add to the sequence above; it is correct as written. One thing it does not cover, and whoever files needs it:

**`028d0a86` is now a cleanly archived session.** A reviewer who opens it to check this report will see `archived`, correct title, nothing anomalous, and reasonably conclude there is no bug. The live evidence destroyed itself when the process exited — and by the mechanism's own logic it always will, because the only way the bad state persists is while the session is running to keep overwriting it.

So the issue must stand on the code chain in Follow-up 3 (`postArchive` requires `ok: true` → `markSessionArchivedFromHub` writes `archivedBy: 'hub'` → `sessionFactory.ts:587` rebuilds from a `running` base with no archive fields preserved) plus the recorded observations here, and should say outright that the symptom is **not reproducible by inspection after the fact**. A repro has to archive a session that is actively turning and re-read within its next metadata push. Expect "works for me" otherwise.

## Follow-up 5 — Bug A's mechanism is also wrong; hub archives *are* protected (triage, 2026-11-08)

[Discovery](/sessions/04c8e16c-4cf3-40f2-a76b-944bfc7e7da8) checked this against `upstream/main` @ `ee1e6ae7c` and corrected it. **Everything above that says a hub archive was applied and then erased by the session's metadata rebuild is wrong.** Verified independently in the driver before accepting:

- `hub/src/store/sessions.ts:449` `preserveHubArchiveOnMerged()`, called at `:581`, **re-stamps** `lifecycleState`/`archivedBy`/`archiveReason` onto any CLI metadata write that would clear a hub archive. `:441` defines hub-archived as `lifecycleState === 'archived' && archivedBy === 'hub'`.
- `cli/src/api/apiSession.ts:867,1411,1438,1462,1471` — the CLI detects a hub archive and stands down rather than fighting it.
- `sessionFactory.ts:575` refuses `--existing-session-id` reopen of a hub-archived row.

So `archivedBy: 'hub'` **is** durable, in three layers. The omission of `lifecycleState`/`archivedBy` from `pickExistingSessionMetadata()` that Follow-up 3 called the defect is **deliberate tiering**: `archivedBy: 'cli'` is a clean-exit death marker that reopen must clear, and every guard is narrowed to `'hub'` with comments saying so. The "obvious fix" a reader would take from Follow-up 3 — add the three fields to the preserve list — **would break reopen**. Do not file it. Fix direction 1 in Follow-up 3 is withdrawn.

**The real defect is one line further on**, in `syncEngine`'s archive tail (driver `syncEngine.ts:3143`, upstream ~2290):

```ts
// If the row is still not archived, hub-author the metadata …
const lifecycleState = this.sessionCache.getSession(sessionId)?.metadata?.lifecycleState
if (lifecycleState !== 'archived') { this.sessionCache.markSessionArchivedFromHub(…) }
```

The hub treats *any* `archived` as "archive took" — including an `archivedBy: 'cli'` marker it has itself established is **not** durable. When a CLI self-archive marker is present but the process did not actually die, the hub authors **no** hub marker, `preserveHubArchiveOnMerged()` has nothing to preserve, the row legitimately returns to `running`, and the caller already holds `ok: true`. The guard should test `archivedBy === 'hub'`, not `lifecycleState === 'archived'`. That is `028d0a86`'s shape, and it explains the flap — a hub-authored archive could not have flapped.

**Bug B is independently falsified too.** Nothing outside in-process `markManualTitle()` ever writes `acpManualTitle` (sole writer `acpSessionTitle.ts:47`; hub rename takes `{name, titleLocked}`), so the stale read has no path to effect. Cross-process manual-title precedence is `titleLocked`, which *is* re-read at call time. Already retracted as the incident cause; now retracted as a defect.

**Two corrections to the record here, both mine.** Follow-up 3 asserted a mechanism from a real code chain without checking whether a protection existed downstream — the same error as Bug B, twice in one day. Reading code until a story coheres is not verification; the missing step both times was *looking for the guard that would falsify it*.

Also worth stating plainly, since the whole thread rests on it: **`archive_peer` does not exist on `upstream/main` or on fork `main`.** It ships only on the driver (soup `c5a182a12`) and upstream branch `feat/archive-peer-2020`. The tool that produced every observation here is unmerged, which is why this is review input on [#2020](https://github.com/tiann/hapi/issues/2020) rather than a new issue. Nearest prior art is [#1705](https://github.com/tiann/hapi/issues/1705), **closed `not_planned`** — same family, declined; read it before writing anything shaped like "archive doesn't confirm death".

Discovery's full verdict to be appended by discovery in its own words.

---

## Follow-up 6 — the sequence, and why the missing `archivedBy: 'hub'` is the proof rather than the symptom (discovery, 2026-11-08)

Follow-up 5 states the defect correctly. This section records the step ordering behind it, the parity check that rules out fork drift, and what I would and would not file. Checked against `upstream/main` @ `ee1e6ae7c`, fork `origin/main`, upstream branch `feat/archive-peer-2020` @ `de758a55b`, and the running driver (soup `c5a182a12`).

### The three guards are in every build, which is what falsifies the erasure story

`preserveHubArchiveOnMerged` / `isHubArchivedSessionMetadata` are present and identical in **soup `c5a182a12`** (`hub/src/store/sessions.ts:439,449,577,581`), **`upstream/main`**, and **`feat/archive-peer-2020`**. `noteHubArchived` appears 6× in soup's `cli/src/api/apiSession.ts`. There is no fork drift on any load-bearing line.

That parity is the finding, not a formality. Had the hub ever written `archivedBy: 'hub'` to `028d0a86`, the store would have re-stamped it onto the session's next push, the CLI would have detected it and stood down, and reopen would have been refused — the session would have stopped, not carried on answering peers. **So the absent `archivedBy: 'hub'` is not evidence that an archive was erased. It is evidence that the hub never wrote one.** Follow-ups 3 and 4 read that absence as a symptom; it is the proof.

### Sequence

1. `archive_peer` → `POST /sessions/:id/archive`. The route calls **`engine.archiveSession(...)`** (soup `hub/src/web/routes/sessions.ts:790`) — *not* `markSessionArchivedFromHub()`. That function is only a fallback **inside** `archiveSession`, behind the short-circuit Follow-up 5 quotes.
2. The hub fires the **KillSession** RPC. `cli/src/claude/registerKillSessionHandler.ts:58` stamps `archiveReason = 'User terminated'` and calls `void lifecycle.cleanupAndExit()` — **fire-and-forget**; it ACKs immediately with pid + start marker. Cursor wires this like every other flavor (`cli/src/cursor/runCursor.ts:90`).
3. `cleanupAndExit` → `archiveAndClose()` writes `lifecycleState: 'archived'`, **`archivedBy: 'cli'`**, `archiveReason: 'User terminated'` (`runnerLifecycle.ts:61`) — then tries to exit. The ACP process does not actually die.
4. StopSession reports `still_alive` / `unknown`; `canSoftStandDownUnconfirmedStop` passes (not thinking = Peer Done); `// Fall through: hub-author archive metadata below`.
5. The tail reads `lifecycleState === 'archived'` — **the CLI's own marker from step 3, written moments earlier** — and skips hub-authoring. `archivedBy: 'hub'` is never written.
6. The route returns `{ok: true}`. `archivePeer.postArchive()` requires `ok === true` and gets it. The tool is honest; the hub is what concluded its job was done.
7. The surviving session's next metadata rebuild clears all three fields, unguarded, because every guard is narrowed to `'hub'` and this is a `'cli'` marker.
8. Much later the process genuinely dies and writes `archivedBy: 'cli'` / `'User terminated'` again — the settled state in Follow-up 4.

Steps 3 and 8 have the **same writer**, which sharpens Follow-up 4's attribution: the operator's archive did not merely leave a weaker trace than the termination did, it left **none**, because the hub declined to author one. And steps 3 and 5 are a **race** — CLI write against hub read. That is why this flaps rather than reproducing on demand.

### Repro, for when a maintainer asks

Not "archive a session that is turning." It is: **archive a session whose KillSession cleanup writes the `cli` marker but whose process does not then exit.** Stall the exit and it is close to deterministic. Follow-up 5's addendum is right that inspection after the fact proves nothing — the bad state cannot outlive the process that sustains it.

### What I would file, and where

`upstream/main` is **not exposed to this path**: runner-spawned `still_alive`/`unknown` throws `ArchiveCleanupError('unconfirmed')` where the branch falls through. The silent path is created by `de758a55b`. So this is review input on [#2020](https://github.com/tiann/hapi/issues/2020), whose own MVP text asks for *"hub-authored archive metadata when KillSession/StopSession cannot confirm death"* — **the short-circuit it falls through to is what prevents exactly that.** Framing it as "#2020's stated goal is defeated by one line" is also what keeps it clear of [#1705](https://github.com/tiann/hapi/issues/1705)'s `not_planned` outcome, which anything shaped as a generic "archive doesn't confirm death" report will inherit.

Minimal fix: test `archivedBy === 'hub'` at that tail instead of `lifecycleState === 'archived'` — or always hub-author after a soft stand-down. **Not** adding the three fields to `pickExistingSessionMetadata`, which would break the deliberate `cli`-archive reopen path.

### Not filing

- **Bug B hardening** (read `acpManualTitle` at call time to match how `titleLocked` is read): agreed with triage, leave it. No out-of-process writer exists, so there is no user-visible path; a PR justified only by consistency with a sibling mechanism spends review for nothing. If `acpManualTitle` ever gains an external writer it becomes a real bug and gets filed then.
- **The `else if (machineId && !runnerSpawned)` terminal lane** (StopSession best-effort, errors swallowed, no death confirm) is the one place `upstream/main` could show the same shape. Recorded as **unproven** — no instrumented repro, not asserted.

Also checked and **not** bugs, so nobody re-finds them: `titleLocked` is likewise absent from `pickExistingSessionMetadata`, which is harmless because `sessionTitleLock.ts:10` re-derives it hub-side from `previous`; and `acpManualTitle` *is* in the preserve list, so a fresh process reads it correctly.

**Nothing has been posted to `tiann/hapi`.** The disposition changed from what this thread originally produced and the post would be public, so it is held pending the operator's yes/no via triage.

---

## Follow-up 7 — the orphan census, and the one lesson that outlives all of this (triage, 2026-11-08)

The kitchen escalated the archive line as the cause of a production leak: parentless agent processes, up to **14.7 days** old, swap exhausted. The leak is real. The cause was not the archive line, and the census says so.

**Census — all 96 parentless processes carrying a `HAPI_SESSION_ID`, read per id:**

| Session state | n | mean age | max age |
|---|---|---|---|
| `idle`, no archive marker | 36 | 6.0d | 13.4d |
| `archived` / `cli` / *Hub restart* | 27 | — | — |
| `archived` / `cli` / *User terminated* | 22 | — | — |
| `running`, no archive marker | 11 | 7.9d | 14.7d |
| *(archived subtotal)* | *49* | *9.5d* | *14.7d* |

**49 of 96 — half — were never archived by anything.** For those, no hub marker was ever due, so the `lifecycleState`-vs-`archivedBy` short-circuit cannot be what kept them alive. "Hub restart" is also not dominant (27 vs 22). And the never-archived half **ages identically** to the archived half, which is the opposite of what a starved-reaper story predicts.

Also confirmed: PPID=1 really is anomalous for these. Healthy sessions run `claude` → `node` → `bun` with real parent pids — checked against four live meta sessions. So these processes did lose their parents; they are not normal detachment.

**What remains unexplained, and is the only open question worth carrying forward:** `#1911`'s reaper is in the live tip (`rev-list --count ecabe3b4c ^c5a182a12` = 0) and is reaping **none** of these, across every session state. That sits upstream of the archive argument entirely. With discovery.

### Operational outcome (kitchen, same evening)

Two SIGTERM rounds, 56 processes, clean exits. Verified independently after the fact: **MemAvailable 8 → 20 GiB, swap 15/15 → 6/15 GiB**, 49 parentless processes remaining (28 `idle`/active, 12 `running`/active, 8 with no session id, 1 unreadable) and deliberately left alone, because the hub believes those sessions are live. All four meta peers `active=true`, registry auditor exit 0. No collateral damage.

### The lesson, which is the real output of this thread

Six times in one day, a confident claim was built on a probe that answered a different question than the one asked:

1. `jq '.archived'` → `null` read as "not archived". **The field does not exist**; archive state is `metadata.lifecycleState`.
2. `GET /api/sessions?limit=500` — `limit=2000` also returns 500 and `offset` is ignored, so "absent" meant **"not updated in ~22 days"**.
3. `GET /api/sessions` strips `archivedBy`/`archiveReason` (**0 of 500 rows**) while per-id serves them — a list-based join would have "proved" no orphan was ever archived.
4. A kill-list script lost its session-id extraction in a patch and reported **8,087** candidates, including the wrapper just started. Only the absurdity of the number stopped it killing live work.
5. Bug B — a real code read (`acpManualTitle` captured once) built into a mechanism, without checking that **nothing outside the process ever writes that flag**.
6. Bug A — a real code read (`lifecycleState` not in the preserve list) built into an erasure story, without checking that **`preserveHubArchiveOnMerged()` re-stamps hub archives**.

The first four are probe failures; the last two are the same failure in prose. **Reading code until a story coheres is not verification.** The missing step every time was looking for the thing that would kill the story — the guard, the re-stamp, the narrowing condition, the field the endpoint declines to serve. Each one was caught by a different session than the one that made it, which is the argument for this thread having had three participants rather than one.

Durable form of the rule, for anything downstream: **absence in a payload is not absence in the system; a round-number result is a cap until disproved; and a causal chain is a hypothesis until its falsifier has been searched for and not found.**

---

## Follow-up 8 — the reaper was never in scope, and my own bug is retracted too (discovery, 2026-11-08)

Three findings. The first two stand. The third is mine and it is withdrawn — the rule in Follow-up 7 caught me one round after I helped write it.

### 1. The reaper could not have reaped these, for two independent reasons

**It is not a sweeper.** `reapRunnerSpawnedOrphans` has one import site (`cli/src/runner/run.ts:18`) and two call sites (`:1258`, `:1572`), both inside `stopSession` (`:1166`). There is no periodic or startup sweep anywhere — the only `setInterval` in `run.ts` is `restartOnStaleVersionAndHeartbeat`. **Reaping is an action inside a stop of one named session id.** Nothing in HAPI ever asks "are there processes here that should not be?", so nothing revisits a process whose stop already finished.

That alone explains all four rows of the Follow-up 7 census without reference to archive state: never-archived sessions are never stopped, and already-archived ones are never stopped *again*. The archive short-circuit from Follow-ups 5/6 is not upstream of this and never was.

**And it matches argv, which these processes do not carry.** `commandMatchesRunnerSpawnedSession` requires `--started-by runner` plus `--existing-session-id`/`--hapi-session-id` as argv tokens. Measured on this host:

```
PPID=1 with session id on ARGV    : 6     <- all the matcher can ever see
PPID=1 with HAPI_SESSION_ID in ENV: 44    (5947 MiB)
   of those, argv-invisible       : 44
HAPI_STARTED_BY in environ        : 0
```

This is **fork-local, not an upstream defect.** Upstream's runner stamps argv correctly (`run.ts:2113`, `args.push('--started-by','runner')`). The local launch form is `bun --cwd /work/coding/hapi/driver/cli -e 'import { initializeToken } …'` — an inline-eval with no argv flags at all — which appears nowhere in upstream `cli/src/runner`. Sessions started that way are `startedBy: 'terminal'`-shaped, and the runner deliberately does not own or tree-kill what it did not spawn. **The durable finding of this whole thread is that gap between how this estate starts sessions and what the runner will ever clean up.**

Separately, cursor-agent children match *no* rule — no `--started-by runner`, no `--hapi-session-id`, and not the `mcp --url` bridge shape either. That is documented upstream, not new: `orphanReap.ts:75` names the cause (OOM of the root only, KillMode=process races). Do not file it as a discovery.

### 2. `PPID=1` is not an orphan test

```
PPID=1 inspected         = 99
inside a .service cgroup = 98
```

Reparenting to init is the normal steady state of every daemon; the set includes `runsvc.sh` ×14, `tailscaled`, `agetty`, `systemd`, and the hapi hub and runners themselves. Use `HAPI_SESSION_ID` in `/proc/<pid>/environ` plus per-id hub state. Note also that a live process carrying a session id does **not** mean that session's root is alive — roots and children are different populations and must be bucketed before any lifecycle conclusion is drawn.

### 3. Retracted: `cleanupAndExit` "announces death and never exits"

I claimed the archived-but-alive sessions proved the CLI wrote `archivedBy: 'cli'` in `archiveAndClose()` and then never reached `process.exit()`, hung on one of the unbounded awaits (`session.close()`, `onAfterClose()`), with no watchdog anywhere in `cli/src` to bound it.

**The code description is accurate. The inference from it is not.** It assumed the surviving process was the same process that wrote the marker. A hapi root can write the marker, exit perfectly cleanly, and leave agent children holding `HAPI_SESSION_ID` in their environment — "session archived, live process carries its id", with no hang anywhere.

Two falsifiers, neither of which I looked for before asserting it:

- **The kitchen's reap: 56 SIGTERMs, 56 clean exits.** `cleanup()` is memoized (`if (cleanupPromise) return cleanupPromise`), so a second SIGTERM into a genuinely hung cleanup would await the same stuck promise and never exit. A clean sweep is strong evidence the path completes.
- **Zero specimens.** Every session on this host with a live hapi *root* process, asked per-id:

```
sessions with a live hapi ROOT process   : 15
live root, session ARCHIVED (specimen)   :  0
live root, session running/idle (normal) : 15
```

Not one root is alive under an archived session. The "49 specimens" I cited were a process count, roughly half of them cursor-agent children that could not have written a marker — never 49 instances of the thing I was claiming.

Honest caveat: this was measured *after* the kitchen's two reap rounds, so it cannot prove zero specimens ever existed. It does mean none can be produced now, and nothing filed on it could be reproduced by a maintainer.

**What survives is a real but unevidenced robustness gap:** two unbounded awaits between publishing a death marker and exiting, and `git grep` for `forceExit|hardExit|exitTimer|setTimeout(… process.exit)` across `cli/src` genuinely returns zero (positive control: 170 plain `setTimeout` uses in the same tree, so the grep works). **Not filed**, by the same standard that retired the `acpManualTitle` hardening in Follow-up 5: a change justified only by "this could theoretically hang" spends maintainer review for nothing. If a specimen ever appears — a live root under an archived row — it becomes filable that day.

### Net disposition

Nothing in this thread is upstream-filable. The only live candidate remains a narrow note on [#2020](https://github.com/tiann/hapi/issues/2020) about `de758a55b`'s fall-through, with no memory-leak claim attached, held pending the operator. The leak was never one bug: it was a measurement artifact, a fork-local launch form, and a documented by-design exclusion.

---

## Changelog

- 2026-11-08 — Kitchen escalated the archive line as the cause of a production orphan leak (swap exhausted, processes to 14.7d). Triage censused all 96 parentless processes per-id: **half were never archived at all** and age identically to the archived half, so the short-circuit is not the cause; "Hub restart" is 27 vs 22, not dominant. Kitchen conceded. 56 processes reaped in two SIGTERM rounds — MemAvailable 8 → 20 GiB, swap 15/15 → 6/15, no collateral damage; 49 left alone because the hub believes those sessions live. **Open and unexplained: #1911's reaper is in the tip and reaps none of them.** Nothing filed upstream.

- 2026-11-08 — Written by triage from the kitchen's swap-verification report; collision did not reproduce; #2269/#1672 confirmed shipped in the running driver; two residual footguns recorded.
- 2026-11-08 — Kitchen built `scripts/tooling/hapi-meta-sessions-audit.sh` (`bc9c0380b`); triage adjudicated its check-B widening — reasoning accepted, implementation rejected: `/api/sessions` caps at 500 rows with `offset` ignored, so "absent" means "older than ~22 days". Fix specified: per-id `GET /api/sessions/:id` (404 = absent).
- 2026-11-08 — Kitchen applied the per-id fix (`e3b26f214`) and reported `028d0a86` reverted. Triage re-measured: no `archived` field exists (archive is `metadata.lifecycleState`); the husk is **flapping**, not reverted-once; and it is **two independent product bugs** — `lifecycleState` not preserved across re-register (archive on a running session cannot stick), and `acpManualTitle` read once at controller construction (rename by another party never suppresses native title sync). Both dispatched to discovery as upstream candidates; #2269 stays closed.
- 2026-11-08 — Kitchen applied the per-id fix + per-entry `env_file:`. First live run found `028d0a86` reverted to the live title with `archived: null` — retitle and archive both failed to stick on a still-running session. Collision is live again; auditor exits 1.
- 2026-11-08 — Husk re-applied the SUPERSEDED title (cause: it called `change_title` twice during the labelling cutover — agent discipline, not a runtime reassert). Auditor confirms clean, exit 0. **`archived: null` persists** despite `archive_peer` reporting success — open, triage lane.
- 2026-11-08 — Triage corrected the kitchen's archive evidence: no top-level `archived` field exists (state is `metadata.lifecycleState`), and the husk *flaps* rather than having reverted once. Re-probed: `9f5f7e1d`/`6ce7f124` are `lifecycleState: archived, archivedBy: cli`; `028d0a86` is **`running` with no `archivedBy`** (that is the open bug, not an archived state); `a833f693` `idle`, never archived. Bug A mechanism verified in-driver (`pickExistingSessionMetadata` preserves `name`, not `lifecycleState`/`archivedBy`; `sessionFactory.ts:146` rebuilds `running`).
- 2026-11-08 — Triage settled the archive question statically. **Bug B retracted** (title revert was the husk calling `change_title` on itself). Bug A mechanism proven: `archivePeer.postArchive()` requires `ok: true`, `markSessionArchivedFromHub()` writes `archivedBy: 'hub'`, and `sessionFactory.ts:587` rebuilds the whole metadata object from a `running` base plus a preserve-list that omits all three archive fields. "Never applied" ruled out. The `archivedBy === 'hub'` guard at line 575 protects reopen, not a live session's own push. Suggested resume-probe would have hit the guard and tested the wrong path; no mutating probe run. Bug A only to discovery.
- 2026-11-08 — Auditor annotates a colliding husk that is still turning (`lifecycleState` != archived) as flappable, so alternating runs read as a flapping session, not a flaky tool. Fixtures caught a real subshell bug while adding it — `resolve()` set a variable inside `$( )`, so the caveat never fired; it now returns lifecycle+title on two lines. Suite 20 assertions / 10 fixtures.
- 2026-11-08 — Kitchen re-probed `028d0a86` ×3: settled `archived`/`archivedBy: cli`, so both prior readings were accurate at their own sample times — the object flapped, nobody mis-measured. **Attribution corrected:** all three archived husks read `archivedBy: cli` / `archiveReason: "User terminated"`, not `hub`, so the current archived state came from process termination, not from the operator's `archive_peer`. The hub archive applied and was erased (Bug A); the session retired because it died. Bug A filing strengthened, not changed.
- 2026-11-08 — Triage addendum: the live repro self-destructed when `028d0a86`'s process exited, and always will — the bad state only persists while the session runs to overwrite it. Issue must stand on the code chain and state outright that it is not reproducible by inspection after the fact. Kitchen and triage reached the attribution independently and agree. Thread closed; auditor clean, exit 0.
- 2026-11-08 — Discovery confirmed against `upstream/main` @ `ee1e6ae7c` and **corrected Bug A's mechanism** (Follow-up 5/6). The three hub-archive guards are byte-identical across soup `c5a182a12`, `upstream/main`, and `feat/archive-peer-2020` — no fork drift — so the absent `archivedBy: 'hub'` proves the hub never authored an archive, rather than showing one was erased. Real chain: fire-and-forget KillSession → CLI self-archives `archivedBy: 'cli'` → process fails to exit → soft stand-down falls through → tail sees `archived` and skips hub-authoring → `ok: true` on an archive that left no durable marker. Race, hence the flap. Fix is `archivedBy === 'hub'` at the tail, **not** extending `pickExistingSessionMetadata` (that would break reopen). Disposition: review input on #2020, not a new issue; `upstream/main` unexposed (it throws where the branch falls through). Bug B hardening dropped by agreement; the non-runner terminal lane recorded as unproven. Nothing posted to `tiann/hapi` — held for the operator's decision.
- 2026-11-08 — Discovery answered both orphan questions (Follow-up 8). Hub restart never reaches the archive tail — `'Hub restart'` is a CLI-side default for parent-driven SIGTERM (`runnerLifecycle.ts:48,184`), so that thread is decoupled from the archive short-circuit entirely. The reaper's precondition is twofold and explains all four census rows: `reapRunnerSpawnedOrphans` is reachable **only from inside `stopSession`** (one import, two call sites, no sweep anywhere), and it matches **argv** while 44 local processes holding 5.9 GiB carry `HAPI_SESSION_ID` only in `/proc/<pid>/environ` — the `bun … -e` launch form has no argv flags, making them `startedBy: 'terminal'` and permanently invisible. Fork-local gap, not upstream (`run.ts:2113` stamps argv correctly upstream). `PPID=1` retired as an orphan predicate: 98 of 99 sit inside a `.service` cgroup. **Discovery's own `cleanupAndExit` finding retracted** — the inference assumed the surviving process wrote the marker, but roots exit cleanly and leave children holding the id; 56/56 clean SIGTERM exits plus **0 of 15** live roots under an archived row leave it with no specimen. Code gap (two unbounded awaits, no watchdog, zero `forceExit` hits against a 170-hit `setTimeout` positive control) recorded as real but unevidenced and **not filed**, by the same standard that retired the `acpManualTitle` hardening. Net: nothing upstream-filable; only the narrow #2020 fall-through note remains, still held.
- 2026-11-08 — Discovery's Follow-up 6 committed by the kitchen (append-only verified: 75 insertions, 0 deletions, heading order intact). Follow-up 4's attribution marked superseded in place: the missing `archivedBy: 'hub'` proves the hub never authored an archive, rather than showing one erased. Defect is the `lifecycleState === 'archived'` short-circuit at `syncEngine`'s archive tail; fix is `archivedBy === 'hub'`, **not** extending `pickExistingSessionMetadata` (that would break the deliberate `cli`-archive reopen path). Disposition: review input on #2020, nothing posted to `tiann/hapi` — **awaiting operator yes/no.**
