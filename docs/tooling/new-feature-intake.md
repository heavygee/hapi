# New functionality intake

Step-by-step execution for **new product behavior** (web, hub, cli, shared). Summarized in repo root [`AGENTS.md`](../../AGENTS.md).

**Workflow (mermaid, soup tree, done criteria, agent permissions):** [`feature-work-lifecycle.md`](./feature-work-lifecycle.md) **only** — read that first. This file is §0 handoff + steps 1–8 how-to; it does not define the flow.

**Orchestrator** owns steps 0–5 and demo topology choice. **Feature peer** owns implementation and pre-operator gates. **Upstream PR** after operator dogfood approval.

---

## Flow

See [`feature-work-lifecycle.md` § When you say "do the next feature"](./feature-work-lifecycle.md#when-you-say-do-the-next-feature--master-flow) — **one chart, one place.**

---

## Step-by-step

### 0 — Feature peer agent + mandatory handoff

When intake starts, spawn (or hand off to) a **dedicated feature peer**. The **orchestrator prompt is not optional** — it must list **which steps are already done** and **which steps the peer owns**.

**How to spawn:** `hapi-spawn-peer --dir <worktree> --name 'Peer #<n>: <slug>' --message-file -` with the block below. Do **not** put the brief in `POST /api/machines/:id/spawn` JSON — that field is stripped (`docs/plans/2026-08-11-spawn-peer-empty-shell-postmortem.md`). A `sessionId` with 0 messages is a failed spawn.

Copy and fill this block (do not spawn a peer with only "implement X"):

```markdown
## Parent
- Orchestrator: `Name: <session display name>` + `agentSessionId: <metadata.agentSessionId>`
  (**durable identity — do NOT write a bare hub session id here.** Hub ids are ephemeral: a relaunch
  presents a new tag, `sessionCache` merges state onto a new row and **deletes** the old, so any id
  pasted into this brief goes dead and the peer's loop-closure ping fails silently with "Session not
  found". `agentSessionId` survives that merge. A hub id/URL may be included as a convenience copy,
  but must be labelled ephemeral and never used as the return address. Note this is an **addressing
  hint for resolution, not an identity assertion** — soft peer nametag comes from hub
  `meta.peer.sourceSessionId` (CLI path + namespace-token trust; **not** verified / not capability
  HMAC). Client-written `From:` text is a reply hint only. See `docs/operator/AGENTS.md` § Peer
  message identity and its kill criterion: never pass a session id as a tool argument or body field
  expecting crypto-authenticated identity.)
- Operator request: <verbatim>

## Intake status (orchestrator completed)
- [ ] 1 Code search — DONE: <paths or "none found">
- [ ] 2 Upstream search — DONE: <issue/PR links or "no match">
- [ ] 3 Playback — DONE: operator confirmed on <date>
- [ ] 4 Issue — <issue URL> OR spike-only (no issue yet)
- [ ] 5 Proof path — **peer stack** (Playwright) **+ soup promote** (default dogfood) | clean only if parity review — `localdocs/peer-stack.env` when peer stack

## Your assignment (feature peer)
- Own steps: **<e.g. 5 implementation + 6 gates + iterate until 7 handoff>**
- Do NOT redo: **<list completed step numbers>**
- Worktree: `~/coding/hapi/worktrees/<name>` @ branch `<branch>` (create if missing via `hapi-worktree-create`)
- Do NOT edit `~/coding/hapi/driver` by hand
- Read: [`feature-work-lifecycle.md`](./feature-work-lifecycle.md) (workflow) + this file (your steps)
- Before operator browser test: pass §6 (typecheck, test, cold review, Playwright + visual evidence)
- Report back to orchestrator with: demo URLs, **visual evidence inline in HAPI chat** (§6.4 — use `display_image` / `hapi-display-image.mjs`; PNG always for UI; GIF or short MP4 when interaction tier applies), test output, diff stat
- **Session title:** workstream only — e.g. `opt-in awareness`. Pre-PR incubating may use `Peer #<issue>: <slug>`. **No** status emoji (✅🔁⚠️📝🔧) and **no** `PR #N:` once a PR exists (chip owns identity). After the upstream PR exists, attach with `hapi link-pr <url>` / MCP `link_pr` / Link PR dialog (lifecycle § Session titles and PR chips).
- **Close the loop (mandatory):** when done or blocked, resolve the orchestrator to its **current** id first — `scripts/tooling/hapi-overseer-call.sh resolve '<name or agentSessionId above>'` (TSV `hubId<TAB>active|idle<TAB>agentSessionId<TAB>name`, take line 1) — then `hapi ping-peer` / MCP `ping_peer` **that** id (**spawn parent only** — never CC Meta PR watcher unless that session **is** the parent). Message **must** open with `From:` your **name** (and `agentSessionId` if known) rather than a bare `/sessions/<id>` — read `$HAPI_SESSION_ID` fresh if you quote a hub id at all, never a value cached from earlier in your own transcript then verdict + pointer to this peer — see [`docs/operator/AGENTS.md`](../operator/AGENTS.md) § Peer message identity + quieter Meta. Then emit `AGENT_NOTIFY_SUMMARY`. Do **not** treat the summary line alone as notification. "Ping only if blocked" is for mid-task escalation, not for signaling completion.

## Links
- Issue: ...
- Playback summary: ...
- Upstream PR (when open): ... — attach to this session via link_pr
```

One feature → one worktree → one peer. Do not share worktrees across agents.

### 0-backstop — unnamed / bare-spawn peers (fail-closed)

When a peer arrives **without** a filled §0 handoff — bare machine spawn, **spawn-per-send** from `/opmic`, or other transport that did not set a human-salient title — the peer **self-serves** the same intake bar **before implementation**:

1. **Self-name** — If the session title is generic or unset (bare agent flavor, UUID, empty sidebar), rename to `Peer #<issue>: <slug>` (or equivalent) from the remit / issue text. Same bar as the §0 session-title line; do not work under an unnamed row.
2. **Seek precedents** — First substantive step **after** naming: search GitHub **open and closed** issues and PRs ([§2](#2--upstream-search-mandatory)). Pick repo by domain:
   - HAPI product → `tiann/hapi`
   - hapi-inline dock / package → `heavygee/hapi-inline`
   - HAPI consumer re-vendor → note package issues; do **not** lasting-edit vendored `operator-dock.*`
   Note matches in your next operator/orchestrator update; reference priors if filing new ([§3](#3--playback-mandatory)). **Do not implement** until precedents are searched and noted — even when the parent did not run discovery.

Orchestrator-led spawns with a completed §0 block may skip steps marked **DONE** in the handoff. **[Upstream issue/pr discovery](/sessions/6ce7f124-6240-4479-8dad-f2e27eb880a1)** remains the specialist for dedicated discovery passes; this backstop covers peers that arrive without that parent.

### 0-closure — salvage audit (reverse handoff)

When mirror `main` is tidied and a **backup branch** exists (see [`mirror-main-layout.md`](./mirror-main-layout.md)), the orchestrator runs **salvage closure** before deleting it: bucket backup commits, resume originating peers with the four-section template, verify dispositions, record in `docs/plans/*-salvage-audit.md`. Full process: [`salvage-closure.md`](./salvage-closure.md). This is the mirror of §0 above — **backward accountability**, not spawn.

---

## Where agents read instructions (not the daily driver)

Confusion is common: **`hapi-active` → `~/coding/hapi/driver` is the running hub/runner**, not where Cursor rules usually live.

| Source | Path | Applies when |
|--------|------|----------------|
| **Workflow** | [`feature-work-lifecycle.md`](./feature-work-lifecycle.md) | **Start here** — sole source for flow |
| **Fork agent canon** | [`docs/operator/AGENTS.md`](../operator/AGENTS.md) | Upstream PR rules, voice/XR — not workflow |
| **Intake steps** | This file | §0 handoff + steps 1–8 execution |
| **Manifest / DB** | [`driver-soup.md`](./driver-soup.md) | Mechanics only — links lifecycle for dogfood |
| **Operator local (gitignored)** | `~/coding/AGENTS.local.md`, optional `AGENTS.local.md` in repo | Machine voice, pre-PR checklist, worktree discipline. Never upstream. |
| **Global persona** | `~/coding/SOUL.md` | User-facing tone (never cite in PRs). |
| **Upstream-style root `AGENTS.md`** | Only on **`upstream/main`** / `tiann/hapi` | Not used on fork `main` (fork deletes or stubs it). Do not treat upstream root copy as fork canon. |
| **`cli/AGENTS.md` / `hub/AGENTS.md`** | Stub only (tracked) | Points to fork canon + [`docs/guide/client-auth.md`](../guide/client-auth.md). **Do not paste** `~/coding/AGENTS.md` here. |
| **Daily driver tree** | `~/coding/hapi/driver` | **Runtime** after manifest rebuild — not the default instruction root |

**Where to edit code**

| Goal | Edit in |
|------|---------|
| Upstream PR | `~/coding/hapi/worktrees/<name>`, branch from `upstream/main` |
| Mirror / docs | `~/coding/hapi` (primary checkout) |
| Soup on `:3006` | Manifest merge only — `hapi-driver-rebuild`, never hand-edit driver |
| Try feature in browser | Peer stack for §6 proof; **always** soup-promote for `:3006` dogfood — [lifecycle](./feature-work-lifecycle.md) |

**Peer agents** spawned from an orchestrator inherit **files on disk** in the workspace (`~/coding/hapi`), not the orchestrator's chat memory. They only know completed intake steps if the handoff block above says so.

**Windows estate agents** (Teemo, workspace outside `~/coding/hapi`) do **not** inherit Linux repo rules. For runner/toolchain refresh tasks, orchestrator must paste the scope lock from [`docs/operator/windows-estate-agents.md`](../operator/windows-estate-agents.md) and confirm `hapi-install-windows-cursor-muzzle.sh` has been run on Teemo.

### 1 — Code search (mandatory)

Search the repo for existing behavior, flags, routes, and UI:

- Ripgrep / semantic search on keywords from the request
- Read call sites, not just filenames
- **Stop with links** if the feature already exists or is partially implemented

### 2 — Upstream search (mandatory)

On the **target repo** for the work (default `tiann/hapi`; hapi-inline dock/package → `heavygee/hapi-inline` — see [§0-backstop](#0-backstop--unnamed--bare-spawn-peers-fail-closed)), search **open and closed** issues and PRs for the same theme:

```bash
gh search issues "scroll restoration" --repo tiann/hapi --state open
gh search issues "scroll restoration" --repo tiann/hapi --state closed
gh search prs "voice backend" --repo tiann/hapi --state open
gh search prs "voice backend" --repo tiann/hapi --state closed
```

Also check merged PRs that may have landed on `upstream/main` since the operator last synced.

### 3 — Playback (mandatory)

Before any implementation, send the operator a short **playback**:

- What you think they want
- What already exists (code + upstream links)
- Proposed gap / scope
- Risks or trade-offs (one paragraph max)

Wait for confirmation or correction.

### 4 — Issue vs worktree-first

Operator chooses:

| Choice | Action |
|--------|--------|
| **Open issue** | Create issue on `tiann/hapi` (use `gh api` + jq for bodies with backticks — see github-cli-safety skill) |
| **Spike first** | `hapi-worktree-create <name> --branch feat/...` from `upstream/main`; issue optional until dogfood passes |

Upstream PR branches stay **`upstream/main...HEAD`** for review. Soup manifest merge order is **local only** — see [driver-soup.md](./driver-soup.md).

### 5 — Proof path + soup dogfood (not either/or)

**Default:** peer stack for isolated Playwright **and** soup promote for `:3006`. **Workflow:** [feature-work-lifecycle.md § Proof path + soup dogfood](./feature-work-lifecycle.md#proof-path--soup-dogfood-not-mutually-exclusive).

```bash
hapi-peer-stack up --name <feature> --worktree ~/coding/hapi/worktrees/<name>
# Playwright: from mirror — see [peer-stack.md § Upstream PR worktree](./peer-stack.md#upstream-pr-worktree--fork-tooling-read-this)
cd ~/coding/hapi && node scripts/dev/run-e2e-on-peer-stack.mjs \
  --worktree ~/coding/hapi/worktrees/<name> --name <feature> \
  e2e/peer/<issue>-<slug>.spec.ts
hapi-peer-stack down --name <feature>
```

Registry: `~/.hapi-peer/registry.json`. Commands and evidence tiers: [peer-stack.md](./peer-stack.md).

**Soup is not optional.** After (or while) peer proof is ready, add the manifest layer and rebuild — do not ask whether the operator "wants soup." Clean upstream-only instances are rare parity reviews and still do not replace soup for estate dogfood.

#### Clean instance handoff fields (when operator picks clean)

| Component | When |
|-----------|------|
| **Hub** | Always — new `HAPI_LISTEN_PORT`, separate `HAPI_HOME` / DB if isolation needed |
| **Web** | Bundled in hub `web/dist` or vite proxy per operator setup |
| **Runner** | Only if the feature needs **remote spawn / live CLI sessions** — must target the **new** hub URL, not `:3006` |

Give the operator tailnet + LAN URLs, port, `HAPI_HOME`, and branch in the handoff message.

### 6 — Gates before operator test (mandatory)

**Do not** send "please try it" until all pass in the **demo worktree / instance**:

1. **`bun typecheck`** and **`bun run test`** (and `cd web && bun run test` if web touched)
2. **Cold code review** — full diff vs `upstream/main`; use [cold-pr-review-rubric.md](./cold-pr-review-rubric.md); fix Blocker/Major before handoff
3. **DB schema check** — if your branch bumps `SCHEMA_VERSION` in `hub/src/store/index.ts` (i.e. adds a `migrateFromVxToVy()` step), you MUST also add the reverse-SQL case to `apply_downgrade_step()` in [`scripts/tooling/hapi-driver-db-prep.sh`](../../scripts/tooling/hapi-driver-db-prep.sh). Without this, swinging `hapi-active` away from your layer later (back to upstream, or to a soup without it) aborts the activation cleanly but blocks until someone writes the SQL. See [driver-soup.md "DB schema jiu-jitsu"](./driver-soup.md#db-schema-jiu-jitsu-auto-handled-2026-06-01).
4. **Playwright smoke + visual evidence** — real browser on **peer stack session UI** (default). Assertions prove behavior; files prove humans can see it. Archive under `localdocs/playwright-runs/` (gitignored). The implementing agent **assesses PNG vs MP4** per §6.4b/4c (see [peer-stack.md § Evidence modality](./peer-stack.md#evidence-modality--agent-decides-png-vs-mp4)); state the tier and one-line rationale in the handoff.

#### 4a — Playwright (mandatory when web UI touched)

Run smoke with real assertions on the **peer stack** (`hapi-peer-stack up`). Fixture `:5179` / `bun run test:e2e` is CI-only fast path — not operator handoff. Assert: no `QuotaExceededError` / error-boundary strings in console; `failedRequests` empty unless documented.

```bash
# Peer stack (default) — real SessionChat on isolated hub
hapi-peer-stack up --name my-feature --worktree ~/coding/hapi/worktrees/my-feature
export PLAYWRIGHT_CHROME_PATH=/usr/bin/google-chrome   # Linux: prefer system Chrome
# From mirror (upstream worktrees lack fork scripts) — peer-stack.md § Upstream PR worktree
cd ~/coding/hapi && node scripts/dev/run-e2e-on-peer-stack.mjs \
  --worktree ~/coding/hapi/worktrees/my-feature --name my-feature \
  ~/coding/hapi/worktrees/my-feature/e2e/my-feature-peer.spec.ts
# Evidence: localdocs/playwright-runs/*.png and/or *.mp4 (gitignored staging, in worktree)
# HAPI inline: absolute-path media via hapi-display-image.mjs → session with hapiMcpUrl (e.g. Cursor #956). See peer-stack.md § Inline evidence.
hapi-peer-stack down --name my-feature
```

Legacy clean-instance handoff (parity review only — still promote soup for estate dogfood):

```bash
node scripts/dev/read-hapi-web.mjs \
  "https://<demo-host>/sessions/<id>?token=<token>" \
  --expect "visible proof string" \
  --screenshot localdocs/playwright-runs/<feature>.png \
  --timeout 30000
```

#### 4b — Existence receipt (mandatory when user-visible UI changed)

Save **`localdocs/playwright-runs/<feature>.png`** — end-state or key screen.

Use PNG alone when the change is **static existence** (new label, layout, copy, icon) with no meaningful motion story.

#### 4c — Interaction clip (mandatory when motion/state change is the point)

When the feature is about **what happens when the user acts** — not merely that a widget exists — also capture **`localdocs/playwright-runs/<feature>.{gif|mp4}`** (either format; pick smaller / clearer):

**Requires interaction clip when any of:**

- Mode toggle, drawer open/close, pressed/unpressed control
- Before → after depends on a click/type sequence (not two unrelated stills)
- Async UI feedback (send → clears, toast, queue bar, mode exit)
- Animation, transition, or timing is part of the fix

**PNG alone is enough when:**

- Static render with no interaction story (typography, spacing, new inert panel)
- Backend/hub/cli-only (no web UI change) — skip 4b/4c entirely

**Clip spec (agent-friendly) — human default, not robot:**

- **Clicks:** annotated screencast is **mandatory** when video is on (`scripts/dev/playwright-annotated-video.mjs` → `annotatedVideoUseOption` / `startAnnotatedScreencast`). Pointer + element highlight. Use `clickForHuman` (wait for the UI result, then ~1s dwell). Raw `video: 'on'` / `recordVideo` without `showActions` is a **kill-criterion**.
- **Length:** whatever that pacing needs (often 8–20s). One interaction story per clip. Trimming dead air is fine; trimming the consequence of the click is not.
- **Size:** target under 5MB after trim (`scripts/dev/peer-stack-trim-video.sh` or ffmpeg).
- **Env:** `PLAYWRIGHT_RECORD_VIDEO=1` / `HAPI_PEER_RECORD_VIDEO=1` (peer-stack runner already defaults the latter on).

#### 4d — Inline in HAPI chat (mandatory for 4b/4c; operator reads sessions in the web app)

**Do not** hand off with filesystem paths or `Read` (Cursor IDE only). Post images into **this session's chat** so the operator sees them inline in the PWA:

**Preferred (agent has `display_image` MCP — Claude/Codex/OpenCode/Cursor ACP after #956):**

Call `display_image` with `{ path, title? }` for each PNG/GIF/MP4.

**Fallback (Cursor agent shell / peer without MCP in tool list):**

```bash
bun scripts/tooling/hapi-display-image.mjs <session-id-prefix> localdocs/playwright-runs/<feature>.gif "title"
bun scripts/tooling/hapi-display-image.mjs <session-id-prefix> localdocs/playwright-runs/<feature>.png "title"
```

The script resolves `hapiMcpUrl` via `GET /api/sessions/:id` (the list endpoint omits it). Session must be **ACP + MCP bridge** (`metadata.hapiMcpUrl` present) — legacy Cursor stream-json sessions cannot inline images.

**Dual delivery when 4c applies:**

1. **HAPI handoff chat** — `display_image` or `hapi-display-image.mjs` for PNG **and** interaction clip in the same turn
2. **Upstream PR (§8)** — embed the same files via `hapi-dogfood-shot --pr …` (release assets) or GitHub drag-and-drop (`user-attachments/assets/…`)

```bash
# Example: trim Playwright webm to a PR-friendly mp4 (~8× speed, 1024px wide, no audio)
ffmpeg -i localdocs/playwright-runs/<feature>.webm \
  -filter:v "setpts=0.125*PTS,scale=1024:-2" -an \
  -c:v libx264 -preset fast -crf 28 -movflags +faststart \
  -y localdocs/playwright-runs/<feature>.mp4
```

Optional feature-specific repro scripts live under `scripts/dev/*-playwright.mjs`.

Only after (1)-(4): send operator **links**, **what to click**, **declared tier (4b vs 4c) + one-line rationale**, and **inline media in HAPI web** (§6.4d; not Cursor IDE composer). See `docs/tooling/peer-stack.md`.

### 7 — Operator dogfood

Operator validates in browser. Iterate in the worktree; re-run gates after each round. **Do not** open upstream PR until explicit approval. Inline Playwright proof ([§6.4d](#4d--inline-in-hapi-chat-mandatory-for-4b4c-operator-reads-sessions-in-the-web-app)) satisfies **ready for operator** handoff — it does **not** substitute for operator click-test on `:3006` or unilateral PR open unless the operator says otherwise in chat.

**Soup promotion on `:3006` (default — peer-owned):** the **feature peer** edits **repo** `config/driver-manifest.yaml`, commits on mirror same turn, optionally mirrors to ~/.config via `scripts/tooling/hapi-manifest-mirror-to-config.sh`, then `hapi-driver-rebuild --build-web --verify`, `hapi-verify-web-dist`, and `hapi-restart-hub` if hub/cli/shared changed. See [feature-work-lifecycle.md § Soup promotion](./feature-work-lifecycle.md#soup-promotion-peer-owned--default-not-optional). **Do not** ask the operator to add manifest layers or grant permission to soup-promote.

### 8 — Upstream PR (after approval)

1. `/verification-before-completion` with command output
2. `/requesting-code-review` on `git diff upstream/main...HEAD`
3. `gh pr create` against `tiann/hapi` `main` — link issue (`Fixes #NNN`)
4. **Visual evidence on GitHub (not in git)** — same tier as §6.4; attach without committing binaries. Prefer `hapi-dogfood-shot --from <asset> --pr <upstream-or-fork>#N` ([`dogfood-shot.md` § PR attach](./dogfood-shot.md#pr-attach-recommended-path)). Exact `user-attachments/assets/…` still = GitHub UI drag-drop. Link the HAPI session URL from operator dogfood inline post.
   - **UI changed (§6.4b):** embed the handoff PNG
   - **Interaction tier (§6.4c):** embed the same GIF or short MP4 used in the HAPI handoff chat — reviewers should not need to run soup to see a toggle toggle
5. Post-push: [pr-review-loop.md](./pr-review-loop.md)

To land on daily soup after merge: owning peer **drops** the layer from the manifest and cleans the worktree/branch; meta rematerializes soup **once** the merge-wave cleanups are done — see [`feature-work-lifecycle.md` § After upstream merge](./feature-work-lifecycle.md#after-upstream-merge-fleet-cleanup--meta-sweep-must-advise-this).

---

## Ship / done semantics

See [feature-work-lifecycle.md § Ship / done semantics](./feature-work-lifecycle.md#ship--done-semantics).

---

## Related

- [feature-work-lifecycle.md](./feature-work-lifecycle.md) — **workflow (sole source)**
- [driver-soup.md](./driver-soup.md) — manifest, DB jiu-jitsu
- [worktree-testing.md](./worktree-testing.md) — `hapi-use-worktree`, env symlinks
- [pr-review-loop.md](./pr-review-loop.md) — pre-PR and post-push discipline
- [peer-stack.md](./peer-stack.md) — isolated peer hub for Playwright handoff
- [README.md](./README.md) — meta bot charter
