# `hapi-dogfood-shot` — reliable proof capture + easy inline/PR display

**Not a test runner.** Vitest / Playwright `expect(...)` stay the tests. This tool makes the *proof artifact* path reliable and zero-think:

1. PNG lands under `localdocs/playwright-runs/` (gitignored)
2. Same PNG inlines into the current HAPI session (`display_image`)
3. Same PNG is ready to drag onto the upstream PR (checklist printed; never `git add`)

## Why it exists

Lifecycle / peer-stack *require* §6.4 proof, but left agents to reinvent Playwright auth, token paths (`~/.hapi` vs `/var/lib/hapi`), SSE `networkidle` hangs, virtualized-list scrolling, and overlay clicks. That scavenger hunt is at odds with "peers must produce proof."

## Oneshot

```bash
# A) Capture current SessionChat (needs $HAPI_SESSION_ID from #1119)
hapi-dogfood-shot
hapi-dogfood-shot --title "#1120 .mmd" --expect-link "/file?"
hapi-dogfood-shot --goto-file web/src/lib/remark-file-path-links.ts

# B) Tests already wrote the PNG — just display + PR checklist
hapi-dogfood-shot --from localdocs/playwright-runs/959-peer-stack.png --title "peer #959"
hapi-dogfood-shot --from "$SCREENSHOT_PATH" --pr-checklist
```

## How this pairs with tests

| Layer | Owns |
|-------|------|
| Vitest / Playwright `expect` | Correctness (assertions) |
| Playwright `page.screenshot({ path })` or `hapi-dogfood-shot` capture | Disk PNG |
| `hapi-dogfood-shot --from …` (or capture with display on) | HAPI chat inline |
| `--pr-checklist` + GitHub PR UI upload | Upstream PR attach (`user-attachments/assets/…`) |

Feature e2e specs keep asserting. At the end, either:

- write `SCREENSHOT_PATH` as today, then `hapi-dogfood-shot --from "$SCREENSHOT_PATH"`, or
- call `hapi-dogfood-shot` for soup `:3006` dogfood when you need a live SessionChat frame without a dedicated spec.

Optional soft checks (`--expect` / `--expect-link`) are **proof guards** ("is the thing visible in the shot?"), not a replacement for unit/e2e asserts.

## Footguns baked in

| Footgun | Mitigation |
|---------|------------|
| Token in `~/.hapi` but hub on `/var/lib/hapi` | `lib/hapi-hub-auth.mjs` |
| `waitUntil: 'networkidle'` hangs on SSE | Always `domcontentloaded` |
| Virtualized chat misses proof text | Scroll-harvest before assert |
| Overlays eat clicks | `--click` uses `force: true` |
| "PNG on disk = done" | Default calls `hapi-display-image.mjs self` |
| Binaries in git | `--pr-checklist` reminds: upload via PR UI, never `git add` |

## Install

```bash
ln -sf ~/coding/hapi/scripts/tooling/hapi-dogfood-shot.mjs ~/.local/bin/hapi-dogfood-shot
chmod +x ~/coding/hapi/scripts/tooling/hapi-dogfood-shot.mjs
```

## Kill criteria

- Agent still hand-rolls Playwright auth for a static SessionChat shot → failed
- 401 because script read `~/.hapi` while hub used `/var/lib/hapi` → auth helper failed
- Capture OK, no inline image, agent calls §6.4 done → failed
- Agent `git add`s PNGs into upstream PR → failed (checklist ignored)

## Related

- [`feature-work-lifecycle.md` § Proof tiers](./feature-work-lifecycle.md#proof-tiers-images-and-video)
- [`peer-stack.md` § Evidence modality](./peer-stack.md#evidence-modality--agent-decides-png-vs-mp4)
- `scripts/tooling/hapi-display-image.mjs`
- `scripts/tooling/lib/hapi-hub-auth.mjs`
