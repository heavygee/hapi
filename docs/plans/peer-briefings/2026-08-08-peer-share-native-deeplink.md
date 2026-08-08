# Peer briefing: native/deep-link ingest for `/share`

**Spawned:** 2026-08-08  
**Worktree:** `/home/heavygee/coding/hapi/worktrees/share-native-deeplink`  
**Branch:** `feat/share-native-deeplink` (from `upstream/main`)  
**Upstream issue:** https://github.com/tiann/hapi/issues/1412  

## Discovery (DONE)

- Web Share Target POST → IndexedDB → `/share?id=` already ships (#932 / merge wave).
- `/share` `validateSearch` today is only `{ id?: string; error?: string }` — **no** GET `url`/`text`/`title`.
- [#980](https://github.com/tiann/hapi/issues/980) searchable picker is orthogonal — do not conflate.

## Spec (locked contract — do not rename without operator OK)

```
GET /share?url=…&text=…&title=…
```

| Condition | Behavior |
|-----------|----------|
| `id` present | Existing SW/IndexedDB path; ignore GET content fields for ingest |
| No `id`, any of `url`/`text`/`title` non-empty | Client-side `putShareTransfer` with same payload shape as `buildSharePayloadFromFormData`; continue picker / create-new with `shareTransferId` |
| No `id`, all content empty | Current no-id / missing transfer UX |

Keep POST `share_target` path unchanged.

## Implement

- `web/src/router.tsx` validateSearch
- `web/src/routes/share/index.tsx` ingest branch
- Reuse `web/src/lib/shareTransfer.ts`
- Tests: url-only, text-only, both, id-wins, empty→no-id
- Short docs note (user guide / web README — upstream-appropriate)

## Dogfood / consumers

Quest Audio Relay (and any native companion) will open:

`{hapiOrigin}/share?url=…&text=…&title=…`

Peer-stack + soup dogfood when ready. **No upstream PR until operator OK.**

After dogfood-ready on a reachable hub URL, optionally ping the Quest Audio Relay orchestrator session that requested this (if you can resolve it via `hapi ping-peer --list` / name search) with the issue URL + confirmed contract.

## Intake ownership

| Step | Status |
|------|--------|
| Discovery + issue #1412 | DONE |
| Implement | **YOU** |
| Proof + soup dogfood | **YOU** |
| Upstream PR | **YOU** only after operator OK |

Hard rules: product edits only in this worktree; never merge `tiann/hapi`; no agent stack-switch.
