# Peer briefing: scratchlist image / attachment support (#921)

> **Historical spawn brief (2026-06-20).** Living plan: [`scratchlist-attachments-v22-921.md`](./scratchlist-attachments-v22-921.md). Canonical worktree: `~/coding/hapi/worktrees/scratchlist-attachments-v22` (`feat/scratchlist-attachments-v22`). Spike wt/branch superseded.

**Spawned:** 2026-06-20  
**Worktree (original):** `~/coding/hapi/worktrees/scratchlist-attachments`  
**Branch (original):** `spike/scratchlist-attachments-921` (off `upstream/main`)

---

## Parent

- **Orchestrator:** scratchlist-exit-after-send Cursor session (operator request)
- **Operator request (verbatim intent):** Spawn a peer with issue details; **CONFIRM or SUGGEST** a solution (may differ from existing issue comments). Reasonable to allow images placed/referenced in scratchlist — mindful of where files go, size limits, efficient storage (**no attachment blobs in SQLite**).

---

## Intake status (orchestrator completed)

- [x] **1 Code search** — scratchlist v1 text-only: `web/src/lib/scratchlist.ts`, `ScratchlistPanel.tsx`, `SessionChat.tsx` promote paths; `AttachmentMetadata` in `shared/src/schemas.ts`; normal send supports attachments via hub `messages.ts`
- [x] **2 Upstream search** — **tiann/hapi#921** (confirmed, open); related **#893** scratchlist v2 hub-sync (text column only today); **#894** migrate-on-delete; **#920** mergeSessionData FK gaps
- [x] **3 Playback** — operator confirmed spawn 2026-06-20
- [x] **4 Issue** — https://github.com/tiann/hapi/issues/921 (do not duplicate; comment or link design there when ready)
- [x] **5 Demo topology** — design spike first; no operator browser test until proposal approved

---

## Your assignment (feature peer)

**Primary deliverable:** A written **design proposal** the operator can approve or reject — not necessarily a full implementation in v1 of your turn.

### Must do

1. Read **#921** body + comments (HAPI Bot verification + contributor note deferring to #893).
2. Trace current attachment lifecycle: composer upload → hub/CLI storage → `AttachmentMetadata` (`id`, `path`, `previewUrl`, etc.) — where files live, TTL/cleanup, max sizes today.
3. **CONFIRM or SUGGEST** an approach for scratchlist entries that **reference** attachments without storing blobs in DB:
   - Prefer metadata + object storage path (hub file store / CLI upload dir / future scratchlist bucket) over inline BLOBs
   - Explicit limits (count per entry, total bytes, mime allowlist)
   - Stale reference handling when CLI tmp cleaned up
   - Promote-to-queue must forward attachments like normal `onSend(text, attachments)`
4. Compare options (at minimum):
   - **A.** Extend scratchlist v1 localStorage with attachment refs (quick, stale-ref risk)
   - **B.** Fold into **#893** v2 table with JSON `attachments` column + hub-side retention policy (issue comment recommendation)
   - **C.** Hybrid: v1 refs + hub upload on add (if such API exists or minimal addition)
5. State whether your recommendation **aligns or diverges** from #921's "defer to #893" comment — justify with operator constraints above.
6. If implementation is small and low-risk after design, optional thin spike OK — but **stop for operator approval** before upstream PR unless explicitly greenlit in chat.

### Do NOT

- `hapi-use-driver`, `hapi-use-worktree`, `hapi-driver-rebuild --activate`
- Hand-edit `~/coding/hapi-driver`
- Store binary/image blobs in SQLite
- Assume unlimited attachment size

### Read first

- https://github.com/tiann/hapi/issues/921
- https://github.com/tiann/hapi/issues/893
- `web/src/lib/scratchlist.ts`, `ScratchlistPanel.tsx`, `SessionChat.tsx` (scratchlist routing + promote)
- `shared/src/schemas.ts` (`AttachmentMetadataSchema`)
- `hub/src/web/routes/messages.ts` (send path)
- `docs/tooling/new-feature-intake.md` §0–§6 (for eventual PR discipline)

### Report back

Post in **this session's HAPI chat** (not only Cursor):

- **Recommendation** (1 paragraph)
- **Option comparison** (prose bullets or markdown tables OK — tables allowed in Cursor since 2026-07-01; see `hapi/.cursor/rules/cursor-markdown-table-discipline.mdc`)
- **Schema/API sketch** (JSON + SQL column names if v2)
- **Limits & retention** policy proposal
- **Scope split:** what ships with #893 vs follow-up PR
- **Open questions** for operator

When/if you open an upstream PR: attach with `hapi link-pr` / MCP `link_pr` (title stays `PR #N: …` — no status emoji). Meta daily refreshes chip status (`hapi-meta-daily.sh`).

---

## Links

- Issue: https://github.com/tiann/hapi/issues/921
- Scratchlist v2: https://github.com/tiann/hapi/issues/893
- Related exit-mode fix (merged context): #959 / PR #960
