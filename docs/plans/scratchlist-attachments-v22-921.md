# Scratchlist attachments v2.2 (#921)

**Branch:** `feat/scratchlist-attachments-v22`  
**Worktree:** `~/coding/hapi/worktrees/scratchlist-attachments-v22`  
**Issue:** https://github.com/tiann/hapi/issues/921 (open; upstream PR not filed)  
**Spawn brief (historical):** [`peer-briefing-scratchlist-attachments-921.md`](./peer-briefing-scratchlist-attachments-921.md)

## Locked decisions (operator 2026-06-21)

- Hub filesystem stores bytes; SQLite holds `AttachmentMetadata[]` JSON only
- Cross-device: metadata + bytes must both be on hub (no CLI-local-only refs)
- Attachment-only entries allowed
- Promote-to-composer rehydrates text + attachments
- Retention: infinite until user deletes entry/session
- Limits: hub-configurable via env / `settings.json`
- Dogfood via soup layer before upstream PR

## Schema

- `session_scratchlist.attachments TEXT DEFAULT NULL` (migration v11 → v12)
- `AttachmentMetadata.path` uses prefix `hapi-hub:scratchlist/` for hub-resident files

## Hub storage layout

```
{HAPI_HOME}/scratchlist-attachments/{namespace}/{sessionId}/{attachmentId}-{filename}
```

## API (v2.2)

- `POST /api/sessions/:id/scratchlist/upload` — write hub file, return metadata
- `GET /api/sessions/:id/scratchlist/attachments/:attachmentId` — serve bytes (auth + session guard)
- `GET /api/sessions/:id/scratchlist/limits` — effective caps for web pre-validation
- Extend scratchlist POST/PUT with optional `attachments`; text optional when attachments present

## Send / promote path

- Promote-to-queue: hub materializes hub paths to CLI upload dir via RPC, then `sendMessage`
- Promote-to-composer: web fetches hub attachment URLs for preview + rehydrate

## Soup integration

Manifest layer: `soup/scratchlist-attachments-v22-v12` (v11→v12 renumber for FCM stack). Upstream PR branch stays on upstream/main migration ladder.

Env limits (defaults):

- `HAPI_SCRATCHLIST_MAX_ATTACHMENT_BYTES_PER_FILE` (default 10MB)
- `HAPI_SCRATCHLIST_MAX_ATTACHMENTS_PER_ENTRY` (default 4)
- `HAPI_SCRATCHLIST_MAX_ATTACHMENT_BYTES_PER_ENTRY` (default 20MB)
- `HAPI_SCRATCHLIST_MAX_ATTACHMENT_BYTES_PER_SESSION` (default 100MB)
- `HAPI_SCRATCHLIST_ALLOWED_ATTACHMENT_MIMES` (comma-separated allowlist)

## Status (2026-06-24)

- **Feat tip:** `c08f327d` — composer attach fix, float thumbs, copy-text-only tooltip
- **Soup layer:** `soup/scratchlist-attachments-v22-v12` @ `972e8234` (needs cherry of `c08f327d` web fixes)
- **Driver dogfood:** build `driver/web` from full soup (`654fde5f`+); cherry scratchlist commits. **Never** feat-dist swap into driver.
- **Upstream PR:** not filed; #896 dependency note may be stale — verify before open
- **Spike branch** `spike/scratchlist-attachments-921` — prune-ready (superseded by v22)
