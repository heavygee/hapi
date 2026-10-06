# `hapi-dogfood-shot` — reliable proof capture + easy inline/PR display

**Not a test runner.** Vitest / Playwright `expect(...)` stay the tests. This tool makes the *proof artifact* path reliable and zero-think:

1. PNG lands under `localdocs/playwright-runs/` (gitignored)
2. Same PNG inlines into the current HAPI session (`display_image`)
3. Same PNG attaches to a GitHub PR comment via `--pr` (Releases API) — **or** `--pr-checklist` for manual drag-drop

## Why it exists

Lifecycle / peer-stack *require* §6.4 proof, but left agents to reinvent Playwright auth, token paths (`~/.hapi` vs `/var/lib/hapi`), SSE `networkidle` hangs, virtualized-list scrolling, and overlay clicks. That scavenger hunt is at odds with "peers must produce proof."

## Oneshot

```bash
# A) Capture current SessionChat (needs $HAPI_SESSION_ID from #1119)
hapi-dogfood-shot
hapi-dogfood-shot --title "#1120 .mmd" --expect-link "/file?"
hapi-dogfood-shot --goto-file web/src/lib/remark-file-path-links.ts

# B) Tests already wrote the PNG — just display + PR attach
hapi-dogfood-shot --from localdocs/playwright-runs/959-peer-stack.png --title "peer #959"
hapi-dogfood-shot --from "$SCREENSHOT_PATH" --pr heavygee/hapi#76
hapi-dogfood-shot --from "$SCREENSHOT_PATH" --pr 1234 --repo tiann/hapi --asset-repo heavygee/hapi
```

## How this pairs with tests

| Layer | Owns |
|-------|------|
| Vitest / Playwright `expect` | Correctness (assertions) |
| Playwright `page.screenshot({ path })` or `hapi-dogfood-shot` capture | Disk PNG |
| Playwright video (when recording) | Annotated screencast + `clickForHuman` — not raw `recordVideo`. See `scripts/dev/playwright-annotated-video.mjs` |
| `hapi-dogfood-shot --from …` (or capture with display on) | HAPI chat inline |
| `--pr owner/repo#N` | GitHub PR comment via estate `pr-attach-proof` (release asset) |
| `pr-attach-proof` (PATH) | Same attach, any repo/agent — no HAPI session required |
| `--pr-checklist` | Reminder only — manual UI drag-drop for exact `user-attachments/assets/…` |

Playwright **video** (interaction proof) is a different layer: annotated
screencast + human click pacing. See `scripts/dev/playwright-annotated-video.mjs`.
This oneshot is PNG-first; do not use it as an excuse to skip click-visible MP4
when the story is an interaction.

Feature e2e specs keep asserting. At the end, either:

- write `SCREENSHOT_PATH` as today, then `hapi-dogfood-shot --from "$SCREENSHOT_PATH"`, or
- call `hapi-dogfood-shot` for soup `:3006` dogfood when you need a live SessionChat frame without a dedicated spec.

Optional soft checks (`--expect` / `--expect-link`) are **proof guards** ("is the thing visible in the shot?"), not a replacement for unit/e2e asserts.

## PR attach (recommended path)

### Discovery (2026-07)

