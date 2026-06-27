# Peer briefing — #954 file pane markdown Source | Preview toggle

**Branch:** `feat/file-markdown-preview`
**Worktree:** `~/coding/hapi/worktrees/file-md-preview/`
**Tracker:** [tiann/hapi#954](https://github.com/tiann/hapi/issues/954)

## Gates before operator dogfood (mandatory — intake §6)

1. `bun typecheck` (root)
2. `bun run test` (root; `cd web && bun run test` if you add web tests)
3. **Cold code review** full diff vs `upstream/main` — fix Blocker/Major per `cold-pr-review-rubric.md`
4. **Playwright smoke** — open a session, navigate to a `.md` file in file pane, assert preview renders a heading/table, toggle back to source shows raw `#`. Save to `localdocs/playwright-runs/954-file-md-preview.png`. In the handoff message, call **Read** on that PNG (Cursor displays inline). **Forbidden:** markdown `![](/home/...)` or path-only handoff.

**Do not** ping operator with "please try it" until all gates pass.

## Ping back

When gates pass OR blocked:

```bash
hapi-ping-peer 4afb9884 "Peer #954: feat/file-markdown-preview — gates pass, ready for manifest + dogfood"
```

Same assistant turn: **Read** `localdocs/playwright-runs/954-file-md-preview.png` so the screenshot appears in chat.
