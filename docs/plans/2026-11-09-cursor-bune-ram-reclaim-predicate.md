# Cursor `bun -e` RAM reclaim — predicate + dry-run auditor (2026-11-09)

**Peer:** [Peer: stale-session RAM reclaim audit](/sessions/32fa5de3-406e-4954-8a4d-300237865dea)
**Parent:** [tooling/meta bot](/sessions/cbd1073e-4fd3-4f4a-bff8-cf9ba97bca6d)
**Status:** dry-run signed off by Meta (2026-11-09); on fork main. **Nothing killed** without per-run Meta sign-off.

## Ownership (durable)

- Runner KillSession stops **tracked** PIDs. Argv orphan reap (`cli/src/runner/orphanReap.ts`, **#1911**) is a **backstop inside `stopSession`**, matching `--started-by runner` + session-id flags — not a sweeper. Agent-spawned ACP children are excluded by design (`orphanReap.ts:75`).
- Cursor `bun -e` wrappers declare `startedBy: 'runner'` **in the script body** but put **no** `--started-by runner` on argv. Environ carries `HAPI_SESSION_ID` after bootstrap. That is the blind spot (~15 processes on oos tonight), not the estate (other sessions already carry matchable argv).
- Not `startedBy: 'terminal'`. Prevention (estate launchers spawning with real argv stamps) is **Meta's**; this peer only audits.

## Predicate (v3 + Meta amendments)

See peer chat for the signed rule table (R1–R12). Hard points:

- **R3** = not in `resume-processes.json` with matching start marker (**no** cmdline `or`).
- **R4** requires `active === false` (per-id GET only; list strips `archivedBy`).
- Archive-while-alive is **annotation only**, never sufficient staleness.
- **R7** thinking re-check at execute time; dry-run records classify-time thinking as `R7-thinking-classify`.
- **R8** Cursor store: resumable (`OK`) or `never_persisted`; refuse `BUSY`.
- **R9** SIGTERM only (execute path — not in this script).
- **R10** positive control: live **Cursor** subjects must NO with a **non-R2** rule id.
- **R12** post-exit environ survivor scan (execute path — not in this script).

## Tooling

| Path | Role |
|------|------|
| `scripts/tooling/hapi-cursor-bune-ram-audit.sh` | Dry-run only (no `--kill`) |
| `scripts/tooling/hapi-cursor-bune-ram-audit.test.sh` | Red-driven fixtures (16 assertions) |

## Live dry-run (2026-11-09, oos)

- `bun_e_wrappers=15`, all `launcher=bun-e-runCursor-startedBy-runner-in-script` (producer: `hapi-safe-revive-session.sh`)
- **CANDIDATES: none** — every wrapper is resume-tracked and `active=true`
- Control self `32fa5de3` → `NO` rules=`R2-shape,R3-tracked,R4-active,R5-fresh,R7-thinking-classify` (Cursor; non-R2 exercised)
- Cursor peers `5d5d200a` / `ad24ecf0` → `R4-active` (among others)
- Registry Meta lives → `R6-protect` + `R4-active`
- Gate OK; store gate live (`OK/acp` on all 15); nothing signalled

### Zero candidates is not live YES-path proof

Meta had already reclaimed **56** processes (two SIGTERM rounds) before this predicate existed. The live dry-run therefore shows a post-cleanup host: **GATE OK + none found** is correct for that moment, but it is **not** independent evidence that the selecting path finds wild candidates. The YES path is proven in fixtures (`hapi-cursor-bune-ram-audit.test.sh`: stale untracked → `CANDIDATE pid=103`; control-as-candidate fails the gate; protected husk not a candidate; archive-while-alive alone does not candidacy). Do not read a clean live gate as "the tool was proven against live candidates."

### Load-bearing excludes

Every live wrapper was excluded by **three** rules at once (`R3-tracked,R4-active,R5-fresh`), so the dry-run cannot tell which rule would be sole load-bearing if one flipped. The auditor prints a `SINGLE-RULE-EXCLUDE` section for any process excluded by exactly one rule — those are the ones a day's drift turns into candidates.

## Prevention note for Meta

Named producer: **`scripts/tooling/hapi-safe-revive-session.sh`** interpolates `existingSessionId` into a `bun -e` body and declares `startedBy: 'runner'` inside the JS object (~line 86), so argv reap stays blind to processes the runner is told it started. Fixes (operator word required): append matchable argv tokens, or route through a real CLI and retire the #991 workaround. Not touched by this peer.