GitHub has **no public API** for minting `https://github.com/user-attachments/assets/…` URLs. That CDN is web-UI only (`POST /upload/policies/assets` → **422** with a PAT). Tracked as [cli/cli#13256](https://github.com/cli/cli/issues/13256) (blocked on a platform API). Community workarounds:

| Approach | URL shape | Auth | Agent-host fit |
|----------|-----------|------|----------------|
| **Releases prerelease assets** (`pr-attach-proof`) | `…/releases/download/pr-attach-proof-N/…` | `gh` PAT | **Yes** — zero cookie |
| `pr-media` / `gh-attach` release strategy | same family | `gh` PAT | Yes (third-party) |
| Cookie replay (`gh-image`, etc.) | real `user-attachments` | browser `user_session` | **No** — steals full-account cookie; none on headless agents |
| CDP / Playwright drop (`gh-pr-media` browser) | real `user-attachments` | logged-in browser | Only if operator keeps Chrome+CDP forever |
| Gist | n/a | PAT | **Dead** — `gh gist` rejects binary |
| Commit to branch / raw.githubusercontent | raw URL | PAT | Forbidden here (never `git add` proof binaries); private camo breaks |

### Recommended: `pr-attach-proof` (estate) / `--pr` (HAPI)

```bash
# Any agent / any repo (PATH):
pr-attach-proof proof.png --pr heavygee/hapi#76

# HAPI capture/display + same attach:
hapi-dogfood-shot --from proof.png --pr heavygee/hapi#76
```

Cross-repo (fork hosts assets, comment on upstream):

```bash
pr-attach-proof proof.png --pr 1234 --repo tiann/hapi --asset-repo heavygee/hapi
```

**Canon:** `~/coding/skills/github-operations/scripts/pr-attach-proof.mjs` (also `github-operations` skill § PR visual proof attach). HAPI shim: `scripts/tooling/lib/hapi-pr-attach-proof.mjs`.

### Kill criteria

| Criterion | Kill when… |
|-----------|------------|
| Exact `user-attachments/assets/…` required | Release URLs are not that shape — use manual UI or keep a logged-in CDP browser; do not steal cookies on shared agent hosts |
| Private asset-repo + secrets in screenshot | Release assets are **always public** even on private repos — refuse / use browser attach instead |
| No `contents:write` on `--asset-repo` | Upload fails — point `--asset-repo` at a repo you admin (usually the fork) |
| Video inline player parity | Release MP4 URLs often render as download links, not the native player `user-attachments` gets — accept or manual-upload video |
| Upstream-only hosting | Collaborator write ≠ release-create on `tiann/hapi` — host on fork via `--asset-repo` |
| Size | Soft-warn at web-UI caps (10 MB image / 100 MB video); release API allows more |

### Friction mode (steelman)

Steelman for cookie/`user-attachments`: reviewers and GitHub's own UI treat that CDN as the "real" attach; release URLs are a second-class citizen and leave prerelease litter. Counter: on this headless estate, cookie extraction is a worse security trade than a deletable `hapi-proof-pr-N` tag — and public fork/upstream PRs camo-render release download URLs fine. Falsify cheaply: attach once with `--pr`, hard-reload the PR as anonymous (public repo) and confirm the image paints. If it doesn't, fall back to manual drag-drop and file upstream pressure on #13256.

## Footguns baked in

| Footgun | Mitigation |
|---------|------------|
| Token in `~/.hapi` but hub on `/var/lib/hapi` | `lib/hapi-hub-auth.mjs` |
| `waitUntil: 'networkidle'` hangs on SSE | Always `domcontentloaded` |
| Virtualized chat misses proof text | Scroll-harvest before assert |
| Overlays eat clicks | `--click` uses `force: true` |
| "PNG on disk = done" | Default calls `hapi-display-image.mjs self` |
| Binaries in git | `--pr` / `--pr-checklist`: never `git add` |

## Install

```bash
ln -sf ~/coding/hapi/scripts/tooling/hapi-dogfood-shot.mjs ~/.local/bin/hapi-dogfood-shot
chmod +x ~/coding/hapi/scripts/tooling/hapi-dogfood-shot.mjs
```

## Kill criteria (capture/display)

- Agent still hand-rolls Playwright auth for a static SessionChat shot → failed
- 401 because script read `~/.hapi` while hub used `/var/lib/hapi` → auth helper failed
- Capture OK, no inline image, agent calls §6.4 done → failed
- Agent `git add`s PNGs into upstream PR → failed (checklist / `--pr` ignored)

## Related

- [`feature-work-lifecycle.md` § Proof tiers](./feature-work-lifecycle.md#proof-tiers-images-and-video)
- [`peer-stack.md` § Evidence modality](./peer-stack.md#evidence-modality--agent-decides-png-vs-mp4)
- `scripts/tooling/hapi-display-image.mjs`
- `scripts/tooling/lib/hapi-hub-auth.mjs`
- `~/coding/skills/github-operations/scripts/pr-attach-proof.mjs` (estate CLI + lib)
- `scripts/tooling/lib/hapi-pr-attach-proof.mjs` (HAPI re-export shim)
