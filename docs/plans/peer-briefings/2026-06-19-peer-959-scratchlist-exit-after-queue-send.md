# Peer briefing — #959 exit scratchlist mode after promote-to-queue

**Branch:** `fix/scratchlist-exit-after-queue-send`
**Worktree:** `~/coding/hapi/worktrees/scratchlist-exit-after-send/`
**Tracker:** [tiann/hapi#959](https://github.com/tiann/hapi/issues/959)

## Parent

- Orchestrator HAPI session: `4afb9884-8262-4eff-a519-635d23741f5e`
- Orchestrator Cursor session: `d1ceebab-27db-4601-9b9d-00a5c5bc7c3f`
- Operator request: after Send to queue from scratchlist, exit scratchlist mode so operator can continue normal chat with the agent.

## Intake status (orchestrator completed)

- [x] **1 Code search** — `ScratchlistDrawerHost.handlePromoteToQueue` in `web/src/components/SessionChat.tsx` sends via `onSend` but intentionally keeps scratchlist mode on (comment lines 287-292). Promote-to-composer already calls `onExitScratchlistMode()`.
- [x] **2 Upstream search** — no prior issue; related #893 / PR #896 (scratchlist v2 hub sync). This is composer UX only.
- [x] **3 Playback** — operator confirmed bug + wants issue + peer.
- [x] **4 Issue** — [tiann/hapi#959](https://github.com/tiann/hapi/issues/959)
- [x] **5 Demo topology** — **soup** (web-only; hard-reload after manifest layer + web dist swap)

## Your assignment (feature peer)

- Own: **implementation + gates + ping orchestrator when ready for manifest/dogfood**
- Do NOT redo: steps 1-5 above
- Do NOT run `hapi-use-worktree`, `hapi-use-driver`, or `hapi-driver-rebuild --activate` (kills live sessions)
- Do NOT hand-edit `~/coding/hapi-driver`

### Fix (minimal)

1. `web/src/components/SessionChat.tsx` — in `handlePromoteToQueue`, after `onSend(text)` returns **true**, call `props.onExitScratchlistMode()`. On **false**, keep mode (entry stays).
2. Update `web/src/components/SessionChat.exit-mode.test.tsx` — invert the test at line ~74: successful promote-to-queue **should** exit scratchlist mode; add case for rejected send keeping mode.
3. Skim `ScratchlistPanel.test.tsx` for any host-level assertions to align.

### Gates before operator dogfood (mandatory — intake §6)

1. `bun typecheck` (root)
2. `bun run test` (root) — at minimum web tests pass
3. **Cold code review** full diff vs `upstream/main` — fix Blocker/Major per `cold-pr-review-rubric.md`
4. **Playwright smoke** — open session, enable scratchlist, add entry, Send to queue, assert scratchlist mode off (composer not amber / drawer closed). Save `localdocs/playwright-runs/959-scratchlist-exit-after-queue.png`. Handoff: **Read** that PNG in chat (Cursor renders inline).

**Do not** ping operator with "please try it" until all gates pass.

### After gates pass

- Commit on branch (conventional message, refs #959)
- Ping orchestrator:

```bash
hapi-ping-peer 4afb9884 "Peer #959: fix/scratchlist-exit-after-queue-send — gates pass, ready for manifest + dogfood"
```

Orchestrator will add manifest layer + web rebuild; operator hard-reloads for dogfood.

## References

- Issue body: https://github.com/tiann/hapi/issues/959
- Prior intentional test: `SessionChat.exit-mode.test.tsx` "does NOT exit scratchlist mode when an entry is promoted to queue"
- Promote-to-composer precedent: PR #798 upstream review
