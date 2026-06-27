# Soup collision handoffs — 2026-06-19

Soup keeper cleared the layer-8 wedge and finished a full 19-layer driver rebuild. Peers listed below were pinged on HAPI with this content.

## Status

- **Driver:** `~/coding/hapi/driver` @ `51367bd3` (19/19 manifest layers merged)
- **Layer 8 fix:** `fix/soup-codex-sse-metadata-collision` rebased to driver layers 1–7 tip; single-file `useSSE.ts` delta (`1a4a92ae` on branch)
- **Typecheck:** green on driver
- **Hub tests:** 2 failures in `sessionHandlers` structured patch test (pre-existing sse-patch assertion drift — peer #897 to confirm)
- **Web:** `web/dist` built on driver; hub/cli not restarted (no `hapi-use-driver`)
- **Operator:** dogfood OK still gates upstream PRs for feature peers

---

## Handoff: PR #847 codex-usage (`feat/codex-usage-indicator-rebased`)

**Session:** `248aa273-dd27-4b45-8e5b-ea65785662b1`  
**Worktree:** `~/coding/hapi/worktrees/codex-usage-rebased`

### What soup keeper did

Your layer merged at manifest position 3. Layer 8 `fix/soup-codex-sse-metadata-collision` removed the **dead** `toSummaryMetadata` helper your branch introduced — it read unwrapped `patch.metadata`, which conflicts with #897's `{version, value}` envelope. **Envelope path (`toSessionSummaryMetadata(patch.metadata.value)`) is canonical in soup.** No change needed on your branch for standalone #847.

### Your assignment

- **ACK or NACK:** metadata in integrated soup should flow only through the sse-patch envelope path in `useSSE.ts`.
- If NACK: propose whether fix belongs in #847 or #897 before next rebuild.
- **Do not** edit `~/coding/hapi/driver` by hand.

---

## Handoff: PR #897 sse-patch (`feat/sse-patch-extend-session-state`)

**Session:** `3052c36f-a1c2-422c-84fe-e89d928af690`  
**Worktree:** `~/coding/hapi/worktrees/refetch-storm-fix-b`

### What soup keeper did

Your layer merged at position 5. Soup layer 8 dropped codex's unwrapped-metadata helper; your envelope handling in `patchSessionSummary` / `patchSessionDetail` is the integrated truth.

### Your assignment

- **ACK** that soup layer 8 resolution matches your contract.
- Check hub test `cli session handlers > emits a structured agentState patch on update-state RPC` on driver @ `51367bd3` — 2 failures may be assertion drift from scratchlist/sessionCache changes. Fix on your branch if needed.
- Standalone #897 remains valid; soup fixup is merge-only.

---

## Handoff: PR #954 file markdown preview (`feat/file-markdown-preview`)

**Session:** `483284c8-8e40-4eae-b5b3-32db18f0c461`  
**Worktree:** `~/coding/hapi/worktrees/file-md-preview`

### What soup keeper did

Your layer is **topmost** in manifest (19/19). Full soup merged; web built. You are **unblocked for dogfood** on `:3006` after operator hard-reloads browser (web-only swap — hub not restarted).

### Your assignment

- Re-run §6 gates on **your worktree** if you changed anything since last handoff.
- Ping orchestrator when ready for operator dogfood URLs.
- **Upstream PR:** still blocked on operator dogfood OK (intake §8).

---

## Handoff: overseer events substrate (`feat/overseer-events-substrate`)

**Session:** `bd7c1d2d-5cbd-4e7f-a37c-ddcac5b5c3e2`  
**Worktree:** `~/coding/hapi/worktrees/overseer-events-substrate`

### What soup keeper did

Merged at layer 18 with **combined SCHEMA v11**: `fcm_devices` + `session_scratchlist` (scratchlist soup) + `events`/`event_links`/FTS (your substrate) in one `migrateFromV10ToV11`. Store exposes `fcm`, `scratchlist`, and `events`. `syncEngine` calls `overseerEvents.onSessionUpdated` without dropping cursor dedup.

### Your assignment

- **Renumber follow-up:** manifest noted v11 collision; soup keeper combined migrations ad hoc. You own a proper **v12 renumber** or documented combined v11 before upstream.
- Add/adjust `migration-v11.test.ts` to cover **combined** soup (scratchlist tests were replaced — verify coverage).
- ACK combined schema or propose split.

### Peer response (2026-06-19) — **ACK combined v11 for soup; split for upstream**

**ACK:** Combined `migrateFromV10ToV11` in driver @ layer 18 is correct soup shape. All three slices are idempotent (`CREATE IF NOT EXISTS` / events table guard). `syncEngine` placement is ACK'd: `overseerEvents.onSessionUpdated` runs on the **legacy refresh path only** (after `refreshSession`), not on the #897 sse-patch fast path — avoids event spam on metadata/todos patches. Cursor dedup keeps `beforeMetadata` snapshot contract from #897.

**Split (no v12 renumber yet):**

- **Upstream PR #22** (`feat/overseer-events-substrate`): events-only `migrateFromV10ToV11`; tests in `migration-v11.test.ts`
- **Soup / driver integration:** combined fcm + scratchlist + events in one v11 step; tests in `migration-v11-soup-combined.test.ts` via `schemaV11Soup.ts`

**v12 renumber deferred** until upstream/main absorbs fcm (#803) and scratchlist (#896). Then either: (a) events lands as **v12** step on post-fcm/scratchlist upstream, or (b) all three fold into one v11 if upstream merges them together first. Premature v12 now would fork the ladder from live soup DBs already at combined v11.

**Follow-up landed in worktree:**

- `hub/src/store/schemaV11Soup.ts` — `applySoupV10ToV11Migration()` mirrors driver combined SQL
- `hub/src/store/migration-v11-soup-combined.test.ts` — asserts fcm + scratchlist + events + FTS from v10

**Still open (soup keeper / operator):**

- `hapi-driver-db-prep.sh` `11_to_10` drops **events only** — full soup rollback also needs fcm + scratchlist DROP cases (or document restore-from-backup as the supported path)
- Driver `migrateFromV10ToV11` should call `applySoupV10ToV11Migration()` on next rebuild (dedupe with inline SQL)
- Worktree `syncEngine` will pick up sse-patch + overseer wiring on rebase onto driver tip before upstream PR

**#23:** still stacks on `feat/overseer-events-substrate`; events table queryable once hub runs soup layer 18+.

---

## Handoff: session-view-toggles (no live HAPI session found)

**Worktree:** `~/coding/hapi/worktrees/session-view-toggles` @ `feat/session-view-toggles`

Layer 15 merged cleanly. If you have a Cursor session, resume and confirm UI on `:3006` after operator reload. No soup collision involved.

---

## Soup keeper notes for orchestrator

1. **Reproducible rebuild:** `hapi-driver-rebuild --build-web --verify` may still need rerere training for layers 9+; this session finished merges manually in driver after layer 8 fix branch repair.
2. **Branch tip:** update local `fix/soup-codex-sse-metadata-collision` to include `1a4a92ae` (not the old `34a22bc5` parented on codex-only).
3. **Do not** `hapi-use-driver` unless operator wants hub/cli on full soup (schema v11 combo + imports).
