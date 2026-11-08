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

## Changelog

- 2026-11-08 — Written by triage from the kitchen's swap-verification report; collision did not reproduce; #2269/#1672 confirmed shipped in the running driver; two residual footguns recorded.
- 2026-11-08 — Kitchen built `scripts/tooling/hapi-meta-sessions-audit.sh` (`bc9c0380b`); triage adjudicated its check-B widening — reasoning accepted, implementation rejected: `/api/sessions` caps at 500 rows with `offset` ignored, so "absent" means "older than ~22 days". Fix specified: per-id `GET /api/sessions/:id` (404 = absent).
- 2026-11-08 — Kitchen applied the per-id fix + per-entry `env_file:`. First live run found `028d0a86` reverted to the live title with `archived: null` — retitle and archive both failed to stick on a still-running session. Collision is live again; auditor exits 1.
