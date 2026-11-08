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

## Changelog

- 2026-11-08 — Written by triage from the kitchen's swap-verification report; collision did not reproduce; #2269/#1672 confirmed shipped in the running driver; two residual footguns recorded.
