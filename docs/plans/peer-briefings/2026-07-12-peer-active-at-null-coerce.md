# Peer briefing — coerce null `active_at` so CLI resume cannot 500

**Branch:** `fix/active-at-null-coerce`
**Worktree:** `~/coding/hapi/worktrees/active-at-null-coerce/`
**Tracker:** [tiann/hapi#1025](https://github.com/tiann/hapi/issues/1025)
**Parent orchestrator HAPI:** `4afb9884-8262-4eff-a519-635d23741f5e` (if reachable; else report in-thread)

## Operator / migration postmortem context

Archived/idle sessions with `sessions.active_at IS NULL` brick CLI parse of `GET /cli/sessions/:id` (Zod `activeAt: z.number()`). Hub surfaces HTTP 500 `resume_failed` / `Invalid /cli/sessions/:id response` on reopen/resume. Operator backfilled DB as emergency; product needs durable fix.

## Intake status (orchestrator completed)

- [x] **1 Code search** — store allows `activeAt: number | null`; shared Session schema requires `z.number()`; CLI validates hub response with that schema.
- [x] **2 Upstream search** — no issue/PR covering this exact Zod null `activeAt` → resume 500 path (adjacent: #917, #841, #991).
- [x] **3 Playback** — orchestrator task from oos migration / reopen postmortem.
- [x] **4 Issue** — filed at spawn.
- [x] **5 Demo** — hub+cli unit/integration tests; no web Playwright required.

## Your assignment

**Own:** implement defense-in-depth fix → tests → cold review → upstream PR to `tiann/hapi`.

### Fix (prefer all three layers if cheap)

1. **Hub write:** never persist `active_at = NULL` (default `createdAt` / `updatedAt` / `0`).
2. **Hub read (CLI path):** coerce `null → createdAt ?? updatedAt ?? 0` before JSON.
3. **CLI parse (optional belt):** coerce null/undefined → `0` before Zod / `.nullish().transform`.

Do **not** change public Session type to `number | null` without strong reason.

### Tests

- Hub: NULL `active_at` row → CLI GET returns numeric `activeAt`.
- CLI (if coerce): missing/null fixture does not throw.
- Regression: normal sessions unchanged.

### Do NOT

- UI tombstone labels
- conflate with `cursorSessionId` archive preservation (Peer C / separate)
- operator DB backfill scripts
- include `docs/operator/`, `docs/plans/`, fork `CLAUDE.md` in PR
- `hapi-use-worktree` / `hapi-use-driver` / `hapi-driver-rebuild --activate`
- manual hub on `:3006`

### Gates

1. `bun typecheck` + focused hub/cli tests
2. Cold review vs `upstream/main`
3. Open PR to `tiann/hapi` with `Fixes #<issue>`

### Ping back

```bash
hapi-ping-peer 4afb9884 "Peer #1025: fix/active-at-null-coerce — PR opened <url>"
```

## Key files

- `hub/src/store/types.ts`, `hub/src/store/sessions.ts`
- `shared/src/schemas.ts` (`activeAt: z.number()`)
- `cli/src/api/api.ts` (`/cli/sessions/:id` parse)
- related hub CLI routes that serialize Session
