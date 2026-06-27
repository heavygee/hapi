# Soup dogfood recovery — 2026-06-22 (operator + all feature peers)

**Status:** `:3006` driver soup @ `969a7db5` — **web/dist verified**, hub restart pending/required for hub/cli parity.

## What broke

Two failure modes stacked:

1. **Source/dist drift (not manifest layer removal)** — Jun 22 `hapi-driver-rebuild --build-web` produced a bundle from soup source that **did not yet include** `feat/session-copy-link` (top manifest layer). A later merge restored `web/src` but **did not re-run vite**. Live `web/dist` was stale while driver source was correct.

2. **Rollback picked the wrong half** — `hapi-driver-rollback-web` restored `dist.prev` (Jun 21), which had **Copy reference** but **lost** `#921` scratchlist strings (`scratchlist.attachmentOnly`). The "bad" bundle in `dist.broken-*` had scratchlist but **not** copy reference. Neither half was the full soup.

3. **Vite SIGTERM under swap pressure** — follow-up `hapi-driver-build-web` attempts died ~5s into transform with exit 143. Root cause: **swap ~100% full** (remote agents + host). Node self-sent SIGTERM under memory pressure — not a manifest bug.

## What we did (recovery)

1. `sync; sudo swapoff -a && sudo swapon -a` — cleared swap (~3 min on this host).
2. `bun run build` in `~/coding/hapi/driver/web` — fresh `web/dist` @ `index-B1HDpnQy.js`.
3. `hapi-verify-web-dist` — **563/563** `t()` keys OK (copy reference + scratchlist attachments + rest).
4. Wrote `web/dist/.hapi-build-meta.json` (`driverHead=969a7db5`).
5. Tooling: `build-web-preflight.sh` (swap + MemAvailable gate) wired into `build_web_atomic`; `verify-soup-web-dist.mjs` runs after every atomic swap with auto-rollback.

## Peer agent contract (mandatory)

When your layer is in `driver-manifest.yaml` and you claim **done for operator dogfood**:

```bash
hapi-driver-status --quiet          # exit 0
hapi-driver-rebuild --build-web --verify   # or build-web-only if merge already done
hapi-verify-web-dist                # must exit 0 — dist matches driver web/src
hapi-restart-hub                    # when hub/cli/shared changed; patient drain OK
```

**Do not stop at:**

- verify stamp alone (`~/.hapi/driver-promotion.json`) — does not prove `web/dist` shipped
- merge commit on `driver/integration` — hub serves **disk** `web/dist`, not `web/src`
- `hapi-use-driver` — stack path only; not a substitute for rebuild + restart when already on driver soup

**Web-only layers:** rebuild/build-web + verify + hard-reload `:3006` (no hub restart).

**Hub layers (e.g. `#921` v12, scratchlist attachments):** rebuild `--verify` + **`hapi-restart-hub`**.

## Affected peers (ping if still open)

| Issue / layer | Branch | Worktree | Notes |
|---------------|--------|----------|-------|
| #950 Copy reference | `feat/session-copy-link` | `worktrees/session-copy-link` | Was in source, missing from dist until 2026-06-22 rebuild |
| #921 Scratchlist attachments | `soup/scratchlist-attachments-v22-v12` | `worktrees/scratchlist-attachments-v22` | v12 migration; dist + hub |
| #921 exit-after-queue | `fix/scratchlist-exit-after-queue-send` | — | web-only; now in verified dist |
| Soup typecheck followups | `fix/soup-typecheck-followups` | mirror branch | Layer-7 store conflict fix landed on driver @ `969a7db5` |

## Operator dogfood checklist

- [ ] Hard-reload `:3006` (new `index-B1HDpnQy.js`)
- [ ] Right-click session → **Copy reference**
- [ ] Scratchlist → attach image → `(attachment)` label
- [ ] After hub restart: attachment upload hits v12 schema

## If vite build fails again

```bash
free -h                                    # swap near 100%?
hapi-remote-agent-budget.sh                # agent/swap budget
sync; sudo swapoff -a && sudo swapon -a   # operator TTY; ~3min
hapi-driver-build-web                      # atomic swap + verify + auto-rollback
```

Kill criterion: `hapi-verify-web-dist` exit 1 after you claimed web done → dist still stale; do not ask operator to test.
