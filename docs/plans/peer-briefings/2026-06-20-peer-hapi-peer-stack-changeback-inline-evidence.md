# Change-back: orchestrator `503d9757` — inline evidence + MP4

**From:** feature peer (worktree `peer-stack-worktrees/0620-f7a4`, branch `hapi-0620-f7a4`)  
**To:** orchestrator session `503d9757` — **Peer: hapi-peer-stack default**  
**Context session:** `4971055d` — **Peer #956: cross-flavor inline images** (`/sessions/4971055d-508b-4a93-8673-148cb97fd33d`)  
**Issue / PR:** tiann/hapi#956, PR #958 (`feat/cross-flavor-inline-images`)

---

## What went wrong

Tasks 1–9 landed (peer stack + #959 vertical slice). Proof artifacts exist on disk. **Operator still saw no inline media** because the handoff used broken surfaces:

1. **Cursor IDE chat** — `Read()` paths and markdown `![](...)` **do not render** for this operator (confirmed 2026-06-20). Do not document this as acceptance path.
2. **`hapi-display-image.mjs` to orchestrator `503d9757`** — **Cursor sessions have no `metadata.hapiMcpUrl`**. Script exits `session has no hapiMcpUrl`. Posting to the orchestrator Cursor session cannot work.
3. **Relative paths** — MCP `display_image` runs in the **target session CLI cwd**. Repo-relative paths ENOENT unless absolute.
4. **MP4 in plan step 4** — `display_image` is **image-only** (png/jpeg/gif/webp/avif). MP4/WebM never inline via current MCP. Motion proof = GIF via `display_image`, or disk MP4 + operator download.

**Working proof posted:** PNGs inline in session **#956** (**Cursor**, live `hapiMcpUrl`) via:

```bash
bun scripts/tooling/hapi-display-image.mjs 4971055d \
  /home/heavygee/coding/hapi/worktrees/peer-stack-worktrees/0620-f7a4/localdocs/playwright-runs/959-peer-stack.png \
  "Peer stack #959 - scratchlist queue"

bun scripts/tooling/hapi-display-image.mjs 4971055d \
  .../959-peer-stack-handoff.png \
  "Peer stack #959 - after Send to queue"
```

Open `/sessions/4971055d-508b-4a93-8673-148cb97fd33d` in HAPI web — images render in chat.

---

## Required plan / intake edits (orchestrator-owned)

Update **`docs/plans/2026-06-20-hapi-peer-stack-default.md`** vertical slice step 4 and **`docs/tooling/new-feature-intake.md`** §6 evidence block:

### Inline PNG (mandatory)

After peer-stack Playwright / handoff:

```bash
# Pick a session WITH hapiMcpUrl (any flavor — canonical demo is Cursor #956, not orchestrator 503d9757)
TARGET_PREFIX=4971055d
ABS=/home/heavygee/coding/hapi/worktrees/<worktree>/localdocs/playwright-runs/959-peer-stack.png
bun scripts/tooling/hapi-display-image.mjs "$TARGET_PREFIX" "$ABS" "title"
```

Rules:

- **Absolute paths only**
- **Per-session GET** for `hapiMcpUrl` (list endpoint omits metadata) — merged in peer branch `hapi-display-image.mjs`
- Reference: #956 acceptance, session `4971055d` as canonical demo

### MP4 (artifact + optional inline motion)

- **Disk artifact:** `localdocs/playwright-runs/*.mp4` via `peer-stack-trim-video.sh` — keep
- **HAPI web inline MP4:** not supported — `display_image` rejects non-image MIME
- **HAPI web inline motion:** `ffmpeg -i clip.mp4 -vf 'fps=8,scale=640:-1' clip.gif` then `hapi-display-image.mjs` on GIF
- **Cursor IDE:** no inline video — do not promise

**Do not** list "post MP4 via display_image" in plan DoD. Either:

- **v1:** PNG pair (before/after) + MP4 path in handoff text, or GIF inline to #956-style session  
- **v1.1 (separate issue):** `display_video` MCP + `generated-video` message type — out of peer-stack scope unless operator expands #956

### Cursor orchestrator sessions

When orchestrator lacks `hapiMcpUrl`: post evidence to a **different** session that has MCP (e.g. Cursor `#956`), not the orchestrator row.

---

## Peer branch fixes already made (merge into `feat/hapi-peer-stack`)

- `scripts/tooling/hapi-display-image.mjs` — cli SDK import + per-session metadata GET
- `docs/tooling/peer-stack.md` — § Inline evidence (needs MP4 row above merged from this briefing)

---

## Operator ack

- [x] Plan + intake updated per above  
- [x] PNGs posted to MCP session `4971055d` (#956) — verify in HAPI web  
- [x] MP4 DoD wording fixed (disk + optional GIF; no false `display_image` MP4 claim)

AGENT_NOTIFY_SUMMARY {"version":1,"agent":"peer-stack changeback","project":"0620-f7a4","status":"needs_review","action":"open session 4971055d in HAPI web to view inline PNGs","summary":"Posted #959 proof PNGs inline to Cursor session #956 (hapiMcpUrl); gate is MCP URL not flavor."}
